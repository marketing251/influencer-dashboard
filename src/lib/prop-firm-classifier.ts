/**
 * Prop firm classifier — determines if a lead IS a prop firm.
 *
 * We sell white-label prop firm products. Actual prop firms are NOT leads.
 * Educators, influencers, affiliates, reviewers, and communities ARE leads.
 *
 * Key principle: someone who DISCUSSES, REVIEWS, or AFFILIATES prop firms
 * is a valid lead. Only entities that OPERATE a prop firm are excluded.
 */

import { log } from './logger';

export interface PropFirmClassification {
  is_prop_firm: boolean;
  confidence: number;
  reasons: string[];
}

// ─── Known prop firm EXACT brand names ──────────────────────────────
// These are the official operating names of prop trading firms.
// A lead whose name matches one of these (exactly or as a substring) is excluded.
const KNOWN_FIRM_NAMES = [
  'ftmo', 'myfundedfx', 'the5ers', 'fundednext', 'topstep',
  'apex trader funding', 'surgetrader', 'e8 funding', 'e8funding',
  'funded trading plus', 'alpha capital group', 'lux trading firm',
  'city traders imperium', 'funding pips', 'fundingpips',
  'elite trader funding', 'goat funded trader', 'blueberry funded',
  'true forex funds', 'the trading pit', 'bulenox', 'uprofit',
  'earn2trade', 'oneup trader', 'tradeday', 'maven trading',
  'the funded trader', 'thefundedtrader', 'fundedtrader',
  'funded trader markets',
];

// ─── Known prop firm domains ────────────────────────────────────────
const FIRM_DOMAINS = [
  'ftmo.com', 'myfundedfx.com', 'the5ers.com', 'fundednext.com',
  'topstep.com', 'apextraderfunding.com', 'surgetrader.com',
  'e8funding.com', 'fundedtradingplus.com', 'alphacapitalgroup.uk',
  'luxtradingfirm.com', 'citytradersimperium.com', 'fundingpips.com',
  'elitetraderfunding.com', 'goatfundedtrader.com', 'blueberryfunded.com',
  'trueforexfunds.com', 'thetradingpit.com', 'thefundedtrader.com',
];

// ─── Names/keywords that prove someone is NOT a prop firm ───────────
// If any of these appear in the name, the lead is likely an educator/reviewer.
const SAFE_SIGNALS = [
  /\breview/i, /\breviews/i, /\breviewer/i,
  /\beducat/i, /\bmentor/i, /\bcoach/i, /\bteach/i,
  /\bcourse/i, /\bacademy/i, /\btraining/i,
  /\baffiliat/i, /\bpartner/i,
  /\bcommunity/i, /\bdiscord/i, /\btelegram/i,
  /\bsignal/i, /\balert/i,
  /\byoutube/i, /\bchannel/i, /\bpodcast/i,
  /\bblog/i, /\bmedia/i, /\bnews/i,
  /\bkid\b/i, /\bguy\b/i, /\blife/i,
  /\bjourney/i, /\bresult/i, /\bproof/i,
  /\bpassi?ng\b/i, // "passing strategy" = educator
  /\bSMB Capital/i, // trading education firm, not a prop firm
];

/**
 * Classify whether a lead IS a prop firm.
 *
 * Logic:
 * 1. If name contains a safe signal (review, educator, mentor, etc.) → NOT a firm
 * 2. If name exactly matches a known firm brand → IS a firm (+80)
 * 3. If website matches a firm domain → IS a firm (+70)
 * 4. Threshold: >= 60 = excluded
 *
 * This is deliberately conservative — we'd rather keep a questionable lead
 * than accidentally exclude an educator who's a valid prospect.
 */
export function classifyPropFirm(input: {
  name: string;
  slug?: string | null;
  website?: string | null;
  bio?: string | null;
}): PropFirmClassification {
  let score = 0;
  const reasons: string[] = [];
  const nameLower = (input.name ?? '').toLowerCase().trim();
  const slugLower = (input.slug ?? '').toLowerCase().trim();
  const websiteLower = (input.website ?? '').toLowerCase().trim();
  const combined = `${nameLower} ${slugLower}`;

  // SAFETY CHECK: if the name contains safe signals, it's likely an educator/reviewer
  for (const pattern of SAFE_SIGNALS) {
    if (pattern.test(nameLower)) {
      // Don't exclude this lead — they discuss firms, they're not a firm
      return { is_prop_firm: false, confidence: 0, reasons: ['Safe signal in name: ' + pattern.source] };
    }
  }

  // Check 1: Name is a known firm brand
  for (const firm of KNOWN_FIRM_NAMES) {
    const normalized = firm.replace(/\s+/g, '');
    // Exact match or starts with the firm name (catches "FTMO" but not "FTMOChallengeTips")
    if (
      nameLower === firm || nameLower === normalized ||
      slugLower === firm || slugLower === normalized ||
      // The name IS the firm (not just mentions it)
      nameLower.startsWith(firm + ' ') || nameLower.startsWith(normalized) && nameLower.length < normalized.length + 15
    ) {
      score += 80;
      reasons.push(`Name matches firm: ${firm}`);
      break;
    }
  }

  // Check 2: Website is a known firm domain
  if (websiteLower) {
    for (const domain of FIRM_DOMAINS) {
      if (websiteLower.includes(domain)) {
        score += 70;
        reasons.push(`Website is firm domain: ${domain}`);
        break;
      }
    }
  }

  const is_prop_firm = score >= 60;
  const confidence = Math.min(score, 100);

  if (is_prop_firm) {
    log.debug('prop-firm-classifier: excluded', { name: input.name, confidence, reasons });
  }

  return { is_prop_firm, confidence, reasons };
}

/**
 * Quick boolean check.
 */
export function isKnownPropFirm(name: string, slug?: string | null, website?: string | null): boolean {
  return classifyPropFirm({ name, slug, website }).is_prop_firm;
}
