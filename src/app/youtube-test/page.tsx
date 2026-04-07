'use client';

import { useState, useCallback, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────────────

interface Creator {
  platform: 'youtube';
  name: string;
  channelId: string;
  handle: string;
  url: string;
  description: string;
  thumbnails: {
    default: string | null;
    medium: string | null;
    high: string | null;
  };
  subscribers: number;
  views: number;
  videos: number;
}

interface SearchResponse {
  query: string;
  count: number;
  totalResults: number;
  nextPageToken: string | null;
  creators: Creator[];
}

interface ErrorResponse {
  error: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const SUGGESTED_QUERIES = [
  'forex trading education',
  'prop firm trading',
  'day trading course',
  'FTMO funded trader',
  'smart money concepts',
  'options trading strategy',
  'crypto trading',
  'futures trading live',
];

// ─── Components ─────────────────────────────────────────────────────

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-zinc-800/60 px-3 py-2">
      <span className="text-sm font-semibold text-white">{value}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </div>
  );
}

function CreatorCard({ creator }: { creator: Creator }) {
  const thumb = creator.thumbnails.medium ?? creator.thumbnails.high ?? creator.thumbnails.default;

  return (
    <div className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700">
      {/* Thumbnail */}
      <div className="shrink-0">
        {thumb ? (
          <img
            src={thumb}
            alt={creator.name}
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800 text-lg font-bold text-zinc-500">
            {creator.name.charAt(0)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a
              href={creator.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-white hover:text-blue-400"
            >
              {creator.name}
            </a>
            <p className="text-sm text-zinc-500">{creator.handle}</p>
          </div>
          <span className="shrink-0 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-400">
            YouTube
          </span>
        </div>

        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-400">
          {creator.description || 'No description available.'}
        </p>

        {/* Stats row */}
        <div className="mt-3 flex gap-2">
          <StatBadge label="Subscribers" value={formatNumber(creator.subscribers)} />
          <StatBadge label="Total Views" value={formatNumber(creator.views)} />
          <StatBadge label="Videos" value={formatNumber(creator.videos)} />
        </div>

        {/* Channel ID for dev reference */}
        <p className="mt-2 font-mono text-[11px] text-zinc-700 select-all">
          ID: {creator.channelId}
        </p>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

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
    if (!pageToken) {
      setCreators([]);
      setMeta(null);
      setDurationMs(null);
    }

    const start = performance.now();
    try {
      const params = new URLSearchParams({ q, maxResults: String(maxResults) });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`/api/youtube/search?${params}`);
      const data: SearchResponse | ErrorResponse = await res.json();

      if (!res.ok || 'error' in data) {
        setError('error' in data ? data.error : `Request failed with status ${res.status}`);
        return;
      }

      setCreators(prev => pageToken ? [...prev, ...data.creators] : data.creators);
      setMeta({ totalResults: data.totalResults, nextPageToken: data.nextPageToken });
      setSearchedQuery(data.query);
      setDurationMs(Math.round(performance.now() - start));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [maxResults]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(query);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">YouTube Channel Search</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Search the YouTube Data API for channels by keyword. Returns normalized creator objects.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search for trading channels..."
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none ring-blue-500/40 transition-shadow focus:border-zinc-600 focus:ring-2"
          />
          <select
            value={maxResults}
            onChange={e => setMaxResults(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white"
          >
            {[5, 10, 15, 25, 50].map(n => (
              <option key={n} value={n}>{n} results</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Suggested queries */}
        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-zinc-600">Try:</span>
          {SUGGESTED_QUERIES.map(q => (
            <button
              key={q}
              type="button"
              onClick={() => { setQuery(q); search(q); }}
              className="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
            >
              {q}
            </button>
          ))}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-400">Error</p>
          <p className="mt-1 text-sm text-red-300/80">{error}</p>
        </div>
      )}

      {/* Results header */}
      {searchedQuery && !error && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Showing <span className="text-white">{creators.length}</span>
            {meta?.totalResults ? <> of ~{formatNumber(meta.totalResults)}</> : null}
            {' '}channels for &quot;<span className="text-white">{searchedQuery}</span>&quot;
            {durationMs != null && <span className="ml-2 text-zinc-600">({durationMs}ms)</span>}
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && creators.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
          <p className="mt-3 text-sm text-zinc-500">Searching YouTube...</p>
        </div>
      )}

      {/* Results grid */}
      {creators.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {creators.map(creator => (
            <CreatorCard key={creator.channelId} creator={creator} />
          ))}
        </div>
      )}

      {/* Load more */}
      {meta?.nextPageToken && !loading && (
        <div className="flex justify-center">
          <button
            onClick={() => search(searchedQuery, meta.nextPageToken!)}
            className="rounded-lg border border-zinc-700 px-6 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
          >
            Load More
          </button>
        </div>
      )}

      {/* Loading more indicator */}
      {loading && creators.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && searchedQuery && creators.length === 0 && !error && (
        <div className="py-16 text-center">
          <p className="text-zinc-500">No channels found for that query.</p>
        </div>
      )}

      {/* API info footer */}
      <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/50 p-4">
        <p className="text-xs font-medium text-zinc-500">API Endpoint</p>
        <code className="mt-1 block text-xs text-zinc-400">
          GET /api/youtube/search?q=&#123;keyword&#125;&maxResults=&#123;1-50&#125;&pageToken=&#123;token&#125;
        </code>
        <p className="mt-3 text-xs font-medium text-zinc-500">Response Shape</p>
        <pre className="mt-1 overflow-x-auto text-xs text-zinc-600">
{`{
  query: string,
  count: number,
  totalResults: number,
  nextPageToken: string | null,
  creators: [{
    platform: "youtube",
    name, channelId, handle, url,
    description, thumbnails: { default, medium, high },
    subscribers, views, videos
  }]
}`}
        </pre>
      </div>
    </div>
  );
}
