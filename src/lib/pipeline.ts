/**
 * Pipeline utilities for normalizing and upserting creator data.
 * Central place for DB writes so discovery routes stay focused on fetching.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { detectPropFirmsFromSources } from './prop-firms';
import { extractAllSignals } from './social-links';
import { log } from './logger';
import type { Platform } from './types';

// ─── Text analysis ──────────────────────────────────────────────────

const COURSE_PATTERN = /\b(?:course|mentor(?:ship)?|academy|learn|enroll|program|masterclass|bootcamp|curriculum|coaching|training|workshop|certification)\b/i;
const DISCORD_PATTERN = /discord\.(?:gg|com\/invite)\//i;
const TELEGRAM_PATTERN = /t\.me\//i;

function analyzeText(texts: (string | null | undefined)[]) {
  const combined = texts.filter(Boolean).join(' ');
  const signals = extractAllSignals(...texts);
  return {
    propFirms: detectPropFirmsFromSources(...texts),
    hasCourse: COURSE_PATTERN.test(combined),
    hasDiscord: DISCORD_PATTERN.test(combined),
    hasTelegram: TELEGRAM_PATTERN.test(combined),
    ...signals, // instagram_url, linkedin_url, youtube_url, x_url, discord_url, telegram_url, link_in_bio_url, course_url, has_skool, has_whop
  };
}

// ─── Public types ───────────────────────────────────────────────────

export interface DiscoveredCreator {
  name: string;
  slug: string;
  website?: string | null;
  bio?: string | null;
  source_type?: string;
  source_url?: string;
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
 * Contact qualification: a lead must have a reachable contact path.
 * Leads without at least a website are rejected — we need somewhere
 * to extract email/phone/contact form from during enrichment.
 */
function hasContactPath(data: DiscoveredCreator): boolean {
  // Must have a website — this is where we extract emails from
  if (data.website) return true;
  // Seeds with known websites in the seed data pass
  if (data.source_type === 'seed' && data.website) return true;
  // YouTube channels always have a public channel page (contactable via YouTube)
  // but ONLY if they have significant following (worth the outreach effort)
  if (data.source_type === 'youtube_api' && data.account.followers >= 1000) return true;
  // X profiles with bios containing URLs pass
  if (data.source_type === 'x_api' && data.bio && /https?:\/\//i.test(data.bio)) return true;
  return false;
}

export async function upsertCreator(
  data: DiscoveredCreator,
  posts?: DiscoveredPost[],
): Promise<UpsertResult> {
  if (!isSupabaseConfigured()) {
    return { action: 'skipped', creator_id: null, name: data.name, error: 'No database configured' };
  }

  const now = new Date().toISOString();

  try {
    // Dedup check 1: exact (platform, platform_id) match
    let existing = (await supabaseAdmin
      .from('creator_accounts')
      .select('creator_id, id')
      .eq('platform', data.account.platform)
      .eq('platform_id', data.account.platform_id)
      .maybeSingle()).data;

    // Dedup check 2: same platform + normalized handle (catches format differences)
    if (!existing) {
      const normalHandle = data.account.handle.toLowerCase().replace(/^@/, '');
      existing = (await supabaseAdmin
        .from('creator_accounts')
        .select('creator_id, id')
        .eq('platform', data.account.platform)
        .ilike('handle', normalHandle)
        .maybeSingle()).data;
    }

    // Dedup check 3: same website domain → same creator (cross-platform unification)
    if (!existing && data.website) {
      try {
        const domain = new URL(data.website).hostname.replace(/^www\./, '');
        const { data: websiteMatch } = await supabaseAdmin
          .from('creators')
          .select('id')
          .ilike('website', `%${domain}%`)
          .maybeSingle();
        if (websiteMatch) {
          // Link this account to the existing creator
          const creatorId = websiteMatch.id;
          const { data: accountCheck } = await supabaseAdmin
            .from('creator_accounts')
            .select('id')
            .eq('creator_id', creatorId)
            .eq('platform', data.account.platform)
            .maybeSingle();
          if (accountCheck) {
            existing = { creator_id: creatorId, id: accountCheck.id };
          }
        }
      } catch { /* invalid URL, skip domain dedup */ }
    }

    const postTexts = (posts ?? []).map(p => `${p.title ?? ''} ${p.content_snippet ?? ''}`);
    const signals = analyzeText([data.bio, data.account.bio, ...postTexts]);

    if (existing) {
      return await updateExistingCreator(existing, data, posts, signals, now);
    }

    // Contact qualification: reject leads without any contact path
    if (!hasContactPath(data)) {
      log.info('pipeline.upsert: rejected (no contact path)', { name: data.name, platform: data.account.platform });
      return { action: 'skipped', creator_id: null, name: data.name, error: 'no_contact_path' };
    }

    return await createNewCreator(data, posts, signals, now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('pipeline.upsertCreator: exception', { name: data.name, error: msg });
    return { action: 'skipped', creator_id: null, name: data.name, error: msg };
  }
}

// ─── Merge helper: only fill empty fields ───────────────────────────

function mergeUrl(existing: string | null | undefined, discovered: string | null | undefined): string | null {
  return existing || discovered || null;
}

function mergeBool(existing: boolean | undefined, discovered: boolean): boolean {
  return existing || discovered;
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

  const { data: current } = await supabaseAdmin
    .from('creators').select('*').eq('id', creatorId).single();

  if (!current) {
    return { action: 'skipped', creator_id: creatorId, name: data.name, error: 'Creator record missing' };
  }

  const mergedFirms = [...new Set([...(current.prop_firms_mentioned ?? []), ...signals.propFirms])];

  const { data: allAccounts } = await supabaseAdmin
    .from('creator_accounts').select('followers, platform, verified').eq('creator_id', creatorId);

  const accountsForScoring = (allAccounts ?? []).map(a =>
    a.platform === data.account.platform ? { ...a, followers: data.account.followers } : a,
  );
  const totalFollowers = accountsForScoring.reduce((sum, a) => sum + (a.followers ?? 0), 0);

  const merged = {
    total_followers: totalFollowers,
    has_course: mergeBool(current.has_course, signals.hasCourse),
    has_discord: mergeBool(current.has_discord, signals.hasDiscord),
    has_telegram: mergeBool(current.has_telegram, signals.hasTelegram),
    has_skool: mergeBool(current.has_skool, signals.has_skool),
    has_whop: mergeBool(current.has_whop, signals.has_whop),
    promoting_prop_firms: current.promoting_prop_firms || mergedFirms.length > 0,
    prop_firms_mentioned: mergedFirms,
    website: mergeUrl(current.website, data.website),
    instagram_url: mergeUrl(current.instagram_url, signals.instagram_url),
    linkedin_url: mergeUrl(current.linkedin_url, signals.linkedin_url),
    youtube_url: mergeUrl(current.youtube_url, signals.youtube_url),
    x_url: mergeUrl(current.x_url, signals.x_url),
    discord_url: mergeUrl(current.discord_url, signals.discord_url),
    telegram_url: mergeUrl(current.telegram_url, signals.telegram_url),
    link_in_bio_url: mergeUrl(current.link_in_bio_url, signals.link_in_bio_url),
    course_url: mergeUrl(current.course_url, signals.course_url),
    contact_form_url: current.contact_form_url || null,
    source_type: current.source_type || data.source_type || null,
    source_url: current.source_url || data.source_url || null,
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

  await supabaseAdmin.from('creator_accounts').update({
    followers: data.account.followers,
    bio: data.account.bio,
    verified: data.account.verified,
    last_scraped_at: now,
    updated_at: now,
  }).eq('id', existing.id);

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
  let slug = data.slug;
  const { data: slugOwner } = await supabaseAdmin
    .from('creators').select('id, name').eq('slug', slug).maybeSingle();

  if (slugOwner) {
    if (slugOwner.name.toLowerCase() === data.name.toLowerCase()) {
      // Same person — check if they already have this platform account
      const creatorId = slugOwner.id;
      const { data: existingAcc } = await supabaseAdmin
        .from('creator_accounts')
        .select('id')
        .eq('creator_id', creatorId)
        .eq('platform', data.account.platform)
        .maybeSingle();

      if (existingAcc) {
        // Account already linked — just update it and bump timestamps
        await supabaseAdmin.from('creator_accounts').update({
          followers: data.account.followers, bio: data.account.bio,
          verified: data.account.verified, last_scraped_at: now, updated_at: now,
        }).eq('id', existingAcc.id);
      } else {
        // New platform account for existing creator
        await supabaseAdmin.from('creator_accounts').insert({
          creator_id: creatorId, platform: data.account.platform,
          handle: data.account.handle, profile_url: data.account.profile_url,
          followers: data.account.followers, platform_id: data.account.platform_id,
          bio: data.account.bio, verified: data.account.verified, last_scraped_at: now,
        });
      }
      await supabaseAdmin.from('creators').update({ last_seen_at: now, updated_at: now }).eq('id', creatorId);
      log.info('pipeline.upsert: linked/updated account', { name: data.name, creator_id: creatorId, platform: data.account.platform });
      return { action: 'updated', creator_id: creatorId, name: data.name };
    }
    slug = `${slug}-${data.account.platform}`;
  }

  const creatorData = {
    name: data.name,
    slug,
    website: data.website || null,
    total_followers: data.account.followers,
    has_course: signals.hasCourse,
    has_discord: signals.hasDiscord,
    has_telegram: signals.hasTelegram,
    has_skool: signals.has_skool,
    has_whop: signals.has_whop,
    promoting_prop_firms: signals.propFirms.length > 0,
    prop_firms_mentioned: signals.propFirms,
    instagram_url: signals.instagram_url,
    linkedin_url: signals.linkedin_url,
    youtube_url: signals.youtube_url,
    x_url: signals.x_url,
    discord_url: signals.discord_url,
    telegram_url: signals.telegram_url,
    link_in_bio_url: signals.link_in_bio_url,
    course_url: signals.course_url,
    primary_platform: data.account.platform,
    source_type: data.source_type || null,
    source_url: data.source_url || null,
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
    .select('id').single();

  if (insertErr || !newCreator) {
    return { action: 'skipped', creator_id: null, name: data.name, error: insertErr?.message ?? 'Insert failed' };
  }

  await supabaseAdmin.from('creator_accounts').insert({
    creator_id: newCreator.id, platform: data.account.platform,
    handle: data.account.handle, profile_url: data.account.profile_url,
    followers: data.account.followers, platform_id: data.account.platform_id,
    bio: data.account.bio, verified: data.account.verified, last_scraped_at: now,
  });

  if (posts?.length) {
    await upsertPosts(newCreator.id, null, data.account.platform, posts);
  }

  log.info('pipeline.upsert: created', { name: data.name, creator_id: newCreator.id, platform: data.account.platform });
  return { action: 'created', creator_id: newCreator.id, name: data.name };
}

// ─── Post upsert ────────────────────────────────────────────────────

async function upsertPosts(creatorId: string, accountId: string | null, platform: Platform, posts: DiscoveredPost[]) {
  for (const post of posts) {
    if (!post.post_url) continue;
    const { data: existing } = await supabaseAdmin
      .from('creator_posts').select('id').eq('post_url', post.post_url).maybeSingle();

    const text = `${post.title ?? ''} ${post.content_snippet ?? ''}`;
    if (existing) {
      await supabaseAdmin.from('creator_posts').update({
        views: post.views, likes: post.likes, comments: post.comments,
      }).eq('id', existing.id);
    } else {
      await supabaseAdmin.from('creator_posts').insert({
        creator_id: creatorId, account_id: accountId, platform, post_url: post.post_url,
        title: post.title, content_snippet: post.content_snippet?.slice(0, 500),
        views: post.views, likes: post.likes, comments: post.comments,
        published_at: post.published_at,
        mentions_prop_firm: detectPropFirmsFromSources(text).length > 0,
        mentions_course: COURSE_PATTERN.test(text),
      });
    }
  }
}

// ─── Discovery logging ──────────────────────────────────────────────

export async function logDiscoveryRun(
  platform: Platform, newCount: number, updatedCount: number,
  errors: string[], status: 'completed' | 'failed',
) {
  if (!isSupabaseConfigured()) return;
  await supabaseAdmin.from('daily_discoveries').insert({
    run_date: new Date().toISOString().split('T')[0], platform,
    new_creators_found: newCount, existing_creators_updated: updatedCount,
    errors, status, completed_at: new Date().toISOString(),
  });
}
