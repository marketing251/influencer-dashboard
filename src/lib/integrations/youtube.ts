/**
 * YouTube Data API v3 integration.
 * Searches for trading/finance creators and fetches channel details.
 * Quota: 10,000 units/day (search = 100 units, channels = 1 unit).
 */

import { log } from '../logger';
import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

function apiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  return key;
}

interface YTSearchItem { id: { channelId?: string }; snippet: { channelId: string } }
interface YTChannelItem {
  id: string;
  snippet: { title: string; description: string; customUrl?: string; thumbnails?: { default?: { url: string } } };
  statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string };
  brandingSettings?: { channel?: { keywords?: string } };
}

export interface YouTubeChannel {
  id: string; title: string; description: string; customUrl: string;
  subscriberCount: number; videoCount: number; viewCount: number; keywords: string;
}

export interface YouTubeDiscoveryResult { creator: DiscoveredCreator; posts: DiscoveredPost[] }

// 30 search queries covering diverse trading niches
const TRADING_QUERIES = [
  // Forex
  'forex trading education', 'forex trading mentor', 'forex trading course',
  'forex signals community', 'forex trader lifestyle',
  // Prop firms
  'prop firm trading challenge', 'FTMO funded trader', 'prop firm passing strategy',
  'funded trader results payout', 'MyFundedFX trader',
  // Day trading
  'day trading course', 'day trading live stream', 'day trading for beginners',
  'scalping trading strategy',
  // Smart money / ICT
  'smart money concepts ICT', 'ICT trading methodology', 'order block trading',
  // Futures
  'futures trading education', 'NQ ES futures trading', 'futures scalping',
  // Options
  'options trading strategy', 'options trading course', 'options day trading',
  // Crypto
  'crypto trading education', 'bitcoin trading strategy',
  // General
  'trading mentor coaching', 'trading discord community', 'trading course review',
  'best traders to follow', 'trading psychology education',
];

async function ytFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey());
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && body.includes('quotaExceeded'))
      throw new Error('YouTube API daily quota exceeded');
    throw new Error(`YouTube API ${endpoint} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function searchChannels(query: string, maxResults: number) {
  const data = await ytFetch<{ items?: YTSearchItem[]; nextPageToken?: string }>('search', {
    part: 'snippet', type: 'channel', q: query,
    maxResults: String(maxResults), relevanceLanguage: 'en', order: 'relevance',
  });
  return [...new Set((data.items ?? []).map(i => i.id.channelId ?? i.snippet.channelId).filter(Boolean))];
}

async function getChannelDetails(ids: string[]): Promise<YouTubeChannel[]> {
  if (!ids.length) return [];
  const data = await ytFetch<{ items?: YTChannelItem[] }>('channels', {
    part: 'snippet,statistics,brandingSettings', id: ids.join(','),
  });
  return (data.items ?? []).map(ch => ({
    id: ch.id, title: ch.snippet.title, description: ch.snippet.description ?? '',
    customUrl: ch.snippet.customUrl ?? '',
    subscriberCount: parseInt(ch.statistics.subscriberCount ?? '0', 10),
    videoCount: parseInt(ch.statistics.videoCount ?? '0', 10),
    viewCount: parseInt(ch.statistics.viewCount ?? '0', 10),
    keywords: ch.brandingSettings?.channel?.keywords ?? '',
  }));
}

function toDiscoveredCreator(ch: YouTubeChannel): YouTubeDiscoveryResult {
  const urlMatch = ch.description.match(/https?:\/\/[^\s)>"]+/g);
  const website = urlMatch?.find(u =>
    !/youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|tiktok\.com|discord\.|t\.me/i.test(u),
  ) ?? null;

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
  maxPerQuery?: number; minSubscribers?: number;
}): Promise<YouTubeDiscoveryResult[]> {
  const { maxPerQuery = 10, minSubscribers = 500 } = opts ?? {};

  const seenIds = new Set<string>();
  const allChannelIds: string[] = [];

  for (const query of TRADING_QUERIES) {
    try {
      const ids = await searchChannels(query, maxPerQuery);
      for (const id of ids) {
        if (!seenIds.has(id)) { seenIds.add(id); allChannelIds.push(id); }
      }
      log.debug('youtube: query done', { query: query.slice(0, 30), found: ids.length, total: allChannelIds.length });
    } catch (err) {
      if (String(err).includes('quota')) { log.warn('youtube: quota exceeded, stopping'); break; }
      log.warn('youtube: query failed', { query: query.slice(0, 30), error: String(err) });
    }
  }

  log.info('youtube: search done', { uniqueChannels: allChannelIds.length });
  if (!allChannelIds.length) return [];

  const channels: YouTubeChannel[] = [];
  for (let i = 0; i < allChannelIds.length; i += 50) {
    try {
      const batch = await getChannelDetails(allChannelIds.slice(i, i + 50));
      channels.push(...batch);
    } catch (err) { log.warn('youtube: detail batch failed', { error: String(err) }); }
  }

  const qualified = channels.filter(ch => ch.subscriberCount >= minSubscribers);
  log.info('youtube: complete', { total: channels.length, qualified: qualified.length });

  return qualified.map(toDiscoveredCreator);
}
