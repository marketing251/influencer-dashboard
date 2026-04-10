/**
 * YouTube Data API v3 — scaled for 500+ lead discovery on Vercel Pro.
 *
 * Keyword groups allow the refresh pipeline to cycle through distinct niches.
 * Each search costs 100 quota units; channels batch lookups cost 1 per 50.
 * Daily quota is 10,000 units.
 *
 * With all groups enabled (~45 queries) a single refresh spends ~4,500 units,
 * which still leaves headroom for the scheduled daily-refresh cron.
 */

import { log } from '../logger';
import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';

const BASE = 'https://www.googleapis.com/youtube/v3';
function key() { const k = process.env.YOUTUBE_API_KEY; if (!k) throw new Error('YOUTUBE_API_KEY not set'); return k; }

interface YTSearchItem { id: { channelId?: string }; snippet: { channelId: string } }
interface YTChannelItem {
  id: string;
  snippet: { title: string; description: string; customUrl?: string };
  statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string };
}

export interface YouTubeChannel {
  id: string; title: string; description: string; customUrl: string;
  subscriberCount: number; videoCount: number;
}

export interface YouTubeDiscoveryResult { creator: DiscoveredCreator; posts: DiscoveredPost[] }

// ─── Keyword groups (each refresh can select a subset) ──────────────

export const YOUTUBE_KEYWORD_GROUPS = {
  forex: [
    'forex trading education course',
    'forex signals mentor community',
    'forex trader journey funded',
    'price action forex trader',
    'swing trading forex strategy',
    'forex scalper live trading',
    'forex trader lifestyle',
  ],
  prop_firm: [
    'prop firm funded trader FTMO challenge',
    'prop firm passing strategy funded',
    'funded trader results payout proof',
    'prop firm review funded account',
    'funded trader journey FTMO payout',
    'prop firm challenge strategy',
    'funded account live trading',
  ],
  day_trading: [
    'day trading live stream education',
    'day trading strategy beginner',
    'day trading psychology mindset',
    'scalping strategy day trader',
    'day trader morning routine',
    'day trading live session',
  ],
  smart_money: [
    'smart money ICT order block trading',
    'inner circle trader ICT concepts',
    'liquidity sweep order flow trading',
    'market structure smart money',
    'ICT mentorship silver bullet',
  ],
  futures: [
    'futures trading NQ ES scalping',
    'micro futures day trader education',
    'futures trader prop firm topstep',
    'emini futures trader live',
  ],
  options: [
    'options trading strategy course',
    'options trader coach mentor',
    'options iron condor spreads education',
    'options wheel strategy',
    'zero dte options trader',
    'options flow unusual trader',
  ],
  crypto: [
    'crypto bitcoin trading education',
    'crypto altcoin swing trading',
    'crypto mentor signals community',
    'crypto leverage perpetual trader',
    'crypto futures trading strategy',
    'bitcoin ethereum trader analysis',
  ],
  stocks: [
    'penny stock day trading education',
    'swing trading stocks strategy',
    'stock market trader mentor',
    'small cap momentum trader',
    'stock picking trader strategy',
  ],
  mentor: [
    'trading mentor coaching discord',
    'trading academy course mentorship',
    'best traders to follow 2025',
    'trading bootcamp online education',
    'trading community signals coach',
    'trading lifestyle entrepreneur',
  ],
  // ── new groups (source diversification) ──
  algo: [
    'algo trading strategy python',
    'algorithmic trader backtesting',
    'trading bot automated strategy',
    'quant trader strategy',
  ],
  technical_analysis: [
    'technical analysis trader chart patterns',
    'fibonacci trader strategy',
    'elliott wave trader analysis',
    'chart patterns trader tutorial',
  ],
  indicators: [
    'RSI indicator trading strategy',
    'MACD trader strategy',
    'moving average trader strategy',
    'volume profile trader strategy',
  ],
  risk_management: [
    'trading risk management psychology',
    'trader journal discipline strategy',
    'position sizing trader strategy',
  ],
  beginner: [
    'beginner trader tutorial guide',
    'learn trading from scratch',
    'trading for beginners course',
  ],
  podcast: [
    'trading podcast interview mentor',
    'trader interview success story',
    'chat with traders podcast',
  ],
  live_stream: [
    'live trading stream day trader',
    'trading room live call',
    'market open live trading',
  ],
  news_analysis: [
    'market analysis daily trader',
    'trading weekly outlook forex',
    'economic calendar trader news',
  ],
} as const;

export type YouTubeKeywordGroup = keyof typeof YOUTUBE_KEYWORD_GROUPS;

export const ALL_YOUTUBE_GROUPS: YouTubeKeywordGroup[] = Object.keys(YOUTUBE_KEYWORD_GROUPS) as YouTubeKeywordGroup[];

function buildQueries(groups: readonly YouTubeKeywordGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) out.push(...YOUTUBE_KEYWORD_GROUPS[g]);
  return [...new Set(out)];
}

async function ytFetch<T>(endpoint: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key());
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && body.includes('quotaExceeded')) throw new Error('QUOTA_EXCEEDED');
    throw new Error(`YouTube ${endpoint} ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function search(query: string, max: number, pageToken?: string, signal?: AbortSignal) {
  const p: Record<string, string> = { part: 'snippet', type: 'channel', q: query, maxResults: String(max), relevanceLanguage: 'en', order: 'relevance' };
  if (pageToken) p.pageToken = pageToken;
  const d = await ytFetch<{ items?: YTSearchItem[]; nextPageToken?: string }>('search', p, signal);
  return { ids: [...new Set((d.items ?? []).map(i => i.id.channelId ?? i.snippet.channelId).filter(Boolean))], next: d.nextPageToken ?? null };
}

async function details(ids: string[], signal?: AbortSignal): Promise<YouTubeChannel[]> {
  if (!ids.length) return [];
  const d = await ytFetch<{ items?: YTChannelItem[] }>('channels', { part: 'snippet,statistics', id: ids.join(',') }, signal);
  return (d.items ?? []).map(c => ({
    id: c.id, title: c.snippet.title, description: c.snippet.description ?? '',
    customUrl: c.snippet.customUrl ?? '',
    subscriberCount: parseInt(c.statistics.subscriberCount ?? '0', 10),
    videoCount: parseInt(c.statistics.videoCount ?? '0', 10),
  }));
}

function toCreator(ch: YouTubeChannel): YouTubeDiscoveryResult {
  const urls = ch.description.match(/https?:\/\/[^\s)>"]+/g);
  const website = urls?.find(u => !/youtube|youtu\.be|twitter|x\.com|instagram|tiktok|discord|t\.me/i.test(u)) ?? null;
  return {
    creator: {
      name: ch.title,
      slug: ch.customUrl?.replace(/^@/, '') || ch.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      website, bio: ch.description.slice(0, 1000),
      source_type: 'youtube_api',
      source_url: ch.customUrl ? `https://youtube.com/${ch.customUrl}` : `https://youtube.com/channel/${ch.id}`,
      account: {
        platform: 'youtube', handle: ch.customUrl || ch.title,
        profile_url: ch.customUrl ? `https://youtube.com/${ch.customUrl}` : `https://youtube.com/channel/${ch.id}`,
        followers: ch.subscriberCount, platform_id: ch.id,
        bio: ch.description.slice(0, 500), verified: ch.subscriberCount >= 100_000,
      },
    },
    posts: [],
  };
}

/** Run N async tasks with a concurrency limit. */
async function pLimitAll<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        // caller handles errors per-item
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export interface DiscoverYouTubeOpts {
  /** Keyword groups to include. Defaults to all groups. */
  groups?: readonly YouTubeKeywordGroup[];
  /** Custom query list (overrides groups). */
  queries?: string[];
  /** Max search results per query (default 10, max 50). */
  maxPerQuery?: number;
  /** Drop channels below this subscriber count. */
  minSubscribers?: number;
  /** Fetch a second search page for each query once first pass is done. */
  secondPage?: boolean;
  /** Abort signal — propagates to all in-flight fetches. */
  signal?: AbortSignal;
  /** Parallel search fan-out (default 6). YouTube accepts bursty traffic fine. */
  concurrency?: number;
  /**
   * Hard cap on the number of search queries. Each search costs 100 quota
   * units; free tier is 10 000/day. Default 35 keeps the whole call under
   * 3 600 units so we can afford multiple refreshes per day.
   */
  maxQueries?: number;
}

export async function discoverYouTubeCreators(opts?: DiscoverYouTubeOpts): Promise<YouTubeDiscoveryResult[]> {
  const {
    groups = ALL_YOUTUBE_GROUPS,
    queries,
    maxPerQuery = 10,
    minSubscribers = 500,
    secondPage = false,
    signal,
    concurrency = 6,
    maxQueries = 35,
  } = opts ?? {};

  const fullQueryList = queries ?? buildQueries(groups);
  const queryList = fullQueryList.slice(0, Math.max(1, maxQueries));
  const seen = new Set<string>();
  let quota = false;

  // Phase 1: parallel first pages
  const firstPage = await pLimitAll(queryList, concurrency, async q => {
    if (quota || signal?.aborted) return { ids: [] as string[], next: null as string | null };
    try {
      return await search(q, maxPerQuery, undefined, signal);
    } catch (e) {
      if (String(e).includes('QUOTA')) quota = true;
      return { ids: [], next: null };
    }
  });

  for (const r of firstPage) for (const id of r.ids) seen.add(id);

  // Phase 2: optional second page using the next-tokens we already have from
  // phase 1 (fixes a bug where this previously re-fetched page 1 every time).
  if (!quota && secondPage && seen.size < 500) {
    const phase2Work = queryList
      .map((q, i) => ({ q, next: firstPage[i]?.next ?? null }))
      .filter(x => x.next !== null)
      .slice(0, Math.min(20, queryList.length));
    await pLimitAll(phase2Work, concurrency, async ({ q, next }) => {
      if (quota || signal?.aborted || !next) return;
      try {
        const p2 = await search(q, maxPerQuery, next, signal);
        for (const id of p2.ids) seen.add(id);
      } catch (e) {
        if (String(e).includes('QUOTA')) quota = true;
      }
    });
  }

  const allIds = [...seen];
  log.info('youtube: search done', { unique: allIds.length, queries: queryList.length, quota });

  // Phase 3: batch channel lookups (50/call) in parallel
  const idBatches: string[][] = [];
  for (let i = 0; i < allIds.length; i += 50) idBatches.push(allIds.slice(i, i + 50));

  const channelBatches = await pLimitAll(idBatches, 4, async batch => {
    if (signal?.aborted) return [] as YouTubeChannel[];
    try { return await details(batch, signal); }
    catch { return [] as YouTubeChannel[]; }
  });

  const channels = channelBatches.flat();
  const qualified = channels.filter(c => c.subscriberCount >= minSubscribers);
  log.info('youtube: complete', { fetched: channels.length, qualified: qualified.length });

  return qualified.map(toCreator);
}
