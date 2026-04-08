/**
 * Shared discovery pipeline used by both the scheduled daily refresh
 * and the manual "Refresh Leads" button.
 *
 * Uses the provider registry to run all configured API providers in parallel,
 * then runs website enrichment on creators that have a website but no email.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { enrichFromWebsite } from './integrations/website-enrichment';
import { crawlLinkInBio } from './integrations/link-in-bio';
import { extractAllSignals, isLinkInBioUrl } from './social-links';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { upsertCreator, logDiscoveryRun } from './pipeline';
import { withLogging, log } from './logger';
import { getApiProviders } from './discovery/registry';
import type { DiscoveryProvider } from './discovery/provider';
import type { Platform } from './types';

// ─── Result types ───────────────────────────────────────────────────

export interface DiscoverLeadsResult {
  started_at: string;
  completed_at: string;
  platforms: Record<string, PlatformResult>;
  enrichment: { attempted: number; enriched: number; errors: number };
  /** Legacy accessors so existing UI code doesn't break. */
  youtube: PlatformResult;
  x: PlatformResult;
}

export interface PlatformResult {
  discovered: number;
  new: number;
  updated: number;
  skipped: number;
  errors: number;
  error_details: string[];
  skippedReason?: string;
}

function skippedResult(reason: string): PlatformResult {
  return { discovered: 0, new: 0, updated: 0, skipped: 0, errors: 0, error_details: [], skippedReason: reason };
}

// ─── Per-provider execution ─────────────────────────────────────────

async function runProvider(provider: DiscoveryProvider): Promise<PlatformResult> {
  if (!provider.isConfigured()) {
    return skippedResult(provider.configHint());
  }

  const { result: discoveries, error: fetchError } = await withLogging(
    `discoverLeads.${provider.platform}`,
    () => provider.discover(),
  );

  if (fetchError || !discoveries) {
    await logDiscoveryRun(provider.platform as Platform, 0, 0, [fetchError ?? 'Unknown error'], 'failed');
    return { discovered: 0, new: 0, updated: 0, skipped: 0, errors: 1, error_details: [fetchError ?? 'Unknown error'] };
  }

  let newCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (const { creator, posts } of discoveries) {
    const result = await upsertCreator(creator, posts);
    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updatedCount++;
    if (result.error) errors.push(`${result.name}: ${result.error}`);
  }

  const status = errors.length > discoveries.length / 2 ? 'failed' : 'completed';
  await logDiscoveryRun(provider.platform as Platform, newCount, updatedCount, errors, status);

  return {
    discovered: discoveries.length,
    new: newCount,
    updated: updatedCount,
    skipped: discoveries.length - newCount - updatedCount,
    errors: errors.length,
    error_details: errors.slice(0, 10),
  };
}

// ─── Website enrichment ─────────────────────────────────────────────

async function runEnrichment(maxCreators = 10): Promise<{ attempted: number; enriched: number; errors: number }> {
  const stats = { attempted: 0, enriched: 0, errors: 0 };
  if (!isSupabaseConfigured()) return stats;

  const { data: creatorsToEnrich } = await supabaseAdmin
    .from('creators')
    .select('id, website, link_in_bio_url, public_email, instagram_url, linkedin_url, youtube_url, x_url, discord_url, telegram_url, course_url, has_skool, has_whop, niche, primary_platform, prop_firms_mentioned')
    .not('website', 'is', null)
    .order('lead_score', { ascending: false })
    .limit(maxCreators);

  const needsEnrichment = (creatorsToEnrich ?? []).filter(c =>
    !c.public_email || !c.instagram_url || !c.linkedin_url || !c.youtube_url || !c.x_url || !c.niche || !c.primary_platform,
  );
  if (!needsEnrichment.length) return stats;

  for (const creator of needsEnrichment) {
    stats.attempted++;
    try {
      // Step 1: Crawl website
      const enrichment = await enrichFromWebsite(creator.website);
      const allLinkText = enrichment.social_links.map(l => l.url).join(' ');
      let signals = extractAllSignals(allLinkText);

      // Step 2: If we found a link-in-bio URL (or the creator already has one), crawl it too
      const libUrl = signals.link_in_bio_url || creator.link_in_bio_url
        || (isLinkInBioUrl(creator.website) ? creator.website : null);
      if (libUrl) {
        try {
          const libResult = await crawlLinkInBio(libUrl);
          // Merge link-in-bio signals with website signals
          const libText = libResult.allLinks.join(' ');
          const libSignals = extractAllSignals(libText);
          signals = {
            instagram_url: signals.instagram_url || libSignals.instagram_url,
            linkedin_url: signals.linkedin_url || libSignals.linkedin_url,
            youtube_url: signals.youtube_url || libSignals.youtube_url,
            x_url: signals.x_url || libSignals.x_url,
            discord_url: signals.discord_url || libResult.discordUrl || libSignals.discord_url,
            telegram_url: signals.telegram_url || libResult.telegramUrl || libSignals.telegram_url,
            link_in_bio_url: libUrl,
            course_url: signals.course_url || libResult.courseUrls[0] || libSignals.course_url,
            has_skool: signals.has_skool || libSignals.has_skool,
            has_whop: signals.has_whop || libSignals.has_whop,
          };
          // Merge emails and prop firms from link-in-bio
          if (libResult.emails.length > 0 && !enrichment.emails.length) {
            enrichment.emails.push(...libResult.emails);
          }
          if (libResult.propFirmsMentioned.length > 0) {
            enrichment.prop_firms_mentioned.push(...libResult.propFirmsMentioned);
          }
        } catch {
          log.debug('enrichment: link-in-bio crawl failed', { url: libUrl });
        }
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let changed = false;

      // Contact info
      if (enrichment.emails.length > 0 && !creator.public_email) { updates.public_email = enrichment.emails[0]; changed = true; }
      if (enrichment.phones.length > 0) { updates.public_phone = enrichment.phones[0]; changed = true; }

      // Boolean signals
      if (enrichment.has_course) { updates.has_course = true; changed = true; }
      if (enrichment.has_discord) { updates.has_discord = true; changed = true; }
      if (enrichment.has_telegram) { updates.has_telegram = true; changed = true; }
      if (signals.has_skool && !creator.has_skool) { updates.has_skool = true; changed = true; }
      if (signals.has_whop && !creator.has_whop) { updates.has_whop = true; changed = true; }

      // Prop firms
      const allFirms = [...new Set([...(creator.prop_firms_mentioned ?? []), ...enrichment.prop_firms_mentioned])];
      if (allFirms.length > (creator.prop_firms_mentioned ?? []).length) {
        updates.promoting_prop_firms = true;
        updates.prop_firms_mentioned = allFirms;
        changed = true;
      }

      // URLs
      const urlMap: [string, string | null | undefined, string | null][] = [
        ['instagram_url', creator.instagram_url, enrichment.social_links.find(l => l.platform === 'instagram')?.url ?? signals.instagram_url],
        ['linkedin_url', creator.linkedin_url, enrichment.social_links.find(l => l.platform === 'linkedin')?.url ?? signals.linkedin_url],
        ['youtube_url', creator.youtube_url, enrichment.social_links.find(l => l.platform === 'youtube')?.url ?? signals.youtube_url],
        ['x_url', creator.x_url, enrichment.social_links.find(l => l.platform === 'x')?.url ?? signals.x_url],
        ['discord_url', creator.discord_url, signals.discord_url],
        ['telegram_url', creator.telegram_url, signals.telegram_url],
        ['link_in_bio_url', creator.link_in_bio_url, signals.link_in_bio_url],
        ['course_url', creator.course_url, signals.course_url],
      ];
      for (const [field, existing, discovered] of urlMap) {
        if (!existing && discovered) { updates[field] = discovered; changed = true; }
      }

      // Niche classification (rule-based from all text)
      if (!creator.niche) {
        const niche = classifyNiche(enrichment.social_links.map(l => l.url).join(' ') + ' ' + (creator.website ?? ''));
        if (niche) { updates.niche = niche; changed = true; }
      }

      // Primary platform inference
      if (!creator.primary_platform) {
        const { data: accounts } = await supabaseAdmin
          .from('creator_accounts').select('platform, followers').eq('creator_id', creator.id);
        const primary = inferPrimaryPlatform(accounts ?? [], updates);
        if (primary) { updates.primary_platform = primary; changed = true; }
      }

      if (changed) {
        await supabaseAdmin.from('creators').update(updates).eq('id', creator.id);

        const { data: full } = await supabaseAdmin.from('creators').select('*').eq('id', creator.id).single();
        const { data: accounts } = await supabaseAdmin.from('creator_accounts').select('followers, platform, verified').eq('creator_id', creator.id);
        if (full) {
          const leadScore = computeLeadScore({ creator: full, accounts: accounts ?? [] });
          const confidenceScore = computeConfidenceScore({ creator: full, accounts: accounts ?? [] });
          await supabaseAdmin.from('creators').update({ lead_score: leadScore, confidence_score: confidenceScore }).eq('id', creator.id);
        }
        stats.enriched++;
      }
    } catch (err) {
      log.warn('discoverLeads.enrichment: failed', { creator_id: creator.id, error: String(err) });
      stats.errors++;
    }
  }

  return stats;
}

// ─── Classification helpers ─────────────────────────────────────────

const NICHE_PATTERNS: { niche: string; pattern: RegExp }[] = [
  { niche: 'forex', pattern: /\b(?:forex|fx|currency\s*trad)/i },
  { niche: 'crypto', pattern: /\b(?:crypto|bitcoin|btc|ethereum|defi|web3)/i },
  { niche: 'futures', pattern: /\b(?:futures|es|nq|nasdaq\s*futures|s&p\s*futures)/i },
  { niche: 'options', pattern: /\b(?:options|calls?\s*and\s*puts|iron\s*condor|spreads)/i },
  { niche: 'stocks', pattern: /\b(?:stocks?|equities|penny\s*stock|swing\s*trad)/i },
  { niche: 'prop_firm', pattern: /\b(?:prop\s*firm|funded\s*trader|ftmo|fundednext)/i },
  { niche: 'day_trading', pattern: /\b(?:day\s*trad|scalp|intraday)/i },
];

function classifyNiche(text: string): string | null {
  if (!text) return null;
  for (const { niche, pattern } of NICHE_PATTERNS) {
    if (pattern.test(text)) return niche;
  }
  return null;
}

function inferPrimaryPlatform(
  accounts: { platform: string; followers: number }[],
  updates: Record<string, unknown>,
): string | null {
  // Highest-follower account wins
  if (accounts.length > 0) {
    const sorted = [...accounts].sort((a, b) => b.followers - a.followers);
    return sorted[0].platform;
  }
  // Fall back to whichever URL is set
  const platformOrder = ['youtube', 'x', 'instagram', 'linkedin'];
  for (const p of platformOrder) {
    if (updates[`${p}_url`]) return p;
  }
  return null;
}

// ─── Main orchestrator ──────────────────────────────────────────────

/**
 * Run the full discovery pipeline:
 * 1. All configured API providers in parallel
 * 2. Website enrichment for creators missing email
 */
export async function discoverLeads(): Promise<DiscoverLeadsResult> {
  const startedAt = new Date().toISOString();
  log.info('discoverLeads: started');

  // Run all API providers in parallel with 60s timeout per provider
  const apiProviders = getApiProviders();
  const platformResults: Record<string, PlatformResult> = {};

  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);

  const settled = await Promise.allSettled(
    apiProviders.map(async provider => {
      const result = await withTimeout(runProvider(provider), 60_000, provider.label);
      return { platform: provider.platform, result };
    }),
  );

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      platformResults[s.value.platform] = s.value.result;
    } else {
      log.warn('discoverLeads: provider failed', { error: s.reason?.message });
    }
  }

  // Run enrichment (limit to 5 creators to keep total time under 90s)
  const { result: enrichment } = await withLogging('discoverLeads.enrichment', () => runEnrichment(5));

  const completedAt = new Date().toISOString();

  log.info('discoverLeads: completed', {
    platforms: Object.fromEntries(
      Object.entries(platformResults).map(([k, v]) => [k, { new: v.new, updated: v.updated }]),
    ),
    enriched: enrichment?.enriched ?? 0,
  });

  return {
    started_at: startedAt,
    completed_at: completedAt,
    platforms: platformResults,
    enrichment: enrichment ?? { attempted: 0, enriched: 0, errors: 0 },
    // Legacy accessors for existing UI
    youtube: platformResults['youtube'] ?? skippedResult('YouTube provider not registered'),
    x: platformResults['x'] ?? skippedResult('X provider not registered'),
  };
}
