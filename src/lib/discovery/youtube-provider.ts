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
      maxPerQuery: 10,          // 10 results per query (was 3)
      minSubscribers: 500,      // lower threshold = more leads (was 1000)
    });
  },

  configHint() {
    return 'Set YOUTUBE_API_KEY. Get one at https://console.cloud.google.com (YouTube Data API v3).';
  },
};
