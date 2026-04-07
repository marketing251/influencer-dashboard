import type { DiscoveryProvider, DiscoveryResult } from './provider';

/**
 * LinkedIn provider — import-only.
 *
 * LinkedIn's API does not support searching for arbitrary profiles.
 * The Marketing API and People API both require the target user's OAuth
 * consent, and LinkedIn explicitly prohibits scraping in their ToS.
 *
 * Supported data paths:
 *   1. CSV/JSON manual import via /api/import/creators
 *   2. LinkedIn Sales Navigator export (manual download)
 *   3. Third-party enrichment services (e.g. Apollo, Clearbit, Phantombuster)
 *      that provide LinkedIn data through their own licensed APIs
 *
 * Once imported, LinkedIn creators are stored, scored, and displayed
 * identically to YouTube/X creators in the dashboard.
 */
export const linkedinProvider: DiscoveryProvider = {
  platform: 'linkedin',
  type: 'import',
  label: 'LinkedIn (CSV Import)',

  isConfigured() {
    return true;
  },

  async discover(): Promise<DiscoveryResult[]> {
    return [];
  },

  configHint() {
    return 'LinkedIn does not support public discovery. Use CSV import at /api/import/creators or export from Sales Navigator.';
  },
};
