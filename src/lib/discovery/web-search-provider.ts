/**
 * Web-search discovery providers for Instagram and LinkedIn.
 *
 * Seed candidates are inserted directly (they're already verified real profiles).
 * DDG/Brave candidates go through verification.
 * Website enrichment is NOT done inline — it happens in the post-discovery
 * enrichment pass in discover-leads.ts to avoid timeout issues.
 */

import type { DiscoveryProvider, DiscoveryResult } from './provider';
import { discoverViaWebSearch } from '../integrations/web-search';
import { verifyCandidate } from '../verification';
import { log } from '../logger';
import type { DiscoveredCreator } from '../pipeline';

async function runWebDiscovery(platform: 'instagram' | 'linkedin'): Promise<DiscoveryResult[]> {
  const candidates = await discoverViaWebSearch({ platform });
  const results: DiscoveryResult[] = [];

  // Count cross-references for verification
  const handlePageCount = new Map<string, number>();
  for (const c of candidates) {
    if (c.handle) handlePageCount.set(c.handle, (handlePageCount.get(c.handle) ?? 0) + 1);
  }

  // Deduplicate by handle
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (!c.handle || seen.has(c.handle)) return false;
    seen.add(c.handle);
    return true;
  });

  for (const candidate of unique.slice(0, 100)) {
    try {
      // Seed data candidates (sourceUrl === 'seed_data') are pre-verified
      const isSeed = candidate.sourceUrl === 'seed_data';

      if (!isSeed) {
        const verification = verifyCandidate(
          candidate,
          null,
          handlePageCount.get(candidate.handle!) ?? 1,
        );
        if (!verification.shouldStore) {
          log.debug('web-search: skipped low confidence', { name: candidate.name, confidence: verification.confidence });
          continue;
        }
      }

      const creator: DiscoveredCreator = {
        name: candidate.name,
        slug: candidate.handle!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        website: candidate.websiteUrl ?? null,
        bio: isSeed
          ? `Known ${platform} trading influencer/educator`
          : `Discovered via web search from: ${candidate.sourceTitle}`,
        source_type: isSeed ? 'seed' : 'web_search',
        source_url: candidate.sourceUrl,
        account: {
          platform,
          handle: candidate.handle!,
          profile_url: candidate.profileUrl || `https://${platform === 'instagram' ? 'instagram.com' : 'linkedin.com/in'}/${candidate.handle}`,
          followers: 0,
          platform_id: candidate.handle!,
          bio: '',
          verified: false,
        },
      };

      results.push({ creator, posts: [] });
    } catch (err) {
      log.warn('web-search: candidate failed', { name: candidate.name, error: String(err) });
    }
  }

  log.info('web-search: provider done', { platform, input: unique.length, output: results.length });
  return results;
}

export const webSearchInstagramProvider: DiscoveryProvider = {
  platform: 'instagram',
  type: 'api',
  label: 'Web Discovery (Instagram)',
  isConfigured() { return true; },
  async discover() { return runWebDiscovery('instagram'); },
  configHint() { return 'Always active. Set BRAVE_SEARCH_API_KEY for expanded search.'; },
};

export const webSearchLinkedInProvider: DiscoveryProvider = {
  platform: 'linkedin',
  type: 'api',
  label: 'Web Discovery (LinkedIn)',
  isConfigured() { return true; },
  async discover() { return runWebDiscovery('linkedin'); },
  configHint() { return 'Always active. Set BRAVE_SEARCH_API_KEY for expanded search.'; },
};
