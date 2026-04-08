'use client';

/**
 * StatsGrid — row of labeled metric cards.
 * Matches the reference's #stats grid pattern.
 */
export interface StatItem {
  value: string | number;
  label: string;
  accent?: boolean;
}

export function StatsGrid({ items, columns = 5 }: { items: StatItem[]; columns?: number }) {
  return (
    <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))` }}>
      {items.map(item => (
        <div key={item.label} className="rounded-[var(--radius-sm)] p-3"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-xl font-semibold tabular-nums"
            style={{ color: item.accent ? 'var(--accent-gold)' : 'var(--text-primary)' }}>
            {item.value}
          </div>
          <div className="text-[9px] uppercase tracking-widest mt-0.5"
            style={{ color: 'var(--text-muted)' }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}
