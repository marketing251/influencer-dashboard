/**
 * Link-in-bio page scanner.
 * Detects and crawls Linktree, Beacons, Stan Store, bio.link, lnk.bio.
 * All these services server-render their link lists — no headless browser needed.
 */

import { extractPropFirmNames } from '../prop-firms';
import { log } from '../logger';

export interface LinkInBioResult {
  url: string;
  provider: string;
  socialLinks: { platform: string; url: string }[];
  emails: string[];
  courseUrls: string[];
  discordUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
  propFirmsMentioned: string[];
  allLinks: string[];
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const EMAIL_BLACKLIST = ['example.com', 'wixpress.com', 'sentry.io', 'google.com'];

const SOCIAL_PATTERNS: { platform: string; pattern: RegExp }[] = [
  { platform: 'youtube', pattern: /youtube\.com\/(c\/|channel\/|@)/i },
  { platform: 'x', pattern: /(?:twitter|x)\.com\/(?!intent|share|i\/)/i },
  { platform: 'instagram', pattern: /instagram\.com\/(?!p\/|reel)/i },
  { platform: 'linkedin', pattern: /linkedin\.com\/(?:in|company)\//i },
  { platform: 'tiktok', pattern: /tiktok\.com\/@/i },
  { platform: 'discord', pattern: /discord\.(?:gg|com\/invite)\//i },
  { platform: 'telegram', pattern: /t\.me\//i },
  { platform: 'twitch', pattern: /twitch\.tv\//i },
];

const COURSE_URL_KEYWORDS = /course|academy|mentorship|masterclass|bootcamp|training|learn|coaching|enroll/i;

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfluencerDashboard/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractLinks(html: string): string[] {
  const hrefs = html.match(/href="(https?:\/\/[^"]+)"/gi) ?? [];
  return hrefs.map(h => h.replace(/^href="/i, '').replace(/"$/, ''));
}

function extractEmails(text: string): string[] {
  const raw = text.match(EMAIL_REGEX) ?? [];
  return [...new Set(raw)].filter(e => {
    const domain = e.split('@')[1]?.toLowerCase();
    return domain && !EMAIL_BLACKLIST.some(b => domain.includes(b));
  }).slice(0, 3);
}

function classifySocialLink(url: string): { platform: string; url: string } | null {
  for (const { platform, pattern } of SOCIAL_PATTERNS) {
    if (pattern.test(url)) return { platform, url };
  }
  return null;
}

export async function crawlLinkInBio(url: string): Promise<LinkInBioResult> {
  const result: LinkInBioResult = {
    url,
    provider: detectProvider(url),
    socialLinks: [],
    emails: [],
    courseUrls: [],
    discordUrl: null,
    telegramUrl: null,
    websiteUrl: null,
    propFirmsMentioned: [],
    allLinks: [],
  };

  const html = await fetchPage(url);
  if (!html) {
    log.debug('link-in-bio: failed to fetch', { url });
    return result;
  }

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const links = extractLinks(html);
  result.allLinks = links;

  // Classify links
  const seenPlatforms = new Set<string>();
  for (const link of links) {
    const social = classifySocialLink(link);
    if (social && !seenPlatforms.has(social.platform)) {
      seenPlatforms.add(social.platform);
      result.socialLinks.push(social);
    }
    if (COURSE_URL_KEYWORDS.test(link)) {
      result.courseUrls.push(link);
    }
    if (/discord\.(?:gg|com\/invite)\//i.test(link)) result.discordUrl = link;
    if (/t\.me\//i.test(link)) result.telegramUrl = link;
    // Non-social external link = likely their real website
    if (!classifySocialLink(link) && !COURSE_URL_KEYWORDS.test(link) && isExternalSite(link, url)) {
      result.websiteUrl = result.websiteUrl || link;
    }
  }

  result.emails = extractEmails(text);
  result.propFirmsMentioned = extractPropFirmNames(text);

  log.debug('link-in-bio: crawled', { url, links: links.length, socials: result.socialLinks.length });
  return result;
}

function detectProvider(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('linktr.ee')) return 'linktree';
  if (lower.includes('beacons.ai')) return 'beacons';
  if (lower.includes('stan.store')) return 'stan';
  if (lower.includes('bio.link')) return 'biolink';
  if (lower.includes('lnk.bio')) return 'lnkbio';
  return 'unknown';
}

function isExternalSite(link: string, sourceUrl: string): boolean {
  try {
    const linkHost = new URL(link).hostname;
    const sourceHost = new URL(sourceUrl).hostname;
    const socialDomains = ['youtube.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
      'tiktok.com', 'discord.gg', 'discord.com', 't.me', 'twitch.tv', 'facebook.com',
      'linktr.ee', 'beacons.ai', 'stan.store', 'bio.link', 'lnk.bio', 'skool.com', 'whop.com'];
    if (linkHost === sourceHost) return false;
    return !socialDomains.some(d => linkHost.includes(d));
  } catch {
    return false;
  }
}
