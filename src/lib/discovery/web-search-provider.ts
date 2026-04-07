/**
 * Web-search discovery providers for Instagram and LinkedIn.
 * Uses Brave Search API to find public list pages, then extracts profiles.
 * Enriches candidates via link-in-bio crawling AND website enrichment.
 */

import type { DiscoveryProvider, DiscoveryResult } from './provider';
import { discoverViaWebSearch } from '../integrations/web-search';
import { crawlLinkInBio } from '../integrations/link-in-bio';
import { enrichFromWebsite } from '../integrations/website-enrichment';
import { verifyCandidate } from '../verification';
import { extractAllSignals } from '../social-links';
import { log } from '../logger';
import type { DiscoveredCreator } from '../pipeline';

async function runWebDiscovery(platform: 'instagram' | 'linkedin'): Promise<DiscoveryResult[]> {
  const candidates = await discoverViaWebSearch({ platform });
  const results: DiscoveryResult[] = [];

  // Count how many pages each handle appears on (for cross-referencing)
  const handlePageCount = new Map<string, number>();
  for (const c of candidates) {
    if (c.handle) handlePageCount.set(c.handle, (handlePageCount.get(c.handle) ?? 0) + 1);
  }

  // Deduplicate candidates by handle
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (!c.handle || seen.has(c.handle)) return false;
    seen.add(c.handle);
    return true;
  });

  for (const candidate of unique.slice(0, 50)) {
    try {
      // Step 1: Crawl link-in-bio if available
      const linkInBio = candidate.linkInBioUrl
        ? await crawlLinkInBio(candidate.linkInBioUrl)
        : null;

      // Step 2: Enrich from website if available (THIS WAS THE MISSING STEP)
      const website = candidate.websiteUrl || linkInBio?.websiteUrl || null;
      let websiteEnrichment = null;
      if (website) {
        try {
          websiteEnrichment = await enrichFromWebsite(website);
        } catch (err) {
          log.debug('web-search: website enrichment failed', { url: website, error: String(err) });
        }
      }

      // Step 3: Verify candidate
      const verification = verifyCandidate(
        candidate,
        linkInBio,
        handlePageCount.get(candidate.handle!) ?? 1,
      );

      if (!verification.shouldStore) {
        log.debug('web-search: skipped low confidence', {
          name: candidate.name, confidence: verification.confidence, platform,
        });
        continue;
      }

      // Step 4: Build a rich bio from all available data
      const bioSources: string[] = [];
      if (linkInBio?.socialLinks.length) {
        bioSources.push(`Link-in-bio has ${linkInBio.socialLinks.length} social links`);
      }
      if (websiteEnrichment?.has_course) bioSources.push('Has course/academy');
      if (websiteEnrichment?.prop_firms_mentioned.length) {
        bioSources.push(`Mentions: ${websiteEnrichment.prop_firms_mentioned.join(', ')}`);
      }
      bioSources.push(`Confidence: ${Math.round(verification.confidence * 100)}%`);
      bioSources.push(`Source: ${candidate.sourceTitle}`);
      const bio = bioSources.join('. ');

      // Step 5: Extract all signals from enrichment data
      const enrichmentText = [
        ...(websiteEnrichment?.social_links ?? []).map(l => l.url),
        ...(linkInBio?.allLinks ?? []),
      ].join(' ');
      const signals = extractAllSignals(enrichmentText);

      const creator: DiscoveredCreator = {
        name: candidate.name,
        slug: candidate.handle!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        website,
        bio,
        source_type: 'web_search',
        source_url: candidate.sourceUrl,
        account: {
          platform,
          handle: candidate.handle!,
          profile_url: candidate.profileUrl || `https://${platform === 'instagram' ? 'instagram.com' : 'linkedin.com/in'}/${candidate.handle}`,
          followers: 0,
          platform_id: candidate.handle!,
          bio: bio.slice(0, 500),
          verified: false,
        },
      };

      results.push({ creator, posts: [] });
    } catch (err) {
      log.warn('web-search: candidate processing failed', { name: candidate.name, error: String(err) });
    }
  }

  log.info('web-search: provider done', { platform, candidates: candidates.length, verified: results.length });
  return results;
}

export const webSearchInstagramProvider: DiscoveryProvider = {
  platform: 'instagram',
  type: 'api',
  label: 'Web Search (Instagram)',
  isConfigured() { return Boolean(process.env.BRAVE_SEARCH_API_KEY); },
  async discover() { return runWebDiscovery('instagram'); },
  configHint() { return 'Set BRAVE_SEARCH_API_KEY. Get one free at https://brave.com/search/api/ (2000 queries/month free).'; },
};

export const webSearchLinkedInProvider: DiscoveryProvider = {
  platform: 'linkedin',
  type: 'api',
  label: 'Web Search (LinkedIn)',
  isConfigured() { return Boolean(process.env.BRAVE_SEARCH_API_KEY); },
  async discover() { return runWebDiscovery('linkedin'); },
  configHint() { return 'Set BRAVE_SEARCH_API_KEY. Get one free at https://brave.com/search/api/ (2000 queries/month free).'; },
};
