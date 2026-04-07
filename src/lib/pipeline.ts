/**
 * Pipeline utilities for normalizing and upserting creator data.
 * Central place for DB writes so discovery routes stay focused on fetching.
 *
 * Dedup rules:
 * 1. Primary key: (platform, platform_id) on creator_accounts — same platform account is never duplicated
 * 2. Slug + name match: same slug AND same name → link new platform account to existing creator
 * 3. Slug collision, different name → append platform to slug to avoid overwrite
 * 4. Post dedup: by post_url — same post URL is never duplicated, metrics are updated
 *
 * Timestamp rules:
 * - first_seen_at: set once on creation, never updated
 * - last_seen_at: updated on every discovery run that touches this creator
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { detectPropFirmsFromSources } from './prop-firms';
import { log } from './logger';
import type { Platform } from './types';

// ─── Text analysis helpers ──────────────────────────────────────────

const COURSE_PATTERN = /\b(?:course|mentor(?:ship)?|academy|learn|enroll|program|masterclass|bootcamp|curriculum|coaching|training|workshop|certification)\b/i;
const DISCORD_PATTERN = /discord\.(?:gg|com\/invite)\//i;
const TELEGRAM_PATTERN = /t\.me\//i;

function analyzeText(texts: (string | null | undefined)[]) {
  const combined = texts.filter(Boolean).join(' ');
  return {
    propFirms: detectPropFirmsFromSources(...texts),
    hasCourse: COURSE_PATTERN.test(combined),
    hasDiscord: DISCORD_PATTERN.test(combined),
    hasTelegram: TELEGRAM_PATTERN.test(combined),
  };
}

// ─── Public types ───────────────────────────────────────────────────

/** Shape returned by discovery integrations. */
export interface DiscoveredCreator {
  name: string;
  slug: string;
  website?: string | null;
  bio?: string | null;
  account: {
    platform: Platform;
    handle: string;
    profile_url: string;
    followers: number;
    platform_id: string;
    bio: string;
    verified: boolean;
  };
}

/** Shape for discovered posts. */
export interface DiscoveredPost {
  platform: Platform;
  post_url: string;
  title: string | null;
  content_snippet: string | null;
  views: number;
  likes: number;
  comments: number;
  published_at: string | null;
}

export interface UpsertResult {
  action: 'created' | 'updated' | 'skipped';
  creator_id: string | null;
  name: string;
  error?: string;
}

// ─── Core upsert ────────────────────────────────────────────────────

/**
 * Upsert a discovered creator + account into the database.
 * Returns what happened: created, updated, or error.
 */
export async function upsertCreator(
  data: DiscoveredCreator,
  posts?: DiscoveredPost[],
): Promise<UpsertResult> {
  if (!isSupabaseConfigured()) {
    return { action: 'skipped', creator_id: null, name: data.name, error: 'No database configured' };
  }

  const now = new Date().toISOString();

  try {
    // ── Dedup check: does this platform+platform_id already exist? ──
    const { data: existing } = await supabaseAdmin
      .from('creator_accounts')
      .select('creator_id, id')
      .eq('platform', data.account.platform)
      .eq('platform_id', data.account.platform_id)
      .maybeSingle();

    // Analyze all text sources for signals
    const postTexts = (posts ?? []).map(p => `${p.title ?? ''} ${p.content_snippet ?? ''}`);
    const signals = analyzeText([data.bio, data.account.bio, ...postTexts]);

    if (existing) {
      return await updateExistingCreator(existing, data, posts, signals, now);
    } else {
      return await createNewCreator(data, posts, signals, now);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('pipeline.upsertCreator: exception', { name: data.name, error: msg });
    return { action: 'skipped', creator_id: null, name: data.name, error: msg };
  }
}

// ─── Update path ────────────────────────────────────────────────────

async function updateExistingCreator(
  existing: { creator_id: string; id: string },
  data: DiscoveredCreator,
  posts: DiscoveredPost[] | undefined,
  signals: ReturnType<typeof analyzeText>,
  now: string,
): Promise<UpsertResult> {
  const creatorId = existing.creator_id;

  // Fetch current creator to merge (never overwrite good data)
  const { data: current } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();

  if (!current) {
    return { action: 'skipped', creator_id: creatorId, name: data.name, error: 'Creator record missing' };
  }

  // Merge prop firms (union of existing + new)
  const mergedFirms = [...new Set([...(current.prop_firms_mentioned ?? []), ...signals.propFirms])];

  // Recalculate total followers across all accounts
  const { data: allAccounts } = await supabaseAdmin
    .from('creator_accounts')
    .select('followers, platform, verified')
    .eq('creator_id', creatorId);

  const accountsForScoring = (allAccounts ?? []).map(a =>
    a.platform === data.account.platform ? { ...a, followers: data.account.followers } : a,
  );
  const totalFollowers = accountsForScoring.reduce((sum, a) => sum + (a.followers ?? 0), 0);

  // Merge: booleans only upgrade (false→true), never downgrade
  const merged = {
    total_followers: totalFollowers,
    has_course: current.has_course || signals.hasCourse,
    has_discord: current.has_discord || signals.hasDiscord,
    has_telegram: current.has_telegram || signals.hasTelegram,
    promoting_prop_firms: current.promoting_prop_firms || mergedFirms.length > 0,
    prop_firms_mentioned: mergedFirms,
    website: current.website || data.website || null,
  };

  const leadScore = computeLeadScore({ creator: { ...current, ...merged }, accounts: accountsForScoring });
  const confidenceScore = computeConfidenceScore({ creator: { ...current, ...merged }, accounts: accountsForScoring });

  await supabaseAdmin.from('creators').update({
    ...merged,
    lead_score: leadScore,
    confidence_score: confidenceScore,
    last_seen_at: now,
    updated_at: now,
  }).eq('id', creatorId);

  // Update the matched account
  await supabaseAdmin.from('creator_accounts').update({
    followers: data.account.followers,
    bio: data.account.bio,
    verified: data.account.verified,
    last_scraped_at: now,
    updated_at: now,
  }).eq('id', existing.id);

  // Upsert posts
  if (posts?.length) {
    await upsertPosts(creatorId, existing.id, data.account.platform, posts);
  }

  log.info('pipeline.upsert: updated', { name: data.name, creator_id: creatorId, platform: data.account.platform });
  return { action: 'updated', creator_id: creatorId, name: data.name };
}

// ─── Create path ────────────────────────────────────────────────────

async function createNewCreator(
  data: DiscoveredCreator,
  posts: DiscoveredPost[] | undefined,
  signals: ReturnType<typeof analyzeText>,
  now: string,
): Promise<UpsertResult> {
  // ── Slug dedup: check for collision ──
  let slug = data.slug;
  const { data: slugOwner } = await supabaseAdmin
    .from('creators')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();

  if (slugOwner) {
    if (slugOwner.name.toLowerCase() === data.name.toLowerCase()) {
      // Same person on different platform → link account to existing creator
      const creatorId = slugOwner.id;
      await supabaseAdmin.from('creator_accounts').insert({
        creator_id: creatorId,
        platform: data.account.platform,
        handle: data.account.handle,
        profile_url: data.account.profile_url,
        followers: data.account.followers,
        platform_id: data.account.platform_id,
        bio: data.account.bio,
        verified: data.account.verified,
        last_scraped_at: now,
      });

      // Bump last_seen_at on the existing creator
      await supabaseAdmin.from('creators').update({
        last_seen_at: now,
        updated_at: now,
      }).eq('id', creatorId);

      log.info('pipeline.upsert: linked account to existing creator', {
        name: data.name, creator_id: creatorId, platform: data.account.platform,
      });
      return { action: 'updated', creator_id: creatorId, name: data.name };
    }

    // Different person → disambiguate slug
    slug = `${slug}-${data.account.platform}`;
  }

  // Build creator record
  const creatorData = {
    name: data.name,
    slug,
    website: data.website || null,
    total_followers: data.account.followers,
    has_course: signals.hasCourse,
    has_discord: signals.hasDiscord,
    has_telegram: signals.hasTelegram,
    promoting_prop_firms: signals.propFirms.length > 0,
    prop_firms_mentioned: signals.propFirms,
    lead_score: 0,
    confidence_score: 0,
    first_seen_at: now,
    last_seen_at: now,
  };

  const leadScore = computeLeadScore({ creator: creatorData, accounts: [data.account] });
  const confidenceScore = computeConfidenceScore({ creator: creatorData, accounts: [data.account] });

  const { data: newCreator, error: insertErr } = await supabaseAdmin
    .from('creators')
    .insert({ ...creatorData, lead_score: leadScore, confidence_score: confidenceScore })
    .select('id')
    .single();

  if (insertErr || !newCreator) {
    return { action: 'skipped', creator_id: null, name: data.name, error: insertErr?.message ?? 'Insert failed' };
  }

  await supabaseAdmin.from('creator_accounts').insert({
    creator_id: newCreator.id,
    platform: data.account.platform,
    handle: data.account.handle,
    profile_url: data.account.profile_url,
    followers: data.account.followers,
    platform_id: data.account.platform_id,
    bio: data.account.bio,
    verified: data.account.verified,
    last_scraped_at: now,
  });

  if (posts?.length) {
    await upsertPosts(newCreator.id, null, data.account.platform, posts);
  }

  log.info('pipeline.upsert: created', { name: data.name, creator_id: newCreator.id, platform: data.account.platform });
  return { action: 'created', creator_id: newCreator.id, name: data.name };
}

// ─── Post upsert ────────────────────────────────────────────────────

/**
 * Upsert posts — dedup by post_url, update metrics on existing.
 */
async function upsertPosts(
  creatorId: string,
  accountId: string | null,
  platform: Platform,
  posts: DiscoveredPost[],
) {
  for (const post of posts) {
    if (!post.post_url) continue;

    const { data: existing } = await supabaseAdmin
      .from('creator_posts')
      .select('id')
      .eq('post_url', post.post_url)
      .maybeSingle();

    const text = `${post.title ?? ''} ${post.content_snippet ?? ''}`;

    if (existing) {
      await supabaseAdmin.from('creator_posts').update({
        views: post.views,
        likes: post.likes,
        comments: post.comments,
      }).eq('id', existing.id);
    } else {
      await supabaseAdmin.from('creator_posts').insert({
        creator_id: creatorId,
        account_id: accountId,
        platform,
        post_url: post.post_url,
        title: post.title,
        content_snippet: post.content_snippet?.slice(0, 500),
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        published_at: post.published_at,
        mentions_prop_firm: detectPropFirmsFromSources(text).length > 0,
        mentions_course: COURSE_PATTERN.test(text),
      });
    }
  }
}

// ─── Discovery logging ──────────────────────────────────────────────

/**
 * Log a daily discovery run in the daily_discoveries table.
 */
export async function logDiscoveryRun(
  platform: Platform,
  newCount: number,
  updatedCount: number,
  errors: string[],
  status: 'completed' | 'failed',
) {
  if (!isSupabaseConfigured()) return;

  await supabaseAdmin.from('daily_discoveries').insert({
    run_date: new Date().toISOString().split('T')[0],
    platform,
    new_creators_found: newCount,
    existing_creators_updated: updatedCount,
    errors,
    status,
    completed_at: new Date().toISOString(),
  });
}
