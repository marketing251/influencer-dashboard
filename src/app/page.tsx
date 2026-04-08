import { StatsCards } from '@/components/stats-cards';
import { CreatorTable } from '@/components/creator-table';
import { isSupabaseConfigured, supabase } from '@/lib/db';
import type { DashboardStats, DailyDiscovery, Creator, CreatorAccount } from '@/lib/types';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };

async function fetchStats(): Promise<DashboardStats> {
  const empty: DashboardStats = {
    total_creators: 0, new_today: 0, total_with_email: 0,
    avg_lead_score: 0, outreach_sent: 0, outreach_replied: 0, platforms: [],
  };
  if (!isSupabaseConfigured()) return empty;

  const [creatorsRes, outreachRes, accountsRes] = await Promise.all([
    supabase.from('creators').select('id, public_email, lead_score, first_seen_at, created_at'),
    supabase.from('outreach').select('id, status'),
    supabase.from('creator_accounts').select('platform'),
  ]);

  const creators = creatorsRes.data ?? [];
  const outreach = outreachRes.data ?? [];
  const accounts = accountsRes.data ?? [];

  const today = new Date().toISOString().split('T')[0];
  const platformCounts = new Map<string, number>();
  for (const a of accounts) {
    platformCounts.set(a.platform, (platformCounts.get(a.platform) ?? 0) + 1);
  }

  return {
    total_creators: creators.length,
    new_today: creators.filter(c => (c.first_seen_at ?? c.created_at)?.startsWith(today)).length,
    total_with_email: creators.filter(c => c.public_email).length,
    avg_lead_score: creators.length
      ? Math.round(creators.reduce((s, c) => s + (c.lead_score ?? 0), 0) / creators.length)
      : 0,
    outreach_sent: outreach.filter(o => o.status !== 'draft').length,
    outreach_replied: outreach.filter(o => o.status === 'replied').length,
    platforms: [...platformCounts.entries()]
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count),
  };
}

async function fetchTopCreators(): Promise<CreatorWithAccounts[]> {
  if (!isSupabaseConfigured()) return [];

  const { data } = await supabase
    .from('creators')
    .select('*, creator_accounts(*)')
    .order('lead_score', { ascending: false })
    .limit(5);

  return (data ?? []).map(c => ({
    ...c,
    accounts: c.creator_accounts ?? [],
    prop_firms_mentioned: c.prop_firms_mentioned ?? [],
  }));
}

async function fetchRecentRuns(): Promise<DailyDiscovery[]> {
  if (!isSupabaseConfigured()) return [];

  const { data } = await supabase
    .from('daily_discoveries')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(6);

  return data ?? [];
}

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  let stats: DashboardStats = { total_creators: 0, new_today: 0, total_with_email: 0, avg_lead_score: 0, outreach_sent: 0, outreach_replied: 0, platforms: [] };
  let topCreators: CreatorWithAccounts[] = [];
  let recentRuns: DailyDiscovery[] = [];

  try {
    [stats, topCreators, recentRuns] = await Promise.all([
      fetchStats(),
      fetchTopCreators(),
      fetchRecentRuns(),
    ]);
  } catch (err) {
    console.error('Overview page data fetch failed:', err);
  }

  const isEmpty = stats.total_creators === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Trading influencer discovery dashboard</p>
      </div>

      <StatsCards stats={stats} />

      {isEmpty ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
            <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">No creators yet</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Run your first discovery to populate the dashboard. Use the YouTube or X discovery
            endpoints, or trigger a daily refresh.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
            <code className="rounded bg-zinc-800 px-3 py-1.5 text-zinc-400">POST /api/discover/youtube</code>
            <code className="rounded bg-zinc-800 px-3 py-1.5 text-zinc-400">POST /api/discover/x</code>
            <code className="rounded bg-zinc-800 px-3 py-1.5 text-zinc-400">GET /api/daily-refresh</code>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Platform Distribution */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="text-sm font-medium text-zinc-400">Platform Distribution</h2>
              {stats.platforms.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {stats.platforms.map(p => (
                    <div key={p.platform} className="flex items-center gap-3">
                      <span className="w-20 text-sm capitalize text-zinc-300">{p.platform}</span>
                      <div className="flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${(p.count / Math.max(stats.total_creators, 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-sm text-zinc-500">{p.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-600">No platform data yet.</p>
              )}
            </div>

            {/* Recent Discovery Runs */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="text-sm font-medium text-zinc-400">Recent Discovery Runs</h2>
              {recentRuns.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {recentRuns.map(run => (
                    <div key={run.id} className="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm capitalize text-zinc-300">{run.platform}</span>
                        <span className="text-xs text-zinc-600">{run.run_date}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-400">+{run.new_creators_found} new</span>
                        <span className="text-blue-400">{run.existing_creators_updated} updated</span>
                        <span className={`rounded-full px-2 py-0.5 ${
                          run.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {run.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-600">No discovery runs yet.</p>
              )}
            </div>
          </div>

          {/* Top Creators */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-white">Top Creators by Lead Score</h2>
            <CreatorTable creators={topCreators} />
          </div>
        </>
      )}
    </div>
  );
}
