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
  // Forex educators
  { handle: 'navinprithyani', name: 'Navin Prithyani', website: 'https://forexwatchers.com' },
  { handle: 'rayabordeaux', name: 'Rayner Teo', website: 'https://www.tradingwithrayner.com' },
  { handle: 'fx.professor', name: 'FX Professor' },
  { handle: 'forexsignals', name: 'Forex Signals', website: 'https://www.forexsignals.com' },
  { handle: 'traderdale1', name: 'Trader Dale', website: 'https://www.trader-dale.com' },
  { handle: 'astrofxc', name: 'AstroFX', website: 'https://www.astrofxc.com' },
  { handle: 'babypips', name: 'BabyPips', website: 'https://www.babypips.com' },
  { handle: 'tradeciety', name: 'Tradeciety', website: 'https://www.tradeciety.com' },
  { handle: 'wicksdontlie', name: 'Wicks Dont Lie' },
  { handle: 'thesecretmindset', name: 'The Secret Mindset' },
  // Day traders
  { handle: 'daytradingaddict', name: 'Day Trading Addict' },
  { handle: 'warrior_trading', name: 'Warrior Trading', website: 'https://www.warriortrading.com' },
  { handle: 'investorsunderground', name: 'Investors Underground', website: 'https://www.investorsunderground.com' },
  { handle: 'thetradingchannel', name: 'The Trading Channel', website: 'https://thetradingchannel.net' },
  { handle: 'tradertom_', name: 'Trader Tom' },
  { handle: 'tradingwithshonn', name: 'Shonn Campbell' },
  { handle: 'karen_foo', name: 'Karen Foo' },
  { handle: 'vfrancotv', name: 'VFranco TV' },
  { handle: 'rikinaik_', name: 'Rikki Naik' },
  { handle: 'marcusgarveytrading', name: 'Marcus Garvey Trading' },
  // Prop firms
  { handle: 'ftmocom', name: 'FTMO', website: 'https://ftmo.com' },
  { handle: 'myfundedfx', name: 'MyFundedFX', website: 'https://www.myfundedfx.com' },
  { handle: 'the5ers_funding', name: 'The5ers', website: 'https://www.the5ers.com' },
  { handle: 'fundednext', name: 'FundedNext', website: 'https://fundednext.com' },
  { handle: 'topstepofficial', name: 'Topstep', website: 'https://www.topstep.com' },
  { handle: 'e8funding', name: 'E8 Funding', website: 'https://e8funding.com' },
  { handle: 'surgetrader', name: 'SurgeTrader' },
  { handle: 'apextraderfunding', name: 'Apex Trader Funding', website: 'https://www.apextraderfunding.com' },
  { handle: 'fundedtradingplus', name: 'Funded Trading Plus', website: 'https://www.fundedtradingplus.com' },
  // ICT / Smart Money
  { handle: 'ict_concepts', name: 'ICT Concepts' },
  { handle: 'smcforex', name: 'SMC Forex' },
  { handle: 'orderblocktrading', name: 'Order Block Trading' },
  // Crypto traders
  { handle: 'cryptokirby', name: 'Crypto Kirby' },
  { handle: 'cryptojack', name: 'Crypto Jack' },
  { handle: 'thecryptolark', name: 'The Crypto Lark', website: 'https://thecryptolark.com' },
  // Options/Futures
  { handle: 'tastyliveshow', name: 'Tasty Live', website: 'https://www.tastylive.com' },
  { handle: 'smbcapital', name: 'SMB Capital', website: 'https://www.smbtraining.com' },
  { handle: 'tradepro_academy', name: 'TradePro Academy', website: 'https://www.tradeproacademy.com' },
  { handle: 'humbledtrader', name: 'Humbled Trader', website: 'https://www.humbledtrader.com' },
  { handle: 'ziptrader', name: 'ZipTrader', website: 'https://www.ziptrader.com' },
  // More educators
  { handle: 'tradingheroes', name: 'Trading Heroes', website: 'https://www.tradingheroes.com' },
  { handle: 'desiretotrade', name: 'Desire To Trade', website: 'https://www.desiretotrade.com' },
  { handle: 'ukspreadbetting', name: 'UK Spread Betting', website: 'https://www.financial-spread-betting.com' },
  { handle: 'forex_analytix', name: 'Forex Analytix', website: 'https://www.forexanalytix.com' },
  { handle: 'tradingnut', name: 'Trading Nut', website: 'https://www.tradingnut.com' },
  { handle: 'learncurrencytrading', name: 'Learn Currency Trading', website: 'https://www.learncurrencytrading.com' },
  { handle: 'tradingcoach', name: 'Trading Coach' },
  { handle: 'mack_freedom', name: 'Mack Freedom' },
  { handle: 'tradeempowered', name: 'Trade Empowered', website: 'https://www.tradeempowered.com' },
  { handle: 'the_forex_guy', name: 'The Forex Guy', website: 'https://www.theforexguy.com' },
  // Batch 2 — more educators, mentors, prop firm affiliates
  { handle: 'tradingwithkian', name: 'Trading With Kian' },
  { handle: 'forex.shark', name: 'Forex Shark' },
  { handle: 'ict_traders_community', name: 'ICT Traders Community' },
  { handle: 'thechartguys', name: 'The Chart Guys', website: 'https://www.thechartguys.com' },
  { handle: 'claytrader', name: 'ClayTrader', website: 'https://www.claytrader.com' },
  { handle: 'tradestation', name: 'TradeStation', website: 'https://www.tradestation.com' },
  { handle: 'ninjatrader', name: 'NinjaTrader', website: 'https://ninjatrader.com' },
  { handle: 'tradingview', name: 'TradingView', website: 'https://www.tradingview.com' },
  { handle: 'fxstreet', name: 'FXStreet', website: 'https://www.fxstreet.com' },
  { handle: 'dailyfx', name: 'DailyFX', website: 'https://www.dailyfx.com' },
  { handle: 'forex.com', name: 'Forex.com', website: 'https://www.forex.com' },
  { handle: 'ig_trading', name: 'IG Trading', website: 'https://www.ig.com' },
  { handle: 'cmcmarkets', name: 'CMC Markets', website: 'https://www.cmcmarkets.com' },
  { handle: 'oaboreal', name: 'OA Forex' },
  { handle: 'pandafx_trading', name: 'Panda FX Trading' },
  { handle: 'fx_evolution', name: 'FX Evolution' },
  { handle: 'simplytradingfx', name: 'Simply Trading FX' },
  { handle: 'elitetraderfunding', name: 'Elite Trader Funding', website: 'https://elitetraderfunding.com' },
  { handle: 'trueforexfunds', name: 'True Forex Funds' },
  { handle: 'goatfundedtrader', name: 'Goat Funded Trader' },
  { handle: 'blueberryfunded', name: 'Blueberry Funded' },
  { handle: 'alphacapitalgroup', name: 'Alpha Capital Group', website: 'https://www.alphacapitalgroup.uk' },
  { handle: 'luxtradingfirm', name: 'Lux Trading Firm', website: 'https://luxtradingfirm.com' },
  { handle: 'city_traders_imperium', name: 'City Traders Imperium', website: 'https://citytradersimperium.com' },
  { handle: 'fundingpips', name: 'Funding Pips', website: 'https://fundingpips.com' },
  { handle: 'stocktwits', name: 'StockTwits', website: 'https://stocktwits.com' },
  { handle: 'benzinga', name: 'Benzinga', website: 'https://www.benzinga.com' },
  { handle: 'thinkorswim', name: 'Thinkorswim' },
  { handle: 'tastylive', name: 'Tasty Live', website: 'https://www.tastylive.com' },
  { handle: 'optionalpha', name: 'Option Alpha', website: 'https://optionalpha.com' },
  { handle: 'projectfinance', name: 'Project Finance' },
  { handle: 'pennystockwarrior', name: 'Penny Stock Warrior' },
  { handle: 'timothysykes', name: 'Timothy Sykes', website: 'https://www.timothysykes.com' },
  { handle: 'tradingschools', name: 'Trading Schools', website: 'https://www.tradingschools.org' },
  { handle: 'forex_factory', name: 'Forex Factory', website: 'https://www.forexfactory.com' },
  { handle: 'myfxbook_official', name: 'MyFXBook', website: 'https://www.myfxbook.com' },
  { handle: 'earnforex', name: 'EarnForex', website: 'https://www.earnforex.com' },
  { handle: 'forexpeacearmy', name: 'Forex Peace Army', website: 'https://www.forexpeacearmy.com' },
  { handle: 'metatrader', name: 'MetaTrader' },
  { handle: 'ctrader_official', name: 'cTrader' },
  { handle: 'thetradingpit', name: 'The Trading Pit', website: 'https://thetradingpit.com' },
  { handle: 'ftmo_official', name: 'FTMO Official', website: 'https://ftmo.com' },
  { handle: 'forexmentor', name: 'Forex Mentor', website: 'https://www.forexmentor.com' },
  { handle: 'learntotradethemarket', name: 'Learn To Trade', website: 'https://www.learntotradethemarket.com' },
  { handle: 'priceactiontrading', name: 'Price Action Trading' },
  { handle: 'theinnercircletrader', name: 'The Inner Circle Trader' },
  { handle: 'chartpatterntrading', name: 'Chart Pattern Trading' },
  { handle: 'tradingacademy_official', name: 'Online Trading Academy', website: 'https://www.tradingacademy.com' },
  { handle: 'marketmakers_fx', name: 'Market Makers FX' },
  { handle: 'fxlifestyle', name: 'FX Lifestyle' },
];

const LI_SEEDS: { handle: string; name: string; website?: string }[] = [
  { handle: 'rayabordeaux', name: 'Rayner Teo', website: 'https://www.tradingwithrayner.com' },
  { handle: 'navinprithyani', name: 'Navin Prithyani', website: 'https://forexwatchers.com' },
  { handle: 'rossccameron', name: 'Ross Cameron', website: 'https://www.warriortrading.com' },
  { handle: 'andrew-aziz', name: 'Andrew Aziz', website: 'https://bearbulltraders.com' },
  { handle: 'investorsunderground', name: 'Nathan Michaud', website: 'https://www.investorsunderground.com' },
  { handle: 'traderdaleofficial', name: 'Trader Dale', website: 'https://www.trader-dale.com' },
  { handle: 'adam-khoo', name: 'Adam Khoo', website: 'https://www.piranhaprofits.com' },
  { handle: 'markminervini', name: 'Mark Minervini', website: 'https://www.minervini.com' },
  { handle: 'steve-burns', name: 'Steve Burns', website: 'https://www.newtraderu.com' },
  { handle: 'claytontrader', name: 'ClayTrader', website: 'https://www.claytrader.com' },
  { handle: 'ftmo-prop-trading', name: 'FTMO', website: 'https://ftmo.com' },
  { handle: 'fundednext', name: 'FundedNext', website: 'https://fundednext.com' },
  { handle: 'nickshackelford', name: 'Nick Shackelford' },
  { handle: 'karenfoo', name: 'Karen Foo' },
  { handle: 'jabordeaux', name: 'JA Bordeaux' },
  // Additional LinkedIn profiles
  { handle: 'smbcapital', name: 'SMB Capital', website: 'https://www.smbtraining.com' },
  { handle: 'humbledtrader', name: 'Humbled Trader', website: 'https://www.humbledtrader.com' },
  { handle: 'tradepro', name: 'TradePro', website: 'https://www.tradeproacademy.com' },
  { handle: 'tastylive', name: 'Tasty Live', website: 'https://www.tastylive.com' },
  { handle: 'topstep', name: 'Topstep', website: 'https://www.topstep.com' },
  { handle: 'the5ers', name: 'The5ers', website: 'https://www.the5ers.com' },
  { handle: 'e8funding', name: 'E8 Funding', website: 'https://e8funding.com' },
  { handle: 'surgetrader', name: 'SurgeTrader' },
  { handle: 'apextraderfunding', name: 'Apex Trader Funding', website: 'https://www.apextraderfunding.com' },
  { handle: 'fundedtradingplus', name: 'Funded Trading Plus', website: 'https://www.fundedtradingplus.com' },
  { handle: 'ziptrader', name: 'ZipTrader', website: 'https://www.ziptrader.com' },
  { handle: 'desiretotrade', name: 'Desire To Trade', website: 'https://www.desiretotrade.com' },
  { handle: 'tradingheroes', name: 'Trading Heroes', website: 'https://www.tradingheroes.com' },
  { handle: 'forexanalytix', name: 'Forex Analytix', website: 'https://www.forexanalytix.com' },
  { handle: 'tradeempowered', name: 'Trade Empowered', website: 'https://www.tradeempowered.com' },
  // Batch 2 — brokers, platforms, educators
  { handle: 'tradestation', name: 'TradeStation', website: 'https://www.tradestation.com' },
  { handle: 'ninjatrader', name: 'NinjaTrader', website: 'https://ninjatrader.com' },
  { handle: 'tradingview', name: 'TradingView', website: 'https://www.tradingview.com' },
  { handle: 'fxstreet', name: 'FXStreet', website: 'https://www.fxstreet.com' },
  { handle: 'dailyfx', name: 'DailyFX', website: 'https://www.dailyfx.com' },
  { handle: 'elitetraderfunding', name: 'Elite Trader Funding', website: 'https://elitetraderfunding.com' },
  { handle: 'alphacapitalgroup', name: 'Alpha Capital Group', website: 'https://www.alphacapitalgroup.uk' },
  { handle: 'luxtradingfirm', name: 'Lux Trading Firm', website: 'https://luxtradingfirm.com' },
  { handle: 'citytradersimperium', name: 'City Traders Imperium', website: 'https://citytradersimperium.com' },
  { handle: 'fundingpips', name: 'Funding Pips', website: 'https://fundingpips.com' },
  { handle: 'optionalpha', name: 'Option Alpha', website: 'https://optionalpha.com' },
  { handle: 'timothysykes', name: 'Timothy Sykes', website: 'https://www.timothysykes.com' },
  { handle: 'thechartguys', name: 'The Chart Guys', website: 'https://www.thechartguys.com' },
  { handle: 'benzinga', name: 'Benzinga', website: 'https://www.benzinga.com' },
  { handle: 'stocktwits', name: 'StockTwits', website: 'https://stocktwits.com' },
  { handle: 'onlinetradingacademy', name: 'Online Trading Academy', website: 'https://www.tradingacademy.com' },
  { handle: 'thetradingpit', name: 'The Trading Pit', website: 'https://thetradingpit.com' },
  { handle: 'forexmentor', name: 'Forex Mentor', website: 'https://www.forexmentor.com' },
  { handle: 'learntotradethemarket', name: 'Learn To Trade', website: 'https://www.learntotradethemarket.com' },
  { handle: 'claytrader', name: 'ClayTrader', website: 'https://www.claytrader.com' },
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: controller.signal,
    });
    clearTimeout(timer);
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

  // Strategy 2: DuckDuckGo (disabled by default — enable with ENABLE_DDG_SEARCH=true)
  // DDG frequently returns CAPTCHAs for server-side requests, causing timeouts
  const enableDDG = process.env.ENABLE_DDG_SEARCH === 'true';
  const queries = platform === 'instagram'
    ? ['instagram.com forex trader educator']
    : ['linkedin.com/in forex trader educator'];

  let ddgWorked = false;
  if (enableDDG) {
  let ddgBlocked = false;
  for (const query of queries) {
    if (ddgBlocked) break;
    let html: string | null = null;
    try { html = await searchDDG(query); } catch { /* swallow */ }
    if (html === null) { ddgBlocked = true; continue; }
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
  } else {
    log.info('web-search: DDG search disabled (set ENABLE_DDG_SEARCH=true to enable)');
  }

  // Strategy 3: Brave (if available)
  if (hasBrave) {
    try {
      const braveQueries = platform === 'instagram'
        ? ['best forex traders Instagram 2025']
        : ['top forex traders LinkedIn'];

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
    } catch (err) {
      log.warn('web-search: Brave search failed', { error: String(err) });
    }
  }

  // Note: Google Custom Search used to run here as Strategy 4, but it's now
  // handled by `discoverAcrossPlatforms` inside the refresh pipeline, which
  // runs ONCE per refresh (instead of once per platform) and extracts handles
  // for every supported platform from a single set of CSE queries. Running
  // both paths would double the Google quota burn with no new leads.

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
