import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase, supabaseAdmin } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { data: creator, error } = await supabase
    .from('creators')
    .select('*, creator_accounts(*), creator_posts(*), outreach(*)')
    .eq('id', id)
    .neq('excluded_from_leads', true)  // never expose excluded leads
    .single();

  if (error || !creator) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...creator,
    accounts: creator.creator_accounts ?? [],
    posts: creator.creator_posts ?? [],
    outreach_history: creator.outreach ?? [],
    prop_firms_mentioned: creator.prop_firms_mentioned ?? [],
  });
}

/**
 * PATCH /api/creators/[id]
 *
 * Accepts a small whitelist of updatable fields. Currently used by the
 * Daily Leads UI to toggle `hidden_from_daily_leads` (soft-hide) so a
 * user can dismiss a creator without deleting the row from the DB.
 * Dedup/exclusion-index logic is unaffected — hidden rows still exist.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof input.hidden_from_daily_leads === 'boolean') {
    update.hidden_from_daily_leads = input.hidden_from_daily_leads;
  }

  // No recognized fields → reject rather than silently no-op
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('creators')
    .update(update)
    .eq('id', id)
    .select('id, hidden_from_daily_leads')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, creator: data });
}
