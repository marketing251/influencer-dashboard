'use client';

/**
 * Panel — card container used across the dashboard.
 * Matches the reference's .panel pattern: bg-card, border, rounded, padded.
 */
export function Panel({ title, children, className = '' }: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[var(--radius)] p-4 ${className}`}
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {title && (
        <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text-muted)' }}>{title}</h3>
      )}
      {children}
    </div>
  );
}
