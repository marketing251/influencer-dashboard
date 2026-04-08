'use client';

import { useState, useRef, useCallback } from 'react';
import { Panel } from '@/components/ui/panel';
import { ScanLog } from '@/components/ui/scan-log';
import { StatsGrid } from '@/components/ui/stats-grid';
import { ActionBar } from '@/components/ui/action-bar';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SortableTH } from '@/components/ui/sortable-th';
import { EmptyState } from '@/components/ui/empty-state';

// ─── Types ──────────────────────────────────────────────────────────

interface Channel {
  id: string; title: string; handle: string; url: string; thumb: string | null;
  subscribers: number; views: number; videos: number;
  description: string; emails: string[];
}

interface SearchResponse {
  query: string; count: number; totalResults: number; nextPageToken: string | null;
  creators: {
    platform: 'youtube'; name: string; channelId: string; handle: string; url: string;
    description: string; thumbnails: { default: string | null; medium: string | null; high: string | null };
    subscribers: number; views: number; videos: number;
  }[];
}

// ─── Helpers ────────────────────────────────────────────────────────

const DEFAULT_KEYWORDS = `prop firm trading
funded trading accounts
forex trading education
prop firm challenge
day trading course
FTMO funded trader
smart money concepts
futures trading education
options trading strategy
crypto trading education
prop trading firms
white label prop firm
trading mentor coaching
best prop firms
prop firm affiliate program
forex prop firms`;

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const EMAIL_BL = ['example.com', 'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'google.com', 'youtube.com'];

function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).filter(e => !EMAIL_BL.some(b => e.toLowerCase().endsWith(b))))];
}

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Styles ─────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' };
const labelStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' };
const thStyle: React.CSSProperties = { background: 'var(--bg-secondary)', color: 'var(--text-muted)', borderColor: 'var(--border)', position: 'sticky', top: 0, zIndex: 10 };

// ─── Page ───────────────────────────────────────────────────────────

export default function YouTubeIntelligencePage() {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [minSubs, setMinSubs] = useState(5000);
  const [kwLimit, setKwLimit] = useState(6);
  const [pagesPerKw, setPagesPerKw] = useState(1);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sortKey, setSortKey] = useState<string>('subscribers');
  const [sortDir, setSortDir] = useState(-1);

  const stoppedRef = useRef(false);

  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${t}] ${msg}`]);
  }, []);

  // ─── Scan ─────────────────────────────────────────────────────────

  const runScan = async () => {
    if (running) return;
    setRunning(true);
    stoppedRef.current = false;
    setProgress(0);

    const kws = keywords.split('\n').map(s => s.trim()).filter(Boolean).slice(0, kwLimit);
    log(`Starting · ${kws.length} keywords · ${pagesPerKw} page(s)/kw · min ${fmt(minSubs)} subs`);

    const seen = new Set(channels.map(c => c.id));
    let added = 0;

    for (let i = 0; i < kws.length; i++) {
      if (stoppedRef.current) break;
      const kw = kws[i];
      log(`[${i + 1}/${kws.length}] 🔎 "${kw}"`);

      let pageToken: string | undefined;
      for (let p = 0; p < pagesPerKw; p++) {
        if (stoppedRef.current) break;
        try {
          const params = new URLSearchParams({ q: kw, maxResults: '10' });
          if (pageToken) params.set('pageToken', pageToken);
          const res = await fetch(`/api/youtube/search?${params}`);
          if (!res.ok) { log(`  ✗ HTTP ${res.status}`); break; }
          const data: SearchResponse = await res.json();
          if ('error' in data) { log(`  ✗ ${(data as { error: string }).error}`); break; }

          const fresh = data.creators.filter(c => !seen.has(c.channelId) && c.subscribers >= minSubs);
          for (const c of fresh) {
            seen.add(c.channelId);
            const emails = extractEmails(c.description);
            setChannels(prev => [...prev, {
              id: c.channelId, title: c.name, handle: c.handle, url: c.url,
              thumb: c.thumbnails.medium ?? c.thumbnails.default,
              subscribers: c.subscribers, views: c.views, videos: c.videos,
              description: c.description, emails,
            }]);
            added++;
            log(`  ✓ ${c.name} · ${fmt(c.subscribers)} subs${emails.length ? ` · ${emails.join(', ')}` : ''}`);
          }

          pageToken = data.nextPageToken ?? undefined;
          if (!pageToken) break;
        } catch (err) { log(`  ✗ ${err instanceof Error ? err.message : 'error'}`); break; }
      }
      setProgress(((i + 1) / kws.length) * 100);
    }

    log(`✅ Done. ${added} new channels. Total: ${seen.size}`);
    setRunning(false);
  };

  // ─── Sort ─────────────────────────────────────────────────────────

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const sorted = [...channels].sort((a, b) => {
    const av = a[sortKey as keyof Channel], bv = b[sortKey as keyof Channel];
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
  });

  // ─── CSV ──────────────────────────────────────────────────────────

  const exportCSV = () => {
    if (!channels.length) return;
    const head = ['Channel', 'URL', 'Handle', 'Subscribers', 'Total Views', 'Videos', 'Emails'];
    const rows = channels.map(c => [c.title, c.url, c.handle, c.subscribers, c.views, c.videos, c.emails.join('; ')]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `yt-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ─── Stats ────────────────────────────────────────────────────────

  const withEmail = channels.filter(c => c.emails.length > 0).length;
  const totalEmails = channels.reduce((s, c) => s + c.emails.length, 0);
  const totalSubs = channels.reduce((s, c) => s + c.subscribers, 0);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          YouTube Influencer <span style={{ color: 'var(--accent-gold)', fontStyle: 'italic' }}>Intelligence</span>
        </h1>
        <p className="text-[12px] uppercase tracking-widest mt-1" style={{ color: 'var(--text-muted)' }}>
          Trading / Prop Firm Niche · YouTube Data API v3
        </p>
      </div>

      {/* Keywords */}
      <Panel title="1 · Keywords (one per line)">
        <textarea value={keywords} onChange={e => setKeywords(e.target.value)}
          className="w-full min-h-[100px] resize-y text-[13px] font-mono" style={inputStyle} />
        <div className="flex flex-wrap gap-4 mt-3">
          <FilterInput label="Min subscribers" value={minSubs} onChange={setMinSubs} />
          <FilterInput label="Keywords to scan" value={kwLimit} onChange={setKwLimit} />
          <FilterInput label="Pages per keyword" value={pagesPerKw} onChange={setPagesPerKw} />
        </div>
      </Panel>

      {/* Controls */}
      <Panel>
        <ActionBar
          actions={[
            { label: running ? '⏳ Scanning...' : '▶ Run Scan', onClick: runScan, primary: true, disabled: running },
            { label: '■ Stop', onClick: () => { stoppedRef.current = true; }, disabled: !running },
            { label: '⬇ Export CSV', onClick: exportCSV, disabled: channels.length === 0 },
            { label: 'Clear', onClick: () => { setChannels([]); setLogs([]); setProgress(0); } },
          ]}
          note="⚠ Each search ≈ 100 quota units. Daily limit: 10,000."
        >
          <ProgressBar percent={progress} visible={running} />
        </ActionBar>
        <div className="mt-3">
          <ScanLog lines={logs} />
        </div>
      </Panel>

      {/* Stats */}
      {channels.length > 0 && (
        <Panel title="Summary">
          <StatsGrid items={[
            { value: channels.length, label: 'Channels matched', accent: true },
            { value: withEmail, label: 'With email', accent: true },
            { value: totalEmails, label: 'Total emails' },
            { value: `${(totalSubs / 1e6).toFixed(2)}M`, label: 'Combined subs' },
            { value: fmt(Math.round(totalSubs / Math.max(channels.length, 1))), label: 'Avg subs' },
          ]} />
        </Panel>
      )}

      {/* Results */}
      {channels.length > 0 ? (
        <div className="overflow-auto rounded-[var(--radius)]" style={{ border: '1px solid var(--border)', maxHeight: '70vh', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest">
                <SortableTH k="title" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle}>Channel</SortableTH>
                <SortableTH k="subscribers" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Subs</SortableTH>
                <SortableTH k="views" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Total Views</SortableTH>
                <SortableTH k="videos" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Videos</SortableTH>
                <th className="px-3 py-2.5 font-semibold border-b" style={thStyle}>Emails</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id} className="border-b transition-colors" style={{ borderColor: 'var(--border-subtle)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {c.thumb && <img src={c.thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />}
                      <div className="min-w-0">
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline block truncate" style={{ color: 'var(--text-primary)' }}>{c.title}</a>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.handle}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.subscribers)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.views)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{c.videos}</td>
                  <td className="px-3 py-2.5">
                    {c.emails.length > 0
                      ? c.emails.map(e => <a key={e} href={`mailto:${e}`} className="block text-[12px] hover:underline" style={{ color: 'var(--accent)' }}>{e}</a>)
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !running && logs.length > 0 ? (
        <EmptyState message="No channels matched your criteria. Try adjusting filters." />
      ) : !running ? (
        <EmptyState message="Configure keywords and click Run Scan to discover YouTube channels." />
      ) : null}
    </div>
  );
}

// ─── Filter input ───────────────────────────────────────────────────

function FilterInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <input type="number" value={value} onChange={e => onChange(+e.target.value)} className="w-28"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' }} />
    </div>
  );
}
