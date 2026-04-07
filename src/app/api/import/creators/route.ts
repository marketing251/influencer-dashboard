import { NextRequest, NextResponse } from 'next/server';
import { upsertCreator } from '@/lib/pipeline';
import type { DiscoveredCreator } from '@/lib/pipeline';
import type { Platform } from '@/lib/types';
import { log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * POST /api/import/creators
 *
 * Import creators from CSV/JSON for platforms without first-party discovery APIs
 * (Instagram, LinkedIn, or any other source).
 *
 * Accepts JSON body:
 * {
 *   "creators": [
 *     {
 *       "name": "TraderJane",
 *       "platform": "instagram",
 *       "handle": "traderjane",
 *       "profile_url": "https://instagram.com/traderjane",
 *       "followers": 85000,
 *       "bio": "Forex trader | Course creator",
 *       "website": "https://traderjane.com"
 *     }
 *   ]
 * }
 *
 * Required fields: name, platform, handle
 * Optional: profile_url, followers, bio, website, platform_id
 */

const VALID_PLATFORMS: Platform[] = [
  'youtube', 'x', 'instagram', 'tiktok', 'twitch', 'discord', 'telegram', 'linkedin',
];

interface ImportRow {
  name: string;
  platform: string;
  handle: string;
  profile_url?: string;
  followers?: number;
  bio?: string;
  website?: string;
  platform_id?: string;
}

function validateRow(row: ImportRow, index: number): string | null {
  if (!row.name?.trim()) return `Row ${index}: name is required`;
  if (!row.platform?.trim()) return `Row ${index}: platform is required`;
  if (!row.handle?.trim()) return `Row ${index}: handle is required`;
  if (!VALID_PLATFORMS.includes(row.platform as Platform)) {
    return `Row ${index}: invalid platform "${row.platform}". Valid: ${VALID_PLATFORMS.join(', ')}`;
  }
  return null;
}

function rowToCreator(row: ImportRow): DiscoveredCreator {
  const platform = row.platform as Platform;
  const handle = row.handle.trim().replace(/^@/, '');

  return {
    name: row.name.trim(),
    slug: handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    website: row.website?.trim() || null,
    bio: row.bio?.trim() || null,
    account: {
      platform,
      handle,
      profile_url: row.profile_url?.trim() || buildProfileUrl(platform, handle),
      followers: row.followers ?? 0,
      platform_id: row.platform_id ?? handle,
      bio: row.bio?.trim() ?? '',
      verified: false,
    },
  };
}

function buildProfileUrl(platform: Platform, handle: string): string {
  const urls: Partial<Record<Platform, string>> = {
    youtube: `https://youtube.com/@${handle}`,
    x: `https://x.com/${handle}`,
    instagram: `https://instagram.com/${handle}`,
    tiktok: `https://tiktok.com/@${handle}`,
    twitch: `https://twitch.tv/${handle}`,
    linkedin: `https://linkedin.com/in/${handle}`,
    telegram: `https://t.me/${handle}`,
  };
  return urls[platform] ?? `https://${platform}.com/${handle}`;
}

export async function POST(request: NextRequest) {
  let body: { creators?: ImportRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rows = body.creators;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'Body must contain a non-empty "creators" array', example: { creators: [{ name: 'Jane', platform: 'instagram', handle: 'jane_trades' }] } },
      { status: 400 },
    );
  }

  if (rows.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 creators per import' }, { status: 400 });
  }

  // Validate all rows first
  const validationErrors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const err = validateRow(rows[i], i);
    if (err) validationErrors.push(err);
  }
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: validationErrors }, { status: 400 });
  }

  // Upsert each creator
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const creator = rowToCreator(row);
    const result = await upsertCreator(creator);
    if (result.action === 'created') created++;
    else if (result.action === 'updated') updated++;
    else skipped++;
    if (result.error) errors.push(`${row.name}: ${result.error}`);
  }

  log.info('api.import.creators: done', { total: rows.length, created, updated, skipped, errors: errors.length });

  return NextResponse.json({
    message: `Imported ${rows.length} creators`,
    total: rows.length,
    created,
    updated,
    skipped,
    errors: errors.length,
    error_details: errors.slice(0, 20),
  });
}
