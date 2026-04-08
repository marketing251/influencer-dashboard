'use client';

/**
 * ProgressBar — thin animated bar for scan/refresh progress.
 */
export function ProgressBar({ percent, visible }: { percent: number; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
      <div className="h-full rounded-full transition-all duration-300"
        style={{ background: 'var(--accent-gold)', width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}
