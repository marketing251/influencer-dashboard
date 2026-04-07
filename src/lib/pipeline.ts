/**
 * Pipeline utilities for normalizing and upserting creator data.
 * Central place for DB writes so discovery routes stay focused on fetching.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { detectPropFirmsFromSources } from './prop-firms';
import { log } from './logger';
import type { Platform } from './types';

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
    // Check if this platform account already exists
    const { data: existing } = await supabaseAdmin
      .from('creator_accounts')
      .select('creator_id, id')
      .eq('platform', data.account.platform)
      .eq('platform_id', data.account.platform_id)
      .maybeSingle();

    // Merge prop firm detection from all text sources
    const allText = [data.bio, data.account.bio, ...(posts ?? []).map(p => `${p.title ?? ''} ${p.content_snippet ?? ''}`)];
    const propFirms = detectPropFirmsFromSources(...allText);
    const hasCourse = /course|mentor|academy|learn|enroll|program|masterclass|bootcamp|curriculum/i.test(allText.join(' '));
    const hasDiscord = /discord\.gg|discord\.com\/invite/i.test(allText.join(' '));
    const hasTelegram = /t\.me\//i.test(allText.join(' '));

    if (existing) {
      // --- UPDATE existing creator ---
      const creatorId = existing.creator_id;

      // Fetch current creator to merge, not overwrite
      const { data: current } = await supabaseAdmin
        .from('creators')
        .select('*')
        .eq('id', creatorId)
        .single();

      if (!current) {
        return { action: 'skipped', creator_id: creatorId, name: data.name, error: 'Creator record missing' };
      }

      // Merge prop firms (union of existing + new)
      const mergedFirms = [...new Set([...(current.prop_firms_mentioned ?? []), ...propFirms])];

      // Recalculate total followers: fetch all accounts for this creator
      const { data: allAccounts } = await supabaseAdmin
        .from('creator_accounts')
        .select('followers, platform, verified')
        .eq('creator_id', creatorId);

      // Update the account that matched
      const updatedFollowers = data.account.followers;
      const accountsForScoring = (allAccounts ?? []).map(a =>
        a.platform === data.account.platform ? { ...a, followers: updatedFollowers } : a,
      );
      const totalFollowers = accountsForScoring.reduce((sum, a) => sum + (a.followers ?? 0), 0);

      const updatedCreator = {
        ...current,
        total_followers: totalFollowers,
        has_course: current.has_course || hasCourse,
        has_discord: current.has_discord || hasDiscord,
        has_telegram: current.has_telegram || hasTelegram,
        promoting_prop_firms: current.promoting_prop_firms || mergedFirms.length > 0,
        prop_firms_mentioned: mergedFirms,
        website: current.website || data.website || null,
      };

      const leadScore = computeLeadScore({ creator: updatedCreator, accounts: accountsForScoring });
      const confidenceScore = computeConfidenceScore({ creator: updatedCreator, accounts: accountsForScoring });

      await supabaseAdmin.from('creators').update({
        total_followers: totalFollowers,
        has_course: updatedCreator.has_course,
        has_discord: updatedCreator.has_discord,
        has_telegram: updatedCreator.has_telegram,
        promoting_prop_firms: updatedCreator.promoting_prop_firms,
        prop_firms_mentioned: mergedFirms,
        website: updatedCreator.website,
        lead_score: leadScore,
        confidence_score: confidenceScore,
        updated_at: now,
      }).eq('id', creatorId);

      // Update account
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

      log.info('pipeline.upsertCreator: updated', { name: data.name, creator_id: creatorId, platform: data.account.platform });
      return { action: 'updated', creator_id: creatorId, name: data.name };

    } else {
      // --- CREATE new creator ---

      // Check for slug collision
      let slug = data.slug;
      const { data: slugCheck } = await supabaseAdmin
        .from('creators')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (slugCheck) {
        // Check if this is the same person (different platform)
        // by checking if they have similar name
        const { data: existingCreator } = await supabaseAdmin
          .from('creators')
          .select('id, name')
          .eq('slug', slug)
          .single();

        if (existingCreator && existingCreator.name.toLowerCase() === data.name.toLowerCase()) {
          // Same person, different platform — add account to existing creator
          const creatorId = existingCreator.id;
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

          log.info('pipeline.upsertCreator: linked account to existing creator', {
            name: data.name, creator_id: creatorId, platform: data.account.platform,
          });
          return { action: 'updated', creator_id: creatorId, name: data.name };
        }

        // Different person, append platform to slug
        slug = `${slug}-${data.account.platform}`;
      }

      const creatorData = {
        name: data.name,
        slug,
        website: data.website || null,
        total_followers: data.account.followers,
        has_course: hasCourse,
        has_discord: hasDiscord,
        has_telegram: hasTelegram,
        promoting_prop_firms: propFirms.length > 0,
        prop_firms_mentioned: propFirms,
        lead_score: 0,
        confidence_score: 0,
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

      log.info('pipeline.upsertCreator: created', { name: data.name, creator_id: newCreator.id, platform: data.account.platform });
      return { action: 'created', creator_id: newCreator.id, name: data.name };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('pipeline.upsertCreator: exception', { name: data.name, error: msg });
    return { action: 'skipped', creator_id: null, name: data.name, error: msg };
  }
}

/**
 * Upsert posts — skip duplicates by post_url.
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

    if (existing) {
      // Update metrics
      await supabaseAdmin.from('creator_posts').update({
        views: post.views,
        likes: post.likes,
        comments: post.comments,
      }).eq('id', existing.id);
    } else {
      const text = `${post.title ?? ''} ${post.content_snippet ?? ''}`;
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
        mentions_course: /course|mentor|academy|learn|enroll|program/i.test(text),
      });
    }
  }
}

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
