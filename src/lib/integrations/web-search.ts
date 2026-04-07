/**
 * Web discovery for Instagram and LinkedIn trading influencers.
 *
 * Two modes:
 * 1. Brave Search API (if BRAVE_SEARCH_API_KEY is set) — dynamic search
 * 2. DuckDuckGo HTML search (no API key needed) — free, always available
 *
 * Both modes extract candidate profiles from search results and crawled pages.
 */

import { log } from '../logger';
import type { Platform } from '../types';

// ─── Types ──────────────────────────────────────────────────────────

export interface ExtractedCandidate {
  name: string;
  handle: string | null;
  platformHint: Platform | null;
  profileUrl: string | null;
  websiteUrl: string | null;
  linkInBioUrl: string | null;
  sourceUrl: string;
  sourceTitle: string;
}

// ─── Rate limiter ───────────────────────────────────────────────────

class RateLimiter {
  private lastCall = 0;
  constructor(private minMs: number) {}
  async wait() {
    const elapsed = Date.now() - this.lastCall;
    if (elapsed < this.minMs) await new Promise(r => setTimeout(r, this.minMs - elapsed));
    this.lastCall = Date.now();
  }
}

const searchLimit = new RateLimiter(2000); // polite delay between search queries
const fetchLimit = new RateLimiter(1500);

// ─── Shared page fetcher ────────────────────────────────────────────

async function fetchPage(url: string, rateLimit = true): Promise<string | null> {
  if (rateLimit) await fetchLimit.wait();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Search queries per platform ────────────────────────────────────

const IG_QUERIES = [
  'instagram.com forex trader educator',
  'instagram.com prop firm funded trader FTMO',
  'instagram.com funded trader payout results',
  'instagram.com trading mentor course academy',
  'instagram.com forex signals community',
  'instagram.com day trading scalping live',
  'instagram.com smart money ICT trading',
  'instagram.com options trading education',
  'instagram.com futures trading NQ ES',
  'best forex traders instagram list 2024 2025',
  'top trading influencers instagram prop firm list',
  'funded trader instagram accounts to follow',
];

const LI_QUERIES = [
  'linkedin.com/in forex trader educator',
  'linkedin.com/in prop firm funded trader',
  'linkedin.com/in trading mentor coach',
  'linkedin.com/in day trading education',
  'linkedin.com/in funded trader FTMO results',
  'top forex traders linkedin profile list',
  'trading educators linkedin 2024 2025',
  'prop firm trader linkedin profiles',
];

// ─── DuckDuckGo HTML search (no API key needed) ────────────────────

async function searchDuckDuckGo(query: string): Promise<string | null> {
  await searchLimit.wait();
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  return fetchPage(url, false);
}

// ─── Brave Search API (optional) ────────────────────────────────────

async function searchBrave(query: string): Promise<{ url: string; title: string }[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  await searchLimit.wait();
  const params = new URLSearchParams({ q: query, count: '10', safesearch: 'moderate' });
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results ?? []).map((r: { title: string; url: string }) => ({ title: r.title, url: r.url }));
  } catch {
    return [];
  }
}

// ─── Profile extraction from HTML ───────────────────────────────────

const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})\b/gi;
const LI_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/([a-zA-Z0-9\-]{2,60})\b/gi;
const LIB_RE = /https?:\/\/(?:www\.)?(?:linktr\.ee|beacons\.ai|stan\.store|bio\.link|lnk\.bio)\/[a-zA-Z0-9_.\-]+/gi;

const IG_BLACKLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'tv', 'tags', '_u', '_n', 'popular', 'nametag']);
const LI_BLACKLIST = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse', 'learning', 'posts', 'company']);

function extractHandlesFromHtml(html: string, platform: 'instagram' | 'linkedin'): Set<string> {
  const handles = new Set<string>();
  const re = platform === 'instagram' ? IG_RE : LI_RE;
  const blacklist = platform === 'instagram' ? IG_BLACKLIST : LI_BLACKLIST;

  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const h = m[1].toLowerCase();
    if (!blacklist.has(h) && h.length > 2) handles.add(h);
  }
  return handles;
}

function prettifyHandle(handle: string): string {
  return handle
    .replace(/[_.]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ─── Main discovery function ────────────────────────────────────────

export async function discoverViaWebSearch(opts: {
  platform: 'instagram' | 'linkedin';
  maxPagesToFetch?: number;
}): Promise<ExtractedCandidate[]> {
  const { platform, maxPagesToFetch = 15 } = opts;
  const queries = platform === 'instagram' ? IG_QUERIES : LI_QUERIES;
  const hasBrave = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  const allHandles = new Map<string, ExtractedCandidate>();

  log.info('web-search: starting', { platform, mode: hasBrave ? 'brave+ddg' : 'ddg', queries: queries.length });

  // Phase 1: Search using DuckDuckGo (always) + Brave (if available)
  // DuckDuckGo search results directly contain profile URLs in the HTML
  for (const query of queries) {
    try {
      // DuckDuckGo HTML search
      const ddgHtml = await searchDuckDuckGo(query);
      if (ddgHtml) {
        const handles = extractHandlesFromHtml(ddgHtml, platform);
        for (const handle of handles) {
          if (!allHandles.has(handle)) {
            allHandles.set(handle, {
              name: prettifyHandle(handle),
              handle,
              platformHint: platform,
              profileUrl: platform === 'instagram'
                ? `https://instagram.com/${handle}`
                : `https://linkedin.com/in/${handle}`,
              websiteUrl: null,
              linkInBioUrl: null,
              sourceUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
              sourceTitle: `DDG: ${query}`,
            });
          }
        }
        log.debug('web-search: DDG query done', { query: query.slice(0, 40), found: handles.size });
      }
    } catch (err) {
      log.warn('web-search: DDG query failed', { query: query.slice(0, 40), error: String(err) });
    }
  }

  // Phase 2: If Brave is available, also search and fetch result pages for deeper extraction
  if (hasBrave) {
    const seenUrls = new Set<string>();
    for (const query of queries.slice(0, 5)) { // limit Brave queries to save quota
      try {
        const results = await searchBrave(query);
        for (const r of results) {
          if (!seenUrls.has(r.url) && seenUrls.size < maxPagesToFetch) {
            seenUrls.add(r.url);
            const html = await fetchPage(r.url);
            if (html) {
              const handles = extractHandlesFromHtml(html, platform);
              for (const handle of handles) {
                if (!allHandles.has(handle)) {
                  allHandles.set(handle, {
                    name: prettifyHandle(handle),
                    handle,
                    platformHint: platform,
                    profileUrl: platform === 'instagram'
                      ? `https://instagram.com/${handle}`
                      : `https://linkedin.com/in/${handle}`,
                    websiteUrl: null,
                    linkInBioUrl: null,
                    sourceUrl: r.url,
                    sourceTitle: r.title,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        log.warn('web-search: Brave query failed', { query: query.slice(0, 40), error: String(err) });
      }
    }
  }

  const candidates = [...allHandles.values()];
  log.info('web-search: complete', { platform, totalCandidates: candidates.length, mode: hasBrave ? 'brave+ddg' : 'ddg' });
  return candidates;
}
