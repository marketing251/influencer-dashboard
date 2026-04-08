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
      timeoutMs: 8_000,       // 8s per provider (Vercel Hobby 10s limit)
      enrichmentBudget: 5,    // enrich top 5 (fast, fits timeout)
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    log.error('api.refresh-leads: failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
