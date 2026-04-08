import { NextResponse } from 'next/server';
import { discoverLeads } from '@/lib/discover-leads';
import { log } from '@/lib/logger';

// Vercel Hobby: 10s. Pro: up to 300s.
// We need enrichment to extract emails, so allow full duration.
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await discoverLeads({
      skipEnrichment: false,   // MUST run enrichment to extract emails
      timeoutMs: 45_000,      // 45s per provider (YouTube needs time for 30 queries)
      enrichmentBudget: 20,   // enrich up to 20 creators per refresh
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    log.error('api.refresh-leads: failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
