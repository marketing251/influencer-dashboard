/**
 * Fast enrichment — fetches just the root page to extract email/phone.
 * Used inline during discovery to qualify leads before insert.
 * Much faster than full enrichFromWebsite() (1 page vs 6 pages).
 */

import { log } from '../logger';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_BL = ['example.com', 'wixpress.com', 'sentry.io', 'google.com', 'facebook.com', 'twitter.com', 'cloudflare.com', 'wordpress.org', 'schema.org', 'w3.org', 'jquery.com', 'gravatar.com'];
const PHONE_BL = [/^0{4,}/, /^1234/];
const CONTACT_PAGE_RE = /\/contact/i;

export interface FastEnrichResult {
  email: string | null;
  phone: string | null;
  contact_form_url: string | null;
}

/**
 * Quick scan of a website's root page for email/phone/contact form.
 * Timeout: 4 seconds. Single page only.
 */
export async function fastEnrich(url: string): Promise<FastEnrichResult> {
  const result: FastEnrichResult = { email: null, phone: null, contact_form_url: null };

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InfluencerDashboard/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return result;

    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

    // Extract emails — prefer mailto: links first
    const mailtos = (html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi) ?? [])
      .map(m => m.replace(/^mailto:/i, ''));
    const textEmails = (text.match(EMAIL_RE) ?? []).filter(e => {
      const domain = e.split('@')[1]?.toLowerCase();
      return domain && !EMAIL_BL.some(b => domain.includes(b));
    });
    const allEmails = [...new Set([...mailtos, ...textEmails])];
    result.email = allEmails[0] ?? null;

    // Extract phone
    const phones = (text.match(PHONE_RE) ?? []).filter(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 && !PHONE_BL.some(bl => bl.test(digits));
    });
    result.phone = phones[0] ?? null;

    // Detect contact page links
    const hrefs = html.match(/href="([^"]+)"/gi) ?? [];
    for (const href of hrefs) {
      const path = href.replace(/^href="/i, '').replace(/"$/, '');
      if (CONTACT_PAGE_RE.test(path)) {
        try {
          const full = new URL(path, url);
          if (full.origin === new URL(url).origin) {
            result.contact_form_url = full.toString();
            break;
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    log.debug('fast-enrich: failed', { url, error: String(err) });
  }

  return result;
}
