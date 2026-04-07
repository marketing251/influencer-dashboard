/**
 * Confidence scoring for web-search-sourced candidates.
 * Determines whether a candidate is real and worth storing.
 */

import type { ExtractedCandidate } from './integrations/web-search';
import type { LinkInBioResult } from './integrations/link-in-bio';

export interface VerificationResult {
  confidence: number; // 0.0 – 1.0
  signals: string[];
  shouldStore: boolean;
}

// Lower threshold: a candidate with a direct profile URL (0.25) + trading source (0.10) = 0.35 passes
const MIN_CONFIDENCE = parseFloat(process.env.WEB_SEARCH_MIN_CONFIDENCE || '0.25');

/**
 * Score how confident we are that a candidate is a real, relevant creator.
 */
export function verifyCandidate(
  candidate: ExtractedCandidate,
  linkInBio?: LinkInBioResult | null,
  seenOnPageCount?: number,
): VerificationResult {
  let confidence = 0;
  const signals: string[] = [];

  // Has a direct profile URL
  if (candidate.profileUrl) {
    confidence += 0.25;
    signals.push('direct_profile_url');
  }

  // Cross-referenced on multiple pages
  if (seenOnPageCount && seenOnPageCount >= 2) {
    confidence += 0.15;
    signals.push(`cross_referenced_${seenOnPageCount}_pages`);
  }

  // Name matches handle (fuzzy)
  if (candidate.name && candidate.handle && nameMatchesHandle(candidate.name, candidate.handle)) {
    confidence += 0.10;
    signals.push('name_handle_match');
  }

  // Has a link-in-bio page that was successfully crawled
  if (linkInBio && linkInBio.allLinks.length > 0) {
    confidence += 0.15;
    signals.push('link_in_bio_verified');

    // Link-in-bio contains a matching social profile
    const matchingPlatform = linkInBio.socialLinks.find(
      l => l.platform === candidate.platformHint,
    );
    if (matchingPlatform) {
      confidence += 0.05;
      signals.push('lib_confirms_profile');
    }
  }

  // Has a website
  if (candidate.websiteUrl || linkInBio?.websiteUrl) {
    confidence += 0.10;
    signals.push('has_website');
  }

  // Trading-related keywords in source page
  if (isTradingRelated(candidate.sourceTitle)) {
    confidence += 0.10;
    signals.push('trading_related_source');
  }

  // Contact info available
  if (linkInBio?.emails?.length) {
    confidence += 0.05;
    signals.push('has_email');
  }

  // Reputable source domain
  if (isReputableSource(candidate.sourceUrl)) {
    confidence += 0.05;
    signals.push('reputable_source');
  }

  confidence = Math.min(confidence, 1.0);

  return {
    confidence: Math.round(confidence * 100) / 100,
    signals,
    shouldStore: confidence >= MIN_CONFIDENCE,
  };
}

function nameMatchesHandle(name: string, handle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  const h = norm(handle);
  if (n === h) return true;
  // Check if handle contains last name
  const parts = name.toLowerCase().split(/\s+/);
  if (parts.length >= 2) {
    const last = norm(parts[parts.length - 1]);
    if (h.includes(last)) return true;
  }
  // Check if name words are initials in handle
  const initials = parts.map(p => p[0]).join('');
  if (h.startsWith(initials)) return true;
  return false;
}

function isTradingRelated(text: string): boolean {
  return /\b(trad(?:ing|er)|forex|prop\s*firm|funded|crypto|options|futures|mentor|education|coach)\b/i.test(text || '');
}

function isReputableSource(url: string): boolean {
  const reputable = ['medium.com', 'linkedin.com', 'forbes.com', 'benzinga.com', 'investopedia.com', 'tradingview.com'];
  try {
    const host = new URL(url).hostname.toLowerCase();
    return reputable.some(d => host.includes(d));
  } catch {
    return false;
  }
}
