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

const sel: React.CSSProperties = { background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' };

export function Filters() {
  const router = useRouter();
  const sp = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    v && v !== 'all' ? p.set(k, v) : p.delete(k);
    router.push(`?${p.toString()}`);
  }, [router, sp]);

  const get = (k: string) => sp.get(k) || '';
  const hasAny = sp.toString().length > 0;

  const setContact = (v: string) => {
    const p = new URLSearchParams(sp.toString());
    ['has_email', 'has_phone', 'has_contact_form', 'has_any_contact'].forEach(k => p.delete(k));
    if (v) p.set(v, 'true');
    router.push(`?${p.toString()}`);
  };
  const activeContact = contactOptions.find(c => c.value && sp.get(c.value) === 'true')?.value ?? '';

  return (
    <div className="space-y-2.5">
      {/* Dropdowns row */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={get('platform') || 'all'} onChange={e => set('platform', e.target.value)} className="border px-2.5 py-[7px] text-[13px]" style={sel}>
          {platforms.map(p => <option key={p} value={p}>{p === 'all' ? 'All Platforms' : p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select value={get('min_followers') || ''} onChange={e => set('min_followers', e.target.value)} className="border px-2.5 py-[7px] text-[13px]" style={sel}>
          {followerRanges.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={activeContact} onChange={e => setContact(e.target.value)} className="border px-2.5 py-[7px] text-[13px]" style={sel}>
          {contactOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={get('sort_by') || 'lead_score'} onChange={e => set('sort_by', e.target.value)} className="border px-2.5 py-[7px] text-[13px]" style={sel}>
          {sortOptions.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
        </select>
        <button onClick={() => set('sort_order', get('sort_order') === 'asc' ? 'desc' : 'asc')} className="border px-2.5 py-[7px] text-[13px] font-medium" style={{ ...sel, cursor: 'pointer' }}>
          {get('sort_order') === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
        </button>
        <input type="text" placeholder="Search..." defaultValue={get('search')}
          onChange={e => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = setTimeout(() => set('search', e.target.value), 300); }}
          className="border px-2.5 py-[7px] text-[13px] w-36 outline-none" style={{ ...sel, borderRadius: 'var(--radius-sm)' }} />
      </div>

      {/* Toggle pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {toggles.map(f => {
          const on = get(f.key) === 'true';
          return (
            <button key={f.key} onClick={() => set(f.key, on ? '' : 'true')}
              className="rounded-full px-2.5 py-[3px] text-[11px] font-medium tracking-wide transition-all"
              style={{
                background: on ? (f.key === 'new_today' ? 'var(--success)' : 'var(--accent)') : 'transparent',
                color: on ? '#fff' : 'var(--text-muted)',
                border: on ? 'none' : '1px solid var(--border)',
              }}>{f.label}</button>
          );
        })}
        {hasAny && <button onClick={() => router.push('?')} className="px-2 py-[3px] text-[11px] rounded-full" style={{ color: 'var(--text-muted)' }}>Clear</button>}
      </div>
    </div>
  );
}
