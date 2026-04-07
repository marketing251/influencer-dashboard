import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';
import { enrichFromWebsite } from '@/lib/integrations/website-enrichment';
import { computeLeadScore, computeConfidenceScore } from '@/lib/scoring';
import { withLogging, log } from '@/lib/logger';

export const maxDuration = 300; // 5 min for Vercel Pro, 60s for Hobby

/**
 * Daily refresh endpoint — triggered by Vercel Cron.
 *
 * Pipeline:
 * 1. Run YouTube discovery
 * 2. Run X discovery (in parallel with YouTube)
 * 3. Enrich creators that have a website but no email (sequential, rate-limited)
 * 4. Return summary
 */
export async function GET(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    log.warn('daily-refresh: unauthorized attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log.info('daily-refresh: started');
  const startedAt = new Date().toISOString();
  const baseUrl = request.nextUrl.origin;

  // Phase 1 & 2: Run platform discoveries in parallel
  const [ytResult, xResult] = await Promise.allSettled([
    withLogging('daily-refresh.youtube', async () => {
      const res = await fetch(`${baseUrl}/api/discover/youtube`, { method: 'POST' });
      return res.json();
    }),
    withLogging('daily-refresh.x', async () => {
      const res = await fetch(`${baseUrl}/api/discover/x`, { method: 'POST' });
      return res.json();
    }),
  ]);

  const youtube = ytResult.status === 'fulfilled' ? ytResult.value.result : { error: ytResult.reason?.message ?? 'Failed' };
  const x = xResult.status === 'fulfilled' ? xResult.value.result : { error: xResult.reason?.message ?? 'Failed' };

  // Phase 3: Website enrichment for creators with website but no email
  let enrichmentStats = { attempted: 0, enriched: 0, errors: 0 };

  if (isSupabaseConfigured()) {
    const { result: stats } = await withLogging('daily-refresh.enrichment', async () => {
      const { data: creatorsToEnrich } = await supabaseAdmin
        .from('creators')
        .select('id, website')
        .not('website', 'is', null)
        .is('public_email', null)
        .order('lead_score', { ascending: false })
        .limit(20); // Limit to avoid long runtimes

      const stats = { attempted: 0, enriched: 0, errors: 0 };
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
              // Merge with existing
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

            // Recalculate scores
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
          log.warn('daily-refresh.enrichment: failed for creator', { creator_id: creator.id, error: String(err) });
          stats.errors++;
        }
      }

      return stats;
    });

    if (stats) enrichmentStats = stats;
  }

  const completedAt = new Date().toISOString();

  const summary = {
    message: 'Daily refresh completed',
    started_at: startedAt,
    completed_at: completedAt,
    youtube,
    x,
    enrichment: enrichmentStats,
  };

  log.info('daily-refresh: completed', {
    youtube: typeof youtube === 'object' && youtube && 'new' in youtube ? (youtube as Record<string, unknown>).new : 'error',
    x: typeof x === 'object' && x && 'new' in x ? (x as Record<string, unknown>).new : 'error',
    enrichment: enrichmentStats,
  });

  return NextResponse.json(summary);
}
