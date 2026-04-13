/**
 * X (Twitter) API v2 integration — PRIMARY discovery source.
 *
 * Tier-adaptive: reads x-rate-limit-remaining from response headers and
 * automatically scales query volume. Works on Basic (10 req/15min), Pro
 * (300 req/15min), or Enterprise without code changes.
 *
 * Discovery flow:
 *   1. Keyword search across 18 trading-niche queries (tier-adaptive)
 *   2. Optional pagination (maxPages) for deeper coverage
 *   3. Network expansion via getLikingUsers (Basic+) and getFollowers (Pro+)
 *
 * Requires X_BEARER_TOKEN environment variable (from X Developer Portal).
 * API docs: https://developer.x.com/en/docs/x-api
 */

import { log } from '../logger';
import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';
import { isHandleKnown, type ExistingIndex } from '../pipeline';

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

export interface XUser {
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

interface XUsersResponse {
  data?: XUser[];
  meta?: { next_token?: string; result_count?: number };
}

// ─── Tiered search queries — creator-intent, weighted by value ──────
//
// Distribution: Tier 1 (40%) → Tier 2 (30%) → Tier 3 (20%) → Tier 4 (10%)
//
// Tier 1: Monetized creators (courses, mentors, communities, signals)
//         These have the highest email yield because they SELL something
//         and need a website with contact info.
// Tier 2: Authority creators (live trading, results, funded journeys)
//         Public proof-of-results attracts followers; these creators
//         often have link-in-bio or personal sites.
// Tier 3: Strategy & education creators (tutorials, how-tos)
//         Educational content creators with courses or Skool/Whop communities.
// Tier 4: Prop-adjacent discovery (review/walkthrough content)
//         Finds individuals discussing prop firms, not the firms themselves.

const TIER_1_MONETIZED = [
  // ── Courses & mentorships ──
  '"trading course" (enroll OR review OR join) -is:retweet lang:en',
  '"forex course" OR "forex mentorship" (learn OR join) -is:retweet lang:en',
  '"crypto course" OR "crypto mentorship" (enroll OR beginner) -is:retweet lang:en',
  '"trading mentor" (coaching OR session OR DM) -is:retweet lang:en',
  '"forex mentor" OR "forex coach" (strategy OR beginner) -is:retweet lang:en',
  '"trading academy" OR "trading bootcamp" (join OR enroll) -is:retweet lang:en',
  '"trading program" (results OR testimonials) -is:retweet lang:en',
  // ── Communities & signals (high-intent: these creators monetize) ──
  '"trading discord" (free OR VIP OR join) -is:retweet lang:en',
  '"forex signals" (proof OR results OR performance) -is:retweet lang:en',
  '"crypto signals" (VIP OR premium OR join) -is:retweet lang:en',
  '"trading community" (discord OR telegram OR members) -is:retweet lang:en',
  '"premium signals" (forex OR crypto OR trading) -is:retweet lang:en',
  // ── Lead magnet creators ──
  '"free trading course" OR "free forex signals" -is:retweet lang:en',
  '"trading giveaway" OR "funded account giveaway" -is:retweet lang:en',
];

const TIER_2_AUTHORITY = [
  // ── Live proof & results ──
  '"live trading" (stream OR session OR room) -is:retweet lang:en',
  '"trading results" (proof OR screenshot OR payout) -is:retweet lang:en',
  '"trade recap" (forex OR futures OR crypto) -is:retweet lang:en',
  '"winning trades" (results OR profit) -is:retweet lang:en',
  '"funded trader journey" (results OR payout OR proof) -is:retweet lang:en',
  '"trading account growth" (proof OR results) -is:retweet lang:en',
  // ── Bio-keyword-rich creators ──
  '"day trader" (lifestyle OR results OR routine) -is:retweet lang:en',
  '"crypto trader" (analysis OR education OR signals) -is:retweet lang:en',
  '"forex trader" (results OR journey OR lifestyle) -is:retweet lang:en',
];

const TIER_3_STRATEGY = [
  // ── Strategy tutorials ──
  '"price action" (tutorial OR strategy OR explained) -is:retweet lang:en',
  '"smart money concepts" (tutorial OR explained OR ICT) -is:retweet lang:en',
  '"scalping strategy" (tutorial OR explained OR forex) -is:retweet lang:en',
  '"day trading strategy" (beginner OR tutorial) -is:retweet lang:en',
  '"trading for beginners" (course OR tutorial OR guide) -is:retweet lang:en',
  '"trading psychology" (mindset OR discipline OR coach) -is:retweet lang:en',
];

const TIER_4_PROP_ADJACENT = [
  // ── People REVIEWING/DISCUSSING prop firms ──
  '"prop firm challenge" (passed OR "how to pass" OR tips) -is:retweet lang:en',
  '"prop firm" (review OR experience OR honest) -is:retweet lang:en',
  '"funded account" (strategy OR journey OR walkthrough) -is:retweet lang:en',
];

// Combined in tier order so the maxQueries cap in discoverXCreators
// naturally gives Tier 1 the most queries and Tier 4 the fewest.
const TRADING_QUERIES = [
  ...TIER_1_MONETIZED,   // 14 queries (40%)
  ...TIER_2_AUTHORITY,   //  9 queries (26%)
  ...TIER_3_STRATEGY,    //  6 queries (17%)
  ...TIER_4_PROP_ADJACENT, // 3 queries (9%)
  // Remaining ~8% is buffer consumed by AI/modern trader queries:
  '"ai trading" OR "trading bot" (results OR review) -is:retweet lang:en',
  '"algorithmic trading" (strategy OR backtest OR results) -is:retweet lang:en',
];

// ─── Rate-limit-aware API helpers ───────────────────────────────────

/** Tracks remaining API calls in the current rate window. */
let rateLimitRemaining = Infinity;

async function xFetch<T>(path: string, params?: Record<string, string>): Promise<T & { _rateLimitRemaining?: number }> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bearerToken()}` },
  });

  // Read rate-limit headers for tier-adaptive throttling
  const remaining = res.headers.get('x-rate-limit-remaining');
  if (remaining !== null) {
    rateLimitRemaining = parseInt(remaining, 10);
  }

  if (res.status === 429) {
    const resetAt = res.headers.get('x-rate-limit-reset');
    const waitSec = resetAt ? Math.max(0, parseInt(resetAt, 10) - Math.floor(Date.now() / 1000)) : 60;
    log.warn('x.rateLimit: hit rate limit', { path, resetInSeconds: waitSec });
    throw new Error(`X API rate limited. Resets in ${waitSec}s`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (body.includes('CreditsDepleted') || body.includes('credits')) {
      throw new Error('X API credits depleted — your plan has no remaining credits this month. Upgrade at developer.x.com');
    }
    throw new Error(`X API ${path} ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as T;
  return { ...json, _rateLimitRemaining: rateLimitRemaining };
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if we have enough rate budget to make another call. */
function hasRateBudget(reserve = 2): boolean {
  return rateLimitRemaining > reserve;
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

// ─── User lookup ────────────────────────────────────────────────────

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

// ─── Network expansion endpoints ────────────────────────────────────

/**
 * Get users who liked a specific tweet. Works on Basic tier.
 * Returns [] on any error (including 403 for tier-restricted endpoints).
 */
export async function getLikingUsers(tweetId: string, maxResults = 100): Promise<XUser[]> {
  try {
    const data = await xFetch<XUsersResponse>(`/tweets/${tweetId}/liking_users`, {
      max_results: String(Math.min(maxResults, 100)),
      'user.fields': 'description,public_metrics,verified,url,profile_image_url,entities',
    });
    return data.data ?? [];
  } catch (err) {
    log.debug('x.getLikingUsers: failed', { tweetId, error: String(err) });
    return [];
  }
}

/**
 * Get followers of a user. Requires Pro+ tier — returns [] on 403.
 */
export async function getFollowers(userId: string, maxResults = 100): Promise<XUser[]> {
  try {
    const data = await xFetch<XUsersResponse>(`/users/${userId}/followers`, {
      max_results: String(Math.min(maxResults, 1000)),
      'user.fields': 'description,public_metrics,verified,url,profile_image_url,entities',
    });
    return data.data ?? [];
  } catch (err) {
    const msg = String(err);
    if (msg.includes('403') || msg.includes('Forbidden')) {
      log.info('x.getFollowers: endpoint requires higher tier (Pro+)', { userId });
    } else {
      log.debug('x.getFollowers: failed', { userId, error: msg });
    }
    return [];
  }
}

/**
 * Get accounts a user follows. Requires Pro+ tier — returns [] on 403.
 */
export async function getFollowing(userId: string, maxResults = 100): Promise<XUser[]> {
  try {
    const data = await xFetch<XUsersResponse>(`/users/${userId}/following`, {
      max_results: String(Math.min(maxResults, 1000)),
      'user.fields': 'description,public_metrics,verified,url,profile_image_url,entities',
    });
    return data.data ?? [];
  } catch (err) {
    const msg = String(err);
    if (msg.includes('403') || msg.includes('Forbidden')) {
      log.info('x.getFollowing: endpoint requires higher tier (Pro+)');
    } else {
      log.debug('x.getFollowing: failed', { userId, error: msg });
    }
    return [];
  }
}

// ─── Normalization ──────────────────────────────────────────────────

export function resolveUserWebsite(user: XUser): string | null {
  const expanded = user.entities?.url?.urls?.[0]?.expanded_url;
  if (expanded && !/twitter\.com|x\.com/i.test(expanded)) return expanded;
  if (user.url && !/twitter\.com|x\.com/i.test(user.url)) return user.url;
  return null;
}

export function toDiscoveredCreator(user: XUser): DiscoveredCreator {
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

// ─── Primary discovery pipeline ─────────────────────────────────────

export interface XDiscoveryResult {
  creator: DiscoveredCreator;
  posts: DiscoveredPost[];
}

export interface XDiscoverOpts {
  maxPerQuery?: number;
  minFollowers?: number;
  delayMs?: number;
  /** Pagination depth per query. Default 1. Pro+ tiers can use 2-3. */
  maxPages?: number;
  /** Override query list. */
  queries?: string[];
  /** Abort signal for time-budget enforcement. */
  signal?: AbortSignal;
  /** Pre-loaded exclusion index — skip users already in DB during discovery. */
  existingIndex?: ExistingIndex;
}

/**
 * Run a full X discovery sweep. Tier-adaptive: reads x-rate-limit-remaining
 * after each call and stops early when the rate budget is nearly exhausted.
 */
export async function discoverXCreators(opts?: XDiscoverOpts): Promise<XDiscoveryResult[]> {
  const {
    maxPerQuery = 100,
    minFollowers = 500,
    delayMs = 1_500,
    maxPages = 1,
    queries,
    signal,
    existingIndex,
  } = opts ?? {};

  // Reset the module-level rate counter at the start of each sweep
  rateLimitRemaining = Infinity;

  const queryList = queries ?? TRADING_QUERIES;
  const userMap = new Map<string, XUser>();
  const tweetsByAuthor = new Map<string, XTweet[]>();

  // Phase 1: Search tweets — tier-adaptive, stops when rate budget low
  for (let i = 0; i < queryList.length; i++) {
    if (signal?.aborted) break;
    if (!hasRateBudget(3)) {
      log.info('x.discover: stopping queries early — rate budget low', { remaining: rateLimitRemaining, queriesDone: i });
      break;
    }

    const query = queryList[i];
    try {
      const result = await searchRecentTweets(query, maxPerQuery);
      indexResults(result, userMap, tweetsByAuthor);
      log.debug('x.discover: query done', { query: query.slice(0, 50), tweets: result.tweets.length, users: result.users.length, rateRemaining: rateLimitRemaining });

      // Pagination: fetch page 2+ if rate budget allows
      let nextToken = result.nextToken;
      for (let page = 1; page < maxPages && nextToken && hasRateBudget(3) && !signal?.aborted; page++) {
        await delay(delayMs);
        const pageResult = await searchRecentTweets(query, maxPerQuery, nextToken);
        indexResults(pageResult, userMap, tweetsByAuthor);
        nextToken = pageResult.nextToken;
      }

      if (i < queryList.length - 1) await delay(delayMs);
    } catch (err) {
      log.warn('x.discover: query failed', { query: query.slice(0, 50), error: String(err) });
      if (String(err).includes('rate limited')) {
        log.warn('x.discover: stopping early due to rate limit');
        break;
      }
    }
  }

  log.info('x.discover: search phase done', {
    uniqueUsers: userMap.size,
    totalTweets: [...tweetsByAuthor.values()].reduce((s, t) => s + t.length, 0),
    rateRemaining: rateLimitRemaining,
  });

  // Phase 2: Filter, exclude known, and normalize
  const results: XDiscoveryResult[] = [];
  let skippedKnown = 0;

  for (const [userId, user] of userMap) {
    const followers = user.public_metrics?.followers_count ?? 0;
    if (followers < minFollowers) continue;

    // Pre-discovery exclusion: skip accounts already in the DB
    if (existingIndex && isHandleKnown('x', user.id, user.username, existingIndex)) {
      skippedKnown++;
      continue;
    }

    const creator = toDiscoveredCreator(user);
    const tweets = tweetsByAuthor.get(userId) ?? [];
    const uniqueTweets = [...new Map(tweets.map(t => [t.id, t])).values()]
      .sort((a, b) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0))
      .slice(0, 10);

    const posts = uniqueTweets.map(toDiscoveredPost);
    results.push({ creator, posts });
  }

  results.sort((a, b) => b.creator.account.followers - a.creator.account.followers);
  log.info('x.discover: complete', { creators: results.length, skippedKnown });
  return results;
}

function indexResults(
  result: SearchResult,
  userMap: Map<string, XUser>,
  tweetsByAuthor: Map<string, XTweet[]>,
) {
  for (const user of result.users) {
    if (!userMap.has(user.id)) userMap.set(user.id, user);
  }
  for (const tweet of result.tweets) {
    const existing = tweetsByAuthor.get(tweet.author_id) ?? [];
    existing.push(tweet);
    tweetsByAuthor.set(tweet.author_id, existing);
  }
}

// ─── Network expansion ──────────────────────────────────────────────

export interface XExpansionOpts {
  seedResults: XDiscoveryResult[];
  /** How many top-follower seeds to expand. Default 10. */
  maxSeedAccounts?: number;
  /** Only expand seeds with at least this many followers. Default 5000. */
  minSeedFollowers?: number;
  delayMs?: number;
  signal?: AbortSignal;
  /** Pre-loaded exclusion index — skip users already in DB. */
  existingIndex?: ExistingIndex;
}

/**
 * Expand from seed accounts by fetching likers of their top tweet (Basic+)
 * and followers (Pro+ — gracefully returns [] on 403).
 *
 * This is the "multi-step lead expansion" the spec calls for: start from
 * a strong seed account and discover people in their network.
 */
export async function discoverXExpansion(opts: XExpansionOpts): Promise<XDiscoveryResult[]> {
  const {
    seedResults,
    maxSeedAccounts = 10,
    minSeedFollowers = 5_000,
    delayMs = 1_500,
    signal,
  } = opts;

  const seedUserIds = new Set(seedResults.map(r => r.creator.account.platform_id));

  // Pick top seeds by followers
  const seeds = seedResults
    .filter(r => r.creator.account.followers >= minSeedFollowers)
    .sort((a, b) => b.creator.account.followers - a.creator.account.followers)
    .slice(0, maxSeedAccounts);

  if (seeds.length === 0) {
    log.info('x.expansion: no seeds meet threshold', { minSeedFollowers });
    return [];
  }

  const discoveredUsers = new Map<string, XUser>();

  for (const seed of seeds) {
    if (signal?.aborted || !hasRateBudget(2)) break;

    // Strategy 1: get likers of the seed's top tweet (works on Basic)
    const topTweet = seed.posts[0];
    if (topTweet) {
      const tweetId = topTweet.post_url.split('/').pop();
      if (tweetId) {
        try {
          const likers = await getLikingUsers(tweetId);
          for (const u of likers) {
            if (!seedUserIds.has(u.id) && !discoveredUsers.has(u.id)) {
              discoveredUsers.set(u.id, u);
            }
          }
          log.debug('x.expansion: likers done', { seed: seed.creator.name, likers: likers.length });
          await delay(delayMs);
        } catch { /* swallow — getLikingUsers already handles errors */ }
      }
    }

    // Strategy 2: get followers of the seed (Pro+ only, 403 on Basic)
    if (hasRateBudget(2) && !signal?.aborted) {
      try {
        const followers = await getFollowers(seed.creator.account.platform_id);
        for (const u of followers) {
          if (!seedUserIds.has(u.id) && !discoveredUsers.has(u.id)) {
            discoveredUsers.set(u.id, u);
          }
        }
        if (followers.length > 0) {
          log.debug('x.expansion: followers done', { seed: seed.creator.name, followers: followers.length });
          await delay(delayMs);
        }
      } catch { /* swallow */ }
    }
  }

  // Convert to XDiscoveryResult — filter by followers AND exclusion index
  const { existingIndex } = opts;
  const results: XDiscoveryResult[] = [];
  for (const user of discoveredUsers.values()) {
    const followers = user.public_metrics?.followers_count ?? 0;
    if (followers < 500) continue;
    if (existingIndex && isHandleKnown('x', user.id, user.username, existingIndex)) continue;
    results.push({ creator: toDiscoveredCreator(user), posts: [] });
  }

  results.sort((a, b) => b.creator.account.followers - a.creator.account.followers);
  log.info('x.expansion: complete', { seeds: seeds.length, expanded: results.length, rateRemaining: rateLimitRemaining });
  return results;
}
