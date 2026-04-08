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
    has_skool: params.get('has_skool') === 'true' ? true : undefined,
    has_whop: params.get('has_whop') === 'true' ? true : undefined,
    promoting_prop_firms: params.get('promoting_prop_firms') === 'true' ? true : undefined,
    has_instagram: params.get('has_instagram') === 'true' ? true : undefined,
    has_linkedin: params.get('has_linkedin') === 'true' ? true : undefined,
    has_website: params.get('has_website') === 'true' ? true : undefined,
    has_email: params.get('has_email') === 'true' ? true : undefined,
    has_phone: params.get('has_phone') === 'true' ? true : undefined,
    has_contact_form: params.get('has_contact_form') === 'true' ? true : undefined,
    has_any_contact: params.get('has_any_contact') === 'true' ? true : undefined,
    high_confidence: params.get('high_confidence') === 'true' ? true : undefined,
    new_today: params.get('new_today') === 'true' ? true : undefined,
    status: params.get('status') as CreatorFilters['status'] ?? undefined,
    search: params.get('search') || undefined,
    sort_by: (params.get('sort_by') as CreatorFilters['sort_by']) || 'lead_score',
    sort_order: (params.get('sort_order') as CreatorFilters['sort_order']) || 'desc',
  };

  if (!isSupabaseConfigured()) return NextResponse.json([]);

  let query = supabase.from('creators').select('*, creator_accounts(*)');

  // Exclude prop firms from leads list (we sell to them, not prospect them)
  query = query.or('is_prop_firm.is.null,is_prop_firm.eq.false');
  query = query.or('excluded_from_leads.is.null,excluded_from_leads.eq.false');

  if (filters.platform) query = query.contains('creator_accounts.platform', [filters.platform]);
  if (filters.min_followers) query = query.gte('total_followers', filters.min_followers);
  if (filters.max_followers) query = query.lte('total_followers', filters.max_followers);
  if (filters.has_course) query = query.eq('has_course', true);
  if (filters.has_discord) query = query.eq('has_discord', true);
  if (filters.has_telegram) query = query.eq('has_telegram', true);
  if (filters.has_skool) query = query.eq('has_skool', true);
  if (filters.has_whop) query = query.eq('has_whop', true);
  if (filters.promoting_prop_firms) query = query.eq('promoting_prop_firms', true);
  if (filters.has_instagram) query = query.not('instagram_url', 'is', null);
  if (filters.has_linkedin) query = query.not('linkedin_url', 'is', null);
  if (filters.has_website) query = query.not('website', 'is', null);
  if (filters.has_email) query = query.not('public_email', 'is', null);
  if (filters.has_phone) query = query.not('public_phone', 'is', null);
  if (filters.has_contact_form) query = query.not('contact_form_url', 'is', null);
  if (filters.has_any_contact) query = query.or('public_email.not.is.null,public_phone.not.is.null,contact_form_url.not.is.null');
  if (filters.high_confidence) query = query.gte('confidence_score', 70);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) query = query.ilike('name', `%${filters.search}%`);

  if (filters.new_today) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    query = query.gte('first_seen_at', todayStart.toISOString());
  }

  const sortColumn = filters.sort_by === 'followers' ? 'total_followers' : filters.sort_by ?? 'lead_score';
  query = query.order(sortColumn, { ascending: filters.sort_order === 'asc' });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Remap Supabase join name to what the UI expects
  const normalized = (data ?? []).map(c => ({
    ...c,
    accounts: c.creator_accounts ?? [],
    prop_firms_mentioned: c.prop_firms_mentioned ?? [],
  }));

  return NextResponse.json(normalized);
}
