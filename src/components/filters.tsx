'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';

const platforms = ['all', 'youtube', 'x', 'instagram', 'linkedin', 'tiktok', 'discord', 'telegram'] as const;

const sortOptions = [
  { value: 'lead_score', label: 'Lead Score' },
  { value: 'confidence_score', label: 'Confidence' },
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
];

const contactOptions = [
  { value: '', label: 'All Contacts' },
  { value: 'has_email', label: 'Has Email' },
  { value: 'has_phone', label: 'Has Phone' },
  { value: 'has_contact_form', label: 'Has Contact Form' },
  { value: 'has_any_contact', label: 'Has Any Contact' },
];

const toggles = [
  { key: 'has_course', label: 'Course' },
  { key: 'has_discord', label: 'Discord' },
  { key: 'has_telegram', label: 'Telegram' },
  { key: 'promoting_prop_firms', label: 'Prop Firms' },
  { key: 'has_instagram', label: 'Instagram' },
  { key: 'has_linkedin', label: 'LinkedIn' },
  { key: 'has_skool', label: 'Skool' },
  { key: 'has_whop', label: 'Whop' },
  { key: 'high_confidence', label: 'Hi-Conf' },
  { key: 'new_today', label: 'New Today' },
];

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
};

export function Filters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'all' && value !== '') params.set(key, value);
      else params.delete(key);
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const current = (key: string) => searchParams.get(key) || '';
  const hasActive = searchParams.toString().length > 0;

  // Contact filter: only one can be active at a time
  const handleContactFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // Clear all contact filters
    ['has_email', 'has_phone', 'has_contact_form', 'has_any_contact'].forEach(k => params.delete(k));
    if (value) params.set(value, 'true');
    router.push(`?${params.toString()}`);
  };

  const activeContact = contactOptions.find(c =>
    c.value && searchParams.get(c.value) === 'true',
  )?.value ?? '';

  return (
    <div className="space-y-3">
      {/* Row 1: Dropdowns */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={current('platform') || 'all'} onChange={e => update('platform', e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={selectStyle}>
          {platforms.map(p => (
            <option key={p} value={p}>{p === 'all' ? 'All Platforms' : p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

        <select value={current('min_followers') || ''} onChange={e => update('min_followers', e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={selectStyle}>
          {followerRanges.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <select value={activeContact} onChange={e => handleContactFilter(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={selectStyle}>
          {contactOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <select value={current('sort_by') || 'lead_score'} onChange={e => update('sort_by', e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={selectStyle}>
          {sortOptions.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
        </select>

        <button onClick={() => update('sort_order', current('sort_order') === 'asc' ? 'desc' : 'asc')}
          className="rounded-lg border px-3 py-2 text-sm" style={{ ...selectStyle, cursor: 'pointer' }}>
          {current('sort_order') === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <input type="text" placeholder="Search creators..." defaultValue={current('search')}
          onChange={e => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => update('search', e.target.value), 300);
          }}
          className="rounded-lg border px-3 py-2 text-sm w-44"
          style={{ ...selectStyle, outline: 'none' }} />
      </div>

      {/* Row 2: Toggle pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {toggles.map(f => {
          const active = current(f.key) === 'true';
          return (
            <button key={f.key}
              onClick={() => update(f.key, active ? '' : 'true')}
              className="rounded-full px-3 py-1 text-xs font-medium transition-all"
              style={{
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-muted)',
                border: active ? 'none' : '1px solid var(--border)',
              }}>
              {f.label}
            </button>
          );
        })}

        {hasActive && (
          <button onClick={() => router.push('?')}
            className="rounded-full px-3 py-1 text-xs"
            style={{ color: 'var(--text-muted)' }}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
