import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// ─── Types ──────────────────────────────────────────────────────────

interface NormalizedCreator {
  platform: 'youtube';
  name: string;
  channelId: string;
  handle: string;
  url: string;
  description: string;
  thumbnails: {
    default: string | null;
    medium: string | null;
    high: string | null;
  };
  subscribers: number;
  views: number;
  videos: number;
}

interface YouTubeAPIError {
  error: {
    code: number;
    message: string;
    errors?: { reason: string; domain: string }[];
  };
}

// Raw YouTube API shapes
interface YTSearchItem {
  id: { channelId?: string };
  snippet: { channelId: string };
}

interface YTChannelItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    thumbnails?: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  statistics: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

const BASE = 'https://www.googleapis.com/youtube/v3';

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(500, 'YOUTUBE_API_KEY is not configured on the server');
  return key;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function ytFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', getApiKey());

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });

  if (!res.ok) {
    const body: YouTubeAPIError | string = await res.json().catch(() => res.text());
    const msg = typeof body === 'object' && body?.error?.message
      ? body.error.message
      : `YouTube API returned ${res.status}`;

    // Map common YouTube errors to helpful messages
    if (res.status === 403) {
      const reason = typeof body === 'object' ? body?.error?.errors?.[0]?.reason : undefined;
      if (reason === 'quotaExceeded') {
        throw new ApiError(429, 'YouTube API daily quota exceeded. Try again tomorrow or request a higher quota at https://console.cloud.google.com');
      }
      throw new ApiError(403, `YouTube API forbidden: ${msg}. Check that the YouTube Data API v3 is enabled in your Google Cloud project.`);
    }
    if (res.status === 400) {
      throw new ApiError(400, `Bad request to YouTube API: ${msg}`);
    }
    throw new ApiError(res.status, `YouTube API error: ${msg}`);
  }

  return res.json() as Promise<T>;
}

// ─── Core logic ─────────────────────────────────────────────────────

async function searchYouTubeChannels(
  query: string,
  maxResults: number,
  pageToken?: string,
): Promise<{ creators: NormalizedCreator[]; nextPageToken: string | null; totalResults: number }> {
  // Step 1: Search for channels
  const searchParams: Record<string, string> = {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: String(maxResults),
    relevanceLanguage: 'en',
    order: 'relevance',
  };
  if (pageToken) searchParams.pageToken = pageToken;

  const searchData = await ytFetch<{
    items?: YTSearchItem[];
    nextPageToken?: string;
    pageInfo?: { totalResults?: number };
  }>('search', searchParams);

  const channelIds = [
    ...new Set(
      (searchData.items ?? [])
        .map(item => item.id.channelId ?? item.snippet.channelId)
        .filter(Boolean),
    ),
  ];

  if (!channelIds.length) {
    return { creators: [], nextPageToken: null, totalResults: 0 };
  }

  // Step 2: Fetch full channel details (statistics + thumbnails)
  const detailData = await ytFetch<{ items?: YTChannelItem[] }>('channels', {
    part: 'snippet,statistics',
    id: channelIds.join(','),
  });

  // Step 3: Normalize into clean creator objects
  const creators: NormalizedCreator[] = (detailData.items ?? []).map(ch => ({
    platform: 'youtube' as const,
    name: ch.snippet.title,
    channelId: ch.id,
    handle: ch.snippet.customUrl ?? ch.snippet.title,
    url: ch.snippet.customUrl
      ? `https://youtube.com/${ch.snippet.customUrl}`
      : `https://youtube.com/channel/${ch.id}`,
    description: ch.snippet.description ?? '',
    thumbnails: {
      default: ch.snippet.thumbnails?.default?.url ?? null,
      medium: ch.snippet.thumbnails?.medium?.url ?? null,
      high: ch.snippet.thumbnails?.high?.url ?? null,
    },
    subscribers: parseInt(ch.statistics.subscriberCount ?? '0', 10),
    views: parseInt(ch.statistics.viewCount ?? '0', 10),
    videos: parseInt(ch.statistics.videoCount ?? '0', 10),
  }));

  return {
    creators,
    nextPageToken: searchData.nextPageToken ?? null,
    totalResults: searchData.pageInfo?.totalResults ?? creators.length,
  };
}

// ─── Route handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get('q')?.trim();
  const maxResults = Math.min(Math.max(parseInt(params.get('maxResults') ?? '10', 10) || 10, 1), 50);
  const pageToken = params.get('pageToken') ?? undefined;

  if (!query) {
    return NextResponse.json(
      { error: 'Missing required query parameter: q', example: '/api/youtube/search?q=forex+trading' },
      { status: 400 },
    );
  }

  try {
    const { creators, nextPageToken, totalResults } = await searchYouTubeChannels(query, maxResults, pageToken);

    return NextResponse.json({
      query,
      count: creators.length,
      totalResults,
      nextPageToken,
      creators,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[api/youtube/search] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
