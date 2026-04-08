import type { DiscoveryProvider, DiscoveryResult } from './provider';
import { discoverYouTubeCreators } from '../integrations/youtube';

export const youtubeProvider: DiscoveryProvider = {
  platform: 'youtube',
  type: 'api',
  label: 'YouTube Data API v3',

  isConfigured() {
    return Boolean(process.env.YOUTUBE_API_KEY);
  },

  async discover(): Promise<DiscoveryResult[]> {
    return discoverYouTubeCreators({
      maxPerQuery: 3,           // 3 results per query (fast)
      minSubscribers: 1_000,
      fetchVideosAbove: 50_000, // only fetch videos for large channels
      maxVideoFetches: 2,       // max 2 video fetches to stay fast
    });
  },

  configHint() {
    return 'Set YOUTUBE_API_KEY in environment variables. Get one at https://console.cloud.google.com (YouTube Data API v3).';
  },
};
