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
      maxPerQuery: 10,
      minSubscribers: 500,
      maxPages: 1,  // single page per query (fits Vercel Hobby 10s limit)
    });
  },

  configHint() {
    return 'Set YOUTUBE_API_KEY. Get one at console.cloud.google.com (YouTube Data API v3).';
  },
};
