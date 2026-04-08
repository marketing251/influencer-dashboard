'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';
import { PropAccountLogo } from './propaccount-logo';
import { useThemeContext } from './theme-provider';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/daily-leads', label: 'Daily Leads' },
  { href: '/outreach', label: 'Outreach' },
  { href: '/youtube-test', label: 'YouTube' },
];

export function Nav() {
  const path = usePathname();
  const { theme } = useThemeContext();

  return (
    <nav style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          {/* Brand unit: logo + title as one cohesive block */}
          <Link href="/" className="group flex items-center gap-2 transition-opacity hover:opacity-85">
            <PropAccountLogo size={24} />
            <div className="flex items-baseline gap-[3px] leading-none">
              <span className="text-[14px] font-semibold tracking-[-0.01em]"
                style={{ color: theme === 'dark' ? '#C8A456' : '#0F172A' }}>
                Influencer Outreach
              </span>
              <span className="text-[14px] font-light tracking-[-0.01em]"
                style={{ color: theme === 'dark' ? 'rgba(200,164,86,0.55)' : '#94A3B8' }}>
                HQ
              </span>
            </div>
          </Link>

          {/* Divider between brand and nav */}
          <div className="hidden sm:block h-5 w-px" style={{ background: 'var(--border)' }} />

          {/* Navigation links */}
          <div className="flex gap-0.5">
            {links.map(l => (
              <Link key={l.href} href={l.href}
                className="rounded-[var(--radius-sm)] px-2.5 py-1 text-[13px] font-medium transition-colors"
                style={{
                  background: path === l.href ? 'var(--accent)' : 'transparent',
                  color: path === l.href ? '#fff' : 'var(--text-muted)',
                }}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
