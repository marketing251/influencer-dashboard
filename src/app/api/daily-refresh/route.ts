import { NextRequest, NextResponse } from 'next/server';
import { discoverLeads } from '@/lib/discover-leads';
import { log } from '@/lib/logger';

export const maxDuration = 300;

/**
 * Daily refresh endpoint — triggered by Vercel Cron.
 * Uses the same discoverLeads() pipeline as the manual Refresh Leads button.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    log.warn('daily-refresh: unauthorized attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await discoverLeads();
    return NextResponse.json({ message: 'Daily refresh completed', ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Daily refresh failed';
    log.error('daily-refresh: failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
