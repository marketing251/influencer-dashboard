/**
 * YouTube Data API v3 — scaled for 500+ lead discovery.
 * 60 search queries × 10 results + pagination = 400-600 unique channels.
 * Quota: 10,000 units/day (search=100, channels=1 per batch of 50).
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

// 60 queries across 12 niches — each costs 100 quota units
const QUERIES = [
  // Forex (10)
  'forex trading education', 'forex trading mentor', 'forex trading course 2024',
  'forex signals community', 'forex trader lifestyle', 'forex trading for beginners',
  'forex strategy profitable', 'forex analysis daily', 'forex trading live stream',
  'best forex traders youtube',
  // Prop firms (8)
  'prop firm trading challenge', 'FTMO funded trader', 'prop firm passing strategy',
  'funded trader results payout', 'MyFundedFX trader', 'prop firm review 2024',
  'best prop firm trading', 'funded account trading',
  // Day trading (8)
  'day trading course', 'day trading live stream', 'day trading for beginners',
  'scalping trading strategy', 'day trading education', 'live day trading',
  'day trader morning routine', 'small account day trading',
  // Smart money / ICT (5)
  'smart money concepts ICT', 'ICT trading methodology', 'order block trading',
  'fair value gap trading', 'liquidity sweep trading',
  // Futures (5)
  'futures trading education', 'NQ ES futures trading', 'futures scalping strategy',
  'micro futures trading', 'futures day trading live',
  // Options (5)
  'options trading strategy', 'options trading course', 'options day trading',
  'selling options for income', 'options trading for beginners',
  // Crypto (5)
  'crypto trading education', 'bitcoin trading strategy', 'crypto day trading',
  'altcoin trading strategy', 'crypto technical analysis',
  // Swing / position (4)
  'swing trading strategy', 'swing trading course', 'position trading stocks',
  'swing trading for beginners',
  // General / community (5)
  'trading mentor coaching', 'trading discord community', 'trading course review',
  'best traders to follow 2024', 'trading psychology education',
  // Stocks (5)
  'stock trading education', 'penny stock trading', 'stock market course',
  'growth stock investing', 'stock trading for beginners',
];

async function ytFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key());
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && body.includes('quotaExceeded')) throw new Error('QUOTA_EXCEEDED');
    throw new Error(`YouTube ${endpoint} ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function search(query: string, max: number, pageToken?: string) {
  const p: Record<string, string> = { part: 'snippet', type: 'channel', q: query, maxResults: String(max), relevanceLanguage: 'en', order: 'relevance' };
  if (pageToken) p.pageToken = pageToken;
  const d = await ytFetch<{ items?: YTSearchItem[]; nextPageToken?: string }>('search', p);
  return { ids: [...new Set((d.items ?? []).map(i => i.id.channelId ?? i.snippet.channelId).filter(Boolean))], next: d.nextPageToken ?? null };
}

async function details(ids: string[]): Promise<YouTubeChannel[]> {
  if (!ids.length) return [];
  const d = await ytFetch<{ items?: YTChannelItem[] }>('channels', { part: 'snippet,statistics', id: ids.join(',') });
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

export async function discoverYouTubeCreators(opts?: {
  maxPerQuery?: number; minSubscribers?: number; maxPages?: number;
}): Promise<YouTubeDiscoveryResult[]> {
  const { maxPerQuery = 10, minSubscribers = 500, maxPages = 2 } = opts ?? {};
  const seen = new Set<string>();
  const all: string[] = [];
  let quota = false;

  // Page 1 of all queries
  for (const q of QUERIES) {
    if (quota) break;
    try {
      const { ids } = await search(q, maxPerQuery);
      for (const id of ids) { if (!seen.has(id)) { seen.add(id); all.push(id); } }
    } catch (e) { if (String(e).includes('QUOTA')) { quota = true; break; } }
  }

  // Page 2+ for top queries if we need more and have quota
  if (!quota && maxPages >= 2 && all.length < 400) {
    for (const q of QUERIES.slice(0, 20)) {
      if (quota) break;
      try {
        const p1 = await search(q, maxPerQuery);
        if (p1.next) {
          const p2 = await search(q, maxPerQuery, p1.next);
          for (const id of p2.ids) { if (!seen.has(id)) { seen.add(id); all.push(id); } }
        }
      } catch (e) { if (String(e).includes('QUOTA')) { quota = true; } }
    }
  }

  log.info('youtube: search done', { unique: all.length, queries: QUERIES.length, quota });

  // Batch channel details (50 per call)
  const channels: YouTubeChannel[] = [];
  for (let i = 0; i < all.length; i += 50) {
    try { channels.push(...await details(all.slice(i, i + 50))); }
    catch { /* skip failed batch */ }
  }

  const qualified = channels.filter(c => c.subscriberCount >= minSubscribers);
  log.info('youtube: complete', { fetched: channels.length, qualified: qualified.length });
  return qualified.map(toCreator);
}
