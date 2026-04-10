/**
 * Reddit discovery — pulls trading influencer handles out of public subreddit
 * threads. Uses Reddit's free JSON API (no auth required for public listings).
 *
 * Two extraction strategies per subreddit:
 *   1. Post authors themselves — users posting high-engagement content in
 *      trading subreddits are often the creators we want.
 *   2. Cross-platform mentions — post bodies + titles are scanned for
 *      instagram.com / x.com / youtube.com / t.me / linktr.ee / etc. URLs,
 *      yielding handles on the platform those links point to.
 *
 * No API key needed. Reddit's public JSON endpoints are rate-limited to
 * 60 req/min for unauthenticated traffic, which is plenty for this use.
 */

import { log } from '../logger';
import { extractCrossPlatformHandle, type CrossPlatformCandidate } from './google-search';

const USER_AGENT = 'InfluencerDashboard/1.0 (+https://propaccount.com)';

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

// ─── Fetch a subreddit's top posts ──────────────────────────────────

async function fetchTopPosts(subreddit: string, opts: { limit?: number; timeframe?: string; signal?: AbortSignal } = {}): Promise<RedditPostData[]> {
  const { limit = 50, timeframe = 'month', signal } = opts;
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${timeframe}&limit=${Math.min(limit, 100)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    });
    if (!res.ok) {
      log.debug('reddit: fetch non-ok', { subreddit, status: res.status });
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
