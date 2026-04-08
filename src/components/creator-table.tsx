import Link from 'next/link';
import type { Creator, CreatorAccount } from '@/lib/types';

interface Props {
  creators: (Creator & { accounts: CreatorAccount[] })[];
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function relDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SocialBadge({ url, label, bg, fg }: { url: string | null; label: string; bg: string; fg: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold hover:opacity-80 transition-opacity"
      style={{ background: bg, color: fg }}>{label}</a>
  );
}

function ContactIcon({ type, has }: { type: 'email' | 'phone' | 'form'; has: boolean }) {
  if (!has) return null;
  const icons = {
    email: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
    phone: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
    form: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  };
  return (
    <svg className="h-3.5 w-3.5" style={{ color: 'var(--accent-gold)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={icons[type]} />
    </svg>
  );
}

export function CreatorTable({ creators }: Props) {
  if (!creators.length) return null;

  const thStyle: React.CSSProperties = {
    color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderColor: 'var(--border)',
    position: 'sticky', top: 0, zIndex: 10,
  };
  const tdBorder: React.CSSProperties = { borderColor: 'var(--border-subtle)' };

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider">
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Creator</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Platform</th>
            <th className="px-3 py-3 font-medium border-b text-right" style={thStyle}>Followers</th>
            <th className="px-3 py-3 font-medium border-b text-right" style={thStyle}>Score</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Contact</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Profiles</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Signals</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>Prop Firms</th>
            <th className="px-3 py-3 font-medium border-b" style={thStyle}>First Seen</th>
          </tr>
        </thead>
        <tbody>
          {creators.map(c => {
            const primary = c.accounts?.length
              ? [...c.accounts].sort((a, b) => b.followers - a.followers)[0]
              : null;

            return (
              <tr key={c.id} className="transition-colors" style={{ ...tdBorder }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {/* Name + source */}
                <td className="px-3 py-3 border-b" style={tdBorder}>
                  <Link href={`/creators/${c.id}`} className="font-medium hover:underline"
                    style={{ color: 'var(--text-primary)' }}>
                    {c.name}
                  </Link>
                  {c.source_type && (
                    <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>{c.source_type}</span>
                  )}
                </td>

                {/* Platform badges */}
                <td className="px-3 py-3 border-b" style={tdBorder}>
                  <div className="flex gap-1">
                    {(c.accounts ?? []).map(a => (
                      <span key={a.id} className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: 'var(--accent-gold-dim)', color: 'var(--accent-gold)' }}>
                        {a.platform === 'youtube' ? 'YT' : a.platform === 'instagram' ? 'IG' : a.platform === 'linkedin' ? 'LI' : a.platform.slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                  </div>
                </td>

                {/* Followers */}
                <td className="px-3 py-3 border-b text-right font-mono" style={{ ...tdBorder, color: 'var(--text-secondary)' }}>
                  {fmt(c.total_followers)}
                </td>

                {/* Lead Score */}
                <td className="px-3 py-3 border-b text-right" style={tdBorder}>
                  <span className="font-mono font-semibold" style={{
                    color: c.lead_score >= 70 ? 'var(--accent-gold)' : c.lead_score >= 40 ? 'var(--accent)' : 'var(--text-muted)',
                  }}>{c.lead_score}</span>
                </td>

                {/* Contact badges */}
                <td className="px-3 py-3 border-b" style={tdBorder}>
                  <div className="flex gap-1.5 items-center">
                    <ContactIcon type="email" has={Boolean(c.public_email)} />
                    <ContactIcon type="phone" has={Boolean(c.public_phone)} />
                    <ContactIcon type="form" has={Boolean(c.contact_form_url)} />
                    {!c.public_email && !c.public_phone && !c.contact_form_url && (
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </div>
                </td>

                {/* Social profiles */}
                <td className="px-3 py-3 border-b" style={tdBorder}>
                  <div className="flex flex-wrap gap-1">
                    <SocialBadge url={c.youtube_url} label="YT" bg="rgba(239,68,68,0.15)" fg="#f87171" />
                    <SocialBadge url={c.x_url} label="X" bg="rgba(148,163,184,0.15)" fg="#94a3b8" />
                    <SocialBadge url={c.instagram_url} label="IG" bg="rgba(236,72,153,0.15)" fg="#ec4899" />
                    <SocialBadge url={c.linkedin_url} label="LI" bg="rgba(59,130,246,0.15)" fg="#3b82f6" />
                    <SocialBadge url={c.website} label="Web" bg="rgba(34,197,94,0.15)" fg="#22c55e" />
                  </div>
                </td>

                {/* Signals */}
                <td className="px-3 py-3 border-b" style={tdBorder}>
                  <div className="flex flex-wrap gap-1">
                    {c.has_course && <Pill>Course</Pill>}
                    {c.has_discord && <Pill>DC</Pill>}
                    {c.has_telegram && <Pill>TG</Pill>}
                    {c.has_skool && <Pill>Skool</Pill>}
                    {c.has_whop && <Pill>Whop</Pill>}
                    {c.promoting_prop_firms && <Pill gold>Prop</Pill>}
                  </div>
                </td>

                {/* Prop firms */}
                <td className="max-w-[120px] truncate px-3 py-3 border-b text-xs" style={{ ...tdBorder, color: 'var(--text-muted)' }}>
                  {(c.prop_firms_mentioned ?? []).length > 0 ? c.prop_firms_mentioned.join(', ') : ''}
                </td>

                {/* First seen */}
                <td className="px-3 py-3 border-b text-xs" style={{ ...tdBorder, color: 'var(--text-muted)' }}>
                  {relDate(c.first_seen_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: gold ? 'var(--accent-gold-dim)' : 'var(--bg-hover)',
        color: gold ? 'var(--accent-gold)' : 'var(--text-secondary)',
      }}>{children}</span>
  );
}
