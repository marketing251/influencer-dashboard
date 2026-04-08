'use client';

import { useEffect, useState } from 'react';
import type { Outreach } from '@/lib/types';

type OutreachWithName = Outreach & { creator_name?: string };

const tabs = ['all', 'draft', 'queued', 'sent', 'opened', 'replied', 'bounced'] as const;

const statusStyles: Record<string, { bg: string; fg: string }> = {
  draft: { bg: 'var(--bg-hover)', fg: 'var(--text-secondary)' },
  queued: { bg: 'var(--info-bg)', fg: 'var(--info)' },
  sent: { bg: 'var(--warning-bg)', fg: 'var(--warning)' },
  opened: { bg: 'rgba(139,92,246,0.1)', fg: '#a78bfa' },
  replied: { bg: 'var(--success-bg)', fg: 'var(--success)' },
  bounced: { bg: 'var(--error-bg)', fg: 'var(--error)' },
};

export default function OutreachPage() {
  const [items, setItems] = useState<OutreachWithName[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = filter !== 'all' ? `?status=${filter}` : '';
    fetch(`/api/outreach${params}`)
      .then(r => r.json())
      .then(data => { setItems(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Outreach Queue</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Manage outreach to discovered creators</p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1">
        {tabs.map(tab => (
          <button key={tab} onClick={() => setFilter(tab)}
            className="rounded-lg px-3 py-1.5 text-sm capitalize transition-colors"
            style={{
              background: filter === tab ? 'var(--accent)' : 'transparent',
              color: filter === tab ? '#fff' : 'var(--text-muted)',
            }}>
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl p-16 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No outreach items</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Outreach records will appear here when you start contacting leads.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Creator</th>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Channel</th>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Subject</th>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Status</th>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Sent</th>
                <th className="px-4 py-3 font-medium border-b" style={{ borderColor: 'var(--border)' }}>Response</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const st = statusStyles[item.status] ?? statusStyles.draft;
                return (
                  <tr key={item.id} className="transition-colors border-b"
                    style={{ borderColor: 'var(--border-subtle)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {item.creator_name || item.creator_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{item.channel}</td>
                    <td className="max-w-[250px] truncate px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {item.subject || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: st.bg, color: st.fg }}>{item.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {item.sent_at ? new Date(item.sent_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {item.response || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
