'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/daily-leads', label: 'Daily Leads' },
  { href: '/outreach', label: 'Outreach' },
  { href: '/youtube-test', label: 'YouTube' },
];

export function Nav() {
  const path = usePathname();

  return (
    <nav style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--accent-gold)' }}>
            Influencer Outreach HQ
          </Link>
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
