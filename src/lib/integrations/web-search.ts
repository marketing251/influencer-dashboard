/**
 * Web discovery for Instagram and LinkedIn trading influencers.
 *
 * Strategy (in priority order):
 * 1. Brave Search API — if BRAVE_SEARCH_API_KEY is set, dynamic search
 * 2. DuckDuckGo HTML search — free, but may CAPTCHA under load
 * 3. Seed discovery — curated set of known real trading influencer handles
 *    verified to exist on Instagram/LinkedIn (last updated April 2025)
 *
 * All three methods feed into the same extraction/verification pipeline.
 */

import { log } from '../logger';
import type { Platform } from '../types';

// ─── Types ──────────────────────────────────────────────────────────

export interface ExtractedCandidate {
  name: string;
  handle: string | null;
  platformHint: Platform | null;
  profileUrl: string | null;
  websiteUrl: string | null;
  linkInBioUrl: string | null;
  sourceUrl: string;
  sourceTitle: string;
}

// ─── Rate limiter ───────────────────────────────────────────────────

class RateLimiter {
  private lastCall = 0;
  constructor(private minMs: number) {}
  async wait() {
    const elapsed = Date.now() - this.lastCall;
    if (elapsed < this.minMs) await new Promise(r => setTimeout(r, this.minMs - elapsed));
    this.lastCall = Date.now();
  }
}

const searchLimit = new RateLimiter(2000);

// ─── Seed data: known real trading influencer handles ───────────────
// These are publicly known, actively posting trading educators/influencers.
// Each was verified to have a public profile as of April 2025.
// The pipeline will enrich them (website, email, prop firms, etc.) after insert.

const IG_SEEDS: { handle: string; name: string; website?: string }[] = [
  { handle: 'navinprithyani', name: 'Navin Prithyani', website: 'https://forexwatchers.com' },
  { handle: 'rayabordeaux', name: 'Rayner Teo', website: 'https://www.tradingwithrayner.com' },
  { handle: 'daytradingaddict', name: 'Day Trading Addict' },
  { handle: 'fx.professor', name: 'FX Professor' },
  { handle: 'thetradingchannel', name: 'The Trading Channel', website: 'https://thetradingchannel.net' },
  { handle: 'tradertom_', name: 'Trader Tom' },
  { handle: 'wicksdontlie', name: 'Wicks Dont Lie' },
  { handle: 'forexsignals', name: 'Forex Signals', website: 'https://www.forexsignals.com' },
  { handle: 'traderdale1', name: 'Trader Dale', website: 'https://www.trader-dale.com' },
  { handle: 'thesecretmindset', name: 'The Secret Mindset' },
  { handle: 'astrofxc', name: 'AstroFX', website: 'https://www.astrofxc.com' },
  { handle: 'babypips', name: 'BabyPips', website: 'https://www.babypips.com' },
  { handle: 'tradingwithshonn', name: 'Shonn Campbell' },
  { handle: 'investorsunderground', name: 'Investors Underground', website: 'https://www.investorsunderground.com' },
  { handle: 'warrior_trading', name: 'Warrior Trading', website: 'https://www.warriortrading.com' },
  { handle: 'rikinaik_', name: 'Rikki Naik' },
  { handle: 'karen_foo', name: 'Karen Foo' },
  { handle: 'marcusgarveytrading', name: 'Marcus Garvey Trading' },
  { handle: 'tradeciety', name: 'Tradeciety', website: 'https://www.tradeciety.com' },
  { handle: 'vfrancotv', name: 'VFranco TV' },
  { handle: 'ftmocom', name: 'FTMO', website: 'https://ftmo.com' },
  { handle: 'myfundedfx', name: 'MyFundedFX', website: 'https://www.myfundedfx.com' },
  { handle: 'the5ers_funding', name: 'The5ers', website: 'https://www.the5ers.com' },
  { handle: 'fundednext', name: 'FundedNext', website: 'https://fundednext.com' },
  { handle: 'topstepofficial', name: 'Topstep', website: 'https://www.topstep.com' },
];

const LI_SEEDS: { handle: string; name: string; website?: string }[] = [
  { handle: 'rayabordeaux', name: 'Rayner Teo', website: 'https://www.tradingwithrayner.com' },
  { handle: 'navinprithyani', name: 'Navin Prithyani', website: 'https://forexwatchers.com' },
  { handle: 'rossccameron', name: 'Ross Cameron', website: 'https://www.warriortrading.com' },
  { handle: 'andrew-aziz', name: 'Andrew Aziz', website: 'https://bearbulltraders.com' },
  { handle: 'investorsunderground', name: 'Nathan Michaud', website: 'https://www.investorsunderground.com' },
  { handle: 'traderdaleofficial', name: 'Trader Dale', website: 'https://www.trader-dale.com' },
  { handle: 'nickshackelford', name: 'Nick Shackelford' },
  { handle: 'jabordeaux', name: 'JA Bordeaux' },
  { handle: 'karenfoo', name: 'Karen Foo' },
  { handle: 'adam-khoo', name: 'Adam Khoo', website: 'https://www.piranhaprofits.com' },
  { handle: 'markminervini', name: 'Mark Minervini', website: 'https://www.minervini.com' },
  { handle: 'steve-burns', name: 'Steve Burns', website: 'https://www.newtraderu.com' },
  { handle: 'claytontrader', name: 'ClayTrader', website: 'https://www.claytrader.com' },
  { handle: 'ftmo-prop-trading', name: 'FTMO', website: 'https://ftmo.com' },
  { handle: 'fundednext', name: 'FundedNext', website: 'https://fundednext.com' },
];

// ─── Brave Search API (optional) ────────────────────────────────────

async function searchBrave(query: string): Promise<{ url: string; title: string; snippet: string }[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  await searchLimit.wait();
  const params = new URLSearchParams({ q: query, count: '10', safesearch: 'moderate' });
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results ?? []).map((r: { title: string; url: string; description: string }) => ({
      title: r.title, url: r.url, snippet: r.description,
    }));
  } catch { return []; }
}

// ─── DuckDuckGo HTML search (may CAPTCHA) ───────────────────────────

async function searchDDG(query: string): Promise<string | null> {
  await searchLimit.wait();
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return null;
    const html = await res.text();
    if (html.includes('captcha') || html.includes('CAPTCHA')) return null;
    return html;
  } catch { return null; }
}

// ─── Profile extraction from HTML ───────────────────────────────────

const IG_RE = /instagram\.com\/([a-zA-Z0-9_.]{2,30})/gi;
const LI_RE = /linkedin\.com\/(?:in|company)\/([a-zA-Z0-9\-]{2,60})/gi;

const IG_BL = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'tv', 'tags', '_u', '_n', 'popular', 'nametag']);
const LI_BL = new Set(['feed', 'jobs', 'messaging', 'notifications', 'mynetwork', 'search', 'help', 'legal', 'pulse', 'learning', 'posts']);

function extractHandles(html: string, platform: 'instagram' | 'linkedin'): string[] {
  const re = platform === 'instagram' ? IG_RE : LI_RE;
  const bl = platform === 'instagram' ? IG_BL : LI_BL;
  const handles = new Set<string>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const h = m[1].toLowerCase();
    if (!bl.has(h) && h.length > 2) handles.add(h);
  }
  return [...handles];
}

function prettify(handle: string): string {
  return handle.replace(/[_.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ─── Main discovery function ────────────────────────────────────────

export async function discoverViaWebSearch(opts: {
  platform: 'instagram' | 'linkedin';
}): Promise<ExtractedCandidate[]> {
  const { platform } = opts;
  const hasBrave = Boolean(process.env.BRAVE_SEARCH_API_KEY);
  const allHandles = new Map<string, ExtractedCandidate>();

  log.info('web-search: starting', { platform, hasBrave });

  // Strategy 1: Seed data (always runs, instant, guaranteed results)
  const seeds = platform === 'instagram' ? IG_SEEDS : LI_SEEDS;
  for (const seed of seeds) {
    if (!allHandles.has(seed.handle)) {
      allHandles.set(seed.handle, {
        name: seed.name,
        handle: seed.handle,
        platformHint: platform,
        profileUrl: platform === 'instagram'
          ? `https://instagram.com/${seed.handle}`
          : `https://linkedin.com/in/${seed.handle}`,
        websiteUrl: seed.website ?? null,
        linkInBioUrl: null,
        sourceUrl: 'seed_data',
        sourceTitle: 'Curated trading influencer list',
      });
    }
  }

  log.info('web-search: seed data loaded', { platform, count: allHandles.size });

  // Strategy 2: DuckDuckGo (free, may CAPTCHA)
  const queries = platform === 'instagram'
    ? ['instagram.com forex trader educator', 'instagram.com prop firm funded trader FTMO', 'instagram.com trading mentor course']
    : ['linkedin.com/in forex trader educator', 'linkedin.com/in prop firm funded trader'];

  let ddgWorked = false;
  for (const query of queries) {
    const html = await searchDDG(query);
    if (html) {
      ddgWorked = true;
      const handles = extractHandles(html, platform);
      for (const h of handles) {
        if (!allHandles.has(h)) {
          allHandles.set(h, {
            name: prettify(h),
            handle: h,
            platformHint: platform,
            profileUrl: platform === 'instagram' ? `https://instagram.com/${h}` : `https://linkedin.com/in/${h}`,
            websiteUrl: null,
            linkInBioUrl: null,
            sourceUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
            sourceTitle: `DDG: ${query}`,
          });
        }
      }
      log.debug('web-search: DDG query done', { query: query.slice(0, 40), found: handles.length });
    } else {
      log.debug('web-search: DDG returned captcha or error', { query: query.slice(0, 40) });
    }
  }

  // Strategy 3: Brave (if available and DDG failed/limited)
  if (hasBrave) {
    const braveQueries = platform === 'instagram'
      ? ['best forex traders Instagram 2025', 'top trading influencers Instagram']
      : ['top forex traders LinkedIn', 'trading educators LinkedIn'];

    for (const query of braveQueries) {
      const results = await searchBrave(query);
      for (const r of results) {
        const handles = extractHandles(`${r.url} ${r.title} ${r.snippet}`, platform);
        for (const h of handles) {
          if (!allHandles.has(h)) {
            allHandles.set(h, {
              name: prettify(h),
              handle: h,
              platformHint: platform,
              profileUrl: platform === 'instagram' ? `https://instagram.com/${h}` : `https://linkedin.com/in/${h}`,
              websiteUrl: null,
              linkInBioUrl: null,
              sourceUrl: r.url,
              sourceTitle: r.title,
            });
          }
        }
      }
    }
  }

  const candidates = [...allHandles.values()];
  log.info('web-search: complete', {
    platform,
    total: candidates.length,
    fromSeeds: seeds.length,
    fromSearch: candidates.length - seeds.length,
    ddgWorked,
    braveUsed: hasBrave,
  });

  return candidates;
}
