import type { DashboardStats } from '@/lib/types';

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: 'Total Creators', value: stats.total_creators, color: 'text-blue-400' },
    { label: 'New Today', value: stats.new_today, color: 'text-green-400' },
    { label: 'With Email', value: stats.total_with_email, color: 'text-purple-400' },
    { label: 'Avg Lead Score', value: stats.avg_lead_score, color: 'text-amber-400' },
    { label: 'Outreach Sent', value: stats.outreach_sent, color: 'text-cyan-400' },
    { label: 'Replied', value: stats.outreach_replied, color: 'text-emerald-400' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(card => (
        <div key={card.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">{card.label}</p>
          <p className={`mt-1 text-2xl font-bold ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
