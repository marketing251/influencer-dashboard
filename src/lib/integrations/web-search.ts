/**
 * Web search discovery via Brave Search API.
 * Searches for public list pages about trading influencers on Instagram/LinkedIn,
 * then extracts candidate profiles from the HTML.
 *
 * Requires BRAVE_SEARCH_API_KEY.
 * Free tier: 2000 queries/month, 1 req/sec.
 */

import { log } from '../logger';
import type { Platform } from '../types';

const BRAVE_BASE = 'https://api.search.brave.com/res/v1/web/search';

function apiKey() {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY is not set');
  return key;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

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

// ─── Search queries ─────────────────────────────────────────────────

const IG_QUERIES = [
  'best forex traders Instagram 2025 2026',
  'top trading influencers Instagram prop firm',
  'funded trader Instagram accounts to follow',
  'day trading Instagram educators list',
  'forex Instagram influencers directory',
];

const LI_QUERIES = [
  'top forex traders LinkedIn profile',
  'prop firm funded traders LinkedIn',
  'trading educators LinkedIn list 2025 2026',
  'day trading coaches LinkedIn directory',
  'forex mentors LinkedIn profiles list',
];

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

const braveLimit = new RateLimiter(1100);
const fetchLimit = new RateLimiter(1500);

// ─── Brave Search ───────────────────────────────────────────────────

async function searchBrave(query: string, count = 10): Promise<WebSearchResult[]> {
  await braveLimit.wait();

  const params = new URLSearchParams({ q: query, count: String(count), safesearch: 'moderate' });
  const res = await fetch(`${BRAVE_BASE}?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey(),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brave search ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.web?.results ?? []).map((r: { title: string; url: string; description: string }) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

// ─── Page fetcher ───────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  await fetchLimit.wait();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfluencerDashboard/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Candidate extraction from HTML ─────────────────────────────────

const IG_PROFILE_RE = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/gi;
const LI_PROFILE_RE = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/([a-zA-Z0-9\-]{2,60})\/?/gi;
const LINK_IN_BIO_RE = /https?:\/\/(?:www\.)?(?:linktr\.ee|beacons\.ai|stan\.store|bio\.link|lnk\.bio)\/[a-zA-Z0-9_.\\-]+/gi;

const IG_BLACKLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal']);
const LI_BLACKLIST = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse', 'learning']);

function extractCandidatesFromHtml(html: string, sourceUrl: string, sourceTitle: string): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = [];
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const seen = new Set<string>();

  // Extract Instagram profiles
  IG_PROFILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IG_PROFILE_RE.exec(html)) !== null) {
    const handle = m[1].toLowerCase();
    if (IG_BLACKLIST.has(handle) || seen.has(`ig:${handle}`)) continue;
    seen.add(`ig:${handle}`);

    const name = guessNameNearUrl(text, m.index, handle);
    candidates.push({
      name: name || handle,
      handle,
      platformHint: 'instagram',
      profileUrl: `https://instagram.com/${handle}`,
      websiteUrl: null,
      linkInBioUrl: null,
      sourceUrl,
      sourceTitle,
    });
  }

  // Extract LinkedIn profiles
  LI_PROFILE_RE.lastIndex = 0;
  while ((m = LI_PROFILE_RE.exec(html)) !== null) {
    const handle = m[1].toLowerCase();
    if (LI_BLACKLIST.has(handle) || seen.has(`li:${handle}`)) continue;
    seen.add(`li:${handle}`);

    const type = m[0].includes('/company/') ? 'company' : 'in';
    const name = guessNameNearUrl(text, m.index, handle);
    candidates.push({
      name: name || handle,
      handle,
      platformHint: 'linkedin',
      profileUrl: `https://linkedin.com/${type}/${handle}`,
      websiteUrl: null,
      linkInBioUrl: null,
      sourceUrl,
      sourceTitle,
    });
  }

  // Attach link-in-bio URLs found on page to nearby candidates
  LINK_IN_BIO_RE.lastIndex = 0;
  const libUrls: string[] = [];
  while ((m = LINK_IN_BIO_RE.exec(html)) !== null) {
    libUrls.push(m[0]);
  }
  // Attach first link-in-bio to first candidate that doesn't have one
  for (const libUrl of libUrls) {
    const target = candidates.find(c => !c.linkInBioUrl);
    if (target) target.linkInBioUrl = libUrl;
  }

  return candidates;
}

/**
 * Try to find a person's name near where their profile URL appears in the text.
 * Looks for capitalized word sequences within 100 chars before the URL.
 */
function guessNameNearUrl(text: string, urlIndex: number, handle: string): string | null {
  const before = text.slice(Math.max(0, urlIndex - 150), urlIndex);
  // Look for "Name Name" patterns (2-4 capitalized words)
  const nameMatch = before.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*$/);
  if (nameMatch) return nameMatch[1].trim();
  // Fall back to handle prettification
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────

export async function discoverViaWebSearch(opts: {
  platform: 'instagram' | 'linkedin';
  maxResultsPerQuery?: number;
  maxPagesToFetch?: number;
}): Promise<ExtractedCandidate[]> {
  const { platform, maxResultsPerQuery = 10, maxPagesToFetch = 20 } = opts;
  const queries = platform === 'instagram' ? IG_QUERIES : LI_QUERIES;

  const allResults: WebSearchResult[] = [];
  const seenUrls = new Set<string>();

  // Phase 1: Search
  for (const query of queries) {
    try {
      const results = await searchBrave(query, maxResultsPerQuery);
      for (const r of results) {
        if (!seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          allResults.push(r);
        }
      }
      log.debug('web-search: query done', { query: query.slice(0, 50), results: results.length });
    } catch (err) {
      log.warn('web-search: query failed', { query: query.slice(0, 50), error: String(err) });
    }
  }

  log.info('web-search: search phase done', { platform, uniquePages: allResults.length });

  // Phase 2: Fetch and parse pages
  const allCandidates: ExtractedCandidate[] = [];
  const seenHandles = new Set<string>();
  let fetched = 0;

  for (const result of allResults) {
    if (fetched >= maxPagesToFetch) break;

    try {
      const html = await fetchPage(result.url);
      if (!html) continue;
      fetched++;

      const candidates = extractCandidatesFromHtml(html, result.url, result.title);
      for (const c of candidates) {
        if (c.platformHint === platform && c.handle && !seenHandles.has(c.handle)) {
          seenHandles.add(c.handle);
          allCandidates.push(c);
        }
      }
    } catch (err) {
      log.warn('web-search: page fetch failed', { url: result.url, error: String(err) });
    }
  }

  log.info('web-search: extraction done', { platform, candidates: allCandidates.length, pagesFetched: fetched });
  return allCandidates;
}
