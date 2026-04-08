'use client';

import { useState, useRef, useCallback } from 'react';

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

// ─── Constants ──────────────────────────────────────────────────────

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
  const raw = text.match(EMAIL_RE) ?? [];
  return [...new Set(raw.filter(e => !EMAIL_BL.some(b => e.toLowerCase().endsWith(b))))];
}

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

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
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${t}] ${msg}`]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  }, []);

  // ─── Run scan ─────────────────────────────────────────────────────

  const runScan = async () => {
    if (running) return;
    setRunning(true);
    stoppedRef.current = false;
    setProgress(0);

    const kws = keywords.split('\n').map(s => s.trim()).filter(Boolean).slice(0, kwLimit);
    log(`Starting scan · ${kws.length} keywords · ${pagesPerKw} page(s)/keyword`);
    log(`Filter: subscribers ≥ ${fmt(minSubs)}`);

    const seen = new Set(channels.map(c => c.id));
    let newCount = 0;

    for (let i = 0; i < kws.length; i++) {
      if (stoppedRef.current) break;
      const kw = kws[i];
      log(`\n[${i + 1}/${kws.length}] 🔎 "${kw}"`);

      let pageToken: string | undefined;
      for (let p = 0; p < pagesPerKw; p++) {
        if (stoppedRef.current) break;
        try {
          const params = new URLSearchParams({ q: kw, maxResults: '10' });
          if (pageToken) params.set('pageToken', pageToken);
          const res = await fetch(`/api/youtube/search?${params}`);
          if (!res.ok) { log(`  ✗ Search failed (${res.status})`); break; }
          const data: SearchResponse = await res.json();
          if ('error' in data) { log(`  ✗ ${(data as { error: string }).error}`); break; }

          const newCreators = data.creators.filter(c => !seen.has(c.channelId) && c.subscribers >= minSubs);
          for (const c of newCreators) {
            seen.add(c.channelId);
            const emails = extractEmails(c.description);
            const ch: Channel = {
              id: c.channelId, title: c.name, handle: c.handle, url: c.url,
              thumb: c.thumbnails.medium ?? c.thumbnails.default,
              subscribers: c.subscribers, views: c.views, videos: c.videos,
              description: c.description, emails,
            };
            setChannels(prev => [...prev, ch]);
            newCount++;
            log(`  ✓ ${c.name} · ${fmt(c.subscribers)} subs${emails.length ? ` · ${emails.join(', ')}` : ''}`);
          }

          if (newCreators.length === 0 && data.creators.length > 0) {
            log(`  → ${data.creators.length} channels found, all below ${fmt(minSubs)} subs or already seen`);
          }

          pageToken = data.nextPageToken ?? undefined;
          if (!pageToken) break;
        } catch (err) {
          log(`  ✗ Error: ${err instanceof Error ? err.message : 'unknown'}`);
          break;
        }
      }
      setProgress(((i + 1) / kws.length) * 100);
    }

    log(`\n✅ Done. ${newCount} new channels added. Total: ${seen.size} unique.`);
    setRunning(false);
  };

  // ─── Sort ─────────────────────────────────────────────────────────

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const sorted = [...channels].sort((a, b) => {
    const av = a[sortKey as keyof Channel];
    const bv = b[sortKey as keyof Channel];
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
  });

  // ─── CSV export ───────────────────────────────────────────────────

  const exportCSV = () => {
    if (!channels.length) return;
    const head = ['Channel', 'URL', 'Handle', 'Subscribers', 'Total Views', 'Videos', 'Emails', 'Description'];
    const rows = channels.map(c => [c.title, c.url, c.handle, c.subscribers, c.views, c.videos, c.emails.join('; '), c.description.slice(0, 200)]);
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

  // ─── Styles ───────────────────────────────────────────────────────

  const panel: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' };
  const input: React.CSSProperties = { background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' };
  const label: React.CSSProperties = { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' };
  const th: React.CSSProperties = { background: 'var(--bg-secondary)', color: 'var(--text-muted)', borderColor: 'var(--border)', position: 'sticky', top: 0, zIndex: 10, cursor: 'pointer', userSelect: 'none' };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          YouTube Influencer <span style={{ color: 'var(--accent-gold)', fontStyle: 'italic' }}>Intelligence</span>
        </h1>
        <p className="text-[12px] uppercase tracking-widest mt-1" style={{ color: 'var(--text-muted)' }}>
          Trading / Prop Firm Niche · YouTube Data API v3
        </p>
      </div>

      {/* Keywords panel */}
      <div style={panel}>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
          1 · Keywords (one per line)
        </h3>
        <textarea value={keywords} onChange={e => setKeywords(e.target.value)}
          className="w-full min-h-[100px] resize-y text-[13px] font-mono" style={input} />
        <div className="flex flex-wrap gap-4 mt-3">
          <div className="flex flex-col gap-1">
            <span style={label}>Min subscribers</span>
            <input type="number" value={minSubs} onChange={e => setMinSubs(+e.target.value)} className="w-28" style={input} />
          </div>
          <div className="flex flex-col gap-1">
            <span style={label}>Keywords to scan</span>
            <input type="number" value={kwLimit} onChange={e => setKwLimit(+e.target.value)} className="w-28" style={input} />
          </div>
          <div className="flex flex-col gap-1">
            <span style={label}>Pages per keyword</span>
            <input type="number" value={pagesPerKw} onChange={e => setPagesPerKw(+e.target.value)} className="w-28" style={input} />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={runScan} disabled={running}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-[13px] font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--accent-gold)', color: '#0A0F1A' }}>
            {running ? '⏳ Scanning...' : '▶ Run Scan'}
          </button>
          <button onClick={() => { stoppedRef.current = true; }} disabled={!running}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-[13px] font-medium border disabled:opacity-30"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            ■ Stop
          </button>
          <button onClick={exportCSV} disabled={channels.length === 0}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-[13px] font-medium border disabled:opacity-30"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            ⬇ Export CSV
          </button>
          <button onClick={() => { setChannels([]); setLogs([]); setProgress(0); }}
            className="px-4 py-2 rounded-[var(--radius-sm)] text-[13px] font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            Clear
          </button>
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ⚠ Each search ≈ 100 quota units. Daily limit: 10,000.
          </span>
        </div>

        {/* Progress bar */}
        {running && (
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ background: 'var(--accent-gold)', width: `${progress}%` }} />
          </div>
        )}

        {/* Log */}
        {logs.length > 0 && (
          <div ref={logRef} className="mt-3 font-mono text-[11px] max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] p-3"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {logs.join('\n')}
          </div>
        )}
      </div>

      {/* Summary stats */}
      {channels.length > 0 && (
        <div style={panel}>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat value={String(channels.length)} label="Channels matched" />
            <Stat value={String(withEmail)} label="With email" />
            <Stat value={String(totalEmails)} label="Total emails" />
            <Stat value={`${(totalSubs / 1e6).toFixed(2)}M`} label="Combined subs" />
            <Stat value={fmt(Math.round(totalSubs / Math.max(channels.length, 1)))} label="Avg subs" />
          </div>
        </div>
      )}

      {/* Results table */}
      {channels.length > 0 ? (
        <div className="overflow-auto rounded-[var(--radius)]" style={{ border: '1px solid var(--border)', maxHeight: '70vh', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest">
                <TH k="title" cur={sortKey} dir={sortDir} onClick={handleSort} style={th}>Channel</TH>
                <TH k="subscribers" cur={sortKey} dir={sortDir} onClick={handleSort} style={th} right>Subs</TH>
                <TH k="views" cur={sortKey} dir={sortDir} onClick={handleSort} style={th} right>Total Views</TH>
                <TH k="videos" cur={sortKey} dir={sortDir} onClick={handleSort} style={th} right>Videos</TH>
                <th className="px-3 py-2.5 font-semibold border-b" style={th}>Emails</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id} className="border-b transition-colors"
                  style={{ borderColor: 'var(--border-subtle)' }}
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
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !running && logs.length > 0 ? (
        <div className="rounded-[var(--radius)] p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          No channels matched your criteria. Try adjusting filters.
        </div>
      ) : !running ? (
        <div className="rounded-[var(--radius)] p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Configure keywords and click <strong>Run Scan</strong> to discover YouTube channels.
        </div>
      ) : null}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-xl font-semibold" style={{ color: 'var(--accent-gold)' }}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

function TH({ k, cur, dir, onClick, children, style, right }: {
  k: string; cur: string; dir: number; onClick: (k: string) => void;
  children: React.ReactNode; style: React.CSSProperties; right?: boolean;
}) {
  const active = cur === k;
  return (
    <th className={`px-3 py-2.5 font-semibold border-b ${right ? 'text-right' : ''}`} style={style} onClick={() => onClick(k)}>
      {children} {active && (dir > 0 ? '↑' : '↓')}
    </th>
  );
}
