import type { DashboardStats } from '@/lib/types';

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: 'Total Creators', value: stats.total_creators },
    { label: 'New Today', value: stats.new_today },
    { label: 'With Email', value: stats.total_with_email },
    { label: 'Avg Lead Score', value: stats.avg_lead_score },
    { label: 'Outreach Sent', value: stats.outreach_sent },
    { label: 'Replied', value: stats.outreach_replied },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(card => (
        <div key={card.label} className="rounded-xl p-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{card.label}</p>
          <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--accent-gold)' }}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
