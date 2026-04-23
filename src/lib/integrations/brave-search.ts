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
  // Default 15 results/query (up from 10) surfaces tail creators without
  // increasing Brave query count (pricing is per-query, not per-result).
  const { num = 15, signal, timeoutMs = 8_000 } = opts;

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
 * Searches the whole web; social profile URLs route through
 * `extractCrossPlatformHandle` and non-social URLs route through
 * `classifyBraveResult` → website-first leads. Between the two pathways
 * we capture virtually every result Brave returns (the old CSE dropped
 * ~80% of results because creator websites weren't social hosts).
 *
 * Expanded from 16 → 60 queries to cover more niches, geographies,
 * and funnel-intent variants. Adaptive allocation (future work) will
 * prioritize the best performers once keyword_performance accumulates.
 */
export const CROSS_PLATFORM_QUERIES = [
  // ─── Tier 1: Monetized creators (course/mentorship intent) ────────
  'trading course mentor enroll',
  'forex mentor coaching session',
  'trading discord VIP signals',
  'crypto mentor course join',
  'trading community premium signals',
  'trading academy mentorship program',
  'free trading course signals',
  'trading bootcamp course review',
  'options trading mentor course',
  'day trading coach one on one',
  'swing trading mentor program',
  'futures trading coach academy',
  'crypto trading course enroll',
  'forex signals telegram premium',
  'trading psychology coach private',
  'stock trading mentorship join',
  // ─── Tier 1b: Niche-specific monetization ─────────────────────────
  'ICT concepts mentor course',
  'smart money concepts mentor course',
  'supply demand trading mentor',
  'price action coach mentorship',
  'volume profile trading mentor',
  'elliott wave trading mentor',
  'scalping mentor trader course',
  // ─── Tier 2: Authority / proof-of-results ─────────────────────────
  'live trading session results',
  'funded trader journey proof',
  'trading results proof payout',
  'six figure trader educator',
  'full time trader lifestyle coach',
  'prop firm payout proof mentor',
  'seven figure trader mentor',
  'funded trader challenge pass coach',
  // ─── Tier 3: Education / strategy ─────────────────────────────────
  'price action strategy tutorial',
  'smart money concepts explained',
  'trading psychology discipline coach',
  'options flow strategy educator',
  'risk management trading coach',
  'trading journal review educator',
  'technical analysis mentor tutorial',
  'algorithmic trading educator python',
  'order flow trading mentor',
  // ─── Tier 4: Prop-adjacent ────────────────────────────────────────
  'prop firm review honest experience',
  'how to pass prop firm challenge',
  'prop firm affiliate coach review',
  'top prop firm for funded traders',
  'prop firm comparison educator',
  'best prop firm challenge strategy',
  // ─── Tier 5: Geo / demo variants ──────────────────────────────────
  'UK forex trader mentor coach',
  'US day trader mentor coach',
  'Australia forex educator course',
  'Singapore trading coach academy',
  'Dubai forex trader mentor',
  'Canada stock trading educator',
  'South Africa forex mentor course',
  // ─── Tier 6: Funnel intent / CTAs ─────────────────────────────────
  'book a call trading coach',
  'apply for trading mentorship',
  'trading mentor free discovery call',
  'join our trading discord free',
  'skool trading community join',
  'whop trading signals community',
  'trading course early bird enroll',
  'trading mentor application form',
  // ─── Tier 7: Archetypes / creator backgrounds ─────────────────────
  'former hedge fund trader mentor',
  'ex investment banker trading coach',
  'retired floor trader educator',
  'self taught trader course',
  'millionaire trader mentor',
  'professional trader coaching',
  'full time forex trader mentor',
  'trading veteran educator',
  // ─── Tier 8: Asset-class specialists ──────────────────────────────
  'futures day trader mentor course',
  'options seller mentor wheel strategy',
  '0DTE options trader mentor',
  'SPX scalping mentor coach',
  'bitcoin trader mentor course',
  'ethereum defi trader educator',
  'commodities trader mentor coach',
  'gold silver trader educator',
  'indices trader mentor',
  'emini futures mentor trader',
  // ─── Tier 9: Format / distribution channel ────────────────────────
  'trading podcast host interview',
  'trading newsletter substack mentor',
  'trading YouTube channel mentor',
  'trading blog educator contact',
  'trading ebook author mentor',
  'trading webinar host educator',
  'trading masterclass author',
  // ─── Tier 10: Review / recommendation queries ─────────────────────
  'best trading mentor review',
  'top trading course reviewed',
  'best forex course 2026 review',
  'best day trading course review',
  'trading mentor comparison',
  'trading coach testimonials student',
  'trading course alumni review',
  // ─── Tier 11: Outcome / aspiration ────────────────────────────────
  'quit my job trading mentor',
  'trading for a living educator',
  'financial freedom trader mentor',
  'consistent profitable trader coach',
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
 * Legacy social-only discovery. Prefer `discoverAll()` which returns
 * both social and website-first leads from a single Brave pass.
 * Retained for any future caller that only wants social candidates.
 */
export async function discoverAcrossPlatforms(
  opts: WebSearchOpts & { concurrency?: number; queries?: readonly string[] } = {},
): Promise<CrossPlatformCandidate[]> {
  const { socialCandidates } = await discoverAll(opts);
  return socialCandidates;
}

function countByPlatform(list: CrossPlatformCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of list) counts[c.platform] = (counts[c.platform] ?? 0) + 1;
  return counts;
}

// ─── Website-first leads ────────────────────────────────────────────

/**
 * A Brave result that didn't match a known social-profile URL pattern.
 * These are direct creator websites, marketplace listings, blog posts,
 * or listicles. The refresh pipeline fast-enriches each URL to pull
 * contact info + social links and upserts them with `platform='website'`.
 */
export interface WebsiteLead {
  websiteUrl: string;
  domain: string;
  title: string;
  snippet: string;
  sourceQuery?: string;
}

/**
 * Hosts we NEVER want as website-first leads — either they're social
 * (handled by extractCrossPlatformHandle) or they're aggregators /
 * directories / SEO-farms that don't correspond to a single creator.
 */
const WEBSITE_LEAD_HOST_DENYLIST = new Set([
  // Social platforms (already handled by extractCrossPlatformHandle)
  'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'youtu.be', 'reddit.com', 'tiktok.com',
  'facebook.com', 'threads.net', 'pinterest.com',
  'stocktwits.com', 't.me', 'discord.com', 'discord.gg',
  // Marketplaces / directories / aggregators (not a creator)
  'fiverr.com', 'upwork.com', 'guru.com', 'clarity.fm',
  'tradersunion.com', 'investopedia.com', 'wikipedia.org',
  'medium.com', 'substack.com', 'tumblr.com', 'blogspot.com',
  'quora.com', 'stackoverflow.com', 'github.com',
  'amazon.com', 'ebay.com', 'etsy.com', 'apple.com', 'google.com',
  'bing.com', 'yahoo.com', 'duckduckgo.com',
  'nytimes.com', 'bloomberg.com', 'reuters.com', 'cnbc.com',
  'forbes.com', 'businessinsider.com', 'yahoo-finance.com',
  // Misc infra / tech
  'cloudflare.com', 'vercel.app', 'netlify.app', 'herokuapp.com',
]);

function isWebsiteLeadCandidate(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (WEBSITE_LEAD_HOST_DENYLIST.has(host)) return false;
    // Also reject any subdomain of the denylist (e.g. shop.fiverr.com)
    for (const banned of WEBSITE_LEAD_HOST_DENYLIST) {
      if (host.endsWith(`.${banned}`)) return false;
    }
    // Require at least one dot + reasonable length (rejects raw IPs)
    if (!host.includes('.') || host.length < 5 || host.length > 80) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Unified single-pass discovery — runs Brave once across all queries
 * and classifies each result into either a social-profile candidate
 * (handled via `extractCrossPlatformHandle`) or a website-first lead
 * (direct creator domain, fast-enriched downstream).
 *
 * This is the preferred entry point. Single API pass, two output
 * arrays. Dedupes social by `platform::handle` and websites by domain.
 */
export async function discoverAll(
  opts: WebSearchOpts & {
    concurrency?: number;
    queries?: readonly string[];
    maxWebsiteLeads?: number;
  } = {},
): Promise<{ socialCandidates: CrossPlatformCandidate[]; websiteLeads: WebsiteLead[] }> {
  if (!isWebSearchConfigured()) return { socialCandidates: [], websiteLeads: [] };
  const queries = opts.queries ?? CROSS_PLATFORM_QUERIES;
  const maxWebsiteLeads = opts.maxWebsiteLeads ?? 200;
  const results = await webSearchMany([...queries], opts);

  const seenSocial = new Set<string>();
  const socialCandidates: CrossPlatformCandidate[] = [];
  const seenDomain = new Set<string>();
  const websiteLeads: WebsiteLead[] = [];

  for (const r of results) {
    const social = extractCrossPlatformHandle(r.url, r.title);
    if (social) {
      const key = `${social.platform}::${social.handle.toLowerCase()}`;
      if (!seenSocial.has(key)) {
        seenSocial.add(key);
        socialCandidates.push(social);
      }
      continue;
    }
    if (websiteLeads.length >= maxWebsiteLeads) continue;
    if (!isWebsiteLeadCandidate(r.url)) continue;
    let domain: string;
    try {
      domain = new URL(r.url).hostname.toLowerCase().replace(/^www\./, '');
    } catch { continue; }
    if (seenDomain.has(domain)) continue;
    seenDomain.add(domain);
    // Prefer the bare root URL — fast-enrich will crawl sub-pages
    websiteLeads.push({
      websiteUrl: `https://${domain}/`,
      domain,
      title: r.title,
      snippet: r.snippet,
    });
  }

  log.info('brave-search: discoverAll done', {
    queries: queries.length,
    rawResults: results.length,
    socialCandidates: socialCandidates.length,
    websiteLeads: websiteLeads.length,
    byPlatform: countByPlatform(socialCandidates),
  });
  return { socialCandidates, websiteLeads };
}
