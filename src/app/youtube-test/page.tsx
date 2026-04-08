'use client';

import { useState, useCallback, useRef } from 'react';

interface Creator {
  platform: 'youtube'; name: string; channelId: string; handle: string; url: string;
  description: string; thumbnails: { default: string | null; medium: string | null; high: string | null };
  subscribers: number; views: number; videos: number;
}

interface SearchResponse { query: string; count: number; totalResults: number; nextPageToken: string | null; creators: Creator[] }
interface ErrorResponse { error: string }

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const QUERIES = ['forex trading education', 'prop firm trading', 'day trading course', 'FTMO funded trader', 'smart money concepts', 'options trading strategy', 'crypto trading', 'futures trading live'];

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg px-3 py-2" style={{ background: 'var(--bg-hover)' }}>
      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

function YTCard({ creator }: { creator: Creator }) {
  const thumb = creator.thumbnails.medium ?? creator.thumbnails.high ?? creator.thumbnails.default;
  return (
    <div className="flex gap-4 rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="shrink-0">
        {thumb ? (
          <img src={thumb} alt={creator.name} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {creator.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a href={creator.url} target="_blank" rel="noopener noreferrer" className="text-base font-semibold hover:underline" style={{ color: 'var(--text-primary)' }}>
              {creator.name}
            </a>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{creator.handle}</p>
          </div>
          <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>YouTube</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {creator.description || 'No description available.'}
        </p>
        <div className="mt-3 flex gap-2">
          <StatBadge label="Subscribers" value={fmt(creator.subscribers)} />
          <StatBadge label="Total Views" value={fmt(creator.views)} />
          <StatBadge label="Videos" value={fmt(creator.videos)} />
        </div>
        <p className="mt-2 font-mono text-[11px] select-all" style={{ color: 'var(--text-muted)' }}>ID: {creator.channelId}</p>
      </div>
    </div>
  );
}

export default function YouTubeTestPage() {
  const [query, setQuery] = useState('');
  const [maxResults, setMaxResults] = useState(10);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [meta, setMeta] = useState<{ totalResults: number; nextPageToken: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string, pageToken?: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    if (!pageToken) { setCreators([]); setMeta(null); setDurationMs(null); }
    const start = performance.now();
    try {
      const params = new URLSearchParams({ q, maxResults: String(maxResults) });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`/api/youtube/search?${params}`);
      const data: SearchResponse | ErrorResponse = await res.json();
      if (!res.ok || 'error' in data) { setError('error' in data ? data.error : `Failed (${res.status})`); return; }
      setCreators(prev => pageToken ? [...prev, ...data.creators] : data.creators);
      setMeta({ totalResults: data.totalResults, nextPageToken: data.nextPageToken });
      setSearchedQuery(data.query);
      setDurationMs(Math.round(performance.now() - start));
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  }, [maxResults]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); search(query); };

  const selectStyle: React.CSSProperties = { background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>YouTube Channel Search</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Search the YouTube Data API for channels by keyword.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search for trading channels..."
            className="flex-1 rounded-lg border px-4 py-2.5 text-sm outline-none transition-shadow focus:ring-2"
            style={{ ...selectStyle, '--tw-ring-color': 'var(--accent)' } as React.CSSProperties} />
          <select value={maxResults} onChange={e => setMaxResults(Number(e.target.value))}
            className="rounded-lg border px-3 py-2.5 text-sm" style={selectStyle}>
            {[5, 10, 15, 25, 50].map(n => <option key={n} value={n}>{n} results</option>)}
          </select>
          <button type="submit" disabled={loading || !query.trim()}
            className="rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>Try:</span>
          {QUERIES.map(q => (
            <button key={q} type="button" onClick={() => { setQuery(q); search(q); }}
              className="rounded-full border px-2.5 py-1 text-xs transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              {q}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="rounded-lg p-4" style={{ background: 'var(--error-bg)', border: '1px solid var(--error)', color: 'var(--error)' }}>
          <p className="text-sm font-medium">Error</p>
          <p className="mt-1 text-sm opacity-80">{error}</p>
        </div>
      )}

      {searchedQuery && !error && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Showing <span style={{ color: 'var(--text-primary)' }}>{creators.length}</span>
          {meta?.totalResults ? <> of ~{fmt(meta.totalResults)}</> : null}
          {' '}channels for &quot;<span style={{ color: 'var(--text-primary)' }}>{searchedQuery}</span>&quot;
          {durationMs != null && <span className="ml-2">({durationMs}ms)</span>}
        </p>
      )}

      {loading && creators.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
          <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>Searching YouTube...</p>
        </div>
      )}

      {creators.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {creators.map(c => <YTCard key={c.channelId} creator={c} />)}
        </div>
      )}

      {meta?.nextPageToken && !loading && (
        <div className="flex justify-center">
          <button onClick={() => search(searchedQuery, meta.nextPageToken!)}
            className="rounded-lg border px-6 py-2 text-sm transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Load More</button>
        </div>
      )}

      {loading && creators.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        </div>
      )}

      {!loading && searchedQuery && creators.length === 0 && !error && (
        <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>No channels found.</div>
      )}

      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>API Endpoint</p>
        <code className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>
          GET /api/youtube/search?q=&#123;keyword&#125;&maxResults=&#123;1-50&#125;&pageToken=&#123;token&#125;
        </code>
      </div>
    </div>
  );
}
