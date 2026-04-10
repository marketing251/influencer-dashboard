import Link from 'next/link';
import type { Creator, CreatorAccount } from '@/lib/types';

interface Props {
  creator: Creator & { accounts: CreatorAccount[] };
}

const platformIcons: Record<string, string> = {
  youtube: 'YT', x: 'X', instagram: 'IG', tiktok: 'TT',
  discord: 'DC', telegram: 'TG', twitch: 'TW', linkedin: 'LI',
};

function formatFollowers(n: number) {
  // 0 usually means "unknown" for IG/LinkedIn leads sourced via web search
  // (those platforms don't expose follower counts without auth). Render a
  // dash instead so the UI doesn't imply the creator has literally zero fans.
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function CreatorCard({ creator }: Props) {
  return (
    <Link href={`/creators/${creator.id}`}
      className="block rounded-xl p-4 transition-all hover:translate-y-[-2px]"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{creator.name}</h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {creator.total_followers > 0 ? `${formatFollowers(creator.total_followers)} followers` : 'Followers unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-0.5 text-xs font-bold"
            style={{ background: 'var(--accent-gold-dim)', color: 'var(--accent-gold)' }}>
            {creator.lead_score}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(creator.accounts ?? []).map(acc => (
          <span key={acc.id} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
            <span className="font-bold">{platformIcons[acc.platform] || acc.platform}</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatFollowers(acc.followers)}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {creator.has_course && <Badge label="Course" />}
        {creator.has_discord && <Badge label="Discord" />}
        {creator.has_telegram && <Badge label="Telegram" />}
        {creator.promoting_prop_firms && <Badge label="Prop Firms" gold />}
      </div>

      {(creator.public_email || creator.website) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {creator.public_email && <span>{creator.public_email}</span>}
          {creator.website && <span>{creator.website}</span>}
        </div>
      )}

      {(creator.prop_firms_mentioned ?? []).length > 0 && (
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Mentions: {creator.prop_firms_mentioned.join(', ')}
        </div>
      )}
    </Link>
  );
}

function Badge({ label, gold }: { label: string; gold?: boolean }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-xs"
      style={{
        background: gold ? 'var(--accent-gold-dim)' : 'var(--bg-hover)',
        color: gold ? 'var(--accent-gold)' : 'var(--text-secondary)',
      }}>{label}</span>
  );
}
