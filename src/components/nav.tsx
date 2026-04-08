'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/daily-leads', label: 'Daily Leads' },
  { href: '/outreach', label: 'Outreach' },
  { href: '/youtube-test', label: 'YouTube Search' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
            Influencer Outreach HQ
          </Link>
          <div className="hidden sm:flex gap-1">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  background: pathname === link.href ? 'var(--accent)' : 'transparent',
                  color: pathname === link.href ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
