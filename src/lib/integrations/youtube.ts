/**
 * YouTube Data API v3 integration.
 * Uses the official API to search for trading/finance creators and fetch recent videos.
 * Requires YOUTUBE_API_KEY environment variable.
 *
 * API docs: https://developers.google.com/youtube/v3/docs
 * Quota: 10,000 units/day by default (search = 100 units, channels = 1 unit, videos = 1 unit).
 */

import { log } from '../logger';
import { extractPropFirmNames } from '../prop-firms';
import type { DiscoveredCreator, DiscoveredPost } from '../pipeline';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

function apiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  return key;
}

// ─── Raw API response shapes ────────────────────────────────────────

interface YTSearchItem {
  id: { channelId?: string; videoId?: string };
  snippet: { channelId: string; title: string; description: string };
}

interface YTChannelItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    thumbnails?: { default?: { url: string } };
  };
  statistics: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
  };
  brandingSettings?: {
    channel?: { keywords?: string };
  };
}

interface YTVideoItem {
  id: string;
  snippet: {
    channelId: string;
    title: string;
    description: string;
    publishedAt: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

// ─── Parsed shapes ──────────────────────────────────────────────────

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  customUrl: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  keywords: string;
}

export interface YouTubeVideo {
  id: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
}

// ─── Search queries (each costs 100 quota units) ────────────────────

const TRADING_QUERIES = [
  'forex trading education',
  'prop firm trading challenge',
  'FTMO funded trader',
  'day trading course',
  'funded trader results',
  'smart money concepts ICT',
  'futures trading education',
  'options trading strategy',
  'forex signals mentor',
  'prop firm passing strategy',
];

// ─── Core API helpers ───────────────────────────────────────────────

async function ytFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey());

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${endpoint} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Search for channels by keyword. Returns channel IDs for detail lookup.
 * Costs 100 quota units per call.
 */
async function searchChannels(query: string, maxResults: number, pageToken?: string) {
  const params: Record<string, string> = {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: String(maxResults),
    relevanceLanguage: 'en',
    order: 'relevance',
  };
  if (pageToken) params.pageToken = pageToken;

  const data = await ytFetch<{ items?: YTSearchItem[]; nextPageToken?: string }>('search', params);
  const channelIds = [...new Set(
    (data.items ?? []).map(i => i.id.channelId ?? i.snippet.channelId).filter(Boolean),
  )];
  return { channelIds, nextPageToken: data.nextPageToken };
}

/**
 * Fetch full channel details by IDs.
 * Costs 1 quota unit per call (batch up to 50).
 */
async function getChannelDetails(ids: string[]): Promise<YouTubeChannel[]> {
  if (!ids.length) return [];

  const data = await ytFetch<{ items?: YTChannelItem[] }>('channels', {
    part: 'snippet,statistics,brandingSettings',
    id: ids.join(','),
  });

  return (data.items ?? []).map(ch => ({
    id: ch.id,
    title: ch.snippet.title,
    description: ch.snippet.description ?? '',
    customUrl: ch.snippet.customUrl ?? '',
    subscriberCount: parseInt(ch.statistics.subscriberCount ?? '0', 10),
    videoCount: parseInt(ch.statistics.videoCount ?? '0', 10),
    viewCount: parseInt(ch.statistics.viewCount ?? '0', 10),
    keywords: ch.brandingSettings?.channel?.keywords ?? '',
  }));
}

/**
 * Search for recent videos by a channel.
 * Costs 100 quota units — use sparingly, only for high-value channels.
 */
async function searchChannelVideos(channelId: string, maxResults = 5): Promise<string[]> {
  const data = await ytFetch<{ items?: YTSearchItem[] }>('search', {
    part: 'id',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(maxResults),
    publishedAfter: new Date(Date.now() - 30 * 86400000).toISOString(), // last 30 days
  });
  return (data.items ?? []).map(i => i.id.videoId).filter(Boolean) as string[];
}

/**
 * Fetch video details by IDs.
 * Costs 1 quota unit per call (batch up to 50).
 */
async function getVideoDetails(ids: string[]): Promise<YouTubeVideo[]> {
  if (!ids.length) return [];

  const data = await ytFetch<{ items?: YTVideoItem[] }>('videos', {
    part: 'snippet,statistics',
    id: ids.join(','),
  });

  return (data.items ?? []).map(v => ({
    id: v.id,
    channelId: v.snippet.channelId,
    title: v.snippet.title,
    description: v.snippet.description,
    publishedAt: v.snippet.publishedAt,
    views: parseInt(v.statistics?.viewCount ?? '0', 10),
    likes: parseInt(v.statistics?.likeCount ?? '0', 10),
    comments: parseInt(v.statistics?.commentCount ?? '0', 10),
  }));
}

// ─── Discovery pipeline ─────────────────────────────────────────────

export interface YouTubeDiscoveryResult {
  creator: DiscoveredCreator;
  posts: DiscoveredPost[];
}

/**
 * Convert a YouTube channel + videos into the normalized pipeline format.
 */
function toDiscoveredCreator(ch: YouTubeChannel, videos: YouTubeVideo[]): YouTubeDiscoveryResult {
  const allText = [ch.description, ch.keywords, ...videos.map(v => `${v.title} ${v.description}`)].join(' ');

  // Extract website from description (first http(s) link that isn't youtube/social)
  const urlMatch = ch.description.match(/https?:\/\/[^\s)>"]+/g);
  const website = urlMatch?.find(u =>
    !/youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|tiktok\.com|discord\.|t\.me/i.test(u),
  ) ?? null;

  const creator: DiscoveredCreator = {
    name: ch.title,
    slug: ch.customUrl?.replace(/^@/, '') || ch.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    website,
    bio: ch.description.slice(0, 1000),
    source_type: 'youtube_api',
    source_url: ch.customUrl ? `https://youtube.com/${ch.customUrl}` : `https://youtube.com/channel/${ch.id}`,
    account: {
      platform: 'youtube',
      handle: ch.customUrl || ch.title,
      profile_url: ch.customUrl
        ? `https://youtube.com/${ch.customUrl}`
        : `https://youtube.com/channel/${ch.id}`,
      followers: ch.subscriberCount,
      platform_id: ch.id,
      bio: ch.description.slice(0, 500),
      verified: ch.subscriberCount >= 100_000,
    },
  };

  const posts: DiscoveredPost[] = videos.map(v => ({
    platform: 'youtube' as const,
    post_url: `https://youtube.com/watch?v=${v.id}`,
    title: v.title,
    content_snippet: v.description.slice(0, 500),
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    published_at: v.publishedAt,
  }));

  return { creator, posts };
}

/**
 * Run a full YouTube discovery sweep.
 *
 * Strategy:
 * 1. Search channels across multiple trading keywords
 * 2. Deduplicate by channel ID
 * 3. Fetch full details for unique channels
 * 4. For channels with 10k+ subscribers, fetch recent videos (quota-intensive)
 * 5. Return normalized creator + post objects
 *
 * Quota budget: ~9 queries * 100 + channels detail (~1) + high-value video searches (~100 each)
 */
export async function discoverYouTubeCreators(opts?: {
  maxPerQuery?: number;
  minSubscribers?: number;
  fetchVideosAbove?: number;
  maxVideoFetches?: number;
}): Promise<YouTubeDiscoveryResult[]> {
  const {
    maxPerQuery = 5,
    minSubscribers = 1_000,
    fetchVideosAbove = 10_000,
    maxVideoFetches = 10,     // limit video searches to save quota
  } = opts ?? {};

  const seenIds = new Set<string>();
  const allChannelIds: string[] = [];

  // Phase 1: Search across all queries
  for (const query of TRADING_QUERIES) {
    try {
      const { channelIds } = await searchChannels(query, maxPerQuery);
      for (const id of channelIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allChannelIds.push(id);
        }
      }
      log.debug('youtube.discover: query done', { query, found: channelIds.length, total: allChannelIds.length });
    } catch (err) {
      log.warn('youtube.discover: query failed', { query, error: String(err) });
    }
  }

  log.info('youtube.discover: search phase done', { uniqueChannels: allChannelIds.length });

  if (!allChannelIds.length) return [];

  // Phase 2: Fetch channel details in batches of 50
  const channels: YouTubeChannel[] = [];
  for (let i = 0; i < allChannelIds.length; i += 50) {
    const batch = allChannelIds.slice(i, i + 50);
    try {
      const details = await getChannelDetails(batch);
      channels.push(...details);
    } catch (err) {
      log.warn('youtube.discover: channel detail batch failed', { batch: batch.length, error: String(err) });
    }
  }

  // Filter by minimum subscribers
  const qualified = channels.filter(ch => ch.subscriberCount >= minSubscribers);
  log.info('youtube.discover: channel details done', { total: channels.length, qualified: qualified.length });

  // Phase 3: Fetch recent videos for high-subscriber channels
  const results: YouTubeDiscoveryResult[] = [];
  let videoFetchCount = 0;

  for (const ch of qualified) {
    let videos: YouTubeVideo[] = [];

    if (ch.subscriberCount >= fetchVideosAbove && videoFetchCount < maxVideoFetches) {
      try {
        const videoIds = await searchChannelVideos(ch.id, 5);
        if (videoIds.length) {
          videos = await getVideoDetails(videoIds);
        }
        videoFetchCount++;
      } catch (err) {
        log.warn('youtube.discover: video fetch failed', { channelId: ch.id, error: String(err) });
      }
    }

    results.push(toDiscoveredCreator(ch, videos));
  }

  log.info('youtube.discover: complete', { creators: results.length, videoFetches: videoFetchCount });
  return results;
}
