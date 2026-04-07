import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';
import { mockOutreach } from '@/lib/mock-data';

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');

  if (!isSupabaseConfigured() || process.env.USE_MOCK_DATA === 'true') {
    let data = [...mockOutreach];
    if (status) data = data.filter(o => o.status === status);
    return NextResponse.json(data);
  }

  let query = supabase
    .from('outreach')
    .select('*, creators(name)')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data?.map(o => ({ ...o, creator_name: o.creators?.name })) ?? [],
  );
}
