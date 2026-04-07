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
  if (!iso) return '—';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Clickable social badge
function SocialBadge({ url, label, color }: { url: string | null; label: string; color: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${color} hover:opacity-80`}>
      {label}
    </a>
  );
}

function Signal({ label, highlight }: { label: string; highlight?: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
      highlight ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-400'
    }`}>{label}</span>
  );
}

export function CreatorTable({ creators }: Props) {
  if (!creators.length) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50 text-left text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="px-3 py-2.5 font-medium">Creator</th>
            <th className="px-3 py-2.5 font-medium">Platform</th>
            <th className="px-3 py-2.5 font-medium">Handle</th>
            <th className="px-3 py-2.5 font-medium text-right">Followers</th>
            <th className="px-3 py-2.5 font-medium text-right">Score</th>
            <th className="px-3 py-2.5 font-medium text-right">Conf</th>
            <th className="px-3 py-2.5 font-medium">Website</th>
            <th className="px-3 py-2.5 font-medium">Profiles</th>
            <th className="px-3 py-2.5 font-medium">Signals</th>
            <th className="px-3 py-2.5 font-medium">Prop Firms</th>
            <th className="px-3 py-2.5 font-medium">First Seen</th>
          </tr>
        </thead>
        <tbody>
          {creators.map(c => {
            const primary = c.accounts.length
              ? [...c.accounts].sort((a, b) => b.followers - a.followers)[0]
              : null;

            return (
              <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                <td className="px-3 py-2.5">
                  <Link href={`/creators/${c.id}`} className="font-medium text-white hover:text-blue-400">
                    {c.name}
                  </Link>
                  {c.source_type && (
                    <span className="ml-1.5 text-[10px] text-zinc-600">{c.source_type}</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    {c.accounts.map(a => (
                      <span key={a.id} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
                        {a.platform === 'youtube' ? 'YT' : a.platform === 'instagram' ? 'IG' : a.platform === 'linkedin' ? 'LI' : a.platform.toUpperCase().slice(0, 2)}
                      </span>
                    ))}
                  </div>
                </td>

                <td className="px-3 py-2.5">
                  {primary?.profile_url ? (
                    <a href={primary.profile_url} target="_blank" rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-blue-400">@{primary.handle}</a>
                  ) : <span className="text-zinc-600">—</span>}
                </td>

                <td className="px-3 py-2.5 text-right font-mono text-zinc-300">{fmt(c.total_followers)}</td>

                <td className="px-3 py-2.5 text-right">
                  <span className={`font-mono font-semibold ${
                    c.lead_score >= 80 ? 'text-green-400' : c.lead_score >= 50 ? 'text-amber-400' : 'text-zinc-500'
                  }`}>{c.lead_score}</span>
                </td>

                <td className="px-3 py-2.5 text-right">
                  <span className={`font-mono text-xs ${
                    c.confidence_score >= 70 ? 'text-blue-400' : c.confidence_score >= 40 ? 'text-zinc-400' : 'text-zinc-600'
                  }`}>{c.confidence_score}%</span>
                </td>

                <td className="max-w-[130px] truncate px-3 py-2.5">
                  {c.website ? (
                    <a href={c.website} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-zinc-400 hover:text-blue-400">
                      {c.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                    </a>
                  ) : <span className="text-xs text-zinc-700">—</span>}
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <SocialBadge url={c.youtube_url} label="YT" color="bg-red-500/20 text-red-400" />
                    <SocialBadge url={c.x_url} label="X" color="bg-zinc-600/30 text-zinc-300" />
                    <SocialBadge url={c.instagram_url} label="IG" color="bg-pink-500/20 text-pink-400" />
                    <SocialBadge url={c.linkedin_url} label="LI" color="bg-blue-500/20 text-blue-400" />
                    <SocialBadge url={c.discord_url} label="DC" color="bg-indigo-500/20 text-indigo-400" />
                    <SocialBadge url={c.telegram_url} label="TG" color="bg-sky-500/20 text-sky-400" />
                    <SocialBadge url={c.link_in_bio_url} label="Bio" color="bg-amber-500/20 text-amber-400" />
                    {!c.youtube_url && !c.x_url && !c.instagram_url && !c.linkedin_url && (
                      <span className="text-xs text-zinc-700">—</span>
                    )}
                  </div>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {c.has_course && <Signal label="Course" />}
                    {c.has_discord && <Signal label="Discord" />}
                    {c.has_telegram && <Signal label="TG" />}
                    {c.has_skool && <Signal label="Skool" />}
                    {c.has_whop && <Signal label="Whop" />}
                    {c.promoting_prop_firms && <Signal label="Prop" highlight />}
                  </div>
                </td>

                <td className="max-w-[120px] truncate px-3 py-2.5 text-xs text-zinc-500">
                  {c.prop_firms_mentioned?.length > 0 ? c.prop_firms_mentioned.join(', ') : '—'}
                </td>

                <td className="px-3 py-2.5 text-xs text-zinc-500">{relDate(c.first_seen_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
