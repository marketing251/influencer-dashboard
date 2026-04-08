import { NextResponse } from 'next/server';
import { discoverLeads } from '@/lib/discover-leads';
import { log } from '@/lib/logger';

// Vercel Hobby: 10s max. Pro: up to 300s.
export const maxDuration = 60;

export async function POST() {
  try {
    // Skip enrichment and use 8s timeout per provider to fit within Vercel limits.
    // Enrichment runs separately via the daily cron job.
    const result = await discoverLeads({
      skipEnrichment: true,
      timeoutMs: 8_000,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    log.error('api.refresh-leads: failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
