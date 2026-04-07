/**
 * Rule-based prop-firm mention detection.
 * Scans text from profiles, posts, and websites to identify prop firm mentions.
 */

export interface PropFirmMatch {
  firm: string;
  /** Canonical name used across the system */
  canonical: string;
  /** The matched text fragment */
  matched: string;
}

// Canonical firm names with known aliases and URL patterns
const PROP_FIRMS: { canonical: string; patterns: RegExp[] }[] = [
  {
    canonical: 'FTMO',
    patterns: [/\bftmo\b/i, /ftmo\.com/i],
  },
  {
    canonical: 'MyFundedFX',
    patterns: [/\bmyfundedfx\b/i, /myfundedfx\.com/i, /my\s*funded\s*fx/i],
  },
  {
    canonical: 'The5ers',
    patterns: [/\bthe\s*5\s*ers\b/i, /the5ers\.com/i, /\bthe\s*fivers\b/i],
  },
  {
    canonical: 'FundedNext',
    patterns: [/\bfundednext\b/i, /fundednext\.com/i, /funded\s*next/i],
  },
  {
    canonical: 'TrueForexFunds',
    patterns: [/\btrueforexfunds\b/i, /trueforexfunds\.com/i, /true\s*forex\s*funds/i],
  },
  {
    canonical: 'Topstep',
    patterns: [/\btopstep\b/i, /topstep\.com/i, /topsteptrader/i],
  },
  {
    canonical: 'Apex Trader Funding',
    patterns: [/\bapex\s*trader\s*funding\b/i, /apextraderfunding\.com/i, /\bapex\s*funding\b/i],
  },
  {
    canonical: 'SurgeTrader',
    patterns: [/\bsurgetrader\b/i, /surgetrader\.com/i, /surge\s*trader/i],
  },
  {
    canonical: 'City Traders Imperium',
    patterns: [/\bcity\s*traders?\s*imperium\b/i, /citytradersimperium\.com/i, /\bcti\b/i],
  },
  {
    canonical: 'Funded Trading Plus',
    patterns: [/\bfunded\s*trading\s*plus\b/i, /fundedtradingplus\.com/i],
  },
  {
    canonical: 'Lux Trading Firm',
    patterns: [/\blux\s*trading\s*firm\b/i, /luxtradingfirm\.com/i],
  },
  {
    canonical: 'E8 Funding',
    patterns: [/\be8\s*funding\b/i, /e8funding\.com/i, /\be8\s*markets\b/i],
  },
  {
    canonical: 'BlueBerry Funded',
    patterns: [/\bblueberry\s*funded\b/i, /blueberryfunded\.com/i],
  },
  {
    canonical: 'Alpha Capital Group',
    patterns: [/\balpha\s*capital\s*group\b/i, /alphacapitalgroup\.uk/i],
  },
  {
    canonical: 'Goat Funded Trader',
    patterns: [/\bgoat\s*funded\s*trader\b/i, /goatfundedtrader\.com/i],
  },
];

/**
 * Detect all prop firm mentions in a text.
 */
export function detectPropFirms(text: string): PropFirmMatch[] {
  if (!text) return [];

  const matches: PropFirmMatch[] = [];
  const seen = new Set<string>();

  for (const firm of PROP_FIRMS) {
    for (const pattern of firm.patterns) {
      const match = text.match(pattern);
      if (match && !seen.has(firm.canonical)) {
        seen.add(firm.canonical);
        matches.push({
          firm: firm.canonical,
          canonical: firm.canonical,
          matched: match[0],
        });
        break; // Only first match per firm
      }
    }
  }

  return matches;
}

/**
 * Extract canonical prop firm names from text.
 */
export function extractPropFirmNames(text: string): string[] {
  return detectPropFirms(text).map(m => m.canonical);
}

/**
 * Check if any text mentions a prop firm.
 */
export function mentionsPropFirm(text: string): boolean {
  return detectPropFirms(text).length > 0;
}

/**
 * Detect prop firms across multiple text sources and deduplicate.
 */
export function detectPropFirmsFromSources(...texts: (string | null | undefined)[]): string[] {
  const all = new Set<string>();
  for (const t of texts) {
    if (t) {
      for (const m of detectPropFirms(t)) {
        all.add(m.canonical);
      }
    }
  }
  return [...all];
}
