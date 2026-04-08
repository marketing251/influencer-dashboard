'use client';

import { useThemeContext } from './theme-provider';

/**
 * PropAccount logo mark — the distinctive upward-right arrow.
 * Switches color based on theme: gold/white for dark, navy for light.
 */
export function PropAccountLogo({ size = 28 }: { size?: number }) {
  const { theme } = useThemeContext();
  const color = theme === 'dark' ? '#C8A456' : '#0F172A';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PropAccount Logo"
      role="img"
    >
      {/* Upward-right arrow mark inspired by PropAccount branding */}
      <path
        d="M8 32L20 8L32 32H26L20 18L14 32H8Z"
        fill={color}
      />
      <path
        d="M20 8L26 22H32L20 8Z"
        fill={color}
        opacity="0.7"
      />
    </svg>
  );
}

/**
 * Full PropAccount wordmark: logo + "prop" (bold) + "account" (regular).
 */
export function PropAccountWordmark({ logoSize = 28 }: { logoSize?: number }) {
  const { theme } = useThemeContext();
  const boldColor = theme === 'dark' ? '#C8A456' : '#0F172A';
  const lightColor = theme === 'dark' ? '#C8A456' : '#475569';

  return (
    <div className="flex items-center gap-2">
      <PropAccountLogo size={logoSize} />
      <span className="text-[15px] tracking-tight">
        <span className="font-bold" style={{ color: boldColor }}>prop</span>
        <span className="font-normal" style={{ color: lightColor }}>account</span>
      </span>
    </div>
  );
}
