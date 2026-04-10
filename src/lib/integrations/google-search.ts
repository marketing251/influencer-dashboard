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
export const TRADING_QUERIES = {
  instagram: [
    'forex trader mentor',
    'day trading coach',
    'crypto trader educator',
    'prop firm funded trader',
    'smart money ICT trader',
    'options trading mentor',
    'futures trader course',
    'trading academy community',
  ],
  linkedin: [
    'forex trader educator',
    'trading mentor coach',
    'prop trading firm funded trader',
    'day trader founder',
    'options trading coach',
    'trading academy founder',
    'quantitative trader educator',
    'crypto trading mentor',
  ],
} as const;
