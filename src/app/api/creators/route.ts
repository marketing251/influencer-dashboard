import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';
import { mockCreators, mockAccounts } from '@/lib/mock-data';
import type { CreatorFilters } from '@/lib/types';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const filters: CreatorFilters = {
    platform: params.get('platform') as CreatorFilters['platform'] ?? undefined,
    min_followers: params.get('min_followers') ? Number(params.get('min_followers')) : undefined,
    max_followers: params.get('max_followers') ? Number(params.get('max_followers')) : undefined,
    has_course: params.get('has_course') === 'true' ? true : undefined,
    has_discord: params.get('has_discord') === 'true' ? true : undefined,
    has_telegram: params.get('has_telegram') === 'true' ? true : undefined,
    promoting_prop_firms: params.get('promoting_prop_firms') === 'true' ? true : undefined,
    status: params.get('status') as CreatorFilters['status'] ?? undefined,
    search: params.get('search') || undefined,
    sort_by: (params.get('sort_by') as CreatorFilters['sort_by']) || 'lead_score',
    sort_order: (params.get('sort_order') as CreatorFilters['sort_order']) || 'desc',
  };

  // Use mock data if Supabase is not configured
  if (!isSupabaseConfigured() || process.env.USE_MOCK_DATA === 'true') {
    return NextResponse.json(filterMockCreators(filters));
  }

  // Supabase query
  let query = supabase.from('creators').select('*, creator_accounts(*)');

  if (filters.platform) {
    query = query.contains('creator_accounts.platform', [filters.platform]);
  }
  if (filters.min_followers) query = query.gte('total_followers', filters.min_followers);
  if (filters.max_followers) query = query.lte('total_followers', filters.max_followers);
  if (filters.has_course) query = query.eq('has_course', true);
  if (filters.has_discord) query = query.eq('has_discord', true);
  if (filters.has_telegram) query = query.eq('has_telegram', true);
  if (filters.promoting_prop_firms) query = query.eq('promoting_prop_firms', true);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) query = query.ilike('name', `%${filters.search}%`);
  if (filters.sort_by) {
    query = query.order(filters.sort_by, { ascending: filters.sort_order === 'asc' });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

function filterMockCreators(filters: CreatorFilters) {
  let creators = [...mockCreators];

  if (filters.platform) {
    const platformCreatorIds = new Set(
      mockAccounts.filter(a => a.platform === filters.platform).map(a => a.creator_id),
    );
    creators = creators.filter(c => platformCreatorIds.has(c.id));
  }
  if (filters.min_followers) creators = creators.filter(c => c.total_followers >= filters.min_followers!);
  if (filters.max_followers) creators = creators.filter(c => c.total_followers <= filters.max_followers!);
  if (filters.has_course) creators = creators.filter(c => c.has_course);
  if (filters.has_discord) creators = creators.filter(c => c.has_discord);
  if (filters.has_telegram) creators = creators.filter(c => c.has_telegram);
  if (filters.promoting_prop_firms) creators = creators.filter(c => c.promoting_prop_firms);
  if (filters.status) creators = creators.filter(c => c.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    creators = creators.filter(c => c.name.toLowerCase().includes(q));
  }

  const sortBy = filters.sort_by || 'lead_score';
  const order = filters.sort_order === 'asc' ? 1 : -1;
  creators.sort((a, b) => {
    const aVal = a[sortBy as keyof typeof a];
    const bVal = b[sortBy as keyof typeof b];
    if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * order;
    return String(aVal).localeCompare(String(bVal)) * order;
  });

  // Attach accounts
  return creators.map(c => ({
    ...c,
    accounts: mockAccounts.filter(a => a.creator_id === c.id),
  }));
}
