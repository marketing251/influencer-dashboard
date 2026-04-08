'use client';

/**
 * SortableTH — table header cell with sort indicator.
 * Click to toggle sort direction.
 */
export function SortableTH({ k, current, dir, onClick, children, right, style }: {
  k: string;
  current: string;
  dir: number;
  onClick: (key: string) => void;
  children: React.ReactNode;
  right?: boolean;
  style?: React.CSSProperties;
}) {
  const active = current === k;
  return (
    <th className={`px-3 py-2.5 font-semibold border-b ${right ? 'text-right' : ''}`}
      style={{ ...style, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onClick(k)}>
      {children} {active && (dir > 0 ? '↑' : '↓')}
    </th>
  );
}
