/**
 * X (Twitter) API v2 integration.
 * Uses the official API to discover trading creators via recent tweet search.
 * Requires X_BEARER_TOKEN environment variable (from X Developer Portal).
 *
 * API docs: https://developer.x.com/en/docs/x-api
 * Rate limits (Basic): 10 requests/15min for tweet search, 100 requests/15min for user lookup.
 */

import { log } from '../logger';
import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';

const BASE_URL = 'https://api.twitter.com/2';

function bearerToken() {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error('X_BEARER_TOKEN is not set');
  return token;
}

// ─── Raw API response shapes ────────────────────────────────────────

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count?: number;
  };
}

interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  verified?: boolean;
  url?: string;
  profile_image_url?: string;
  entities?: {
    url?: { urls?: { expanded_url?: string }[] };
    description?: { urls?: { expanded_url?: string }[] };
  };
}

interface XSearchResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
  meta?: { next_token?: string; result_count?: number };
}

// ─── Search queries (each costs 1 request / 15min window) ───────────

const TRADING_QUERIES = [
  '"prop firm" (funded OR challenge OR payout) -is:retweet lang:en',
  '"FTMO" (passed OR challenge OR funded) -is:retweet lang:en',
  '"funded trader" (results OR profit OR account) -is:retweet lang:en',
  '"trading course" (forex OR futures OR options) -is:retweet lang:en',
  '"smart money" (ICT OR order block OR fair value gap) -is:retweet lang:en',
  '"day trading" (live OR education OR mentor) -is:retweet lang:en',
  '(MyFundedFX OR FundedNext OR The5ers) (passed OR payout) -is:retweet lang:en',
];

// ─── Core API helpers ───────────────────────────────────────────────

async function xFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bearerToken()}` },
  });

  // Handle rate limiting
  if (res.status === 429) {
    const resetAt = res.headers.get('x-rate-limit-reset');
    const waitSec = resetAt ? Math.max(0, parseInt(resetAt, 10) - Math.floor(Date.now() / 1000)) : 60;
    log.warn('x.rateLimit: hit rate limit', { path, resetInSeconds: waitSec });
    throw new Error(`X API rate limited. Resets in ${waitSec}s`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`X API ${path} ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Wait between API calls to stay within rate limits.
 * Basic tier: 10 tweet searches per 15 min = ~90 sec between calls.
 * We use a conservative 2-second delay to allow burst within a run.
 */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tweet search ───────────────────────────────────────────────────

interface SearchResult {
  tweets: XTweet[];
  users: XUser[];
  nextToken?: string;
}

async function searchRecentTweets(query: string, maxResults = 10, nextToken?: string): Promise<SearchResult> {
  const params: Record<string, string> = {
    query,
    max_results: String(Math.min(maxResults, 100)),
    'tweet.fields': 'author_id,created_at,public_metrics',
    expansions: 'author_id',
    'user.fields': 'description,public_metrics,verified,url,profile_image_url,entities',
  };
  if (nextToken) params.next_token = nextToken;

  const data = await xFetch<XSearchResponse>('/tweets/search/recent', params);

  return {
    tweets: data.data ?? [],
    users: data.includes?.users ?? [],
    nextToken: data.meta?.next_token,
  };
}

/**
 * Look up a specific X user by username.
 */
export async function getXUser(username: string): Promise<XUser | null> {
  try {
    const data = await xFetch<{ data?: XUser }>(`/users/by/username/${username}`, {
      'user.fields': 'description,public_metrics,verified,url,profile_image_url,entities',
    });
    return data.data ?? null;
  } catch {
    return null;
  }
}

// ─── Normalization ──────────────────────────────────────────────────

function resolveUserWebsite(user: XUser): string | null {
  // The user.url field is a t.co short link. The expanded URL is in entities.
  const expanded = user.entities?.url?.urls?.[0]?.expanded_url;
  if (expanded && !/twitter\.com|x\.com/i.test(expanded)) return expanded;
  if (user.url && !/twitter\.com|x\.com/i.test(user.url)) return user.url;
  return null;
}

function toDiscoveredCreator(user: XUser): DiscoveredCreator {
  return {
    name: user.name,
    slug: user.username.toLowerCase(),
    website: resolveUserWebsite(user),
    bio: user.description?.slice(0, 1000) ?? null,
    source_type: 'x_api',
    source_url: `https://x.com/${user.username}`,
    account: {
      platform: 'x',
      handle: user.username,
      profile_url: `https://x.com/${user.username}`,
      followers: user.public_metrics?.followers_count ?? 0,
      platform_id: user.id,
      bio: user.description?.slice(0, 500) ?? '',
      verified: user.verified ?? false,
    },
  };
}

function toDiscoveredPost(tweet: XTweet): DiscoveredPost {
  return {
    platform: 'x',
    post_url: `https://x.com/i/status/${tweet.id}`,
    title: null,
    content_snippet: tweet.text.slice(0, 500),
    views: tweet.public_metrics?.impression_count ?? 0,
    likes: tweet.public_metrics?.like_count ?? 0,
    comments: tweet.public_metrics?.reply_count ?? 0,
    published_at: tweet.created_at ?? null,
  };
}

// ─── Discovery pipeline ─────────────────────────────────────────────

export interface XDiscoveryResult {
  creator: DiscoveredCreator;
  posts: DiscoveredPost[];
}

/**
 * Run a full X discovery sweep.
 *
 * Strategy:
 * 1. Search recent tweets across trading-specific queries
 * 2. Collect unique users from tweet author expansions
 * 3. Filter by minimum followers
 * 4. Group tweets by author so each creator gets their relevant posts
 * 5. Return normalized creator + post objects
 */
export async function discoverXCreators(opts?: {
  maxPerQuery?: number;
  minFollowers?: number;
  delayMs?: number;
}): Promise<XDiscoveryResult[]> {
  const {
    maxPerQuery = 20,
    minFollowers = 1_000,
    delayMs = 2_000,
  } = opts ?? {};

  const userMap = new Map<string, XUser>();             // userId -> user
  const tweetsByAuthor = new Map<string, XTweet[]>();   // userId -> tweets

  // Phase 1: Search tweets across all queries
  for (let i = 0; i < TRADING_QUERIES.length; i++) {
    const query = TRADING_QUERIES[i];
    try {
      const { tweets, users } = await searchRecentTweets(query, maxPerQuery);

      // Index users
      for (const user of users) {
        if (!userMap.has(user.id)) userMap.set(user.id, user);
      }

      // Group tweets by author
      for (const tweet of tweets) {
        const existing = tweetsByAuthor.get(tweet.author_id) ?? [];
        existing.push(tweet);
        tweetsByAuthor.set(tweet.author_id, existing);
      }

      log.debug('x.discover: query done', { query: query.slice(0, 50), tweets: tweets.length, users: users.length });

      // Rate limit delay between queries (skip after last query)
      if (i < TRADING_QUERIES.length - 1) await delay(delayMs);
    } catch (err) {
      log.warn('x.discover: query failed', { query: query.slice(0, 50), error: String(err) });
      // On rate limit, stop searching — we've hit the ceiling
      if (String(err).includes('rate limited')) {
        log.warn('x.discover: stopping early due to rate limit');
        break;
      }
    }
  }

  log.info('x.discover: search phase done', { uniqueUsers: userMap.size, totalTweets: [...tweetsByAuthor.values()].reduce((s, t) => s + t.length, 0) });

  // Phase 2: Filter and normalize
  const results: XDiscoveryResult[] = [];

  for (const [userId, user] of userMap) {
    const followers = user.public_metrics?.followers_count ?? 0;
    if (followers < minFollowers) continue;

    const creator = toDiscoveredCreator(user);
    const tweets = tweetsByAuthor.get(userId) ?? [];

    // Deduplicate tweets by ID and take top 10 by engagement
    const uniqueTweets = [...new Map(tweets.map(t => [t.id, t])).values()]
      .sort((a, b) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0))
      .slice(0, 10);

    const posts = uniqueTweets.map(toDiscoveredPost);
    results.push({ creator, posts });
  }

  // Sort by followers descending
  results.sort((a, b) => b.creator.account.followers - a.creator.account.followers);

  log.info('x.discover: complete', { creators: results.length });
  return results;
}
