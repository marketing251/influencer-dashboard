/**
 * Extract social profile URLs and platform signals from text.
 * Used during discovery, enrichment, and link-in-bio scanning.
 */

// ─── Blacklists ─────────────────────────────────────────────────────

const IG_BLACKLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal']);
const LI_BLACKLIST = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse']);
const YT_BLACKLIST = new Set(['results', 'watch', 'feed', 'playlist', 'shorts', 'trending', 'gaming', 'music']);

// ─── Instagram ──────────────────────────────────────────────────────

export function extractInstagramUrl(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)\/?/gi,
    /(?:instagram|ig)\s*[:\-@]\s*@?([a-zA-Z0-9_.]{2,30})/gi,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const h = m[1]?.toLowerCase();
      if (h && !IG_BLACKLIST.has(h) && h.length >= 2) return `https://instagram.com/${h}`;
    }
  }
  return null;
}

// ─── LinkedIn ───────────────────────────────────────────────────────

export function extractLinkedinUrl(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-]+)\/?/gi,
    /https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9\-]+)\/?/gi,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const h = m[1]?.toLowerCase();
      if (h && !LI_BLACKLIST.has(h) && h.length >= 2) {
        const type = m[0].toLowerCase().includes('/company/') ? 'company' : 'in';
        return `https://linkedin.com/${type}/${h}`;
      }
    }
  }
  return null;
}

// ─── YouTube ────────────────────────────────────────────────────────

export function extractYoutubeUrl(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /https?:\/\/(?:www\.)?youtube\.com\/@([a-zA-Z0-9_\-.]+)\/?/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:c|channel)\/([a-zA-Z0-9_\-]+)\/?/gi,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const h = m[1]?.toLowerCase();
      if (h && !YT_BLACKLIST.has(h) && h.length >= 2) {
        if (m[0].includes('/channel/')) return `https://youtube.com/channel/${m[1]}`;
        return `https://youtube.com/@${h}`;
      }
    }
  }
  return null;
}

// ─── X / Twitter ────────────────────────────────────────────────────

export function extractXUrl(text: string): string | null {
  if (!text) return null;
  const p = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})\/?/gi;
  const blacklist = new Set(['intent', 'share', 'i', 'search', 'explore', 'home', 'settings', 'login']);
  p.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = p.exec(text)) !== null) {
    const h = m[1]?.toLowerCase();
    if (h && !blacklist.has(h) && h.length >= 2) return `https://x.com/${h}`;
  }
  return null;
}

// ─── Discord (full URL) ─────────────────────────────────────────────

export function extractDiscordUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/(?:www\.)?discord\.(?:gg|com\/invite)\/[a-zA-Z0-9\-]+/i);
  return m ? m[0] : null;
}

// ─── Telegram (full URL) ────────────────────────────────────────────

export function extractTelegramUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/t\.me\/[a-zA-Z0-9_]+/i);
  return m ? m[0] : null;
}

// ─── Link-in-bio ────────────────────────────────────────────────────

const LINK_IN_BIO_DOMAINS = [
  { domain: 'linktr.ee', name: 'linktree' },
  { domain: 'beacons.ai', name: 'beacons' },
  { domain: 'stan.store', name: 'stan' },
  { domain: 'bio.link', name: 'biolink' },
  { domain: 'lnk.bio', name: 'lnkbio' },
  { domain: 'hoo.be', name: 'hoobe' },
  { domain: 'msha.ke', name: 'milkshake' },
];

export function extractLinkInBioUrl(text: string): string | null {
  if (!text) return null;
  for (const { domain } of LINK_IN_BIO_DOMAINS) {
    const p = new RegExp(`https?:\\/\\/(?:www\\.)?${domain.replace('.', '\\.')}\\/[a-zA-Z0-9_.\\-]+`, 'i');
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

export function isLinkInBioUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return LINK_IN_BIO_DOMAINS.some(d => lower.includes(d.domain));
}

// ─── Course URL ─────────────────────────────────────────────────────

export function extractCourseUrl(text: string): string | null {
  if (!text) return null;
  // Look for URLs near course-related keywords
  const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const courseKeywords = /course|academy|mentorship|masterclass|bootcamp|training|enroll|learn|coaching/i;
  for (const url of urls) {
    if (courseKeywords.test(url)) return url.replace(/['">\s].*$/, '');
  }
  return null;
}

// ─── Skool ──────────────────────────────────────────────────────────

export function extractSkoolUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/(?:www\.)?skool\.com\/[a-zA-Z0-9\-]+/i);
  return m ? m[0] : null;
}

export function hasSkool(text: string): boolean {
  return /skool\.com\//i.test(text || '');
}

// ─── Whop ───────────────────────────────────────────────────────────

export function extractWhopUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/(?:www\.)?whop\.com\/[a-zA-Z0-9\-]+/i);
  return m ? m[0] : null;
}

export function hasWhop(text: string): boolean {
  return /whop\.com\//i.test(text || '');
}

// ─── Combined extraction ────────────────────────────────────────────

export interface AllSignals {
  instagram_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  x_url: string | null;
  discord_url: string | null;
  telegram_url: string | null;
  link_in_bio_url: string | null;
  course_url: string | null;
  has_skool: boolean;
  has_whop: boolean;
}

/**
 * Extract all social/platform URLs from multiple text sources.
 * Returns the first match for each. Used by pipeline and enrichment.
 */
export function extractAllSignals(...texts: (string | null | undefined)[]): AllSignals {
  const combined = texts.filter(Boolean).join(' ');
  return {
    instagram_url: extractInstagramUrl(combined),
    linkedin_url: extractLinkedinUrl(combined),
    youtube_url: extractYoutubeUrl(combined),
    x_url: extractXUrl(combined),
    discord_url: extractDiscordUrl(combined),
    telegram_url: extractTelegramUrl(combined),
    link_in_bio_url: extractLinkInBioUrl(combined),
    course_url: extractCourseUrl(combined),
    has_skool: hasSkool(combined),
    has_whop: hasWhop(combined),
  };
}
