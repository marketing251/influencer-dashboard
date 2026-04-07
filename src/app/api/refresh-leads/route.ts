import { NextResponse } from 'next/server';
import { discoverLeads } from '@/lib/discover-leads';

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await discoverLeads();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    console.error('[api/refresh-leads]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
