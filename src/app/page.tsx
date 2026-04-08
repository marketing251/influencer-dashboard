'use client';

import { useEffect, useState } from 'react';
import { StatsCards } from '@/components/stats-cards';
import { CreatorTable } from '@/components/creator-table';
import type { DashboardStats, Creator, CreatorAccount } from '@/lib/types';

type CreatorWithAccounts = Creator & { accounts: CreatorAccount[] };

const emptyStats: DashboardStats = {
  total_creators: 0, new_today: 0, total_with_email: 0,
  avg_lead_score: 0, outreach_sent: 0, outreach_replied: 0, platforms: [],
};

export default function OverviewPage() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [topCreators, setTopCreators] = useState<CreatorWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/creators?sort_by=lead_score&sort_order=desc');
        const data = await res.json();
        const creators: CreatorWithAccounts[] = Array.isArray(data) ? data : [];

        const today = new Date().toISOString().split('T')[0];
        const platforms = new Map<string, number>();
        for (const c of creators) {
          for (const a of c.accounts ?? []) {
            platforms.set(a.platform, (platforms.get(a.platform) ?? 0) + 1);
          }
        }

        setStats({
          total_creators: creators.length,
          new_today: creators.filter(c => (c.first_seen_at ?? c.created_at)?.startsWith(today)).length,
          total_with_email: creators.filter(c => c.public_email).length,
          avg_lead_score: creators.length
            ? Math.round(creators.reduce((s, c) => s + c.lead_score, 0) / creators.length)
            : 0,
          outreach_sent: 0,
          outreach_replied: 0,
          platforms: [...platforms.entries()]
            .map(([platform, count]) => ({ platform, count }))
            .sort((a, b) => b.count - a.count),
        });

        setTopCreators(creators.slice(0, 5));
      } catch (err) {
        console.error('Failed to load overview data:', err);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Overview</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Trading influencer discovery dashboard</p>
      </div>

      <StatsCards stats={stats} />

      {stats.total_creators === 0 ? (
        <div className="rounded-xl p-16 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-gold-dim)' }}>
            <svg className="h-7 w-7" style={{ color: 'var(--accent-gold)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No creators yet</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Go to Daily Leads and click Refresh New Leads to discover creators.
          </p>
        </div>
      ) : (
        <>
          {/* Platform Distribution */}
          {stats.platforms.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Platform Distribution</h2>
              <div className="mt-4 space-y-2">
                {stats.platforms.map(p => (
                  <div key={p.platform} className="flex items-center gap-3">
                    <span className="w-20 text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>{p.platform}</span>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-hover)' }}>
                        <div className="h-full rounded-full" style={{
                          background: 'var(--accent)', width: `${(p.count / Math.max(stats.total_creators, 1)) * 100}%`,
                        }} />
                      </div>
                    </div>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Creators */}
          <div>
            <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Top Creators by Lead Score</h2>
            <CreatorTable creators={topCreators} />
          </div>
        </>
      )}
    </div>
  );
}
