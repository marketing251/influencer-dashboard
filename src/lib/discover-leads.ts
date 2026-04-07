/**
 * Shared discovery pipeline used by both the scheduled daily refresh
 * and the manual "Refresh Leads" button.
 *
 * Uses the provider registry to run all configured API providers in parallel,
 * then runs website enrichment on creators that have a website but no email.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { enrichFromWebsite } from './integrations/website-enrichment';
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

async function runEnrichment(): Promise<{ attempted: number; enriched: number; errors: number }> {
  const stats = { attempted: 0, enriched: 0, errors: 0 };
  if (!isSupabaseConfigured()) return stats;

  const { data: creatorsToEnrich } = await supabaseAdmin
    .from('creators')
    .select('id, website')
    .not('website', 'is', null)
    .is('public_email', null)
    .order('lead_score', { ascending: false })
    .limit(20);

  if (!creatorsToEnrich?.length) return stats;

  for (const creator of creatorsToEnrich) {
    stats.attempted++;
    try {
      const enrichment = await enrichFromWebsite(creator.website);

      if (enrichment.emails.length > 0 || enrichment.prop_firms_mentioned.length > 0) {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

        if (enrichment.emails.length > 0) updates.public_email = enrichment.emails[0];
        if (enrichment.phones.length > 0) updates.public_phone = enrichment.phones[0];
        if (enrichment.has_course) updates.has_course = true;
        if (enrichment.has_discord) updates.has_discord = true;
        if (enrichment.has_telegram) updates.has_telegram = true;
        if (enrichment.prop_firms_mentioned.length > 0) {
          updates.promoting_prop_firms = true;
          const { data: existing } = await supabaseAdmin
            .from('creators').select('prop_firms_mentioned').eq('id', creator.id).single();
          updates.prop_firms_mentioned = [
            ...new Set([...(existing?.prop_firms_mentioned ?? []), ...enrichment.prop_firms_mentioned]),
          ];
        }

        await supabaseAdmin.from('creators').update(updates).eq('id', creator.id);

        const { data: full } = await supabaseAdmin.from('creators').select('*').eq('id', creator.id).single();
        const { data: accounts } = await supabaseAdmin
          .from('creator_accounts').select('followers, platform, verified').eq('creator_id', creator.id);

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

// ─── Main orchestrator ──────────────────────────────────────────────

/**
 * Run the full discovery pipeline:
 * 1. All configured API providers in parallel
 * 2. Website enrichment for creators missing email
 */
export async function discoverLeads(): Promise<DiscoverLeadsResult> {
  const startedAt = new Date().toISOString();
  log.info('discoverLeads: started');

  // Run all API providers in parallel
  const apiProviders = getApiProviders();
  const platformResults: Record<string, PlatformResult> = {};

  const results = await Promise.all(
    apiProviders.map(async provider => {
      const result = await runProvider(provider);
      return { platform: provider.platform, result };
    }),
  );

  for (const { platform, result } of results) {
    platformResults[platform] = result;
  }

  // Run enrichment
  const { result: enrichment } = await withLogging('discoverLeads.enrichment', runEnrichment);

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
