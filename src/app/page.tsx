import { StatsCards } from '@/components/stats-cards';
import { CreatorTable } from '@/components/creator-table';
import { mockStats, mockCreators, mockAccounts, mockDiscoveries } from '@/lib/mock-data';

export default function OverviewPage() {
  const stats = mockStats;
  const topCreators = [...mockCreators]
    .sort((a, b) => b.lead_score - a.lead_score)
    .slice(0, 5)
    .map(c => ({ ...c, accounts: mockAccounts.filter(a => a.creator_id === c.id) }));
  const recentRuns = mockDiscoveries;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Trading influencer discovery dashboard</p>
      </div>

      <StatsCards stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Platform Distribution */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Platform Distribution</h2>
          <div className="mt-4 space-y-2">
            {stats.platforms.map(p => (
              <div key={p.platform} className="flex items-center gap-3">
                <span className="w-20 text-sm capitalize text-zinc-300">{p.platform}</span>
                <div className="flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${(p.count / stats.total_creators) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm text-zinc-500">{p.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Discovery Runs */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Recent Discovery Runs</h2>
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
        </div>
      </div>

      {/* Top Creators */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">Top Creators by Lead Score</h2>
        <CreatorTable creators={topCreators} />
      </div>
    </div>
  );
}
