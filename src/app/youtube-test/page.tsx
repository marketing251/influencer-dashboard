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

type Platform = 'youtube' | 'twitter' | 'instagram' | 'linkedin';

/**
 * Normalized creator shape — every platform adapter must return this.
 * The first 12 fields match the spec exactly; `thumb` and `videos` are
 * optional display-only extras that existing table rendering depends on.
 */
interface Creator {
  id: string;               // stable React key, not part of the normalized spec
  platform: Platform;
  name: string;
  handle: string;
  profile_url: string;
  bio: string;
  audience_size: number;
  engagement: number;
  website: string | null;
  email: string | null;
  phone: string | null;
  contact_form: string | null;
  source_keyword: string;
  // ── optional display-only extras ──
  thumb?: string | null;
  videos?: number;
}

interface YouTubeSearchResponse {
  query: string;
  count: number;
  totalResults: number;
  nextPageToken: string | null;
  creators: {
    platform: 'youtube';
    name: string;
    channelId: string;
    handle: string;
    url: string;
    description: string;
    thumbnails: { default: string | null; medium: string | null; high: string | null };
    subscribers: number;
    views: number;
    videos: number;
  }[];
  error?: string;
}

// ─── Platform catalog ───────────────────────────────────────────────

const ALL_PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'twitter', label: 'X / Twitter' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
];

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

// ─── Adapters ───────────────────────────────────────────────────────

interface AdapterArgs {
  keyword: string;
  pagesPerKw: number;
  minAudience: number;
  log: (msg: string) => void;
}

/**
 * YouTube adapter — wraps the existing /api/youtube/search flow unchanged.
 * This is the original logic that used to live inline in runScan, extracted
 * so the orchestrator can call it the same way it calls the others.
 */
async function searchYouTube({ keyword, pagesPerKw, minAudience, log }: AdapterArgs): Promise<Creator[]> {
  const out: Creator[] = [];
  let pageToken: string | undefined;

  for (let p = 0; p < pagesPerKw; p++) {
    try {
      const params = new URLSearchParams({ q: keyword, maxResults: '10' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`/api/youtube/search?${params}`);
      if (!res.ok) { log(`  ✗ YouTube HTTP ${res.status}`); break; }

      const data = (await res.json()) as YouTubeSearchResponse;
      if (data.error) { log(`  ✗ YouTube: ${data.error}`); break; }

      for (const c of data.creators ?? []) {
        if (c.subscribers < minAudience) continue;
        const emails = extractEmails(c.description);
        out.push({
          id: `youtube-${c.channelId}`,
          platform: 'youtube',
          name: c.name,
          handle: c.handle,
          profile_url: c.url,
          bio: c.description,
          audience_size: c.subscribers,
          engagement: c.views,
          website: null,
          email: emails[0] ?? null,
          phone: null,
          contact_form: null,
          source_keyword: keyword,
          thumb: c.thumbnails.medium ?? c.thumbnails.default,
          videos: c.videos,
        });
      }

      pageToken = data.nextPageToken ?? undefined;
      if (!pageToken) break;
    } catch (err) {
      log(`  ✗ YouTube: ${err instanceof Error ? err.message : 'error'}`);
      break;
    }
  }

  return out;
}

/**
 * X / Twitter adapter — scaffolded placeholder.
 * Keeps the same signature as the YouTube adapter and returns the normalized
 * Creator shape. Real X API discovery lives in the background refresh
 * pipeline (see lib/integrations/x.ts) and is out of scope for this page.
 */
async function searchTwitter({ keyword, log }: AdapterArgs): Promise<Creator[]> {
  log(`  · X / Twitter adapter scaffolded for "${keyword}" — not yet wired to a live API on this page`);
  return [];
}

/**
 * Instagram adapter — scaffolded placeholder.
 * Instagram has no public discovery API; real discovery happens via the
 * web-search pipeline in lib/integrations/web-search.ts. This page returns
 * nothing rather than fabricating data.
 */
async function searchInstagram({ keyword, log }: AdapterArgs): Promise<Creator[]> {
  log(`  · Instagram adapter scaffolded for "${keyword}" — not yet wired to a live API on this page`);
  return [];
}

/**
 * LinkedIn adapter — scaffolded placeholder.
 * LinkedIn's ToS forbids scraping and there's no public discovery API.
 * Real discovery is handled by the refresh pipeline.
 */
async function searchLinkedIn({ keyword, log }: AdapterArgs): Promise<Creator[]> {
  log(`  · LinkedIn adapter scaffolded for "${keyword}" — not yet wired to a live API on this page`);
  return [];
}

const ADAPTERS: Record<Platform, (args: AdapterArgs) => Promise<Creator[]>> = {
  youtube: searchYouTube,
  twitter: searchTwitter,
  instagram: searchInstagram,
  linkedin: searchLinkedIn,
};

/**
 * Orchestrator — loops over the selected platforms sequentially and
 * aggregates their normalized results. Runs sequentially per the spec to
 * avoid concurrency issues and keep progress reporting predictable.
 */
async function searchOrchestrator(
  platforms: Platform[],
  args: AdapterArgs,
): Promise<Creator[]> {
  const all: Creator[] = [];
  for (const p of platforms) {
    const adapter = ADAPTERS[p];
    if (!adapter) continue;
    const results = await adapter(args);
    all.push(...results);
  }
  return all;
}

// ─── Styles ─────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' };
const thStyle: React.CSSProperties = { background: 'var(--bg-secondary)', color: 'var(--text-muted)', borderColor: 'var(--border)', position: 'sticky', top: 0, zIndex: 10 };

// ─── Page ───────────────────────────────────────────────────────────

export default function CustomSearchIntelligencePage() {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [minSubs, setMinSubs] = useState(5000);
  const [kwLimit, setKwLimit] = useState(6);
  const [pagesPerKw, setPagesPerKw] = useState(1);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['youtube']);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [sortKey, setSortKey] = useState<keyof Creator>('audience_size');
  const [sortDir, setSortDir] = useState(-1);

  const stoppedRef = useRef(false);

  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${t}] ${msg}`]);
  }, []);

  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(p)) {
        // Never let the user deselect everything — at least one must remain
        return prev.length > 1 ? prev.filter(x => x !== p) : prev;
      }
      return [...prev, p];
    });
  };

  // ─── Scan ─────────────────────────────────────────────────────────

  const runScan = async () => {
    if (running) return;
    if (selectedPlatforms.length === 0) {
      log('⚠ Select at least one platform before running a scan.');
      return;
    }
    setRunning(true);
    stoppedRef.current = false;
    setProgress(0);

    const kws = keywords.split('\n').map(s => s.trim()).filter(Boolean).slice(0, kwLimit);
    const platformLabels = selectedPlatforms
      .map(p => ALL_PLATFORMS.find(ap => ap.value === p)?.label ?? p)
      .join(', ');
    log(`Starting · ${kws.length} keywords · ${pagesPerKw} page(s)/kw · min ${fmt(minSubs)} audience · platforms: ${platformLabels}`);

    const seen = new Set(creators.map(c => c.id));
    let added = 0;

    for (let i = 0; i < kws.length; i++) {
      if (stoppedRef.current) break;
      const kw = kws[i];
      log(`[${i + 1}/${kws.length}] 🔎 "${kw}"`);

      const results = await searchOrchestrator(selectedPlatforms, {
        keyword: kw,
        pagesPerKw,
        minAudience: minSubs,
        log,
      });

      const fresh = results.filter(c => !seen.has(c.id));
      for (const c of fresh) {
        seen.add(c.id);
        setCreators(prev => [...prev, c]);
        added++;
        log(`  ✓ [${c.platform}] ${c.name} · ${fmt(c.audience_size)}${c.email ? ` · ${c.email}` : ''}`);
      }

      setProgress(((i + 1) / kws.length) * 100);
    }

    log(`✅ Done. ${added} new creators. Total: ${seen.size}`);
    setRunning(false);
  };

  // ─── Sort ─────────────────────────────────────────────────────────

  const handleSort = (key: string) => {
    const k = key as keyof Creator;
    if (sortKey === k) setSortDir(d => d * -1);
    else { setSortKey(k); setSortDir(-1); }
  };

  const sorted = [...creators].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * sortDir;
  });

  // ─── CSV ──────────────────────────────────────────────────────────

  const exportCSV = () => {
    if (!creators.length) return;
    const head = ['Platform', 'Name', 'Handle', 'Profile URL', 'Audience', 'Engagement', 'Videos', 'Website', 'Email', 'Phone', 'Contact Form', 'Source Keyword'];
    const rows = creators.map(c => [
      c.platform, c.name, c.handle, c.profile_url, c.audience_size, c.engagement,
      c.videos ?? '', c.website ?? '', c.email ?? '', c.phone ?? '', c.contact_form ?? '', c.source_keyword,
    ]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `custom-search-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ─── Stats ────────────────────────────────────────────────────────

  const withEmail = creators.filter(c => c.email).length;
  const totalAudience = creators.reduce((s, c) => s + c.audience_size, 0);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Custom Search <span style={{ color: 'var(--accent-gold)', fontStyle: 'italic' }}>Intelligence</span>
        </h1>
        <p className="text-[12px] uppercase tracking-widest mt-1" style={{ color: 'var(--text-muted)' }}>
          Trading / Prop Firm Niche · Multi-Platform Discovery
        </p>
      </div>

      {/* Platform selector */}
      <Panel title="Platforms (multi-select)">
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map(p => {
            const selected = selectedPlatforms.includes(p.value);
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => togglePlatform(p.value)}
                disabled={running}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: selected ? 'var(--accent-gold-dim)' : 'var(--bg-primary)',
                  color: selected ? 'var(--accent-gold)' : 'var(--text-muted)',
                  border: `1px solid ${selected ? 'var(--accent-gold)' : 'var(--border)'}`,
                }}
              >
                {selected ? '● ' : '○ '}{p.label}
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Keywords */}
      <Panel title="1 · Keywords (one per line)">
        <textarea value={keywords} onChange={e => setKeywords(e.target.value)}
          className="w-full min-h-[100px] resize-y text-[13px] font-mono" style={inputStyle} />
        <div className="flex flex-wrap gap-4 mt-3">
          <FilterInput label="Min audience" value={minSubs} onChange={setMinSubs} />
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
            { label: '⬇ Export CSV', onClick: exportCSV, disabled: creators.length === 0 },
            { label: 'Clear', onClick: () => { setCreators([]); setLogs([]); setProgress(0); } },
          ]}
          note="⚠ Each YouTube search ≈ 100 quota units. Daily limit: 10,000."
        >
          <ProgressBar percent={progress} visible={running} />
        </ActionBar>
        <div className="mt-3">
          <ScanLog lines={logs} />
        </div>
      </Panel>

      {/* Stats */}
      {creators.length > 0 && (
        <Panel title="Summary">
          <StatsGrid items={[
            { value: creators.length, label: 'Creators matched', accent: true },
            { value: withEmail, label: 'With email', accent: true },
            { value: `${(totalAudience / 1e6).toFixed(2)}M`, label: 'Combined audience' },
            { value: fmt(Math.round(totalAudience / Math.max(creators.length, 1))), label: 'Avg audience' },
            { value: new Set(creators.map(c => c.platform)).size, label: 'Platforms' },
          ]} />
        </Panel>
      )}

      {/* Results */}
      {creators.length > 0 ? (
        <div className="overflow-auto rounded-[var(--radius)]" style={{ border: '1px solid var(--border)', maxHeight: '70vh', boxShadow: 'var(--shadow-sm)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest">
                <SortableTH k="platform" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle}>Platform</SortableTH>
                <SortableTH k="name" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle}>Creator</SortableTH>
                <SortableTH k="audience_size" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Audience</SortableTH>
                <SortableTH k="engagement" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Total Views</SortableTH>
                <SortableTH k="videos" current={sortKey} dir={sortDir} onClick={handleSort} style={thStyle} right>Videos</SortableTH>
                <th className="px-3 py-2.5 font-semibold border-b" style={thStyle}>Email</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id} className="border-b transition-colors" style={{ borderColor: 'var(--border-subtle)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-3 py-2.5">
                    <PlatformBadge platform={c.platform} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {c.thumb && <img src={c.thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />}
                      <div className="min-w-0">
                        <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline block truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</a>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.handle}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.audience_size)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(c.engagement)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{c.videos ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {c.email
                      ? <a href={`mailto:${c.email}`} className="block text-[12px] hover:underline" style={{ color: 'var(--accent)' }}>{c.email}</a>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !running && logs.length > 0 ? (
        <EmptyState message="No creators matched your criteria. Try adjusting filters or selecting more platforms." />
      ) : !running ? (
        <EmptyState message="Choose platforms, configure keywords, and click Run Scan to discover creators." />
      ) : null}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

const PLATFORM_COLORS: Record<Platform, { bg: string; fg: string }> = {
  youtube: { bg: 'rgba(239,68,68,0.12)', fg: '#f87171' },
  twitter: { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' },
  instagram: { bg: 'rgba(236,72,153,0.12)', fg: '#ec4899' },
  linkedin: { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6' },
};

const PLATFORM_SHORT: Record<Platform, string> = {
  youtube: 'YT',
  twitter: 'X',
  instagram: 'IG',
  linkedin: 'LI',
};

function PlatformBadge({ platform }: { platform: Platform }) {
  const c = PLATFORM_COLORS[platform];
  return (
    <span className="rounded px-1.5 py-[2px] text-[10px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {PLATFORM_SHORT[platform]}
    </span>
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
