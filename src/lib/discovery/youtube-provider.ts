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
      maxPerQuery: 5,
      minSubscribers: 1_000,
      fetchVideosAbove: 10_000,
      maxVideoFetches: 10,
    });
  },

  configHint() {
    return 'Set YOUTUBE_API_KEY in environment variables. Get one at https://console.cloud.google.com (YouTube Data API v3).';
  },
};
