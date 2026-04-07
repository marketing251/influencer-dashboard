import type {
  Creator, CreatorAccount, CreatorPost, DailyDiscovery, Outreach, DashboardStats,
} from './types';

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();

export const mockCreators: Creator[] = [
  {
    id: '1a2b3c4d-0001-4000-a000-000000000001',
    name: 'TraderMax',
    slug: 'tradermax',
    website: 'https://tradermax.io',
    public_email: 'business@tradermax.io',
    public_phone: null,
    total_followers: 485000,
    has_course: true,
    has_discord: true,
    has_telegram: true,
    promoting_prop_firms: true,
    prop_firms_mentioned: ['FTMO', 'MyFundedFX', 'The5ers'],
    lead_score: 92,
    confidence_score: 88,
    notes: 'Very active in prop firm space, posts daily.',
    status: 'new',
    created_at: twoDaysAgo,
    updated_at: now,
  },
  {
    id: '1a2b3c4d-0002-4000-a000-000000000002',
    name: 'CryptoQueen',
    slug: 'cryptoqueen',
    website: 'https://cryptoqueen.com',
    public_email: 'hello@cryptoqueen.com',
    public_phone: '+1-555-0102',
    total_followers: 1200000,
    has_course: true,
    has_discord: true,
    has_telegram: false,
    promoting_prop_firms: false,
    prop_firms_mentioned: [],
    lead_score: 68,
    confidence_score: 92,
    notes: null,
    status: 'contacted',
    created_at: twoDaysAgo,
    updated_at: yesterday,
  },
  {
    id: '1a2b3c4d-0003-4000-a000-000000000003',
    name: 'ForexMentor',
    slug: 'forexmentor',
    website: 'https://forexmentor.academy',
    public_email: 'info@forexmentor.academy',
    public_phone: null,
    total_followers: 320000,
    has_course: true,
    has_discord: false,
    has_telegram: true,
    promoting_prop_firms: true,
    prop_firms_mentioned: ['FTMO', 'FundedNext'],
    lead_score: 85,
    confidence_score: 80,
    notes: 'Runs a paid mentorship program.',
    status: 'new',
    created_at: yesterday,
    updated_at: now,
  },
  {
    id: '1a2b3c4d-0004-4000-a000-000000000004',
    name: 'OptionsAlpha',
    slug: 'optionsalpha',
    website: 'https://optionsalpha.net',
    public_email: null,
    public_phone: null,
    total_followers: 89000,
    has_course: false,
    has_discord: true,
    has_telegram: false,
    promoting_prop_firms: false,
    prop_firms_mentioned: [],
    lead_score: 35,
    confidence_score: 55,
    notes: null,
    status: 'new',
    created_at: now,
    updated_at: now,
  },
  {
    id: '1a2b3c4d-0005-4000-a000-000000000005',
    name: 'DayTradeJay',
    slug: 'daytradejay',
    website: 'https://daytradejay.com',
    public_email: 'contact@daytradejay.com',
    public_phone: '+1-555-0199',
    total_followers: 750000,
    has_course: true,
    has_discord: true,
    has_telegram: true,
    promoting_prop_firms: true,
    prop_firms_mentioned: ['FTMO', 'MyFundedFX', 'TrueForexFunds', 'The5ers'],
    lead_score: 97,
    confidence_score: 95,
    notes: 'Top-tier lead. Active across all platforms.',
    status: 'qualified',
    created_at: twoDaysAgo,
    updated_at: now,
  },
  {
    id: '1a2b3c4d-0006-4000-a000-000000000006',
    name: 'SwingTraderSam',
    slug: 'swingtrader-sam',
    website: null,
    public_email: null,
    public_phone: null,
    total_followers: 42000,
    has_course: false,
    has_discord: false,
    has_telegram: true,
    promoting_prop_firms: true,
    prop_firms_mentioned: ['FundedNext'],
    lead_score: 28,
    confidence_score: 35,
    notes: null,
    status: 'new',
    created_at: now,
    updated_at: now,
  },
  {
    id: '1a2b3c4d-0007-4000-a000-000000000007',
    name: 'ICTMethodology',
    slug: 'ict-methodology',
    website: 'https://ictmethod.com',
    public_email: 'team@ictmethod.com',
    public_phone: null,
    total_followers: 2100000,
    has_course: true,
    has_discord: true,
    has_telegram: true,
    promoting_prop_firms: true,
    prop_firms_mentioned: ['FTMO', 'MyFundedFX'],
    lead_score: 95,
    confidence_score: 90,
    notes: 'Massive following in ICT/smart money community.',
    status: 'contacted',
    created_at: twoDaysAgo,
    updated_at: yesterday,
  },
  {
    id: '1a2b3c4d-0008-4000-a000-000000000008',
    name: 'PennyStockPat',
    slug: 'pennystockpat',
    website: 'https://pennystockpat.co',
    public_email: 'pat@pennystockpat.co',
    public_phone: null,
    total_followers: 155000,
    has_course: true,
    has_discord: true,
    has_telegram: false,
    promoting_prop_firms: false,
    prop_firms_mentioned: [],
    lead_score: 52,
    confidence_score: 72,
    notes: 'Primarily penny stocks, not forex/futures.',
    status: 'rejected',
    created_at: twoDaysAgo,
    updated_at: yesterday,
  },
];

export const mockAccounts: CreatorAccount[] = [
  // TraderMax
  { id: 'acc-001', creator_id: mockCreators[0].id, platform: 'youtube', handle: 'TraderMaxTV', profile_url: 'https://youtube.com/@TraderMaxTV', followers: 280000, platform_id: 'UC_tradermax', bio: 'Daily forex & futures analysis', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-002', creator_id: mockCreators[0].id, platform: 'x', handle: 'TraderMax_fx', profile_url: 'https://x.com/TraderMax_fx', followers: 185000, platform_id: '12345678', bio: 'Prop firm trader | Funded 6 accounts', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-003', creator_id: mockCreators[0].id, platform: 'discord', handle: 'TraderMax Community', profile_url: 'https://discord.gg/tradermax', followers: 20000, platform_id: null, bio: null, verified: false, last_scraped_at: null, created_at: twoDaysAgo, updated_at: now },
  // CryptoQueen
  { id: 'acc-004', creator_id: mockCreators[1].id, platform: 'youtube', handle: 'CryptoQueenOfficial', profile_url: 'https://youtube.com/@CryptoQueenOfficial', followers: 800000, platform_id: 'UC_cq', bio: 'Crypto education for beginners', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-005', creator_id: mockCreators[1].id, platform: 'x', handle: 'CryptoQueen', profile_url: 'https://x.com/CryptoQueen', followers: 400000, platform_id: '87654321', bio: 'Teaching crypto since 2017', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  // ForexMentor
  { id: 'acc-006', creator_id: mockCreators[2].id, platform: 'youtube', handle: 'ForexMentorAcademy', profile_url: 'https://youtube.com/@ForexMentorAcademy', followers: 220000, platform_id: 'UC_fm', bio: 'Professional forex education', verified: false, last_scraped_at: now, created_at: yesterday, updated_at: now },
  { id: 'acc-007', creator_id: mockCreators[2].id, platform: 'telegram', handle: 'ForexMentorSignals', profile_url: 'https://t.me/ForexMentorSignals', followers: 100000, platform_id: null, bio: 'Free signals & education', verified: false, last_scraped_at: null, created_at: yesterday, updated_at: now },
  // OptionsAlpha
  { id: 'acc-008', creator_id: mockCreators[3].id, platform: 'youtube', handle: 'OptionsAlpha', profile_url: 'https://youtube.com/@OptionsAlpha', followers: 89000, platform_id: 'UC_oa', bio: 'Options trading strategies', verified: false, last_scraped_at: now, created_at: now, updated_at: now },
  // DayTradeJay
  { id: 'acc-009', creator_id: mockCreators[4].id, platform: 'youtube', handle: 'DayTradeJay', profile_url: 'https://youtube.com/@DayTradeJay', followers: 450000, platform_id: 'UC_dtj', bio: 'Live trading every morning', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-010', creator_id: mockCreators[4].id, platform: 'x', handle: 'DayTradeJay', profile_url: 'https://x.com/DayTradeJay', followers: 250000, platform_id: '11223344', bio: 'Full-time trader & educator', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-011', creator_id: mockCreators[4].id, platform: 'discord', handle: 'DTJ Trading Floor', profile_url: 'https://discord.gg/dtj', followers: 35000, platform_id: null, bio: null, verified: false, last_scraped_at: null, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-012', creator_id: mockCreators[4].id, platform: 'telegram', handle: 'DayTradeJayAlerts', profile_url: 'https://t.me/DayTradeJayAlerts', followers: 15000, platform_id: null, bio: 'Trade alerts', verified: false, last_scraped_at: null, created_at: twoDaysAgo, updated_at: now },
  // SwingTraderSam
  { id: 'acc-013', creator_id: mockCreators[5].id, platform: 'x', handle: 'SwingTraderSam', profile_url: 'https://x.com/SwingTraderSam', followers: 42000, platform_id: '55667788', bio: 'Swing trader | Telegram signals', verified: false, last_scraped_at: now, created_at: now, updated_at: now },
  // ICTMethodology
  { id: 'acc-014', creator_id: mockCreators[6].id, platform: 'youtube', handle: 'ICTMethodology', profile_url: 'https://youtube.com/@ICTMethodology', followers: 1500000, platform_id: 'UC_ict', bio: 'Smart Money Concepts & ICT methodology', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  { id: 'acc-015', creator_id: mockCreators[6].id, platform: 'x', handle: 'ICT_method', profile_url: 'https://x.com/ICT_method', followers: 600000, platform_id: '99001122', bio: 'The original ICT', verified: true, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
  // PennyStockPat
  { id: 'acc-016', creator_id: mockCreators[7].id, platform: 'youtube', handle: 'PennyStockPat', profile_url: 'https://youtube.com/@PennyStockPat', followers: 155000, platform_id: 'UC_psp', bio: 'Finding the next 10x penny stock', verified: false, last_scraped_at: now, created_at: twoDaysAgo, updated_at: now },
];

export const mockPosts: CreatorPost[] = [
  { id: 'post-001', creator_id: mockCreators[0].id, account_id: 'acc-001', platform: 'youtube', post_url: 'https://youtube.com/watch?v=abc123', title: 'How I Passed FTMO Challenge in 3 Days', content_snippet: 'In this video I show you exactly how I passed my FTMO challenge...', views: 245000, likes: 12000, comments: 890, published_at: yesterday, mentions_prop_firm: true, mentions_course: false, created_at: now },
  { id: 'post-002', creator_id: mockCreators[0].id, account_id: 'acc-002', platform: 'x', post_url: 'https://x.com/TraderMax_fx/status/1', title: null, content_snippet: 'Just passed another FTMO challenge! 3rd funded account this year. Link to my course in bio.', views: 45000, likes: 2300, comments: 156, published_at: now, mentions_prop_firm: true, mentions_course: true, created_at: now },
  { id: 'post-003', creator_id: mockCreators[4].id, account_id: 'acc-009', platform: 'youtube', post_url: 'https://youtube.com/watch?v=def456', title: 'My $50K Funded Account Results - Month 3', content_snippet: 'Monthly results from my MyFundedFX account...', views: 380000, likes: 18500, comments: 1200, published_at: yesterday, mentions_prop_firm: true, mentions_course: false, created_at: now },
  { id: 'post-004', creator_id: mockCreators[6].id, account_id: 'acc-014', platform: 'youtube', post_url: 'https://youtube.com/watch?v=ghi789', title: 'ICT Concepts Explained - Order Blocks & Fair Value Gaps', content_snippet: 'Understanding institutional order flow...', views: 920000, likes: 45000, comments: 3400, published_at: twoDaysAgo, mentions_prop_firm: false, mentions_course: true, created_at: now },
  { id: 'post-005', creator_id: mockCreators[2].id, account_id: 'acc-006', platform: 'youtube', post_url: 'https://youtube.com/watch?v=jkl012', title: 'FundedNext vs FTMO - Which Prop Firm is Best in 2026?', content_snippet: 'Comparing the top prop firms...', views: 156000, likes: 7800, comments: 620, published_at: now, mentions_prop_firm: true, mentions_course: false, created_at: now },
];

export const mockDiscoveries: DailyDiscovery[] = [
  { id: 'disc-001', run_date: new Date().toISOString().split('T')[0], platform: 'youtube', new_creators_found: 3, existing_creators_updated: 5, errors: [], started_at: now, completed_at: now, status: 'completed' },
  { id: 'disc-002', run_date: new Date().toISOString().split('T')[0], platform: 'x', new_creators_found: 2, existing_creators_updated: 4, errors: [], started_at: now, completed_at: now, status: 'completed' },
  { id: 'disc-003', run_date: new Date(Date.now() - 86400000).toISOString().split('T')[0], platform: 'youtube', new_creators_found: 4, existing_creators_updated: 6, errors: [], started_at: yesterday, completed_at: yesterday, status: 'completed' },
  { id: 'disc-004', run_date: new Date(Date.now() - 86400000).toISOString().split('T')[0], platform: 'x', new_creators_found: 1, existing_creators_updated: 3, errors: ['Rate limit hit on search endpoint'], started_at: yesterday, completed_at: yesterday, status: 'completed' },
];

export const mockOutreach: (Outreach & { creator_name?: string })[] = [
  { id: 'out-001', creator_id: mockCreators[1].id, creator_name: 'CryptoQueen', channel: 'email', subject: 'Partnership Opportunity', body: 'Hi! We love your content and would like to discuss a partnership...', sent_at: yesterday, status: 'sent', response: null, responded_at: null, created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'out-002', creator_id: mockCreators[6].id, creator_name: 'ICTMethodology', channel: 'email', subject: 'Collaboration Proposal', body: 'Hello! We have an exciting opportunity for creators in the trading space...', sent_at: twoDaysAgo, status: 'opened', response: null, responded_at: null, created_at: twoDaysAgo, updated_at: yesterday },
  { id: 'out-003', creator_id: mockCreators[4].id, creator_name: 'DayTradeJay', channel: 'email', subject: 'Sponsorship Inquiry', body: null, sent_at: null, status: 'draft', response: null, responded_at: null, created_at: now, updated_at: now },
  { id: 'out-004', creator_id: mockCreators[0].id, creator_name: 'TraderMax', channel: 'dm', subject: null, body: null, sent_at: null, status: 'queued', response: null, responded_at: null, created_at: now, updated_at: now },
  { id: 'out-005', creator_id: mockCreators[2].id, creator_name: 'ForexMentor', channel: 'email', subject: 'Re: Partnership', body: 'Thanks for reaching out! I am interested...', sent_at: twoDaysAgo, status: 'replied', response: 'Interested, lets schedule a call.', responded_at: yesterday, created_at: twoDaysAgo, updated_at: yesterday },
];

export const mockStats: DashboardStats = {
  total_creators: mockCreators.length,
  new_today: mockCreators.filter(c => c.created_at === now).length || 3,
  total_with_email: mockCreators.filter(c => c.public_email).length,
  avg_lead_score: Math.round(mockCreators.reduce((s, c) => s + c.lead_score, 0) / mockCreators.length),
  outreach_sent: mockOutreach.filter(o => o.status !== 'draft').length,
  outreach_replied: mockOutreach.filter(o => o.status === 'replied').length,
  platforms: [
    { platform: 'youtube', count: 7 },
    { platform: 'x', count: 5 },
    { platform: 'discord', count: 3 },
    { platform: 'telegram', count: 3 },
  ],
};

// Helpers to get mock data as if from DB
export function getMockCreatorWithAccounts(id: string) {
  const creator = mockCreators.find(c => c.id === id);
  if (!creator) return null;
  const accounts = mockAccounts.filter(a => a.creator_id === id);
  const posts = mockPosts.filter(p => p.creator_id === id);
  const outreach_history = mockOutreach.filter(o => o.creator_id === id);
  return { ...creator, accounts, posts, outreach_history };
}
