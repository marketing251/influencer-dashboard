/**
 * Prop firm classifier — determines if a lead IS a prop firm (vs someone who
 * merely discusses, reviews, or affiliates prop firms).
 *
 * Purpose: We sell white-label prop firm products. Actual prop firms are NOT
 * sales leads — educators, influencers, affiliates, and community owners ARE.
 */

import { log } from './logger';

export interface PropFirmClassification {
  is_prop_firm: boolean;
  confidence: number;      // 0-100
  reasons: string[];
}

// Known prop firm brand names — if the lead's name/slug IS one of these, it's a firm
const KNOWN_FIRMS = [
  'ftmo', 'myfundedfx', 'the5ers', 'fundednext', 'topstep',
  'apex trader funding', 'surgetrader', 'e8 funding', 'e8funding',
  'funded trading plus', 'alpha capital group', 'lux trading firm',
  'city traders imperium', 'funding pips', 'fundingpips',
  'elite trader funding', 'goat funded trader', 'blueberry funded',
  'true forex funds', 'the trading pit', 'bulenox', 'uprofit',
  'earn2trade', 'oneup trader', 'tradeday', 'maven trading',
];

// URL patterns that indicate the entity IS a prop firm
const FIRM_DOMAINS = [
  'ftmo.com', 'myfundedfx.com', 'the5ers.com', 'fundednext.com',
  'topstep.com', 'apextraderfunding.com', 'surgetrader.com',
  'e8funding.com', 'fundedtradingplus.com', 'alphacapitalgroup.uk',
  'luxtradingfirm.com', 'citytradersimperium.com', 'fundingpips.com',
  'elitetraderfunding.com', 'goatfundedtrader.com', 'blueberryfunded.com',
  'trueforexfunds.com', 'thetradingpit.com',
];

// Phrases that strongly indicate the entity SELLS funded accounts (not just discusses them)
const FIRM_SELLING_SIGNALS = [
  /\b(?:buy|purchase|start)\s+(?:a\s+)?challenge\b/i,
  /\bchallenge\s+(?:pricing|fee|cost)\b/i,
  /\bevaluation\s+(?:program|phase|account)\b/i,
  /\bget\s+funded\s+(?:today|now|instantly)\b/i,
  /\btrade\s+our\s+capital\b/i,
  /\bfunding\s+(?:program|solution|platform)\b/i,
  /\bprofit\s+split\s+(?:up\s+to\s+)?\d/i,
  /\baccount\s+sizes?\s+(?:up\s+to\s+)?\$?\d/i,
  /\binstant\s+funding\b/i,
  /\bscaling\s+plan\b/i,
  /\bsimulated\s+(?:funding|trading|capital)\b/i,
  /\bprop\s+(?:trading\s+)?firm\b/i,
];

/**
 * Classify whether a lead IS a prop firm.
 *
 * Uses a point system:
 * - Name matches known firm:      +60 (very strong)
 * - Website matches known domain: +50 (very strong)
 * - Name contains "funded" as a noun: +20
 * - Selling signals in bio/desc:  +15 each (max 45)
 *
 * Threshold: >= 50 = classified as prop firm
 *
 * NOTE: Leads that MENTION prop firms (educators, reviewers, affiliates) should
 * NOT trigger this. The signals specifically look for the entity being a firm.
 */
export function classifyPropFirm(input: {
  name: string;
  slug?: string | null;
  website?: string | null;
  bio?: string | null;
}): PropFirmClassification {
  let score = 0;
  const reasons: string[] = [];
  const nameLower = (input.name ?? '').toLowerCase();
  const slugLower = (input.slug ?? '').toLowerCase();
  const websiteLower = (input.website ?? '').toLowerCase();
  const bioLower = (input.bio ?? '').toLowerCase();

  // Check 1: Name matches a known prop firm
  for (const firm of KNOWN_FIRMS) {
    const normalized = firm.replace(/\s+/g, '');
    if (nameLower.includes(normalized) || slugLower.includes(normalized) || nameLower.includes(firm)) {
      score += 60;
      reasons.push(`Name matches known firm: ${firm}`);
      break;
    }
  }

  // Check 2: Website is a known firm domain
  for (const domain of FIRM_DOMAINS) {
    if (websiteLower.includes(domain)) {
      score += 50;
      reasons.push(`Website is known firm: ${domain}`);
      break;
    }
  }

  // Check 3: Name itself suggests being a funded-account provider
  if (/\bfunded\b/i.test(nameLower) && !/\bfunded\s+trader\s+(?:result|review|journey|lifestyle)/i.test(nameLower)) {
    // "Funded Trading Plus" = firm. "Funded Trader Results" = educator.
    if (/funding|funded\s+(?:trading|account|program|next)/i.test(nameLower)) {
      score += 20;
      reasons.push('Name suggests funding provider');
    }
  }

  // Check 4: Bio/description contains selling signals
  let sellingMatches = 0;
  for (const pattern of FIRM_SELLING_SIGNALS) {
    if (pattern.test(bioLower)) {
      sellingMatches++;
      if (sellingMatches <= 3) reasons.push(`Bio matches: ${pattern.source.slice(0, 40)}`);
    }
  }
  score += Math.min(sellingMatches * 15, 45);

  const is_prop_firm = score >= 50;
  const confidence = Math.min(score, 100);

  if (is_prop_firm) {
    log.debug('prop-firm-classifier: excluded', { name: input.name, confidence, reasons });
  }

  return { is_prop_firm, confidence, reasons };
}

/**
 * Quick check for known firm names — used in pipeline for fast rejection.
 */
export function isKnownPropFirm(name: string, slug?: string | null, website?: string | null): boolean {
  return classifyPropFirm({ name, slug, website }).is_prop_firm;
}
