/**
 * Brave Search API integration.
 *
 * Replaces the previous Google Custom Search (CSE) backend. Brave offers
 * a true "search the entire web" API — Google deprecated that capability
 * for new Programmable Search Engines in late 2025, which made CSE unusable
 * for broad creator discovery.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search/get-started
 *
 * Env vars:
 *   - BRAVE_SEARCH_API_KEY — subscription token from https://api.search.brave.com
 *
 * Pricing: $5 per 1,000 queries on the Search plan, $5/month credit included
 * (~1,000 free queries/month). 50 QPS rate limit — well above what we use.
 *
 * Public API surface is intentionally kept stable (same function names as
 * callers expected) so the refactor from CSE → Brave is a near drop-in:
 *   webSearch, webSearchMany, discoverAcrossPlatforms,
 *   isWebSearchConfigured, extractCrossPlatformHandle.
 */

import { log } from '../logger';

const BASE = 'https://api.search.brave.com/res/v1/web/search';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Hostname derived from the URL (mirrors CSE's `displayLink`). */
  displayLink: string;
}

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
  // Brave surfaces errors as an HTTP status + JSON body; no `error` field
  // on 2xx responses. Any non-2xx is handled via res.ok below.
}

export interface WebSearchOpts {
  /** Number of results per query, 1-20 (Brave max). Default 10. */
  num?: number;
  /** Abort signal (propagates to fetch). */
  signal?: AbortSignal;
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Run a single Brave web search query.
 * Returns an empty array on any failure — the refresh pipeline never crashes
 * just because Brave's quota or network flaked.
 */
export async function webSearch(query: string, opts: WebSearchOpts = {}): Promise<WebSearchResult[]> {
  if (!isWebSearchConfigured()) return [];
  const { num = 10, signal, timeoutMs = 8_000 } = opts;

  const url = new URL(BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(num, 1), 20)));
  url.searchParams.set('safesearch', 'moderate');

  try {
    // Combine external signal with a local timeout
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY as string,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn('brave-search: request failed', { status: res.status, body: body.slice(0, 200) });
      return [];
    }

    const data = (await res.json()) as BraveResponse;
    const results = data.web?.results ?? [];

    return results
      .map(item => ({
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: item.description ?? '',
        displayLink: hostnameOf(item.url ?? ''),
      }))
      .filter(r => r.url);
  } catch (err) {
    log.debug('brave-search: fetch failed', { query: query.slice(0, 60), error: String(err) });
    return [];
  }
}

/**
 * Run multiple queries with a concurrency cap.
 *
 * Brave's free/low tier is 1 QPS — we default to concurrency 1 with a
 * minimum spacing so we don't trip rate limits. Paid Search plan allows
 * 50 QPS; callers on paid tiers can bump `concurrency` explicitly.
 *
 * Returns all unique results, deduplicated by URL.
 */
export async function webSearchMany(
  queries: string[],
  opts: WebSearchOpts & { concurrency?: number } = {},
): Promise<WebSearchResult[]> {
  if (!isWebSearchConfigured() || queries.length === 0) return [];
  const concurrency = Math.min(opts.concurrency ?? 2, queries.length);

  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  let i = 0;
  let lastStart = 0;
  const minSpacingMs = 250; // ~4 QPS ceiling per worker; with concurrency=2 → ~8 QPS total (well under 50)

  const workers = Array.from({ length: concurrency }, async () => {
    while (i < queries.length) {
      const idx = i++;
      // Simple spacing so bursts don't flood Brave's rate limiter
      const elapsed = Date.now() - lastStart;
      if (elapsed < minSpacingMs) {
        await new Promise(r => setTimeout(r, minSpacingMs - elapsed));
      }
      lastStart = Date.now();

      const items = await webSearch(queries[idx], opts);
      for (const item of items) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          results.push(item);
        }
      }
    }
  });

  await Promise.all(workers);
  log.info('brave-search: many done', { queries: queries.length, unique: results.length });
  return results;
}

/**
 * Tiered creator-intent queries for per-platform discovery.
 * Retained for any caller that wants IG/LinkedIn-flavored query bundles.
 * The live cross-platform pipeline uses CROSS_PLATFORM_QUERIES below.
 */
export const TRADING_QUERIES = {
  instagram: [
    // Tier 1: Monetized creators
    'forex course mentor',
    'trading course mentor',
    'crypto course mentor',
    'trading coach educator',
    'trading mentorship program',
    'forex signals community',
    'trading discord VIP',
    'premium trading signals',
    // Tier 2: Authority
    'live trading results',
    'day trading lifestyle',
    'funded trader journey',
    'trading results proof',
    // Tier 3: Education
    'trading tutorial strategy',
    'price action educator',
    'smart money concepts',
    // Tier 4: Prop-adjacent
    'prop firm review experience',
  ],
  linkedin: [
    // Tier 1: Monetized creators
    'trading mentor coach',
    'forex trading educator',
    'trading course creator',
    'crypto trading mentor',
    'trading community founder',
    'trading academy founder',
    // Tier 2: Authority
    'day trading educator',
    'trading coach entrepreneur',
    'funded trader results',
    // Tier 3: Education
    'financial educator trading',
    'trading book author',
    // Tier 4: Prop-adjacent
    'prop firm experience review',
  ],
} as const;

/**
 * Cross-platform queries — tiered, Tier 1 first.
 * Searches the whole web; results are classified by hostname via
 * `extractCrossPlatformHandle` so a single query surfaces IG, LinkedIn,
 * X, YouTube, Reddit, StockTwits, Telegram, and Discord candidates.
 */
export const CROSS_PLATFORM_QUERIES = [
  // Tier 1: Monetized creators (50% of cross-platform budget)
  'trading course mentor enroll',
  'forex mentor coaching session',
  'trading discord VIP signals',
  'crypto mentor course join',
  'trading community premium signals',
  'trading academy mentorship program',
  'free trading course signals',
  'trading bootcamp course review',
  // Tier 2: Authority
  'live trading session results',
  'funded trader journey proof',
  'trading results proof payout',
  // Tier 3: Education
  'price action strategy tutorial',
  'smart money concepts explained',
  'trading psychology discipline coach',
  // Tier 4: Prop-adjacent
  'prop firm review honest experience',
  'how to pass prop firm challenge',
];

// ─── Multi-platform discovery ───────────────────────────────────────

export interface CrossPlatformCandidate {
  platform: 'instagram' | 'linkedin' | 'x' | 'youtube' | 'reddit' | 'stocktwits' | 'telegram' | 'discord';
  handle: string;
  profileUrl: string;
  name: string;
  sourceUrl: string;
  sourceTitle: string;
}

/**
 * Pull handles for multiple platforms out of a single search result URL.
 * Returns null for URLs we can't classify or for non-profile pages
 * (post URLs, tag pages, etc.). Pure function — no network.
 */
export function extractCrossPlatformHandle(url: string, title = ''): CrossPlatformCandidate | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname;

  // ── Instagram: /{handle}/ or /{handle}
  if (host.endsWith('instagram.com')) {
    const m = path.match(/^\/([a-zA-Z0-9_.]{2,30})\/?$/);
    if (!m) return null;
    const bl = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'tv', 'tags'];
    if (bl.includes(m[1])) return null;
    return {
      platform: 'instagram',
      handle: m[1],
      profileUrl: `https://instagram.com/${m[1]}`,
      name: cleanResultTitle(title) || prettifyHandle(m[1]),
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  // ── LinkedIn: /in/{slug} or /company/{slug}
  if (host.endsWith('linkedin.com')) {
    const m = path.match(/^\/(in|company)\/([a-zA-Z0-9\-]{2,60})\/?/);
    if (!m) return null;
    return {
      platform: 'linkedin',
      handle: m[2],
      profileUrl: `https://linkedin.com/${m[1]}/${m[2]}`,
      name: cleanResultTitle(title) || prettifyHandle(m[2]),
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  // ── X / Twitter: /{handle}
  if (host === 'x.com' || host.endsWith('twitter.com')) {
    const m = path.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
    if (!m) return null;
    const bl = ['intent', 'share', 'i', 'search', 'explore', 'home', 'settings', 'login', 'signup', 'about', 'jobs', 'tos', 'privacy'];
    if (bl.includes(m[1])) return null;
    return {
      platform: 'x',
      handle: m[1],
      profileUrl: `https://x.com/${m[1]}`,
      name: cleanResultTitle(title) || prettifyHandle(m[1]),
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  // ── YouTube: /@{handle}, /channel/{id}, /c/{slug}, /user/{slug}
  if (host.endsWith('youtube.com')) {
    const at = path.match(/^\/@([a-zA-Z0-9_\-.]{2,50})\/?$/);
    if (at) {
      return {
        platform: 'youtube',
        handle: at[1],
        profileUrl: `https://youtube.com/@${at[1]}`,
        name: cleanResultTitle(title) || prettifyHandle(at[1]),
        sourceUrl: url,
        sourceTitle: title,
      };
    }
    const channel = path.match(/^\/(?:c|channel|user)\/([a-zA-Z0-9_\-]{2,50})\/?/);
    if (channel) {
      return {
        platform: 'youtube',
        handle: channel[1],
        profileUrl: `https://youtube.com/c/${channel[1]}`,
        name: cleanResultTitle(title) || prettifyHandle(channel[1]),
        sourceUrl: url,
        sourceTitle: title,
      };
    }
    return null;
  }

  // ── StockTwits: /{handle}
  if (host.endsWith('stocktwits.com')) {
    const m = path.match(/^\/([a-zA-Z0-9_]{2,30})\/?$/);
    if (!m) return null;
    const bl = ['about', 'help', 'news', 'rankings', 'symbol', 'search'];
    if (bl.includes(m[1])) return null;
    return {
      platform: 'stocktwits',
      handle: m[1],
      profileUrl: `https://stocktwits.com/${m[1]}`,
      name: cleanResultTitle(title) || prettifyHandle(m[1]),
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  // ── Telegram: t.me/{channel}
  if (host === 't.me' || host.endsWith('.t.me')) {
    const m = path.match(/^\/([a-zA-Z0-9_]{4,40})\/?$/);
    if (!m) return null;
    return {
      platform: 'telegram',
      handle: m[1],
      profileUrl: `https://t.me/${m[1]}`,
      name: cleanResultTitle(title) || prettifyHandle(m[1]),
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  // ── Discord invites: discord.com/invite/{code} or discord.gg/{code}
  if (host.endsWith('discord.com') || host === 'discord.gg') {
    const m = path.match(/^\/(?:invite\/)?([a-zA-Z0-9\-]{4,30})\/?$/);
    if (!m) return null;
    return {
      platform: 'discord',
      handle: m[1],
      profileUrl: `https://discord.gg/${m[1]}`,
      name: cleanResultTitle(title) || `Discord: ${m[1]}`,
      sourceUrl: url,
      sourceTitle: title,
    };
  }

  return null;
}

function prettifyHandle(handle: string): string {
  return handle.replace(/[_.\-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function cleanResultTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/\s*\(@[^)]+\).*$/, '')                    // "(@handle) · ..."
    .replace(/\s*\|\s*LinkedIn.*$/i, '')                 // "Name | LinkedIn"
    .replace(/\s*-\s*YouTube.*$/i, '')                   // "Name - YouTube"
    .replace(/\s*on\s+(?:Instagram|LinkedIn|Twitter|X).*$/i, '') // "Name on Instagram"
    .replace(/\s*[\|\-–·•]\s*.*$/, '')                   // general separator suffix
    .trim();
}

/**
 * Run Brave search across all cross-platform queries and return handles
 * for every platform we can classify. The same result URL is only
 * returned once.
 *
 * This is the heavy lifter for cross-platform discovery — a single call
 * surfaces IG, LinkedIn, X, YouTube, StockTwits, Telegram, and Discord
 * candidates in one shot.
 */
export async function discoverAcrossPlatforms(
  opts: WebSearchOpts & { concurrency?: number; queries?: readonly string[] } = {},
): Promise<CrossPlatformCandidate[]> {
  if (!isWebSearchConfigured()) return [];
  const queries = opts.queries ?? CROSS_PLATFORM_QUERIES;
  const results = await webSearchMany([...queries], opts);

  const seen = new Set<string>(); // `${platform}::${handle.toLowerCase()}`
  const out: CrossPlatformCandidate[] = [];
  for (const r of results) {
    const cand = extractCrossPlatformHandle(r.url, r.title);
    if (!cand) continue;
    const key = `${cand.platform}::${cand.handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cand);
  }

  log.info('brave-search: cross-platform done', {
    queries: queries.length,
    rawResults: results.length,
    candidates: out.length,
    byPlatform: countByPlatform(out),
  });
  return out;
}

function countByPlatform(list: CrossPlatformCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of list) counts[c.platform] = (counts[c.platform] ?? 0) + 1;
  return counts;
}
