'use client';

/**
 * ActionBar — row of primary + secondary action buttons with optional note.
 * Matches the reference's .controls .row pattern.
 */
export interface ActionButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export function ActionBar({ actions, note, children }: {
  actions: ActionButton[];
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map(a => (
          <button key={a.label} onClick={a.onClick} disabled={a.disabled}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-[13px] font-semibold transition-all disabled:opacity-40"
            style={a.primary
              ? { background: 'var(--accent-gold)', color: '#0A0F1A' }
              : { border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'transparent' }
            }>
            {a.label}
          </button>
        ))}
        {note && (
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>{note}</span>
        )}
      </div>
      {children}
    </div>
  );
}
