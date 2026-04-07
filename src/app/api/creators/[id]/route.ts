import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';
import { getMockCreatorWithAccounts } from '@/lib/mock-data';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isSupabaseConfigured() || process.env.USE_MOCK_DATA === 'true') {
    const creator = getMockCreatorWithAccounts(id);
    if (!creator) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(creator);
  }

  const { data: creator, error } = await supabase
    .from('creators')
    .select('*, creator_accounts(*), creator_posts(*), outreach(*)')
    .eq('id', id)
    .single();

  if (error || !creator) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...creator,
    accounts: creator.creator_accounts,
    posts: creator.creator_posts,
    outreach_history: creator.outreach,
  });
}
