import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/db';
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
    has_instagram: params.get('has_instagram') === 'true' ? true : undefined,
    has_linkedin: params.get('has_linkedin') === 'true' ? true : undefined,
    new_today: params.get('new_today') === 'true' ? true : undefined,
    status: params.get('status') as CreatorFilters['status'] ?? undefined,
    search: params.get('search') || undefined,
    sort_by: (params.get('sort_by') as CreatorFilters['sort_by']) || 'lead_score',
    sort_order: (params.get('sort_order') as CreatorFilters['sort_order']) || 'desc',
  };

  if (!isSupabaseConfigured()) {
    return NextResponse.json([]);
  }

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
  if (filters.has_instagram) query = query.not('instagram_url', 'is', null);
  if (filters.has_linkedin) query = query.not('linkedin_url', 'is', null);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) query = query.ilike('name', `%${filters.search}%`);

  // "New today" filter: first_seen_at starts with today's date
  if (filters.new_today) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    query = query.gte('first_seen_at', todayStart.toISOString());
  }

  // Sort — map 'followers' to actual column name
  const sortColumn = filters.sort_by === 'followers' ? 'total_followers' : filters.sort_by ?? 'lead_score';
  query = query.order(sortColumn, { ascending: filters.sort_order === 'asc' });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
