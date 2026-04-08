import Link from 'next/link';
import type { Creator, CreatorAccount } from '@/lib/types';

interface Props { creators: (Creator & { accounts: CreatorAccount[] })[] }

function fmt(n: number) { return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n); }
function relDate(iso: string) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d}d` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const platformColor: Record<string, { bg: string; fg: string }> = {
  youtube: { bg: 'rgba(239,68,68,0.12)', fg: '#f87171' },
  x: { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' },
  instagram: { bg: 'rgba(236,72,153,0.12)', fg: '#ec4899' },
  linkedin: { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6' },
  tiktok: { bg: 'rgba(6,182,212,0.12)', fg: '#06b6d4' },
  discord: { bg: 'rgba(129,140,248,0.12)', fg: '#818cf8' },
  telegram: { bg: 'rgba(56,189,248,0.12)', fg: '#38bdf8' },
};
const plLabel: Record<string, string> = { youtube:'YT', x:'X', instagram:'IG', linkedin:'LI', tiktok:'TT', discord:'DC', telegram:'TG', twitch:'TW' };

function ContactDot({ has, title }: { has: boolean; title: string }) {
  return has ? <span title={title} className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--accent-gold)' }} /> : null;
}

export function CreatorTable({ creators }: Props) {
  if (!creators.length) return null;

  const th: React.CSSProperties = { color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderColor: 'var(--border)', position: 'sticky', top: 0, zIndex: 10 };
  const bd: React.CSSProperties = { borderColor: 'var(--border-subtle)' };

  return (
    <div className="overflow-x-auto rounded-[var(--radius)]" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest">
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Creator</th>
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Platform</th>
            <th className="px-3 py-2.5 font-semibold border-b text-right" style={th}>Followers</th>
            <th className="px-3 py-2.5 font-semibold border-b text-right" style={th}>Score</th>
            <th className="px-3 py-2.5 font-semibold border-b text-center" style={th}>Contact</th>
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Profiles</th>
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Signals</th>
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Prop Firms</th>
            <th className="px-3 py-2.5 font-semibold border-b" style={th}>Seen</th>
          </tr>
        </thead>
        <tbody>
          {creators.map(c => {
            const primary = (c.accounts ?? []).length ? [...c.accounts].sort((a, b) => b.followers - a.followers)[0] : null;
            return (
              <tr key={c.id} className="transition-colors border-b" style={bd}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                <td className="px-3 py-2.5">
                  <Link href={`/creators/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>{c.name}</Link>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    {(c.accounts ?? []).map(a => {
                      const pc = platformColor[a.platform] ?? { bg: 'var(--bg-hover)', fg: 'var(--text-muted)' };
                      return <span key={a.id} className="rounded px-1.5 py-[1px] text-[10px] font-bold" style={{ background: pc.bg, color: pc.fg }}>{plLabel[a.platform] ?? a.platform.slice(0,2).toUpperCase()}</span>;
                    })}
                  </div>
                </td>

                <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.total_followers)}</td>

                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono font-semibold tabular-nums" style={{
                    color: c.lead_score >= 70 ? 'var(--accent-gold)' : c.lead_score >= 40 ? 'var(--accent)' : 'var(--text-muted)',
                  }}>{c.lead_score}</span>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex justify-center gap-1.5">
                    <ContactDot has={Boolean(c.public_email)} title="Email" />
                    <ContactDot has={Boolean(c.public_phone)} title="Phone" />
                    <ContactDot has={Boolean(c.contact_form_url)} title="Contact Form" />
                    {!c.public_email && !c.public_phone && !c.contact_form_url && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>}
                  </div>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <PLink url={c.youtube_url} label="YT" c={platformColor.youtube} />
                    <PLink url={c.x_url} label="X" c={platformColor.x} />
                    <PLink url={c.instagram_url} label="IG" c={platformColor.instagram} />
                    <PLink url={c.linkedin_url} label="LI" c={platformColor.linkedin} />
                    <PLink url={c.website} label="Web" c={{ bg: 'rgba(34,197,94,0.12)', fg: '#22c55e' }} />
                  </div>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {c.has_course && <Pill>Course</Pill>}
                    {c.has_discord && <Pill>DC</Pill>}
                    {c.has_telegram && <Pill>TG</Pill>}
                    {c.has_skool && <Pill>Skool</Pill>}
                    {c.has_whop && <Pill>Whop</Pill>}
                    {c.promoting_prop_firms && <Pill gold>Prop</Pill>}
                  </div>
                </td>

                <td className="max-w-[100px] truncate px-3 py-2.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {(c.prop_firms_mentioned ?? []).join(', ') || ''}
                </td>

                <td className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{relDate(c.first_seen_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PLink({ url, label, c }: { url: string | null; label: string; c: { bg: string; fg: string } }) {
  if (!url) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="rounded px-1.5 py-[1px] text-[10px] font-bold hover:opacity-80 transition-opacity" style={{ background: c.bg, color: c.fg }}>{label}</a>;
}

function Pill({ children, gold }: { children: React.ReactNode; gold?: boolean }) {
  return <span className="rounded px-1.5 py-[1px] text-[10px] font-medium" style={{
    background: gold ? 'var(--accent-gold-dim)' : 'var(--bg-hover)', color: gold ? 'var(--accent-gold)' : 'var(--text-secondary)',
  }}>{children}</span>;
}
