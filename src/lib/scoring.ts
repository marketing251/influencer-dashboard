import type { Creator, CreatorAccount } from './types';

interface ScoreInput {
  creator: Partial<Creator>;
  accounts: Partial<CreatorAccount>[];
}

/**
 * Compute a lead score (0-100) based on how valuable a creator is for outreach.
 * Higher = more likely to convert.
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

  // Has public contact info
  if (creator.public_email) score += 15;
  if (creator.public_phone) score += 5;
  if (creator.website) score += 5;

  // Community indicators
  if (creator.has_course) score += 10;
  if (creator.has_discord) score += 5;
  if (creator.has_telegram) score += 5;

  // Prop firm relevance
  if (creator.promoting_prop_firms) score += 15;
  const firmCount = creator.prop_firms_mentioned?.length ?? 0;
  score += Math.min(firmCount * 3, 9);

  // Multi-platform presence
  const platformCount = new Set(accounts.map(a => a.platform)).size;
  score += Math.min(platformCount * 3, 9);

  // Verified accounts bonus
  const verifiedCount = accounts.filter(a => a.verified).length;
  score += Math.min(verifiedCount * 2, 6);

  return Math.min(Math.round(score), 100);
}

/**
 * Compute a confidence score (0-100) representing how complete/reliable the data is.
 */
export function computeConfidenceScore({ creator, accounts }: ScoreInput): number {
  let score = 0;
  const fields: (keyof Creator)[] = [
    'name', 'website', 'public_email', 'total_followers',
    'has_course', 'has_discord', 'has_telegram', 'promoting_prop_firms',
  ];

  for (const field of fields) {
    const val = creator[field];
    if (val !== null && val !== undefined && val !== '' && val !== 0) {
      score += 10;
    }
  }

  // Account data completeness
  if (accounts.length > 0) score += 10;
  if (accounts.some(a => a.bio)) score += 5;
  if (accounts.some(a => a.followers && a.followers > 0)) score += 5;

  return Math.min(Math.round(score), 100);
}
