import type { Creator, CreatorAccount } from './types';

interface ScoreInput {
  creator: Partial<Creator>;
  accounts: Partial<CreatorAccount>[];
}

/**
 * Lead score (0-100): how valuable is this creator for outreach.
 */
export function computeLeadScore({ creator, accounts }: ScoreInput): number {
  let score = 0;

  // Follower tiers
  const total = creator.total_followers ?? 0;
  if (total >= 500_000) score += 25;
  else if (total >= 100_000) score += 20;
  else if (total >= 50_000) score += 15;
  else if (total >= 10_000) score += 10;
  else if (total >= 1_000) score += 5;

  // Contact info
  if (creator.public_email) score += 15;
  if (creator.public_phone) score += 5;
  if (creator.website) score += 5;

  // Community / monetization
  if (creator.has_course) score += 10;
  if (creator.has_discord) score += 5;
  if (creator.has_telegram) score += 5;
  if (creator.has_skool) score += 5;
  if (creator.has_whop) score += 5;

  // Prop firm relevance
  if (creator.promoting_prop_firms) score += 15;
  score += Math.min((creator.prop_firms_mentioned?.length ?? 0) * 3, 9);

  // Multi-platform URL presence
  const urls = [creator.youtube_url, creator.x_url, creator.instagram_url, creator.linkedin_url];
  const urlCount = urls.filter(Boolean).length;
  score += urlCount * 3; // max +12

  // Contact form (high-value — means they accept business inquiries)
  if (creator.contact_form_url) score += 10;

  // Direct URLs (higher signal than booleans)
  if (creator.course_url) score += 3;
  if (creator.link_in_bio_url) score += 2;
  if (creator.discord_url) score += 2;
  if (creator.telegram_url) score += 2;

  // Account-level signals
  const platformCount = new Set(accounts.map(a => a.platform)).size;
  score += Math.min(platformCount * 3, 9);
  const verifiedCount = accounts.filter(a => a.verified).length;
  score += Math.min(verifiedCount * 2, 6);

  return Math.min(Math.round(score), 100);
}

/**
 * Confidence score (0-100): how complete/reliable is the data.
 */
export function computeConfidenceScore({ creator, accounts }: ScoreInput): number {
  let score = 0;

  // Core fields
  const coreFields: (keyof Creator)[] = [
    'name', 'website', 'public_email', 'total_followers',
    'has_course', 'has_discord', 'has_telegram', 'promoting_prop_firms',
  ];
  for (const field of coreFields) {
    const val = creator[field];
    if (val !== null && val !== undefined && val !== '' && val !== 0 && val !== false) {
      score += 8;
    }
  }

  // URL fields (each adds confidence that we have real data)
  const urlFields: (keyof Creator)[] = [
    'instagram_url', 'linkedin_url', 'youtube_url', 'x_url',
    'link_in_bio_url', 'course_url', 'discord_url', 'telegram_url',
  ];
  for (const field of urlFields) {
    if (creator[field]) score += 3;
  }

  // Classification data
  if (creator.niche) score += 4;
  if (creator.source_type) score += 3;
  if (creator.primary_platform) score += 3;

  // Account data
  if (accounts.length > 0) score += 6;
  if (accounts.some(a => a.bio)) score += 3;
  if (accounts.some(a => a.followers && a.followers > 0)) score += 3;

  return Math.min(Math.round(score), 100);
}
