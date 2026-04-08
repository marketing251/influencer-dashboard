import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';

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
