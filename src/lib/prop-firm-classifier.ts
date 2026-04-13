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
import { supabaseAdmin, isSupabaseConfigured } from './db';

export interface PropFirmClassification {
  is_prop_firm: boolean;
  confidence: number;
  reasons: string[];
}

// ─── Known prop firm EXACT brand names ──────────────────────────────
// These are the official operating names of prop trading firms.
// A lead whose name matches one of these (exactly or as a substring) is excluded.
export const KNOWN_FIRM_NAMES = [
  'ftmo', 'myfundedfx', 'my funded fx', 'the5ers', 'the 5ers', 'fundednext', 'funded next',
  'topstep', 'topsteptrader', 'apex trader funding', 'apex funding', 'surgetrader', 'surge trader',
  'e8 funding', 'e8funding', 'e8 markets', 'e8markets', 'funded trading plus',
  'alpha capital group', 'lux trading firm', 'city traders imperium',
  'funding pips', 'fundingpips', 'elite trader funding', 'goat funded trader',
  'blueberry funded', 'true forex funds', 'trueforexfunds', 'the trading pit',
  'bulenox', 'uprofit', 'earn2trade', 'oneup trader', 'tradeday', 'maven trading',
  'the funded trader', 'thefundedtrader', 'fundedtrader', 'funded trader markets',
  'my forex funds', 'myforexfunds', 'ftff', 'audacity capital',
  'smart prop trader', 'smartproptrader', 'fund your fx', 'fundyourfx',
  'forex capital funds', 'skilled funded trader', 'instant funding',
  'breakout prop', 'breakoutprop', 'prop number one', '3task trader',
  'for traders', 'fortraders', 'take profit trader', 'takeprofittrader',
  'aqua funded', 'aquafunded', 'ff traders', 'fftraders',
  'maven trading', 'hola prime', 'fxify', 'fx2funding', 'sabio trading',
];

// ─── Known prop firm domains ────────────────────────────────────────
export const FIRM_DOMAINS = [
  'ftmo.com', 'myfundedfx.com', 'the5ers.com', 'fundednext.com',
  'topstep.com', 'apextraderfunding.com', 'surgetrader.com',
  'e8funding.com', 'e8markets.com', 'fundedtradingplus.com', 'alphacapitalgroup.uk',
  'luxtradingfirm.com', 'citytradersimperium.com', 'fundingpips.com',
  'elitetraderfunding.com', 'goatfundedtrader.com', 'blueberryfunded.com',
  'trueforexfunds.com', 'thetradingpit.com', 'thefundedtrader.com',
  'myforexfunds.com', 'ftff.com', 'audacitycapital.co.uk',
  'smartproptrader.com', 'fundyourfx.com', 'forexcapitalfunds.com',
  'breakoutprop.com', 'propnumberone.com', 'fortraders.com',
  'takeprofittrader.com', 'aquafunded.com', 'fftraders.com',
  'holaprime.com', 'fxify.com', 'fx2funding.com', 'sabiotrading.com',
  'bulenox.com', 'uprofit.com', 'earn2trade.com', 'oneuptrader.com',
  'tradeday.com', 'maventrading.com',
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
    if (
      nameLower === firm || nameLower === normalized ||
      slugLower === firm || slugLower === normalized ||
      nameLower.startsWith(firm + ' ') ||
      (nameLower.startsWith(normalized) && nameLower.length < normalized.length + 15)
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

  // Check 3: Name looks like a company, not an individual creator.
  // Catches brokerages, platforms, news sites, and generic companies that
  // aren't in the prop-firm denylist but are still not outreach targets.
  // Only fires when the safe-signals check above didn't already clear them.
  if (score < 60) {
    const companyPatterns = [
      /\b(?:ltd|inc|llc|corp|limited|plc|gmbh|s\.?a\.?)\b/i,
      /\b(?:brokerage|broker|exchange|securities)\b/i,
      /\b(?:platform|software|technology|solutions|fintech)\b/i,
      /\b(?:trading\s+ltd|trading\s+limited|trading\s+inc)\b/i,
    ];
    for (const pattern of companyPatterns) {
      if (pattern.test(nameLower)) {
        score += 65;
        reasons.push(`Name matches company pattern: ${pattern.source}`);
        break;
      }
    }
  }

  // Check 4: Known non-creator companies (brokerages, platforms, news sites)
  // that frequently appear in trading searches but are not outreach targets.
  if (score < 60) {
    const knownCompanies = [
      'tradestation', 'ninjatrader', 'tradingview', 'metatrader', 'ctrader',
      'forex.com', 'ig trading', 'ig markets', 'cmc markets', 'oanda', 'pepperstone',
      'ic markets', 'fxcm', 'saxo bank', 'interactive brokers', 'td ameritrade',
      'charles schwab', 'etrade', 'robinhood', 'webull', 'thinkorswim',
      'benzinga', 'investopedia', 'dailyfx', 'fxstreet', 'forex factory',
      'myfxbook', 'babypips', 'stocktwits', 'seeking alpha', 'motley fool',
      'bloomberg', 'reuters', 'cnbc', 'yahoo finance',
      'grok', // X AI assistant, not a trading creator
    ];
    for (const company of knownCompanies) {
      if (nameLower === company || nameLower === company.replace(/\s+/g, '') ||
          slugLower === company || slugLower === company.replace(/\s+/g, '')) {
        score += 65;
        reasons.push(`Known non-creator company: ${company}`);
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

/**
 * Back-fill `excluded_from_leads = true` on any existing rows that match
 * the denylist. Runs once per refresh.
 *
 * Optimized: instead of 120 individual `.ilike()` UPDATE queries (each a
 * full table scan), loads all non-excluded creators in one query, checks
 * names/domains in app logic, then batch-updates by ID. Reduces DB round
 * trips from ~120 to 2 (1 SELECT + 1 UPDATE).
 *
 * Returns the number of rows updated.
 */
export async function backfillPropFirmExclusion(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  // Step 1: Load all non-excluded creators (compact: only id, name, website)
  const PAGE = 1000;
  const toExclude: string[] = [];
  let offset = 0;

  while (true) {
    try {
      const { data } = await supabaseAdmin
        .from('creators')
        .select('id, name, website')
        .neq('excluded_from_leads', true)
        .range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;

      // Step 2: Check each creator against denylist in app logic (fast, in-memory)
      for (const row of data) {
        const nameLower = (row.name ?? '').toLowerCase().trim();
        const nameNorm = nameLower.replace(/\s+/g, '');

        let matched = false;
        for (const firm of KNOWN_FIRM_NAMES) {
          const firmNorm = firm.replace(/\s+/g, '');
          if (nameLower === firm || nameNorm === firmNorm ||
              nameLower.startsWith(firm + ' ') ||
              (nameNorm.startsWith(firmNorm) && nameNorm.length < firmNorm.length + 15)) {
            matched = true;
            break;
          }
        }

        if (!matched && row.website) {
          const websiteLower = row.website.toLowerCase();
          for (const domain of FIRM_DOMAINS) {
            if (websiteLower.includes(domain)) {
              matched = true;
              break;
            }
          }
        }

        if (matched) toExclude.push(row.id);
      }

      if (data.length < PAGE) break;
      offset += PAGE;
    } catch { break; }
  }

  // Step 3: Single batch UPDATE by IDs
  if (toExclude.length > 0) {
    try {
      for (let i = 0; i < toExclude.length; i += 200) {
        const chunk = toExclude.slice(i, i + 200);
        await supabaseAdmin
          .from('creators')
          .update({ excluded_from_leads: true, is_prop_firm: true })
          .in('id', chunk);
      }
    } catch (err) {
      log.warn('prop-firm: batch update failed', { error: String(err) });
    }
    log.info('prop-firm: backfill excluded rows', { total: toExclude.length });
  }
  return toExclude.length;
}
