/**
 * Website enrichment: fetch a creator's public website and extract
 * business contact info, course/community links, and prop firm mentions.
 *
 * Only processes publicly accessible pages (no login-gated content).
 * Crawls the root page plus /about and /contact if they exist.
 */

import { log } from '../logger';
import { detectPropFirmsFromSources, extractPropFirmNames } from '../prop-firms';

export interface EnrichmentResult {
  emails: string[];
  phones: string[];
  has_course: boolean;
  has_discord: boolean;
  has_telegram: boolean;
  promoting_prop_firms: boolean;
  prop_firms_mentioned: string[];
  social_links: { platform: string; url: string }[];
  pages_crawled: string[];
  errors: string[];
}

// Matches standard email addresses; intentionally broad
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Matches North American + international phone formats
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

// Domains that are never real business emails
const EMAIL_BLACKLIST = [
  'example.com', 'wixpress.com', 'sentry.io', 'w3.org', 'schema.org',
  'googletagmanager.com', 'google.com', 'facebook.com', 'twitter.com',
  'gravatar.com', 'wordpress.org', 'jquery.com', 'cloudflare.com',
];

// Phone patterns that are likely CSS/JS artifacts, not real numbers
const PHONE_BLACKLIST = [/^0{4,}/, /^1234/, /^0000/];

const SOCIAL_PATTERNS: { platform: string; pattern: RegExp }[] = [
  { platform: 'youtube', pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[^\s"'<>]+/i },
  { platform: 'x', pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|i\/)[^\s"'<>]+/i },
  { platform: 'instagram', pattern: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i },
  { platform: 'tiktok', pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>]+/i },
  { platform: 'discord', pattern: /https?:\/\/(?:www\.)?discord\.(?:gg|com\/invite)\/[^\s"'<>]+/i },
  { platform: 'telegram', pattern: /https?:\/\/t\.me\/[^\s"'<>]+/i },
  { platform: 'twitch', pattern: /https?:\/\/(?:www\.)?twitch\.tv\/[^\s"'<>]+/i },
  { platform: 'linkedin', pattern: /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^\s"'<>]+/i },
];

const COURSE_INDICATORS = /\b(?:course|enroll|curriculum|lesson|module|masterclass|bootcamp|academy|mentorship|coaching|program|training|workshop|certification)\b/i;
const DISCORD_LINK = /discord\.(?:gg|com\/invite)\//i;
const TELEGRAM_LINK = /t\.me\//i;

/**
 * Fetch a single page's HTML. Returns null on failure.
 */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InfluencerDashboard/1.0; business-contact-lookup)',
        Accept: 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;

    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags and normalize whitespace for text analysis.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract emails from text, filtering out junk.
 */
function extractEmails(text: string): string[] {
  const raw = text.match(EMAIL_REGEX) ?? [];
  const filtered = raw.filter(email => {
    const domain = email.split('@')[1]?.toLowerCase();
    return domain && !EMAIL_BLACKLIST.some(blocked => domain.includes(blocked));
  });
  return [...new Set(filtered)].slice(0, 5);
}

/**
 * Extract phone numbers from text, filtering out noise.
 */
function extractPhones(text: string): string[] {
  const raw = text.match(PHONE_REGEX) ?? [];
  const filtered = raw.filter(phone => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;
    return !PHONE_BLACKLIST.some(p => p.test(digits));
  });
  return [...new Set(filtered)].slice(0, 3);
}

/**
 * Extract social media links from raw HTML (href attributes).
 */
function extractSocialLinks(html: string): { platform: string; url: string }[] {
  const links: { platform: string; url: string }[] = [];
  const seen = new Set<string>();

  for (const { platform, pattern } of SOCIAL_PATTERNS) {
    const matches = html.match(new RegExp(pattern.source, 'gi')) ?? [];
    for (const match of matches) {
      const clean = match.replace(/['">\s].*$/, '');
      if (!seen.has(clean)) {
        seen.add(clean);
        links.push({ platform, url: clean });
      }
    }
  }

  return links;
}

/**
 * Determine which sub-pages to crawl based on links found on the root page.
 */
function findSubPages(html: string, baseUrl: string): string[] {
  const subPages: string[] = [];
  const base = new URL(baseUrl);

  // Common contact/about page patterns
  const patterns = [/\/about/i, /\/contact/i, /\/connect/i, /\/links/i];

  const hrefMatches = html.match(/href="([^"]+)"/g) ?? [];
  for (const href of hrefMatches) {
    const path = href.replace('href="', '').replace('"', '');
    try {
      const resolved = new URL(path, base);
      // Only same-origin pages
      if (resolved.origin !== base.origin) continue;
      if (patterns.some(p => p.test(resolved.pathname)) && !subPages.includes(resolved.toString())) {
        subPages.push(resolved.toString());
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return subPages.slice(0, 3); // Limit sub-page crawls
}

/**
 * Enrich a creator by crawling their public website.
 * Crawls: root page + /about + /contact (if found).
 */
export async function enrichFromWebsite(url: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    emails: [],
    phones: [],
    has_course: false,
    has_discord: false,
    has_telegram: false,
    promoting_prop_firms: false,
    prop_firms_mentioned: [],
    social_links: [],
    pages_crawled: [],
    errors: [],
  };

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      result.errors.push('Invalid protocol');
      return result;
    }
  } catch {
    result.errors.push('Invalid URL');
    return result;
  }

  // Phase 1: Fetch root page
  log.debug('enrichment: fetching root', { url });
  const rootHtml = await fetchPage(url);
  if (!rootHtml) {
    result.errors.push('Failed to fetch root page');
    return result;
  }
  result.pages_crawled.push(url);

  // Phase 2: Find and fetch sub-pages
  const subPages = findSubPages(rootHtml, url);
  const allHtml = [rootHtml];

  for (const subUrl of subPages) {
    const html = await fetchPage(subUrl);
    if (html) {
      allHtml.push(html);
      result.pages_crawled.push(subUrl);
    }
  }

  // Phase 3: Analyze all crawled content
  const allText = allHtml.map(htmlToText).join(' ');
  const allRawHtml = allHtml.join(' ');

  result.emails = extractEmails(allText);
  result.phones = extractPhones(allText);
  result.has_course = COURSE_INDICATORS.test(allText);
  result.has_discord = DISCORD_LINK.test(allRawHtml);
  result.has_telegram = TELEGRAM_LINK.test(allRawHtml);

  const firmNames = extractPropFirmNames(allText);
  result.prop_firms_mentioned = firmNames;
  result.promoting_prop_firms = firmNames.length > 0;

  result.social_links = extractSocialLinks(allRawHtml);

  log.info('enrichment: done', {
    url,
    pages: result.pages_crawled.length,
    emails: result.emails.length,
    phones: result.phones.length,
    propFirms: firmNames.length,
    socialLinks: result.social_links.length,
  });

  return result;
}
