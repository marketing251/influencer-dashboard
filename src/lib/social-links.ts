/**
 * Extract Instagram and LinkedIn profile URLs from text (bios, descriptions, websites).
 * Used during YouTube/X discovery and website enrichment to populate creator records
 * without scraping those platforms directly.
 */

// ─── Instagram ──────────────────────────────────────────────────────

const IG_PATTERNS = [
  // Full URLs
  /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)\/?/gi,
  // Short references in bios: "IG: @handle" or "Instagram: handle"
  /(?:instagram|ig)\s*[:\-@]\s*@?([a-zA-Z0-9_.]{2,30})/gi,
];

// Handles that are navigation paths, not real profiles
const IG_BLACKLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal']);

/**
 * Extract the first valid Instagram profile URL from text.
 */
export function extractInstagramUrl(text: string): string | null {
  if (!text) return null;

  for (const pattern of IG_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const handle = match[1]?.toLowerCase();
      if (handle && !IG_BLACKLIST.has(handle) && handle.length >= 2) {
        return `https://instagram.com/${handle}`;
      }
    }
  }
  return null;
}

// ─── LinkedIn ───────────────────────────────────────────────────────

const LI_PATTERNS = [
  // Profile URLs
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-]+)\/?/gi,
  // Company pages
  /https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9\-]+)\/?/gi,
  // Short references in bios
  /(?:linkedin)\s*[:\-@]\s*@?([a-zA-Z0-9\-]{2,60})/gi,
];

const LI_BLACKLIST = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse']);

/**
 * Extract the first valid LinkedIn profile URL from text.
 */
export function extractLinkedinUrl(text: string): string | null {
  if (!text) return null;

  for (const pattern of LI_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const handle = match[1]?.toLowerCase();
      if (handle && !LI_BLACKLIST.has(handle) && handle.length >= 2) {
        // Preserve the URL type (in/ vs company/)
        const fullMatch = match[0].toLowerCase();
        if (fullMatch.includes('/company/')) {
          return `https://linkedin.com/company/${handle}`;
        }
        return `https://linkedin.com/in/${handle}`;
      }
    }
  }
  return null;
}

// ─── Combined extraction ────────────────────────────────────────────

export interface SocialLinks {
  instagram_url: string | null;
  linkedin_url: string | null;
}

/**
 * Extract Instagram and LinkedIn URLs from multiple text sources.
 * Scans all texts and returns the first match for each platform.
 */
export function extractSocialLinks(...texts: (string | null | undefined)[]): SocialLinks {
  let instagram_url: string | null = null;
  let linkedin_url: string | null = null;

  for (const text of texts) {
    if (!text) continue;
    if (!instagram_url) instagram_url = extractInstagramUrl(text);
    if (!linkedin_url) linkedin_url = extractLinkedinUrl(text);
    if (instagram_url && linkedin_url) break;
  }

  return { instagram_url, linkedin_url };
}
