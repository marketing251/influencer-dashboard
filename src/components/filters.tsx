'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';

const platforms = ['all', 'youtube', 'x', 'instagram', 'linkedin', 'tiktok', 'discord', 'telegram'] as const;

const sortOptions = [
  { value: 'lead_score', label: 'Lead Score' },
  { value: 'followers', label: 'Followers' },
  { value: 'first_seen_at', label: 'First Seen' },
  { value: 'name', label: 'Name' },
];

const followerRanges = [
  { value: '', label: 'Any Followers' },
  { value: '1000', label: '1K+' },
  { value: '10000', label: '10K+' },
  { value: '50000', label: '50K+' },
  { value: '100000', label: '100K+' },
  { value: '500000', label: '500K+' },
];

const toggleFilters = [
  { key: 'has_course', label: 'Course' },
  { key: 'has_discord', label: 'Discord' },
  { key: 'has_telegram', label: 'Telegram' },
  { key: 'promoting_prop_firms', label: 'Prop Firms' },
  { key: 'new_today', label: 'New Today' },
];

export function Filters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'all') {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const current = (key: string) => searchParams.get(key) || '';

  const hasActiveFilters = searchParams.toString().length > 0;

  const clearAll = () => router.push('?');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Platform */}
        <select
          value={current('platform') || 'all'}
          onChange={e => update('platform', e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          {platforms.map(p => (
            <option key={p} value={p}>
              {p === 'all' ? 'All Platforms' : p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        {/* Follower minimum */}
        <select
          value={current('min_followers') || ''}
          onChange={e => update('min_followers', e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          {followerRanges.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={current('sort_by') || 'lead_score'}
          onChange={e => update('sort_by', e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          {sortOptions.map(o => (
            <option key={o.value} value={o.value}>Sort: {o.label}</option>
          ))}
        </select>

        {/* Sort order toggle */}
        <button
          onClick={() => update('sort_order', current('sort_order') === 'asc' ? 'desc' : 'asc')}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-sm text-zinc-400 hover:text-white"
          title={current('sort_order') === 'asc' ? 'Ascending' : 'Descending'}
        >
          {current('sort_order') === 'asc' ? '↑' : '↓'}
        </button>

        {/* Toggle filters */}
        {toggleFilters.map(f => (
          <button
            key={f.key}
            onClick={() => update(f.key, current(f.key) === 'true' ? '' : 'true')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              current(f.key) === 'true'
                ? f.key === 'new_today' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
                : 'border border-zinc-700 text-zinc-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}

        {/* Search */}
        <input
          type="text"
          placeholder="Search..."
          defaultValue={current('search')}
          onChange={e => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => update('search', e.target.value), 300);
          }}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500 w-40"
        />

        {/* Clear all */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-white"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
