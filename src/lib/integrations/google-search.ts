/**
 * Google Custom Search JSON API integration.
 *
 * Uses a Programmable Search Engine (cx) scoped to known creator directories
 * (instagram.com, linkedin.com, medium.com, reddit.com, tradingview.com, etc.)
 * to dynamically discover trading influencer profiles every refresh.
 *
 * Env vars:
 *   - GOOGLE_CLOUD_API_KEY — Google Cloud API key with Custom Search API enabled
 *   - GOOGLE_CSE_CX         — Programmable Search Engine ID
 *
 * Quota: 100 free queries/day, then $5 per 1,000 (max 10,000/day).
 * Docs: https://developers.google.com/custom-search/v1/using_rest
 */

import { log } from '../logger';

const BASE = 'https://customsearch.googleapis.com/customsearch/v1';

export interface GoogleSearchResult {
  title: string;
  url: string;
  snippet: string;
  displayLink: string;
}

export function isGoogleSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_API_KEY && process.env.GOOGLE_CSE_CX);
}

interface CSEItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
}

interface CSEResponse {
  items?: CSEItem[];
  searchInformation?: { totalResults?: string };
  error?: { code: number; message: string };
}

export interface GoogleSearchOpts {
  /** Number of results per query, 1-10 (Google max). Default 10. */
  num?: number;
  /** Abort signal (propagates to fetch). */
  signal?: AbortSignal;
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

/**
 * Run a single Google Custom Search query.
 * Returns an empty array on any failure — the refresh pipeline never crashes
 * just because Google's quota or network flaked.
 */
export async function googleSearch(query: string, opts: GoogleSearchOpts = {}): Promise<GoogleSearchResult[]> {
  if (!isGoogleSearchConfigured()) return [];
  const { num = 10, signal, timeoutMs = 8_000 } = opts;

  const url = new URL(BASE);
  url.searchParams.set('key', process.env.GOOGLE_CLOUD_API_KEY as string);
  url.searchParams.set('cx', process.env.GOOGLE_CSE_CX as string);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set('safe', 'active');

  try {
    // Combine external signal with a local timeout
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn('google-search: request failed', { status: res.status, body: body.slice(0, 200) });
      return [];
    }

    const data = (await res.json()) as CSEResponse;
    if (data.error) {
      log.warn('google-search: api error', { code: data.error.code, message: data.error.message });
      return [];
    }

    return (data.items ?? []).map(item => ({
      title: item.title ?? '',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
      displayLink: item.displayLink ?? '',
    })).filter(r => r.url);
  } catch (err) {
    log.debug('google-search: fetch failed', { query: query.slice(0, 60), error: String(err) });
    return [];
  }
}

/**
 * Run multiple queries in parallel with a concurrency cap.
 * Returns all unique results, deduplicated by URL.
 */
export async function googleSearchMany(
  queries: string[],
  opts: GoogleSearchOpts & { concurrency?: number } = {},
): Promise<GoogleSearchResult[]> {
  if (!isGoogleSearchConfigured() || queries.length === 0) return [];
  const concurrency = Math.min(opts.concurrency ?? 4, queries.length);

  const seen = new Set<string>();
  const results: GoogleSearchResult[] = [];
  let i = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (i < queries.length) {
      const idx = i++;
      const items = await googleSearch(queries[idx], opts);
      for (const item of items) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          results.push(item);
        }
      }
    }
  });

  await Promise.all(workers);
  log.info('google-search: many done', { queries: queries.length, unique: results.length });
  return results;
}

/**
 * Trading-focused query templates per platform.
 * Each query is crafted to surface educator/mentor/influencer profiles
 * on the target social site.
 */
/**
 * Creator-intent queries for per-platform discovery.
 * Every query is designed to find INDIVIDUAL CREATORS (mentors, educators,
 * content creators) — NOT companies, brokerages, or prop firms.
 */
export const TRADING_QUERIES = {
  instagram: [
    // ── Creator-intent (individuals who teach/mentor) ──
    'forex trading mentor',
    'trading coach educator',
    'crypto trader educator',
    'day trading mentor',
    'trading signals community',
    'trading course review',
    'options trading educator',
    'trading psychology coach',
    'price action trader tutorial',
    'smart money concepts educator',
    'trading discord community',
    'forex scalper strategy tutorial',
    'swing trader mentor',
    'trading lifestyle vlog',
    // ── Prop review (people reviewing, not firms) ──
    'prop firm review experience',
    'funded trader journey results',
  ],
  linkedin: [
    // ── Individual educators and founders ──
    'forex trading educator',
    'trading mentor coach',
    'trading course creator',
    'day trading educator',
    'options trading educator',
    'trading community founder',
    'crypto trading mentor',
    'trading coach entrepreneur',
    'financial educator trading',
    'trading book author',
    // ── Prop review (individuals) ──
    'funded trader results journey',
    'prop firm experience review',
  ],
} as const;

/**
 * Cross-platform queries used by `discoverAcrossPlatforms`.
 * These don't site-restrict on the query side — the CSE engine already
 * covers instagram/linkedin/twitter/youtube/reddit/medium/etc., and we
 * classify each result by its hostname.
 */
/**
 * Cross-platform queries — find creators across all sites in the CSE engine.
 * Creator-intent focused: every query signals an individual, not a company.
 */
export const CROSS_PLATFORM_QUERIES = [
  'forex trading mentor coach',
  'day trading educator tutorial',
  'trading course review honest',
  'crypto trading mentor signals',
  'options trading educator tutorial',
  'trading community discord free',
  'smart money concepts tutorial',
  'trading psychology coach mindset',
  'price action strategy tutorial',
  'funded trader journey experience',
  'prop firm review honest',
  'trading mentor coaching session',
  'scalping strategy tutorial explained',
  'swing trading mentor course',
  'trading signals results proof',
  'live trading stream session',
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
 * Pull handles for multiple platforms out of a single CSE result URL.
 * Returns null for URLs we can't classify or for non-profile pages
 * (post URLs, tag pages, etc.).
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
 * Run CSE across all trading queries and return handles for every platform
 * we can classify. The same result URL is only returned once.
 *
 * This is the heavy lifter for cross-platform discovery — a single call
 * surfaces IG, LinkedIn, X, YouTube, StockTwits, Telegram, and Discord
 * candidates in one shot, reusing the existing CSE engine configuration.
 */
export async function discoverAcrossPlatforms(
  opts: GoogleSearchOpts & { concurrency?: number; queries?: readonly string[] } = {},
): Promise<CrossPlatformCandidate[]> {
  if (!isGoogleSearchConfigured()) return [];
  const queries = opts.queries ?? CROSS_PLATFORM_QUERIES;
  const results = await googleSearchMany([...queries], opts);

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

  log.info('google-search: cross-platform done', {
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
