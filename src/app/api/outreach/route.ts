import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');

  if (!isSupabaseConfigured()) {
    return NextResponse.json([]);
  }

  let query = supabase
    .from('outreach')
    .select('*, creators(name)')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    (data ?? []).map(o => ({
      ...o,
      creator_name: (o as unknown as { creators?: { name: string } }).creators?.name,
    })),
  );
}
