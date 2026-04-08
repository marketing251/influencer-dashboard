'use client';

import { useRef, useEffect } from 'react';

/**
 * ScanLog — monospace timestamped log panel for scan/refresh operations.
 * Auto-scrolls to bottom on new entries.
 */
export function ScanLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [lines.length]);

  if (!lines.length) return null;

  return (
    <div ref={ref}
      className="font-mono text-[11px] max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] p-3"
      style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
      {lines.join('\n')}
    </div>
  );
}
