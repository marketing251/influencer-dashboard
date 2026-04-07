'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const platforms = ['all', 'youtube', 'x', 'instagram', 'tiktok', 'discord', 'telegram'] as const;
const sortOptions = [
  { value: 'lead_score', label: 'Lead Score' },
  { value: 'followers', label: 'Followers' },
  { value: 'created_at', label: 'Newest' },
  { value: 'name', label: 'Name' },
];

export function Filters() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  return (
    <div className="flex flex-wrap items-center gap-3">
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

      {/* Sort */}
      <select
        value={current('sort_by') || 'lead_score'}
        onChange={e => update('sort_by', e.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
      >
        {sortOptions.map(o => (
          <option key={o.value} value={o.value}>
            Sort: {o.label}
          </option>
        ))}
      </select>

      {/* Toggle Filters */}
      {[
        { key: 'has_course', label: 'Has Course' },
        { key: 'has_discord', label: 'Has Discord' },
        { key: 'has_telegram', label: 'Has Telegram' },
        { key: 'promoting_prop_firms', label: 'Prop Firms' },
      ].map(f => (
        <button
          key={f.key}
          onClick={() => update(f.key, current(f.key) === 'true' ? '' : 'true')}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            current(f.key) === 'true'
              ? 'bg-blue-600 text-white'
              : 'border border-zinc-700 text-zinc-400 hover:text-white'
          }`}
        >
          {f.label}
        </button>
      ))}

      {/* Search */}
      <input
        type="text"
        placeholder="Search creators..."
        defaultValue={current('search')}
        onChange={e => {
          clearTimeout((window as unknown as { _searchTimeout?: ReturnType<typeof setTimeout> })._searchTimeout);
          (window as unknown as { _searchTimeout?: ReturnType<typeof setTimeout> })._searchTimeout = setTimeout(
            () => update('search', e.target.value),
            300,
          );
        }}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500"
      />
    </div>
  );
}
