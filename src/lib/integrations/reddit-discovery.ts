/**
 * Reddit discovery — pulls trading influencer handles out of public subreddit
 * threads. Uses Reddit's OAuth API (script-app client_credentials flow).
 *
 * Two extraction strategies per subreddit:
 *   1. Post authors themselves — users posting high-engagement content in
 *      trading subreddits are often the creators we want.
 *   2. Cross-platform mentions — post bodies + titles are scanned for
 *      instagram.com / x.com / youtube.com / t.me / linktr.ee / etc. URLs,
 *      yielding handles on the platform those links point to.
 *
 * Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET env vars (create a
 * "script" app at https://www.reddit.com/prefs/apps). OAuth gives us
 * 100 requests/minute — plenty for 15 subreddits. Token is cached in
 * module memory and auto-refreshed on expiration.
 *
 * Without credentials the module is a no-op (isRedditConfigured() === false)
 * — Reddit's unauth JSON endpoints started getting 403 HTML login walls
 * for server-side traffic in 2024, so unauth fallback is not possible.
 */

import { log } from '../logger';
import { extractCrossPlatformHandle, type CrossPlatformCandidate } from './google-search';

const USER_AGENT = 'InfluencerDashboard/1.0 by /u/propaccount (+https://propaccount.com)';

// ─── OAuth (client_credentials) ─────────────────────────────────────

interface RedditTokenCache {
  token: string;
  expiresAt: number;  // epoch ms
}
let tokenCache: RedditTokenCache | null = null;

export function isRedditConfigured(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

/**
 * Fetch a Reddit OAuth bearer token via client_credentials. Caches the
 * result in module memory and returns the cached token until 5 minutes
 * before expiration. Returns null if credentials are missing or auth
 * fails so callers can gracefully degrade.
 */
export async function getRedditAccessToken(): Promise<string | null> {
  if (!isRedditConfigured()) return null;

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    return tokenCache.token;
  }

  const clientId = process.env.REDDIT_CLIENT_ID as string;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET as string;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn('reddit: auth failed', { status: res.status, body: body.slice(0, 200) });
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number; token_type?: string };
    if (!data.access_token) {
      log.warn('reddit: auth response missing token', { data });
      return null;
    }
    // expires_in is seconds; subtract a small buffer and convert to absolute ms
    const lifetimeMs = Math.max(60_000, (data.expires_in ?? 3600) * 1000);
    tokenCache = { token: data.access_token, expiresAt: now + lifetimeMs };
    log.info('reddit: got new access token', { expiresInSec: data.expires_in });
    return data.access_token;
  } catch (err) {
    log.warn('reddit: auth fetch failed', { error: String(err) });
    return null;
  }
}

const TRADING_SUBREDDITS = [
  'Forex',
  'Daytrading',
  'options',
  'algotrading',
  'StockMarket',
  'CryptoCurrency',
  'CryptoMarkets',
  'pennystocks',
  'wallstreetbets',
  'Trading',
  'SecurityAnalysis',
  'swingtrading',
  'Futures_Trading',
  'Forexstrategy',
  'propfirm',
];

// ─── Raw Reddit API types ───────────────────────────────────────────

interface RedditPostData {
  id: string;
  title: string;
  author: string;
  selftext: string;
  ups: number;
  num_comments: number;
  permalink: string;
  url: string;
  created_utc: number;
  subreddit: string;
  over_18: boolean;
  stickied: boolean;
  removed: boolean | null;
}

interface RedditListingChild { kind: string; data: RedditPostData }
interface RedditListing {
  data?: {
    children?: RedditListingChild[];
    after?: string | null;
  };
}

// ─── Fetch a subreddit's top posts (authenticated) ──────────────────

async function fetchTopPosts(subreddit: string, opts: { limit?: number; timeframe?: string; signal?: AbortSignal } = {}): Promise<RedditPostData[]> {
  const { limit = 50, timeframe = 'month', signal } = opts;
  const token = await getRedditAccessToken();
  if (!token) return [];

  // OAuth endpoints live on oauth.reddit.com and DON'T include .json
  const url = `https://oauth.reddit.com/r/${subreddit}/top?t=${timeframe}&limit=${Math.min(limit, 100)}&raw_json=1`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal,
    });
    if (!res.ok) {
      log.debug('reddit: fetch non-ok', { subreddit, status: res.status });
      // On 401 the token might have been revoked — clear cache so next call refetches
      if (res.status === 401) tokenCache = null;
      return [];
    }
    const data = (await res.json()) as RedditListing;
    return (data.data?.children ?? [])
      .map(c => c.data)
      .filter(p => !p.stickied && !p.removed && !p.over_18);
  } catch (err) {
    log.debug('reddit: fetch failed', { subreddit, error: String(err) });
    return [];
  }
}

// ─── URL extraction from post body ──────────────────────────────────

const URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;

function extractUrls(text: string): string[] {
  if (!text) return [];
  return text.match(URL_RE) ?? [];
}

// ─── Discovery helpers ──────────────────────────────────────────────

export interface RedditDiscoveryResult {
  /** Cross-platform handles extracted from post bodies (IG, X, YT, TG, etc.). */
  crossPlatformHandles: CrossPlatformCandidate[];
  /** Reddit authors themselves (stored as `handle` on platform `x` because
   *  we don't have a first-class Reddit platform in the DB yet — their posts
   *  are a weak signal anyway and we use them only for cross-reference). */
  redditAuthors: { handle: string; posts: number; karma: number }[];
}

export interface RedditDiscoveryOpts {
  /** Subreddits to scan. Defaults to TRADING_SUBREDDITS. */
  subreddits?: readonly string[];
  /** Posts per subreddit. Default 50. */
  postsPerSub?: number;
  /** "day" | "week" | "month" | "year" | "all". Default "month". */
  timeframe?: 'day' | 'week' | 'month' | 'year' | 'all';
  /** Only include posts with at least this many upvotes. Default 20. */
  minUpvotes?: number;
  /** Abort signal propagated to every fetch. */
  signal?: AbortSignal;
  /** Parallel subreddit fetches. Default 4. */
  concurrency?: number;
}

/**
 * Scan trading subreddits for creator handles.
 */
export async function discoverViaReddit(opts: RedditDiscoveryOpts = {}): Promise<RedditDiscoveryResult> {
  const {
    subreddits = TRADING_SUBREDDITS,
    postsPerSub = 50,
    timeframe = 'month',
    minUpvotes = 20,
    signal,
    concurrency = 4,
  } = opts;

  const seenHandles = new Set<string>();                // `${platform}::${handle}`
  const crossPlatformHandles: CrossPlatformCandidate[] = [];
  const authorCounts = new Map<string, { posts: number; karma: number }>();

  // Concurrent subreddit fetches
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, subreddits.length) }, async () => {
    while (i < subreddits.length) {
      if (signal?.aborted) return;
      const sub = subreddits[i++];
      const posts = await fetchTopPosts(sub, { limit: postsPerSub, timeframe, signal });
      for (const post of posts) {
        if (post.ups < minUpvotes) continue;

        // Track author (use Reddit URL as source)
        if (post.author && post.author !== '[deleted]' && post.author !== 'AutoModerator') {
          const entry = authorCounts.get(post.author) ?? { posts: 0, karma: 0 };
          entry.posts += 1;
          entry.karma += post.ups;
          authorCounts.set(post.author, entry);
        }

        // Extract handles from post title + body
        const text = `${post.title}\n${post.selftext}\n${post.url}`;
        for (const url of extractUrls(text)) {
          const cand = extractCrossPlatformHandle(
            url,
            post.title.length > 3 ? post.title : '',
          );
          if (!cand) continue;
          const key = `${cand.platform}::${cand.handle.toLowerCase()}`;
          if (seenHandles.has(key)) continue;
          seenHandles.add(key);
          crossPlatformHandles.push({
            ...cand,
            sourceUrl: `https://reddit.com${post.permalink}`,
            sourceTitle: `r/${post.subreddit}: ${post.title}`.slice(0, 200),
          });
        }
      }
    }
  });

  await Promise.all(workers);

  // Rank Reddit authors by total karma × post count
  const redditAuthors = [...authorCounts.entries()]
    .map(([handle, s]) => ({ handle, posts: s.posts, karma: s.karma }))
    .filter(a => a.posts >= 2 && a.karma >= 100)
    .sort((a, b) => b.karma - a.karma)
    .slice(0, 50);

  log.info('reddit: discovery done', {
    subreddits: subreddits.length,
    candidates: crossPlatformHandles.length,
    topAuthors: redditAuthors.length,
  });

  return { crossPlatformHandles, redditAuthors };
}
