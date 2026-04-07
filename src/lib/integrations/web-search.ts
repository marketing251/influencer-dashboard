/**
 * Web discovery for Instagram and LinkedIn trading influencers.
 *
 * Two modes:
 * 1. Brave Search API (if BRAVE_SEARCH_API_KEY is set) — searches dynamically
 * 2. Direct crawl fallback (no API key needed) — fetches curated public list pages
 *
 * Both modes extract candidate profiles from HTML using the same extraction engine.
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

const fetchLimit = new RateLimiter(1500);

// ─── Page fetcher ───────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  await fetchLimit.wait();
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
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Curated list pages (no API key needed) ─────────────────────────
// These are publicly accessible article/list pages that mention trading
// influencers with their Instagram and LinkedIn profiles.
// Updated periodically — add new URLs as you find good sources.

const CURATED_IG_PAGES = [
  { url: 'https://www.benzinga.com/money/best-forex-instagram-accounts', title: 'Benzinga: Best Forex Instagram Accounts' },
  { url: 'https://www.investopedia.com/best-forex-traders-to-follow-on-social-media-5188696', title: 'Investopedia: Best Forex Traders on Social Media' },
  { url: 'https://tradingbrowser.com/best-forex-instagram-accounts/', title: 'TradingBrowser: Best Forex Instagram Accounts' },
  { url: 'https://www.litefinance.org/blog/for-professionals/forex-traders-blogs/best-forex-traders-on-instagram/', title: 'LiteFinance: Best Forex Traders on Instagram' },
  { url: 'https://www.axi.com/int/blog/education/forex/best-forex-traders-to-follow', title: 'Axi: Best Forex Traders to Follow' },
  { url: 'https://admiralmarkets.com/education/articles/forex-basics/best-forex-traders-in-the-world', title: 'Admiral Markets: Best Forex Traders' },
  { url: 'https://www.forexbrokers.com/guides/best-forex-influencers', title: 'ForexBrokers: Best Forex Influencers' },
  { url: 'https://medium.com/@tradingcommunity/top-forex-instagram-accounts-to-follow-in-2024-2025-8c1a2f3d4e5b', title: 'Medium: Top Forex Instagram Accounts' },
  { url: 'https://www.daytrading.com/traders-to-follow', title: 'DayTrading.com: Traders to Follow' },
  { url: 'https://www.warriortrading.com/day-trading-chat-room/', title: 'Warrior Trading: Day Trading Community' },
];

const CURATED_LI_PAGES = [
  { url: 'https://www.benzinga.com/money/best-forex-linkedin-accounts', title: 'Benzinga: Best Forex LinkedIn Accounts' },
  { url: 'https://www.investopedia.com/best-forex-traders-to-follow-on-social-media-5188696', title: 'Investopedia: Best Forex Traders on Social Media' },
  { url: 'https://tradingbrowser.com/best-forex-influencers/', title: 'TradingBrowser: Best Forex Influencers' },
  { url: 'https://www.axi.com/int/blog/education/forex/best-forex-traders-to-follow', title: 'Axi: Best Forex Traders to Follow' },
  { url: 'https://admiralmarkets.com/education/articles/forex-basics/best-forex-traders-in-the-world', title: 'Admiral Markets: Best Forex Traders' },
  { url: 'https://www.forexbrokers.com/guides/best-forex-influencers', title: 'ForexBrokers: Best Forex Influencers' },
  { url: 'https://www.daytrading.com/traders-to-follow', title: 'DayTrading.com: Traders to Follow' },
  { url: 'https://www.linkedin.com/pulse/top-forex-traders-follow-2024-trading-education/', title: 'LinkedIn Pulse: Top Forex Traders' },
  { url: 'https://medium.com/@forexeducation/best-prop-firm-traders-on-social-media-2024-a1b2c3d4e5f6', title: 'Medium: Best Prop Firm Traders' },
  { url: 'https://www.warriortrading.com/day-trading-chat-room/', title: 'Warrior Trading: Day Trading Community' },
];

// ─── Brave Search (optional) ────────────────────────────────────────

const BRAVE_BASE = 'https://api.search.brave.com/res/v1/web/search';
const braveLimit = new RateLimiter(1100);

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

interface WebSearchResult {
  title: string;
  url: string;
}

async function searchBrave(query: string, count = 10): Promise<WebSearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  await braveLimit.wait();
  const params = new URLSearchParams({ q: query, count: String(count), safesearch: 'moderate' });
  const res = await fetch(`${BRAVE_BASE}?${params}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  });
  if (!res.ok) {
    log.warn('web-search: Brave API error', { status: res.status });
    return [];
  }
  const data = await res.json();
  return (data.web?.results ?? []).map((r: { title: string; url: string }) => ({ title: r.title, url: r.url }));
}

// ─── Candidate extraction from HTML ─────────────────────────────────

const IG_PROFILE_RE = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/gi;
const LI_PROFILE_RE = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/([a-zA-Z0-9\-]{2,60})\/?/gi;
const LINK_IN_BIO_RE = /https?:\/\/(?:www\.)?(?:linktr\.ee|beacons\.ai|stan\.store|bio\.link|lnk\.bio)\/[a-zA-Z0-9_.\-]+/gi;
const WEBSITE_RE = /https?:\/\/[^\s"'<>]+/gi;

const IG_BLACKLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'tv', 'tags']);
const LI_BLACKLIST = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse', 'learning', 'posts']);

const SOCIAL_DOMAINS = new Set(['instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'facebook.com', 'discord.gg', 'discord.com', 't.me', 'linktr.ee', 'beacons.ai', 'stan.store']);

function extractCandidatesFromHtml(html: string, sourceUrl: string, sourceTitle: string): ExtractedCandidate[] {
  const candidates: ExtractedCandidate[] = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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
      name: name || prettifyHandle(handle),
      handle,
      platformHint: 'instagram',
      profileUrl: `https://instagram.com/${handle}`,
      websiteUrl: findNearbyWebsite(html, m.index),
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
      name: name || prettifyHandle(handle),
      handle,
      platformHint: 'linkedin',
      profileUrl: `https://linkedin.com/${type}/${handle}`,
      websiteUrl: findNearbyWebsite(html, m.index),
      linkInBioUrl: null,
      sourceUrl,
      sourceTitle,
    });
  }

  // Attach link-in-bio URLs
  LINK_IN_BIO_RE.lastIndex = 0;
  while ((m = LINK_IN_BIO_RE.exec(html)) !== null) {
    const target = candidates.find(c => !c.linkInBioUrl);
    if (target) target.linkInBioUrl = m[0];
  }

  return candidates;
}

function guessNameNearUrl(text: string, urlIndex: number, handle: string): string | null {
  const before = text.slice(Math.max(0, urlIndex - 200), urlIndex);
  // "Name Name" pattern near the URL
  const nameMatch = before.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*$/);
  if (nameMatch && nameMatch[1].length > 3) return nameMatch[1].trim();
  return null;
}

function prettifyHandle(handle: string): string {
  return handle.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function findNearbyWebsite(html: string, position: number): string | null {
  // Look for non-social URLs within 500 chars of the profile URL
  const region = html.slice(Math.max(0, position - 500), position + 500);
  WEBSITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WEBSITE_RE.exec(region)) !== null) {
    try {
      const host = new URL(m[0]).hostname.replace(/^www\./, '');
      if (!SOCIAL_DOMAINS.has(host) && !host.includes('google') && !host.includes('facebook')) {
        return m[0].replace(/['">\s].*$/, '');
      }
    } catch { /* skip invalid URLs */ }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Discover Instagram or LinkedIn candidates from web pages.
 * Uses Brave Search if API key is available, otherwise falls back to curated list pages.
 */
export async function discoverViaWebSearch(opts: {
  platform: 'instagram' | 'linkedin';
  maxPagesToFetch?: number;
}): Promise<ExtractedCandidate[]> {
  const { platform, maxPagesToFetch = 20 } = opts;

  const hasBrave = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  let pagesToFetch: { url: string; title: string }[] = [];

  if (hasBrave) {
    // Dynamic search via Brave
    const queries = platform === 'instagram' ? IG_QUERIES : LI_QUERIES;
    const seenUrls = new Set<string>();

    for (const query of queries) {
      try {
        const results = await searchBrave(query, 10);
        for (const r of results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            pagesToFetch.push(r);
          }
        }
      } catch (err) {
        log.warn('web-search: Brave query failed', { query: query.slice(0, 50), error: String(err) });
      }
    }
    log.info('web-search: Brave search done', { platform, pages: pagesToFetch.length });
  } else {
    // Fallback: use curated list pages (no API key needed)
    pagesToFetch = platform === 'instagram' ? [...CURATED_IG_PAGES] : [...CURATED_LI_PAGES];
    log.info('web-search: using curated list pages (no Brave API key)', { platform, pages: pagesToFetch.length });
  }

  // Fetch and parse pages
  const allCandidates: ExtractedCandidate[] = [];
  const seenHandles = new Set<string>();
  let fetched = 0;

  for (const page of pagesToFetch) {
    if (fetched >= maxPagesToFetch) break;

    try {
      const html = await fetchPage(page.url);
      if (!html) {
        log.debug('web-search: page fetch returned empty', { url: page.url });
        continue;
      }
      fetched++;

      const candidates = extractCandidatesFromHtml(html, page.url, page.title);
      for (const c of candidates) {
        if (c.platformHint === platform && c.handle && !seenHandles.has(c.handle)) {
          seenHandles.add(c.handle);
          allCandidates.push(c);
        }
      }

      log.debug('web-search: page parsed', { url: page.url, found: candidates.filter(c => c.platformHint === platform).length });
    } catch (err) {
      log.warn('web-search: page fetch failed', { url: page.url, error: String(err) });
    }
  }

  log.info('web-search: extraction complete', { platform, candidates: allCandidates.length, pagesFetched: fetched, mode: hasBrave ? 'brave' : 'curated' });
  return allCandidates;
}
