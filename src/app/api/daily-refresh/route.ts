import { NextRequest, NextResponse } from 'next/server';
import { discoverLeads } from '@/lib/discover-leads';
import { log } from '@/lib/logger';

export const maxDuration = 300;

/**
 * Daily lead refresh — triggered by Vercel Cron at 13:00 UTC (8:00 AM EST).
 *
 * Schedule is configured in vercel.json as "0 13 * * *".
 * Vercel cron uses UTC exclusively, so we convert:
 *   - 13:00 UTC = 08:00 EST (UTC-5, Nov–Mar)
 *   - 13:00 UTC = 09:00 EDT (UTC-4, Mar–Nov)
 * DST caveat: during Eastern Daylight Time (mid-March to early November),
 * this runs at 9:00 AM local instead of 8:00 AM. Vercel does not support
 * timezone-aware cron, so this is the expected tradeoff.
 *
 * Security: Vercel automatically sends an Authorization header with
 * Bearer <CRON_SECRET> when invoking cron jobs. If CRON_SECRET is set
 * in environment variables, this route rejects any request without it,
 * ensuring only Vercel's scheduler can trigger it.
 *
 * Uses the same discoverLeads() pipeline as the manual "Refresh Leads" button.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron (or allow if no secret configured)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    log.warn('daily-refresh: rejected unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log.info('daily-refresh: starting scheduled run');

  try {
    // Cron jobs get longer timeouts — run full enrichment
    const result = await discoverLeads({ skipEnrichment: false, timeoutMs: 60_000 });

    const ytNew = result.youtube.new;
    const xNew = result.x.new;
    const ytUpdated = result.youtube.updated;
    const xUpdated = result.x.updated;
    const enriched = result.enrichment.enriched;

    log.info('daily-refresh: completed', {
      new_leads: ytNew + xNew,
      updated_leads: ytUpdated + xUpdated,
      enriched,
      youtube: { new: ytNew, updated: ytUpdated, discovered: result.youtube.discovered },
      x: { new: xNew, updated: xUpdated, discovered: result.x.discovered },
      duration_sec: Math.round(
        (new Date(result.completed_at).getTime() - new Date(result.started_at).getTime()) / 1000,
      ),
    });

    return NextResponse.json({
      message: 'Daily refresh completed',
      new_leads: ytNew + xNew,
      updated_leads: ytUpdated + xUpdated,
      enriched,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Daily refresh failed';
    log.error('daily-refresh: failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
