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
  const titleBold = theme === 'dark' ? '#C8A456' : '#0F172A';
  const titleLight = theme === 'dark' ? 'rgba(200,164,86,0.7)' : '#64748B';

  return (
    <nav style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-5">
          {/* Logo + title */}
          <Link href="/" className="flex items-center gap-2.5">
            <PropAccountLogo size={26} />
            <span className="hidden sm:inline text-[15px] tracking-tight">
              <span className="font-bold" style={{ color: titleBold }}>Influencer Outreach</span>
              <span className="font-normal" style={{ color: titleLight }}> HQ</span>
            </span>
          </Link>

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
