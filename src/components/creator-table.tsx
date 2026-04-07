import Link from 'next/link';
import type { Creator, CreatorAccount } from '@/lib/types';

interface Props {
  creators: (Creator & { accounts: CreatorAccount[] })[];
}

const statusColors: Record<string, string> = {
  new: 'text-blue-400',
  contacted: 'text-amber-400',
  replied: 'text-green-400',
  qualified: 'text-purple-400',
  rejected: 'text-red-400',
  converted: 'text-emerald-400',
};

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function CreatorTable({ creators }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs text-zinc-500">
            <th className="px-4 py-3 font-medium">Creator</th>
            <th className="px-4 py-3 font-medium">Platforms</th>
            <th className="px-4 py-3 font-medium">Followers</th>
            <th className="px-4 py-3 font-medium">Score</th>
            <th className="px-4 py-3 font-medium">Features</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {creators.map(c => (
            <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
              <td className="px-4 py-3">
                <Link href={`/creators/${c.id}`} className="font-medium text-white hover:text-blue-400">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {c.accounts.map(a => (
                    <span key={a.id} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                      {a.platform}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-zinc-300">{formatFollowers(c.total_followers)}</td>
              <td className="px-4 py-3">
                <span className="font-mono text-amber-400">{c.lead_score}</span>
                <span className="ml-1 text-xs text-zinc-600">/ {c.confidence_score}%</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {c.has_course && <MiniTag>Course</MiniTag>}
                  {c.has_discord && <MiniTag>DC</MiniTag>}
                  {c.has_telegram && <MiniTag>TG</MiniTag>}
                  {c.promoting_prop_firms && <MiniTag highlight>Prop</MiniTag>}
                </div>
              </td>
              <td className="max-w-[180px] truncate px-4 py-3 text-xs text-zinc-500">
                {c.public_email || c.website || '—'}
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium ${statusColors[c.status]}`}>
                  {c.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniTag({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <span
      className={`rounded px-1 py-0.5 text-[10px] ${
        highlight ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-500'
      }`}
    >
      {children}
    </span>
  );
}
