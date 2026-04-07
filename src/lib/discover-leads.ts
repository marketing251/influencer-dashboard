/**
 * Shared discovery pipeline used by both the scheduled daily refresh
 * and the manual "Refresh Leads" button.
 *
 * Runs YouTube + X discovery in parallel, then enriches creators
 * that have a website but no email.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { enrichFromWebsite } from './integrations/website-enrichment';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { discoverYouTubeCreators } from './integrations/youtube';
import { discoverXCreators } from './integrations/x';
import { upsertCreator, logDiscoveryRun } from './pipeline';
import { withLogging, log } from './logger';

export interface DiscoverLeadsResult {
  started_at: string;
  completed_at: string;
  youtube: PlatformResult;
  x: PlatformResult;
  enrichment: { attempted: number; enriched: number; errors: number };
}

interface PlatformResult {
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

async function runPlatformDiscovery(
  platform: 'youtube' | 'x',
  fetchFn: () => Promise<{ creator: Parameters<typeof upsertCreator>[0]; posts: Parameters<typeof upsertCreator>[1] }[]>,
): Promise<PlatformResult> {
  const { result: discoveries, error: fetchError } = await withLogging(
    `discoverLeads.${platform}`,
    fetchFn,
  );

  if (fetchError || !discoveries) {
    await logDiscoveryRun(platform, 0, 0, [fetchError ?? 'Unknown error'], 'failed');
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
  await logDiscoveryRun(platform, newCount, updatedCount, errors, status as 'completed' | 'failed');

  return {
    discovered: discoveries.length,
    new: newCount,
    updated: updatedCount,
    skipped: discoveries.length - newCount - updatedCount,
    errors: errors.length,
    error_details: errors.slice(0, 10),
  };
}

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
            .from('creators')
            .select('prop_firms_mentioned')
            .eq('id', creator.id)
            .single();
          updates.prop_firms_mentioned = [
            ...new Set([...(existing?.prop_firms_mentioned ?? []), ...enrichment.prop_firms_mentioned]),
          ];
        }

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

/**
 * Run the full discovery pipeline: YouTube + X in parallel, then enrichment.
 */
export async function discoverLeads(): Promise<DiscoverLeadsResult> {
  const startedAt = new Date().toISOString();
  log.info('discoverLeads: started');

  // Run platform discoveries in parallel
  const [youtube, x] = await Promise.all([
    process.env.YOUTUBE_API_KEY
      ? runPlatformDiscovery('youtube', () =>
          discoverYouTubeCreators({ maxPerQuery: 5, minSubscribers: 1_000, fetchVideosAbove: 10_000, maxVideoFetches: 10 }),
        )
      : Promise.resolve(skippedResult('YOUTUBE_API_KEY not set')),
    process.env.X_BEARER_TOKEN
      ? runPlatformDiscovery('x', () =>
          discoverXCreators({ maxPerQuery: 20, minFollowers: 1_000, delayMs: 2_000 }),
        )
      : Promise.resolve(skippedResult('X_BEARER_TOKEN not set')),
  ]);

  // Run enrichment
  const { result: enrichment } = await withLogging('discoverLeads.enrichment', runEnrichment);

  const completedAt = new Date().toISOString();

  log.info('discoverLeads: completed', {
    youtube_new: youtube.new, x_new: x.new,
    enriched: enrichment?.enriched ?? 0,
  });

  return {
    started_at: startedAt,
    completed_at: completedAt,
    youtube,
    x,
    enrichment: enrichment ?? { attempted: 0, enriched: 0, errors: 0 },
  };
}
