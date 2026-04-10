/**
 * Fast enrichment — scans a creator's website for contact info.
 *
 * Unlike the full `enrichFromWebsite` crawl this is optimised for
 * the Refresh Leads pipeline: it fetches the root page, extracts a
 * short list of promising sub-pages (contact / about / footer / link-in-bio)
 * and fetches them in parallel with a tight per-request timeout.
 *
 * The whole call is time-bounded via `maxTotalMs` so a single slow
 * site can't block the refresh loop.
 */

import { log } from '../logger';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_BL = [
  'example.com', 'example.org', 'example.net', 'example.io',
  'wixpress.com', 'sentry.io', 'google.com', 'gmail-smtp-in',
  'facebook.com', 'twitter.com', 'cloudflare.com', 'wordpress.org',
  'schema.org', 'w3.org', 'jquery.com', 'gravatar.com', 'googletagmanager.com',
  'cdn-cgi', 'jsdelivr.net', 'unpkg.com',
  // Doc/template placeholder addresses that keep getting scraped
  'yourdomain.com', 'domain.com', 'yoursite.com', 'test.com', 'email.com',
  'mysite.com', 'website.com', 'company.com', 'acme.com',
];
// Local-part blocklist — catches placeholder addresses regardless of domain
const EMAIL_LOCAL_BL = [
  'johnappleseed', 'jappleseed', 'appleseed',          // Apple's placeholder ID
  'john.doe', 'jane.doe', 'johndoe', 'janedoe',         // Lorem ipsum people
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',  // Automated senders
  'test', 'test1', 'test2', 'demo', 'sample',           // Generic placeholders
  'user', 'username', 'email', 'yourname', 'yourusername',
  'firstname', 'lastname', 'firstnamelastname',
  'youremail', 'your.email',
];
const PHONE_BL = [/^0{4,}/, /^1234/, /^1111/];
const CONTACT_PATH_RE = /\/(contact|contact-us|get-in-touch|say-hello|hire|work-with|business|partnerships|sponsor|inquir|collab|about|team|support)\b/i;
const LINK_IN_BIO_HOSTS = ['linktr.ee', 'beacons.ai', 'stan.store', 'bio.link', 'lnk.bio', 'hoo.be', 'msha.ke', 'flowcode.com', 'withkoji.com'];
const USER_AGENT = 'Mozilla/5.0 (compatible; InfluencerDashboard/1.0; +https://propaccount.com/bot)';

export interface FastEnrichResult {
  email: string | null;
  phone: string | null;
  contact_form_url: string | null;
  link_in_bio_url: string | null;
  pages_scanned: number;
  found_on: 'root' | 'contact' | 'about' | 'link_in_bio' | null;
}

function emptyResult(): FastEnrichResult {
  return { email: null, phone: null, contact_form_url: null, link_in_bio_url: null, pages_scanned: 0, found_on: null };
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
    // Cap body size at ~1MB to avoid enormous SSR apps
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 1_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    return new TextDecoder().decode(concat(chunks));
  } catch {
    return null;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

export function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split('@');
  if (!local || !domain) return true;
  if (EMAIL_BL.some(b => domain.includes(b))) return true;
  if (EMAIL_LOCAL_BL.includes(local)) return true;
  // local-part contains a blocklisted placeholder token (e.g. "johnappleseed123")
  if (EMAIL_LOCAL_BL.some(bl => local === bl || local.startsWith(bl + '.') || local.startsWith(bl + '_'))) return true;
  return false;
}

function extractEmail(html: string, text: string): string | null {
  const mailtos = (html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi) ?? [])
    .map(m => m.replace(/^mailto:/i, ''));
  const decoded = text.replace(/\s*\[\s*at\s*\]\s*/gi, '@').replace(/\s*\(\s*at\s*\)\s*/gi, '@');
  const textEmails = decoded.match(EMAIL_RE) ?? [];
  const all = [...mailtos, ...textEmails]
    .map(e => e.trim().replace(/\.$/, ''))
    .filter(e => !isPlaceholderEmail(e));
  // Prefer business-style aliases
  const prefer = ['hello', 'contact', 'team', 'business', 'info', 'support', 'press', 'partnerships'];
  const preferred = all.find(e => prefer.some(p => e.toLowerCase().startsWith(p + '@')));
  return preferred ?? all[0] ?? null;
}

function extractPhone(text: string): string | null {
  const phones = (text.match(PHONE_RE) ?? []).filter(p => {
    const digits = p.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;
    return !PHONE_BL.some(bl => bl.test(digits));
  });
  return phones[0]?.trim() ?? null;
}

interface LinkInventory {
  contactUrls: string[];
  linkInBioUrls: string[];
  firstContactFormUrl: string | null;
}

function collectLinks(html: string, baseUrl: string): LinkInventory {
  const out: LinkInventory = { contactUrls: [], linkInBioUrls: [], firstContactFormUrl: null };
  const base = (() => { try { return new URL(baseUrl); } catch { return null; } })();
  if (!base) return out;

  const hrefRe = /href=["']([^"']+)["']/gi;
  const seenLib = new Set<string>();
  const seenContact = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('#') || raw.startsWith('javascript:')) continue;

    let full: URL;
    try { full = new URL(raw, base); } catch { continue; }
    if (!/^https?:$/.test(full.protocol)) continue;

    const hostLower = full.hostname.toLowerCase();

    // Link-in-bio (any domain)
    if (LINK_IN_BIO_HOSTS.some(h => hostLower.includes(h))) {
      const str = full.toString();
      if (!seenLib.has(str)) { seenLib.add(str); out.linkInBioUrls.push(str); }
      continue;
    }

    // Same-origin contact-ish paths
    if (hostLower === base.hostname.toLowerCase() && CONTACT_PATH_RE.test(full.pathname)) {
      const str = full.toString();
      if (!seenContact.has(str)) {
        seenContact.add(str);
        out.contactUrls.push(str);
        if (!out.firstContactFormUrl && /\/contact/i.test(full.pathname)) out.firstContactFormUrl = str;
      }
    }
  }

  // Cap sub-page fan-out
  out.contactUrls = out.contactUrls.slice(0, 4);
  out.linkInBioUrls = out.linkInBioUrls.slice(0, 2);
  return out;
}

function merge(into: FastEnrichResult, html: string | null, source: FastEnrichResult['found_on']): void {
  if (!html) return;
  into.pages_scanned++;
  const text = htmlToText(html);
  if (!into.email) {
    const e = extractEmail(html, text);
    if (e) { into.email = e; if (!into.found_on) into.found_on = source; }
  }
  if (!into.phone) {
    const p = extractPhone(text);
    if (p) { into.phone = p; if (!into.found_on) into.found_on = source; }
  }
}

export interface FastEnrichOpts {
  /** Max total time budget for the entire call. Default 6000ms. */
  maxTotalMs?: number;
  /** Per-request fetch timeout. Default 3500ms. */
  perRequestMs?: number;
}

/**
 * Scan a website for contact info.
 * Checks: root → /contact, /about, /footer-detected sub-pages, link-in-bio.
 * Stops as soon as an email is found or the time budget is exhausted.
 */
export async function fastEnrich(url: string, opts?: FastEnrichOpts): Promise<FastEnrichResult> {
  const { maxTotalMs = 6_000, perRequestMs = 3_500 } = opts ?? {};
  const result = emptyResult();
  const start = Date.now();
  const remaining = () => Math.max(0, maxTotalMs - (Date.now() - start));

  try {
    const rootHtml = await fetchHtml(url, Math.min(perRequestMs, remaining()));
    if (!rootHtml) return result;

    merge(result, rootHtml, 'root');
    const inv = collectLinks(rootHtml, url);
    if (inv.firstContactFormUrl) result.contact_form_url = inv.firstContactFormUrl;
    if (inv.linkInBioUrls[0]) result.link_in_bio_url = inv.linkInBioUrls[0];

    // If email already found on root, we're done
    if (result.email && result.phone) return result;

    // Fetch contact pages + link-in-bio in parallel with a tight budget
    const subUrls: { url: string; source: FastEnrichResult['found_on'] }[] = [];
    for (const u of inv.contactUrls) {
      const source: FastEnrichResult['found_on'] = /\/about/i.test(u) ? 'about' : 'contact';
      subUrls.push({ url: u, source });
    }
    for (const u of inv.linkInBioUrls) subUrls.push({ url: u, source: 'link_in_bio' });

    if (subUrls.length === 0 || remaining() < 500) return result;

    const timeLeft = remaining();
    const per = Math.min(perRequestMs, Math.max(1500, Math.floor(timeLeft / Math.max(1, Math.min(subUrls.length, 3)))));

    const results = await Promise.all(
      subUrls.slice(0, 4).map(async entry => {
        if (remaining() < 300) return { html: null, source: entry.source };
        const html = await fetchHtml(entry.url, per);
        return { html, source: entry.source };
      }),
    );

    for (const r of results) {
      merge(result, r.html, r.source);
      if (result.email && result.phone) break;
    }
  } catch (err) {
    log.debug('fast-enrich: failed', { url, error: String(err) });
  }

  return result;
}
