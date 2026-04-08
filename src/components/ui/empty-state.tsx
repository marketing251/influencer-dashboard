'use client';

/**
 * EmptyState — centered message for no-data scenarios.
 */
export function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] p-12 text-center"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
      <p>{message}</p>
      {children}
    </div>
  );
}
