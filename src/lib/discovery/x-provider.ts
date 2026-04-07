import type { DiscoveryProvider, DiscoveryResult } from './provider';
import { discoverXCreators } from '../integrations/x';

export const xProvider: DiscoveryProvider = {
  platform: 'x',
  type: 'api',
  label: 'X API v2',

  isConfigured() {
    return Boolean(process.env.X_BEARER_TOKEN);
  },

  async discover(): Promise<DiscoveryResult[]> {
    return discoverXCreators({
      maxPerQuery: 20,
      minFollowers: 1_000,
      delayMs: 2_000,
    });
  },

  configHint() {
    return 'Set X_BEARER_TOKEN in environment variables. Get one at https://developer.x.com (API v2 access required).';
  },
};
