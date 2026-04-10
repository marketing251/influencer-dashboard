/**
 * Pipeline utilities for normalizing and upserting creator data.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { detectPropFirmsFromSources } from './prop-firms';
import { extractAllSignals } from './social-links';
import { classifyPropFirm } from './prop-firm-classifier';
import { log } from './logger';
import type { Platform } from './types';

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
    ...signals,
  };
}

/**
 * A lead is outreach-ready if it has any viable contact path:
 *   email > phone > contact form > website we can crawl later > social profile DM
 *
 * The original rule required a website/email/phone/form and threw away
 * every creator whose only reachable channel was their social profile.
 * That lost dozens of valid leads per refresh (real YouTubers/IG users who
 * just don't link a site in their bio). A social profile URL is a valid
 * DM destination, so we accept it — leads with email still outrank
 * profile-only leads via lead_score (email = +25 points).
 *
 * Enforced at insert — updates are unrestricted because the lead already exists.
 */
function hasContactPath(data: DiscoveredCreator): boolean {
  if (data.website) return true;
  if (data.contact?.email || data.contact?.phone || data.contact?.contact_form_url) return true;
  if (data.account?.profile_url) return true;
  return false;
}

export interface DiscoveredCreator {
  name: string;
  slug: string;
  website?: string | null;
  bio?: string | null;
  source_type?: string;
  source_url?: string;
  /** Contact info discovered during fast-enrich — applied on insert. */
  contact?: {
    email?: string | null;
    phone?: string | null;
    contact_form_url?: string | null;
  };
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
  /** True if the newly-created row has an email on insert. */
  had_email?: boolean;
  had_phone?: boolean;
  had_form?: boolean;
}

function mergeUrl(existing: string | null | undefined, discovered: string | null | undefined): string | null {
  return existing || discovered || null;
}

function mergeBool(existing: boolean | undefined, discovered: boolean): boolean {
  return existing || discovered;
}

/**
 * Batch dedup check: given a list of candidates, return the set of
 * (platform, platform_id) / (platform, handle) / website-domain that
 * already exist in the DB. Avoids N+1 queries from upsertCreator.
 */
export interface ExistingIndex {
  platformIds: Set<string>;   // `${platform}::${platform_id_lower}`
  handles: Set<string>;       // `${platform}::${handle_lower}`
  domains: Set<string>;       // domain lowered
}

export async function buildExistingIndex(
  candidates: Pick<DiscoveredCreator, 'website' | 'account'>[],
): Promise<ExistingIndex> {
  const index: ExistingIndex = { platformIds: new Set(), handles: new Set(), domains: new Set() };
  if (!isSupabaseConfigured() || candidates.length === 0) return index;

  const platformIdPairs = new Map<Platform, string[]>();
  const handlePairs = new Map<Platform, string[]>();
  const domains = new Set<string>();

  for (const c of candidates) {
    const p = c.account.platform;
    if (c.account.platform_id) {
      const arr = platformIdPairs.get(p) ?? [];
      arr.push(c.account.platform_id);
      platformIdPairs.set(p, arr);
    }
    if (c.account.handle) {
      const arr = handlePairs.get(p) ?? [];
      arr.push(c.account.handle.toLowerCase().replace(/^@/, ''));
      handlePairs.set(p, arr);
    }
    if (c.website) {
      try { domains.add(new URL(c.website).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* skip */ }
    }
  }

  // Batch query creator_accounts by (platform, platform_id)
  for (const [platform, ids] of platformIdPairs) {
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const { data } = await supabaseAdmin
          .from('creator_accounts')
          .select('platform_id')
          .eq('platform', platform)
          .in('platform_id', chunk);
        for (const row of data ?? []) index.platformIds.add(`${platform}::${row.platform_id.toLowerCase()}`);
      } catch { /* ignore */ }
    }
  }

  // Batch query creator_accounts by (platform, handle)
  for (const [platform, handles] of handlePairs) {
    if (!handles.length) continue;
    for (let i = 0; i < handles.length; i += 200) {
      const chunk = handles.slice(i, i + 200);
      try {
        const { data } = await supabaseAdmin
          .from('creator_accounts')
          .select('handle')
          .eq('platform', platform)
          .in('handle', chunk);
        for (const row of data ?? []) index.handles.add(`${platform}::${row.handle.toLowerCase()}`);
      } catch { /* ignore */ }
    }
  }

  // Batch query creators by domain (exact hostname match is cheaper than ilike)
  const domainArr = [...domains];
  for (let i = 0; i < domainArr.length; i += 100) {
    const chunk = domainArr.slice(i, i + 100);
    const filter = chunk.map(d => `website.ilike.%${d}%`).join(',');
    if (!filter) continue;
    try {
      const { data } = await supabaseAdmin.from('creators').select('website').or(filter);
      for (const row of data ?? []) {
        if (!row.website) continue;
        try {
          const host = new URL(row.website).hostname.replace(/^www\./, '').toLowerCase();
          index.domains.add(host);
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  return index;
}

export function isAlreadyKnown(candidate: DiscoveredCreator, index: ExistingIndex): boolean {
  const platform = candidate.account.platform;
  if (candidate.account.platform_id && index.platformIds.has(`${platform}::${candidate.account.platform_id.toLowerCase()}`)) return true;
  const handle = candidate.account.handle?.toLowerCase().replace(/^@/, '');
  if (handle && index.handles.has(`${platform}::${handle}`)) return true;
  if (candidate.website) {
    try {
      const host = new URL(candidate.website).hostname.replace(/^www\./, '').toLowerCase();
      if (index.domains.has(host)) return true;
    } catch { /* skip */ }
  }
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
    let existing = (await supabaseAdmin
      .from('creator_accounts').select('creator_id, id')
      .eq('platform', data.account.platform).eq('platform_id', data.account.platform_id)
      .maybeSingle()).data;

    if (!existing) {
      const normalHandle = data.account.handle.toLowerCase().replace(/^@/, '');
      existing = (await supabaseAdmin
        .from('creator_accounts').select('creator_id, id')
        .eq('platform', data.account.platform).ilike('handle', normalHandle)
        .maybeSingle()).data;
    }

    if (!existing && data.website) {
      try {
        const domain = new URL(data.website).hostname.replace(/^www\./, '');
        const { data: match } = await supabaseAdmin
          .from('creators').select('id').ilike('website', `%${domain}%`).maybeSingle();
        if (match) {
          const { data: acc } = await supabaseAdmin
            .from('creator_accounts').select('id')
            .eq('creator_id', match.id).eq('platform', data.account.platform).maybeSingle();
          if (acc) existing = { creator_id: match.id, id: acc.id };
        }
      } catch { /* skip */ }
    }

    const postTexts = (posts ?? []).map(p => `${p.title ?? ''} ${p.content_snippet ?? ''}`);
    const signals = analyzeText([data.bio, data.account.bio, ...postTexts]);

    if (existing) {
      return await updateExisting(existing, data, posts, signals, now);
    }

    // Reject: no contact path
    if (!hasContactPath(data)) {
      return { action: 'skipped', creator_id: null, name: data.name, error: 'no_contact_path' };
    }

    // Reject: prop firm
    const firm = classifyPropFirm({ name: data.name, slug: data.slug, website: data.website, bio: data.bio });
    if (firm.is_prop_firm) {
      // Still record it so the dedup index catches it next time, but mark excluded
      await upsertExcludedPropFirm(data, now);
      return { action: 'skipped', creator_id: null, name: data.name, error: 'is_prop_firm' };
    }

    return await createNew(data, posts, signals, now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('pipeline.upsert: exception', { name: data.name, error: msg });
    return { action: 'skipped', creator_id: null, name: data.name, error: msg };
  }
}

async function upsertExcludedPropFirm(data: DiscoveredCreator, now: string): Promise<void> {
  try {
    // Upsert a shell row flagged as excluded so we don't re-discover it every refresh.
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { data: existing } = await supabaseAdmin.from('creators').select('id').eq('slug', slug).maybeSingle();
    if (existing) {
      await supabaseAdmin.from('creators').update({
        is_prop_firm: true, excluded_from_leads: true, updated_at: now,
      }).eq('id', existing.id);
      return;
    }
    await supabaseAdmin.from('creators').insert({
      name: data.name,
      slug,
      website: data.website ?? null,
      is_prop_firm: true,
      excluded_from_leads: true,
      source_type: data.source_type ?? null,
      source_url: data.source_url ?? null,
      first_seen_at: now,
      last_seen_at: now,
    });
  } catch {
    // silent — excluded rows are best-effort tracking
  }
}

async function updateExisting(
  existing: { creator_id: string; id: string },
  data: DiscoveredCreator, posts: DiscoveredPost[] | undefined,
  signals: ReturnType<typeof analyzeText>, now: string,
): Promise<UpsertResult> {
  const creatorId = existing.creator_id;
  const { data: current } = await supabaseAdmin.from('creators').select('*').eq('id', creatorId).single();
  if (!current) return { action: 'skipped', creator_id: creatorId, name: data.name, error: 'missing' };

  const mergedFirms = [...new Set([...(current.prop_firms_mentioned ?? []), ...signals.propFirms])];
  const { data: allAccounts } = await supabaseAdmin.from('creator_accounts').select('followers, platform, verified').eq('creator_id', creatorId);
  const accs = (allAccounts ?? []).map(a => a.platform === data.account.platform ? { ...a, followers: data.account.followers } : a);
  const totalFollowers = accs.reduce((s, a) => s + (a.followers ?? 0), 0);

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
    public_email: current.public_email || data.contact?.email || null,
    public_phone: current.public_phone || data.contact?.phone || null,
    contact_form_url: current.contact_form_url || data.contact?.contact_form_url || null,
    instagram_url: mergeUrl(current.instagram_url, signals.instagram_url),
    linkedin_url: mergeUrl(current.linkedin_url, signals.linkedin_url),
    youtube_url: mergeUrl(current.youtube_url, signals.youtube_url),
    x_url: mergeUrl(current.x_url, signals.x_url),
    discord_url: mergeUrl(current.discord_url, signals.discord_url),
    telegram_url: mergeUrl(current.telegram_url, signals.telegram_url),
    link_in_bio_url: mergeUrl(current.link_in_bio_url, signals.link_in_bio_url),
    course_url: mergeUrl(current.course_url, signals.course_url),
    source_type: current.source_type || data.source_type || null,
    source_url: current.source_url || data.source_url || null,
  };

  const leadScore = computeLeadScore({ creator: { ...current, ...merged }, accounts: accs });
  const confidenceScore = computeConfidenceScore({ creator: { ...current, ...merged }, accounts: accs });

  await supabaseAdmin.from('creators').update({
    ...merged, lead_score: leadScore, confidence_score: confidenceScore,
    last_seen_at: now, updated_at: now,
  }).eq('id', creatorId);

  await supabaseAdmin.from('creator_accounts').update({
    followers: data.account.followers, bio: data.account.bio,
    verified: data.account.verified, last_scraped_at: now, updated_at: now,
  }).eq('id', existing.id);

  if (posts?.length) await upsertPosts(creatorId, existing.id, data.account.platform, posts);
  return {
    action: 'updated',
    creator_id: creatorId,
    name: data.name,
    had_email: Boolean(merged.public_email && !current.public_email),
    had_phone: Boolean(merged.public_phone && !current.public_phone),
    had_form: Boolean(merged.contact_form_url && !current.contact_form_url),
  };
}

async function createNew(
  data: DiscoveredCreator, posts: DiscoveredPost[] | undefined,
  signals: ReturnType<typeof analyzeText>, now: string,
): Promise<UpsertResult> {
  let slug = data.slug;
  const { data: owner } = await supabaseAdmin.from('creators').select('id, name').eq('slug', slug).maybeSingle();

  if (owner) {
    if (owner.name.toLowerCase() === data.name.toLowerCase()) {
      const { data: acc } = await supabaseAdmin.from('creator_accounts').select('id')
        .eq('creator_id', owner.id).eq('platform', data.account.platform).maybeSingle();
      if (acc) {
        await supabaseAdmin.from('creator_accounts').update({
          followers: data.account.followers, bio: data.account.bio,
          verified: data.account.verified, last_scraped_at: now, updated_at: now,
        }).eq('id', acc.id);
      } else {
        await supabaseAdmin.from('creator_accounts').insert({
          creator_id: owner.id, platform: data.account.platform,
          handle: data.account.handle, profile_url: data.account.profile_url,
          followers: data.account.followers, platform_id: data.account.platform_id,
          bio: data.account.bio, verified: data.account.verified, last_scraped_at: now,
        });
      }
      await supabaseAdmin.from('creators').update({ last_seen_at: now, updated_at: now }).eq('id', owner.id);
      return { action: 'updated', creator_id: owner.id, name: data.name };
    }
    slug = `${slug}-${data.account.platform}`;
  }

  const rec = {
    name: data.name, slug, website: data.website || null,
    public_email: data.contact?.email ?? null,
    public_phone: data.contact?.phone ?? null,
    contact_form_url: data.contact?.contact_form_url ?? null,
    total_followers: data.account.followers,
    has_course: signals.hasCourse, has_discord: signals.hasDiscord, has_telegram: signals.hasTelegram,
    has_skool: signals.has_skool, has_whop: signals.has_whop,
    promoting_prop_firms: signals.propFirms.length > 0, prop_firms_mentioned: signals.propFirms,
    instagram_url: signals.instagram_url, linkedin_url: signals.linkedin_url,
    youtube_url: signals.youtube_url, x_url: signals.x_url,
    discord_url: signals.discord_url, telegram_url: signals.telegram_url,
    link_in_bio_url: signals.link_in_bio_url, course_url: signals.course_url,
    primary_platform: data.account.platform,
    source_type: data.source_type || null, source_url: data.source_url || null,
    lead_score: 0, confidence_score: 0, first_seen_at: now, last_seen_at: now,
  };

  const ls = computeLeadScore({ creator: rec, accounts: [data.account] });
  const cs = computeConfidenceScore({ creator: rec, accounts: [data.account] });

  const { data: created, error } = await supabaseAdmin
    .from('creators').insert({ ...rec, lead_score: ls, confidence_score: cs }).select('id').single();
  if (error || !created) return { action: 'skipped', creator_id: null, name: data.name, error: error?.message ?? 'insert failed' };

  await supabaseAdmin.from('creator_accounts').insert({
    creator_id: created.id, platform: data.account.platform,
    handle: data.account.handle, profile_url: data.account.profile_url,
    followers: data.account.followers, platform_id: data.account.platform_id,
    bio: data.account.bio, verified: data.account.verified, last_scraped_at: now,
  });

  if (posts?.length) await upsertPosts(created.id, null, data.account.platform, posts);
  return {
    action: 'created',
    creator_id: created.id,
    name: data.name,
    had_email: Boolean(rec.public_email),
    had_phone: Boolean(rec.public_phone),
    had_form: Boolean(rec.contact_form_url),
  };
}

async function upsertPosts(creatorId: string, accountId: string | null, platform: Platform, posts: DiscoveredPost[]) {
  for (const post of posts) {
    if (!post.post_url) continue;
    const { data: ex } = await supabaseAdmin.from('creator_posts').select('id').eq('post_url', post.post_url).maybeSingle();
    const text = `${post.title ?? ''} ${post.content_snippet ?? ''}`;
    if (ex) {
      await supabaseAdmin.from('creator_posts').update({ views: post.views, likes: post.likes, comments: post.comments }).eq('id', ex.id);
    } else {
      await supabaseAdmin.from('creator_posts').insert({
        creator_id: creatorId, account_id: accountId, platform, post_url: post.post_url,
        title: post.title, content_snippet: post.content_snippet?.slice(0, 500),
        views: post.views, likes: post.likes, comments: post.comments, published_at: post.published_at,
        mentions_prop_firm: detectPropFirmsFromSources(text).length > 0,
        mentions_course: COURSE_PATTERN.test(text),
      });
    }
  }
}

export async function logDiscoveryRun(
  platform: Platform, newCount: number, updatedCount: number, errors: string[], status: 'completed' | 'failed',
) {
  if (!isSupabaseConfigured()) return;
  await supabaseAdmin.from('daily_discoveries').insert({
    run_date: new Date().toISOString().split('T')[0], platform,
    new_creators_found: newCount, existing_creators_updated: updatedCount,
    errors, status, completed_at: new Date().toISOString(),
  });
}
