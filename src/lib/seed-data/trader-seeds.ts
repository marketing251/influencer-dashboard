/**
 * Curated seed list of trading educators / influencers.
 *
 * Used by the /api/seed-traders endpoint to bulk-import handpicked
 * leads into the creators table. Each gets fast-enriched (website →
 * email/phone/contact form + social links) before upsert, so the
 * import preserves dedup semantics and surfaces contact info.
 *
 * Lists are split by primary platform signal:
 *   TRADER_SEEDS      — IG/handle style (most with websites)
 *   YOUTUBE_SEEDS     — confirmed YouTube channels with metadata
 *
 * Re-running the importer is safe — upsertCreator dedupes by
 * (platform, platform_id), (platform, handle), domain, and email.
 * Second runs will update existing creators with fresher enrichment.
 */

import type { Platform } from '../types';

export interface TraderSeed {
  handle: string;
  platform: Platform;
  website: string | null;
  niche: string;
  name?: string;
}

export interface YoutubeSeed {
  channelId: string;
  channelUrl: string;
  name: string;
  subscribers: number;
  country: string | null;
  email: string | null;
  niche: string;
  lastUpload?: string;
}

// ─── IG / handle-style trader seeds ─────────────────────────────────

export const TRADER_SEEDS: TraderSeed[] = [
  { handle: 'akilstokesrtm', platform: 'instagram', website: 'https://tier1trading.com', niche: 'Forex education, price action, prop firm trading' },
  { handle: 'asiaforexmentor', platform: 'instagram', website: 'https://asiaforexmentor.com', niche: 'Forex mentoring, institutional concepts, swing trading' },
  { handle: 'callistofx', platform: 'instagram', website: 'https://callistofx.com', niche: 'Forex, smart money concepts, prop firm challenges' },
  { handle: 'thetradinggeek', platform: 'instagram', website: 'https://thetradinggeek.net', niche: 'Forex, indices, scalping education' },
  { handle: 'bearbulltraders', platform: 'instagram', website: 'https://bearbulltraders.com', niche: 'Day trading education, stocks & forex, prop-style strategies' },
  { handle: 'nicksyiek', platform: 'instagram', website: 'https://thea1trades.com', niche: 'Forex & indices, prop firm trading, mentorship' },
  { handle: 'ezekielchew', platform: 'instagram', website: 'https://asiaforexmentor.com', niche: 'Forex coaching, trend trading, institutional style', name: 'Ezekiel Chew' },
  { handle: 'vladimirribakov', platform: 'instagram', website: 'https://traders-academy.club', niche: 'Forex education, signals, mentoring', name: 'Vladimir Ribakov' },
  { handle: 'andrewmitchem', platform: 'instagram', website: 'https://theforextradingcoach.com', niche: 'Forex coaching, swing trading systems', name: 'Andrew Mitchem' },
  { handle: 'annacoull', platform: 'instagram', website: 'https://annacoulling.com', niche: 'Forex & volume price analysis education', name: 'Anna Coulling' },
  { handle: 'clayhodgesfx', platform: 'instagram', website: 'https://roninforexgroup.com', niche: 'Forex mentoring, community-focused education', name: 'Clay Hodges' },
  { handle: 'tomcampcoaching', platform: 'instagram', website: 'https://tomcamp.com', niche: 'Day trading education, forex & indices, scalping', name: 'Tom Camp' },
  { handle: 'stephenburns', platform: 'instagram', website: 'https://newtraderu.com', niche: 'Trading psychology, trend following, forex & stocks', name: 'Stephen Burns' },
  { handle: 'preshbae_forex', platform: 'instagram', website: 'https://preshforexacademy.com', niche: 'Forex academy, lifestyle & trading education' },
  { handle: 'luckymanfx', platform: 'instagram', website: 'https://luckymanfx.com', niche: 'Forex signals and education, lifestyle content' },
  { handle: 'christianjsmith', platform: 'instagram', website: 'https://frostfxacademy.com', niche: 'Forex, indices, trading lifestyle education' },
  { handle: 'grandson_', platform: 'instagram', website: null, niche: 'Forex lifestyle, trading insights (Instagram-focused)' },
  { handle: 'akil_stokes', platform: 'instagram', website: 'https://tier1trading.com', niche: 'Forex trading education, podcast & YouTube content', name: 'Akil Stokes' },
  { handle: 'fxalexg', platform: 'instagram', website: 'https://fxalexg.com', niche: 'Forex scalping, smart money, prop firm trading' },
  { handle: 'asfx__', platform: 'instagram', website: 'https://asfx.biz', niche: 'Forex strategy, systematic trading education' },
  { handle: 'michael_btb', platform: 'instagram', website: 'https://btbtrading.com', niche: 'Forex, prop firm challenge strategy' },
  { handle: 'qbanks', platform: 'instagram', website: null, niche: 'Forex & indices, smart money trading, mentorship' },
  { handle: 'astrofxcarl', platform: 'instagram', website: 'https://astrofxcarl.com', niche: 'Forex education, lifestyle, swing trading' },
  { handle: 'astro_forex', platform: 'instagram', website: 'https://astrofxcarl.com', niche: 'Forex mentorship, institutional concepts' },
  { handle: 'b.r.andrew', platform: 'instagram', website: 'https://fxblueprint.com', niche: 'Forex strategy and risk management' },
  { handle: 'thepurposedriventrader', platform: 'instagram', website: 'https://thepurposedriventrader.com', niche: 'Forex & funded accounts, prop firm reviews' },
  { handle: 'swaggyc', platform: 'instagram', website: 'https://swaggyc.com', niche: 'Forex trading education & lifestyle' },
  { handle: 'tradernickfx', platform: 'instagram', website: 'https://tradernickfx.com', niche: 'Forex trading academy, prop firm challenges' },
  { handle: 'riskytraderfx', platform: 'instagram', website: null, niche: 'Forex, prop firm challenge breakdowns' },
  { handle: 'goatfx', platform: 'instagram', website: null, niche: 'Forex signals and funded accounts content' },
  { handle: 'falconfx', platform: 'instagram', website: 'https://falconfx.com', niche: 'Swing trading, forex education, funded-style trading' },
  { handle: 'babadonfx', platform: 'instagram', website: null, niche: 'Forex & synthetic indices, lifestyle content' },
  { handle: 'traderdante', platform: 'instagram', website: 'https://traderdante.com', niche: 'Price action, futures & forex education', name: 'Trader Dante' },
  { handle: 'ict_trader', platform: 'instagram', website: 'https://innercircletrader.com', niche: 'Smart money concepts, forex education' },
  { handle: 'noelnation', platform: 'instagram', website: null, niche: 'Prop firm challenges, forex and indices' },
  { handle: 'mambafx', platform: 'instagram', website: 'https://mambafx.com', niche: 'Forex lifestyle, signals & mentorship' },
  { handle: 'raajfx', platform: 'instagram', website: null, niche: 'Intraday forex trading, prop firms' },
  { handle: 'kb_trading_', platform: 'instagram', website: 'https://kbtrading.org', niche: 'Prop firm challenges, forex strategy, trader psychology' },
  { handle: 'tradingriot', platform: 'instagram', website: 'https://tradingriot.com', niche: 'Orderflow, futures & forex education' },
  { handle: 'raynerteo', platform: 'instagram', website: 'https://tradingwithrayner.com', niche: 'Trend following, forex & CFD education', name: 'Rayner Teo' },
  { handle: 'theforexguy', platform: 'instagram', website: 'https://theforexguy.com', niche: 'Swing trading, price action forex education' },
  { handle: 'forexsignalscom', platform: 'instagram', website: 'https://forexsignals.com', niche: 'Forex mentoring, live rooms, trade ideas' },
  { handle: 'astrofxltd', platform: 'instagram', website: 'https://astrofxcarl.com', niche: 'Forex education & in-person training' },
  { handle: 'fxcartel', platform: 'instagram', website: 'https://fxcartel.com', niche: 'Forex & indices, lifestyle and signals' },
  { handle: 'wicksdontlie', platform: 'instagram', website: 'https://wicksdontlie.com', niche: 'Live streams, forex scalping education' },
  { handle: 'fxlifestyle', platform: 'instagram', website: 'https://fxlifestyle.com', niche: 'Signals, basic forex education' },
  { handle: 'thepiproom', platform: 'instagram', website: null, niche: 'Forex, funded account content' },
  { handle: 'a1trading', platform: 'instagram', website: 'https://a1trading.com', niche: 'Forex, indices, community and education' },
  { handle: 'tradingchannel', platform: 'instagram', website: 'https://thetradingchannel.net', niche: 'Forex education, price action' },
];

// ─── YouTube channel seeds ─────────────────────────────────────────

export const YOUTUBE_SEEDS: YoutubeSeed[] = [
  { channelId: 'UC2-JF8X_LDFEtSa3Ohfwvpg', channelUrl: 'https://www.youtube.com/channel/UC2-JF8X_LDFEtSa3Ohfwvpg', name: 'Brooks Trading Course', subscribers: 201000, country: 'US', email: null, niche: 'Trading course, price action education', lastUpload: '2026-04-14' },
  { channelId: 'UCztrpf7pdsiy7UTz9IYqeMw', channelUrl: 'https://www.youtube.com/channel/UCztrpf7pdsiy7UTz9IYqeMw', name: 'VIP Trader', subscribers: 73500, country: null, email: null, niche: 'Trading academy, reviewer content', lastUpload: '2026-04-14' },
  { channelId: 'UCH2MPEc0HPQwsCe1gJLL_jQ', channelUrl: 'https://www.youtube.com/channel/UCH2MPEc0HPQwsCe1gJLL_jQ', name: 'Ali Khan', subscribers: 118000, country: 'AE', email: null, niche: 'Rithmic, prop firm content', lastUpload: '2026-03-25' },
  { channelId: 'UCgPeeHdxYRal0HTNeAkjqLg', channelUrl: 'https://www.youtube.com/channel/UCgPeeHdxYRal0HTNeAkjqLg', name: 'fxalexg', subscribers: 1220000, country: 'US', email: null, niche: 'Forex scalping, smart money, prop firm trading (beginners)', lastUpload: '2026-04-05' },
  { channelId: 'UCiryrSBCAAbgRI7C6-ddPFw', channelUrl: 'https://www.youtube.com/channel/UCiryrSBCAAbgRI7C6-ddPFw', name: 'Earn with Rashid', subscribers: 325000, country: 'AE', email: 'earnwithrashidofficial@gmail.com', niche: 'Trading course, beginners', lastUpload: '2026-04-11' },
  { channelId: 'UCdZqO2SV8tUPo1CsFAA90zQ', channelUrl: 'https://www.youtube.com/channel/UCdZqO2SV8tUPo1CsFAA90zQ', name: 'Game of Forex By Waqas Ahmed', subscribers: 124000, country: 'PK', email: null, niche: 'Prop firms, funded accounts', lastUpload: '2026-04-14' },
  { channelId: 'UCv0Qlrv3DBOmM3Y5P4QeK1A', channelUrl: 'https://www.youtube.com/channel/UCv0Qlrv3DBOmM3Y5P4QeK1A', name: 'TEFS Trading Academy', subscribers: 77700, country: 'AE', email: null, niche: 'Trading academy, prop firm', lastUpload: '2026-04-14' },
  { channelId: 'UCRLLXoi-Ms293noE1InOFMg', channelUrl: 'https://www.youtube.com/channel/UCRLLXoi-Ms293noE1InOFMg', name: 'SL Trading Academy', subscribers: 105000, country: 'LK', email: 'admin@sltradingacademy.com', niche: 'Trading academy', lastUpload: '2026-04-13' },
  { channelId: 'UCoIwJV87rVoDS0r5v9SY9Jg', channelUrl: 'https://www.youtube.com/channel/UCoIwJV87rVoDS0r5v9SY9Jg', name: 'Trading Academy', subscribers: 115000, country: 'US', email: null, niche: 'Trading academy, reviewer content', lastUpload: '2026-04-12' },
  { channelId: 'UC6cJx33d5FONSbllc5wfFIA', channelUrl: 'https://www.youtube.com/channel/UC6cJx33d5FONSbllc5wfFIA', name: 'BK Trading Academy', subscribers: 32300, country: 'US', email: null, niche: 'Trading academy, link-in-bio', lastUpload: '2026-04-11' },
  { channelId: 'UCgfi-u0_DXp32im3up5G1eA', channelUrl: 'https://www.youtube.com/channel/UCgfi-u0_DXp32im3up5G1eA', name: 'Shivam Trading Academy', subscribers: 90300, country: 'IN', email: null, niche: 'Trading for beginners', lastUpload: '2026-04-14' },
  { channelId: 'UCA6x8qx5r_DE14CEK7gsdlg', channelUrl: 'https://www.youtube.com/channel/UCA6x8qx5r_DE14CEK7gsdlg', name: 'Tamil Traders Academy', subscribers: 23300, country: 'IN', email: 'iamfinefrom4@gmail.com', niche: 'Beginners, prop firm, risk management', lastUpload: '2026-04-14' },
  { channelId: 'UCUGojYE26qbwOkslEJRBRSg', channelUrl: 'https://www.youtube.com/channel/UCUGojYE26qbwOkslEJRBRSg', name: 'CryptoNanny Trading Academy', subscribers: 11800, country: 'HK', email: null, niche: 'Trading academy, reviewer', lastUpload: '2026-02-20' },
  { channelId: 'UCib_-kxZOJNF2xUGhcS13EA', channelUrl: 'https://www.youtube.com/channel/UCib_-kxZOJNF2xUGhcS13EA', name: 'Job Zamora', subscribers: 146000, country: 'PH', email: 'partnerships@thethirtyminutetrader.com', niche: 'Trading for beginners', lastUpload: '2026-04-14' },
  { channelId: 'UCcIvNGMBSQWwo1v3n-ZRBCw', channelUrl: 'https://www.youtube.com/channel/UCcIvNGMBSQWwo1v3n-ZRBCw', name: 'Humbled Trader', subscribers: 1440000, country: 'CA', email: null, niche: 'Trading platforms, beginners', lastUpload: '2026-04-13' },
  { channelId: 'UCLHnYvhBeW4vv7lhnbcKilg', channelUrl: 'https://www.youtube.com/channel/UCLHnYvhBeW4vv7lhnbcKilg', name: 'ImanTrading', subscribers: 318000, country: 'US', email: 'imanktrading@gmail.com', niche: 'Prop firm content, funded accounts, trading platforms', lastUpload: '2026-03-15' },
  { channelId: 'UCL-QLzGmf468WAL1U-9g0qA', channelUrl: 'https://www.youtube.com/channel/UCL-QLzGmf468WAL1U-9g0qA', name: 'Craig Percoco', subscribers: 1250000, country: 'US', email: 'craig@highperformers.io', niche: 'Funded accounts, futures', lastUpload: '2026-04-14' },
  { channelId: 'UCIui2mh4TiQ70hjQesyBFDQ', channelUrl: 'https://www.youtube.com/channel/UCIui2mh4TiQ70hjQesyBFDQ', name: 'Trading With Chandru', subscribers: 36700, country: 'IN', email: null, niche: 'Trading course, trading platforms', lastUpload: '2026-03-29' },
  { channelId: 'UCZZzo055Pg5z4i5wB9-wVUA', channelUrl: 'https://www.youtube.com/channel/UCZZzo055Pg5z4i5wB9-wVUA', name: 'Riley Coleman', subscribers: 447000, country: 'US', email: null, niche: 'Prop firms, trading platforms', lastUpload: '2026-04-14' },
  { channelId: 'UCIz6a60wDKdd3SWXYELstQQ', channelUrl: 'https://www.youtube.com/channel/UCIz6a60wDKdd3SWXYELstQQ', name: 'Eddie Smc', subscribers: 30200, country: 'ZA', email: null, niche: 'Prop firms, SMC', lastUpload: '2026-03-16' },
  { channelId: 'UCdJ3OOOoIyEy3SabxKbrPaw', channelUrl: 'https://www.youtube.com/channel/UCdJ3OOOoIyEy3SabxKbrPaw', name: 'Algo Trading Space', subscribers: 21900, country: 'BG', email: 'support@algotradingspace.com', niche: 'Trading academy, prop firm challenges, funded accounts', lastUpload: '2026-04-05' },
];
