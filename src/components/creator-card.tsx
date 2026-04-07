import Link from 'next/link';
import type { Creator, CreatorAccount } from '@/lib/types';

interface Props {
  creator: Creator & { accounts: CreatorAccount[] };
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  contacted: 'bg-amber-500/20 text-amber-400',
  replied: 'bg-green-500/20 text-green-400',
  qualified: 'bg-purple-500/20 text-purple-400',
  rejected: 'bg-red-500/20 text-red-400',
  converted: 'bg-emerald-500/20 text-emerald-400',
};

const platformIcons: Record<string, string> = {
  youtube: 'YT',
  x: 'X',
  instagram: 'IG',
  tiktok: 'TT',
  discord: 'DC',
  telegram: 'TG',
  twitch: 'TW',
  linkedin: 'LI',
};

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function CreatorCard({ creator }: Props) {
  return (
    <Link
      href={`/creators/${creator.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-600"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white">{creator.name}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {formatFollowers(creator.total_followers)} followers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
            {creator.lead_score}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[creator.status]}`}>
            {creator.status}
          </span>
        </div>
      </div>

      {/* Platform badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {creator.accounts.map(acc => (
          <span
            key={acc.id}
            className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
          >
            <span className="font-bold">{platformIcons[acc.platform] || acc.platform}</span>
            <span className="text-zinc-500">{formatFollowers(acc.followers)}</span>
          </span>
        ))}
      </div>

      {/* Feature flags */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {creator.has_course && <Badge label="Course" />}
        {creator.has_discord && <Badge label="Discord" />}
        {creator.has_telegram && <Badge label="Telegram" />}
        {creator.promoting_prop_firms && <Badge label="Prop Firms" variant="highlight" />}
      </div>

      {/* Contact */}
      {(creator.public_email || creator.website) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
          {creator.public_email && <span>{creator.public_email}</span>}
          {creator.website && <span>{creator.website}</span>}
        </div>
      )}

      {/* Prop firms */}
      {creator.prop_firms_mentioned.length > 0 && (
        <div className="mt-2 text-xs text-zinc-600">
          Mentions: {creator.prop_firms_mentioned.join(', ')}
        </div>
      )}
    </Link>
  );
}

function Badge({ label, variant }: { label: string; variant?: 'highlight' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        variant === 'highlight'
          ? 'bg-green-500/20 text-green-400'
          : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      {label}
    </span>
  );
}
