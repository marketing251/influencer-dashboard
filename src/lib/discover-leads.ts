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
  enrichment: { attempted: number; enriched: number; emails_found: number; phones_found: number; errors: number };
  summary: {
    total_new: number;
    total_updated: number;
    total_skipped: number;
    total_errors: number;
    target: number;
    target_reached: boolean;
    reason?: string;
  };
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

async function runEnrichment(maxCreators = 15): Promise<{ attempted: number; enriched: number; emails_found: number; phones_found: number; errors: number }> {
  const stats = { attempted: 0, enriched: 0, emails_found: 0, phones_found: 0, errors: 0 };
  if (!isSupabaseConfigured()) return stats;

  // Priority 1: creators with websites but NO email (highest value enrichment)
  const { data: needEmail } = await supabaseAdmin
    .from('creators')
    .select('id, website, link_in_bio_url, public_email, public_phone, instagram_url, linkedin_url, youtube_url, x_url, discord_url, telegram_url, course_url, contact_form_url, has_skool, has_whop, niche, primary_platform, prop_firms_mentioned')
    .not('website', 'is', null)
    .is('public_email', null)
    .order('total_followers', { ascending: false })
    .limit(maxCreators);

  // Priority 2: creators with email but missing other fields
  const remaining = maxCreators - (needEmail?.length ?? 0);
  let needOther: typeof needEmail = [];
  if (remaining > 0) {
    const { data } = await supabaseAdmin
      .from('creators')
      .select('id, website, link_in_bio_url, public_email, public_phone, instagram_url, linkedin_url, youtube_url, x_url, discord_url, telegram_url, course_url, contact_form_url, has_skool, has_whop, niche, primary_platform, prop_firms_mentioned')
      .not('website', 'is', null)
      .not('public_email', 'is', null)
      .or('instagram_url.is.null,linkedin_url.is.null,niche.is.null')
      .order('lead_score', { ascending: false })
      .limit(remaining);
    needOther = data ?? [];
  }

  const allToEnrich = [...(needEmail ?? []), ...needOther];
  if (!allToEnrich.length) return stats;

  log.info('enrichment: starting', { total: allToEnrich.length, needEmail: needEmail?.length ?? 0, needOther: needOther.length });

  for (const creator of allToEnrich) {
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

      // Contact info — highest priority enrichment
      if (enrichment.emails.length > 0 && !creator.public_email) {
        updates.public_email = enrichment.emails[0];
        changed = true;
        stats.emails_found++;
      }
      if (enrichment.phones.length > 0 && !creator.public_phone) {
        updates.public_phone = enrichment.phones[0];
        changed = true;
        stats.phones_found++;
      }
      // Contact form URL from enrichment
      if (enrichment.contact_form_url && !creator.contact_form_url) {
        updates.contact_form_url = enrichment.contact_form_url;
        changed = true;
      }

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
export async function discoverLeads(opts?: { skipEnrichment?: boolean; timeoutMs?: number; enrichmentBudget?: number }): Promise<DiscoverLeadsResult> {
  const startedAt = new Date().toISOString();
  const providerTimeout = opts?.timeoutMs ?? 8_000; // 8s default fits Vercel Hobby 10s limit
  log.info('discoverLeads: started', { providerTimeout });

  // Run all API providers in parallel with timeout per provider
  const apiProviders = getApiProviders();
  const platformResults: Record<string, PlatformResult> = {};

  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);

  const settled = await Promise.allSettled(
    apiProviders.map(async provider => {
      const result = await withTimeout(runProvider(provider), providerTimeout, provider.label);
      return { platform: provider.platform, result };
    }),
  );

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      platformResults[s.value.platform] = s.value.result;
    } else {
      const errMsg = s.reason?.message ?? 'Unknown error';
      log.warn('discoverLeads: provider failed/timed out', { error: errMsg });
      // Still record it so UI knows what happened
      const timedOut = errMsg.includes('timed out');
      // We don't know which provider this was from allSettled, so skip
    }
  }

  // Run enrichment only if not skipped (skip on Vercel Hobby to stay under 10s)
  let enrichmentResult = { attempted: 0, enriched: 0, emails_found: 0, phones_found: 0, errors: 0 };
  if (!opts?.skipEnrichment) {
    const budget = opts?.enrichmentBudget ?? 15;
    const { result: enrichment } = await withLogging('discoverLeads.enrichment', () => runEnrichment(budget));
    if (enrichment) enrichmentResult = enrichment;
  }

  const completedAt = new Date().toISOString();

  // Compute summary across all providers
  const TARGET = 100;
  let totalNew = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;
  for (const r of Object.values(platformResults)) {
    totalNew += r.new;
    totalUpdated += r.updated;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }

  const targetReached = totalNew >= TARGET;
  let reason: string | undefined;
  if (!targetReached) {
    const discovered = Object.values(platformResults).reduce((s, r) => s + r.discovered, 0);
    if (discovered === 0) reason = 'No sources returned results — check API keys and quotas';
    else if (totalNew + totalUpdated > 0) reason = `Found ${discovered} candidates but only ${totalNew} were new (${totalUpdated} already in DB)`;
    else reason = `All ${discovered} discovered candidates were duplicates`;
  }

  log.info('discoverLeads: completed', { totalNew, totalUpdated, totalErrors, targetReached, enriched: enrichmentResult.enriched });

  return {
    started_at: startedAt,
    completed_at: completedAt,
    platforms: platformResults,
    enrichment: enrichmentResult,
    summary: { total_new: totalNew, total_updated: totalUpdated, total_skipped: totalSkipped, total_errors: totalErrors, target: TARGET, target_reached: targetReached, reason },
    youtube: platformResults['youtube'] ?? skippedResult('YouTube provider not registered'),
    x: platformResults['x'] ?? skippedResult('X provider not registered'),
  };
}
