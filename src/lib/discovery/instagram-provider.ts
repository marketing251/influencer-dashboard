import type { DiscoveryProvider, DiscoveryResult } from './provider';

/**
 * Instagram provider — import-only.
 *
 * Instagram does not offer a public discovery/search API.
 * The Instagram Graph API and Instagram Basic Display API both require
 * the target user to authorize your app (OAuth), making them unsuitable
 * for cold discovery of unknown creators.
 *
 * Supported data paths:
 *   1. CSV/JSON manual import via /api/import/creators
 *   2. Third-party enrichment services (e.g. PhantomBuster, Apify)
 *      that provide Instagram data through their own APIs
 *   3. Future: Meta Content Library API (research access only as of 2026)
 *
 * Once imported, Instagram creators are stored, scored, and displayed
 * identically to YouTube/X creators in the dashboard.
 */
export const instagramProvider: DiscoveryProvider = {
  platform: 'instagram',
  type: 'import',
  label: 'Instagram (CSV Import)',

  isConfigured() {
    // Import providers are always "configured" — they accept data via upload
    return true;
  },

  async discover(): Promise<DiscoveryResult[]> {
    // Import providers don't discover on their own.
    // Data enters via /api/import/creators.
    return [];
  },

  configHint() {
    return 'Instagram does not support public discovery. Use CSV import at /api/import/creators or connect a third-party enrichment service.';
  },
};
