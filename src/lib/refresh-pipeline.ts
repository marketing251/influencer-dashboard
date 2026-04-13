/**
 * Time-aware Refresh Leads pipeline for Vercel Pro (~300s budget).
 * X (Twitter) is the PRIMARY discovery source — runs first with inline
 * enrichment so email-based dedup and the strict email-or-phone filter
 * both have data to work with before secondary sources even start.
 *
 * Phase structure:
 *   0. Backfill prop-firm exclusion + placeholder email cleanup
 *   1a. X Primary Discovery — keyword search + network expansion (60s)
 *   1b. X Inline Enrichment — fast-enrich + bio-email on X candidates (45s)
 *   1c. Secondary Sources — YouTube, IG seeds, LI seeds, CSE, Reddit (50s)
 *   2. Dedup (in-memory + batch DB + email-based)
 *   3. Enrichment + upsert of secondary candidates (60s)
 *   4. Follow-up enrichment of stored leads missing email (30s)
 *   5. NL niche classification (10s)
 */

import { supabaseAdmin, isSupabaseConfigured } from './db';
import {
  discoverYouTubeCreators,
  type YouTubeKeywordGroup,
} from './integrations/youtube';
import {
  discoverXCreators,
  discoverXExpansion,
  type XDiscoveryResult,
} from './integrations/x';
import { discoverViaWebSearch } from './integrations/web-search';
import { fastEnrich, isPlaceholderEmail, extractEmailFromBio } from './integrations/fast-enrich';
import { knowledgeGraphBest, isKnowledgeGraphConfigured } from './integrations/google-knowledge-graph';
import { classifyNicheWithNL, isNaturalLanguageConfigured } from './integrations/google-natural-language';
import { discoverAcrossPlatforms, isGoogleSearchConfigured, type CrossPlatformCandidate } from './integrations/google-search';
import { discoverViaReddit, isRedditConfigured } from './integrations/reddit-discovery';
import { verifyCandidate } from './verification';
import type { Platform } from './types';
import {
  upsertCreator,
  buildExistingIndex,
  isAlreadyKnown,
  type DiscoveredCreator,
  type DiscoveredPost,
} from './pipeline';
import { classifyPropFirm, backfillPropFirmExclusion } from './prop-firm-classifier';
import { computeLeadScore, computeConfidenceScore } from './scoring';
import { log } from './logger';

// ─── Types ──────────────────────────────────────────────────────────

export type RefreshPhase =
  | 'init'
  | 'backfill_exclusion'
  | 'x_discovery'
  | 'x_enrichment'
  | 'discovery'
  | 'dedup'
  | 'enrichment'
  | 'followup_enrichment'
  | 'done';

export interface RefreshCounts {
  attempted: number;
  discovered: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  excluded_prop_firm: number;
  with_email: number;
  with_phone: number;
  with_form: number;
  errors: number;
  // X-specific metrics
  x_discovered: number;
  x_expanded: number;
  x_enriched: number;
  x_with_email: number;
  x_with_website: number;
  // Enrichment metrics
  enrichment_attempts: number;
  enrichment_success: number;
  hard_filtered: number;
}

export interface RefreshSources {
  youtube: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  x: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  x_expansion: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  instagram_web: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  linkedin_web: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  google_cse: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  reddit: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
}

export interface RefreshProgress extends RefreshCounts {
  phase: RefreshPhase;
  message: string;
  elapsed_ms: number;
  batch_index?: number;
  batch_total?: number;
  time_budget_ms: number;
  remaining_ms: number;
  sources: RefreshSources;
}

export interface RefreshResult extends RefreshProgress {
  phase: 'done';
  started_at: string;
  completed_at: string;
  email_rate: number;
  enrichment_rate: number;
  stopped_reason: 'completed' | 'time_budget' | 'aborted';
}

export interface RefreshOpts {
  timeBudgetMs?: number;
  enrichConcurrency?: number;
  maxEnrichCandidates?: number;
  onProgress?: (event: RefreshProgress) => void;
  signal?: AbortSignal;
}

type CandidatePacket = { creator: DiscoveredCreator; posts: DiscoveredPost[]; _xEnriched?: boolean };

// ─── Helpers ────────────────────────────────────────────────────────

function emptyCounts(): RefreshCounts {
  return {
    attempted: 0, discovered: 0, inserted: 0, duplicates: 0,
    rejected: 0, excluded_prop_firm: 0,
    with_email: 0, with_phone: 0, with_form: 0, errors: 0,
    x_discovered: 0, x_expanded: 0, x_enriched: 0, x_with_email: 0, x_with_website: 0,
    enrichment_attempts: 0, enrichment_success: 0, hard_filtered: 0,
  };
}

function emptySources(): RefreshSources {
  return {
    youtube: { discovered: 0, status: 'ok' },
    x: { discovered: 0, status: 'ok' },
    x_expansion: { discovered: 0, status: 'ok' },
    instagram_web: { discovered: 0, status: 'ok' },
    linkedin_web: { discovered: 0, status: 'ok' },
    google_cse: { discovered: 0, status: 'ok' },
    reddit: { discovered: 0, status: 'ok' },
  };
}

async function pLimit<T>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<void>, shouldStop?: () => boolean) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (i < items.length) {
      if (shouldStop?.()) return;
      const idx = i++;
      try { await fn(items[idx], idx); } catch { /* per-item error handled inside fn */ }
    }
  });
  await Promise.all(workers);
}

// ─── Main pipeline ──────────────────────────────────────────────────

export async function runRefreshPipeline(opts: RefreshOpts = {}): Promise<RefreshResult> {
  const {
    timeBudgetMs = 265_000,
    enrichConcurrency = 8,
    maxEnrichCandidates = 500,
    onProgress,
    signal,
  } = opts;

  const started = Date.now();
  const startedIso = new Date(started).toISOString();
  const counts = emptyCounts();
  const sources = emptySources();

  const deadline = started + timeBudgetMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const aborted = () => Boolean(signal?.aborted);
  const timeIsUp = () => remaining() <= 0 || aborted();

  const emit = (phase: RefreshPhase, message: string, extra?: Partial<RefreshProgress>) => {
    const event: RefreshProgress = {
      ...counts, phase, message,
      elapsed_ms: Date.now() - started,
      time_budget_ms: timeBudgetMs,
      remaining_ms: remaining(),
      sources, ...extra,
    };
    try { onProgress?.(event); } catch { /* never let the sink break the pipeline */ }
  };

  emit('init', 'Starting refresh');
  log.info('refresh-pipeline: starting', { timeBudgetMs });

  const pendingCandidates: CandidatePacket[] = [];
  const hasX = Boolean(process.env.X_BEARER_TOKEN);
  const hasYouTube = Boolean(process.env.YOUTUBE_API_KEY);

  // ─── Phase 0: backfill exclusion + placeholder cleanup ────────────
  if (isSupabaseConfigured()) {
    emit('backfill_exclusion', 'Cleaning prop-firm exclusions');
    try {
      const updated = await backfillPropFirmExclusion();
      if (updated > 0) emit('backfill_exclusion', `Excluded ${updated} prop-firm rows from leads`);
    } catch (err) {
      log.warn('refresh-pipeline: exclusion backfill failed', { error: String(err) });
    }

    try {
      const { data: suspect } = await supabaseAdmin
        .from('creators').select('id, public_email')
        .not('public_email', 'is', null)
        .order('last_seen_at', { ascending: false }).limit(500);
      const toNull: string[] = [];
      for (const row of suspect ?? []) {
        if (row.public_email && isPlaceholderEmail(row.public_email)) toNull.push(row.id);
      }
      if (toNull.length > 0) {
        await supabaseAdmin.from('creators')
          .update({ public_email: null, updated_at: new Date().toISOString() })
          .in('id', toNull);
        emit('backfill_exclusion', `Removed ${toNull.length} placeholder emails`);
      }
    } catch { /* ignore */ }
  }

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1a: X PRIMARY DISCOVERY (budget: ~60s)
  // X runs FIRST, solo, with the most time. This is the main discovery
  // source — everything else is supplementary.
  // ═══════════════════════════════════════════════════════════════════

  if (hasX) {
    emit('x_discovery', 'X Primary Discovery — searching trading keywords');
    const xBudgetDeadline = Math.min(Date.now() + 60_000, deadline - 120_000);
    const xSignal = timeoutSignal(xBudgetDeadline, signal);

    let xResults: XDiscoveryResult[] = [];
    try {
      xResults = await discoverXCreators({
        maxPerQuery: 100,     // full page size (was 20)
        minFollowers: 500,    // lower threshold to catch emerging creators
        delayMs: 1_500,
        maxPages: 2,          // paginate if tier allows
        signal: xSignal,
      });
      sources.x = { discovered: xResults.length, status: 'ok' };
      counts.x_discovered = xResults.length;
      counts.discovered += xResults.length;
      emit('x_discovery', `X search returned ${xResults.length} candidates`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sources.x = { discovered: 0, status: 'error', note: msg };
      counts.errors++;
      log.warn('refresh-pipeline: X discovery failed', { error: msg });
    }

    // Network expansion: get likers + followers of top seed accounts
    if (xResults.length > 0 && remaining() > 120_000 && !aborted()) {
      emit('x_discovery', 'X Network Expansion — expanding from seed accounts');
      try {
        const expanded = await discoverXExpansion({
          seedResults: xResults,
          maxSeedAccounts: 10,
          minSeedFollowers: 5_000,
          delayMs: 1_500,
          signal: xSignal,
        });
        sources.x_expansion = { discovered: expanded.length, status: 'ok' };
        counts.x_expanded = expanded.length;
        counts.discovered += expanded.length;
        xResults.push(...expanded);
        emit('x_discovery', `X expansion added ${expanded.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources.x_expansion = { discovered: 0, status: 'error', note: msg };
        log.warn('refresh-pipeline: X expansion failed', { error: msg });
      }
    } else {
      sources.x_expansion = { discovered: 0, status: 'skipped', note: 'No seeds or insufficient time' };
    }

    // Count how many X candidates have a website
    for (const r of xResults) {
      if (r.creator.website) counts.x_with_website++;
    }
    pendingCandidates.push(...xResults);
  } else {
    sources.x = { discovered: 0, status: 'skipped', note: 'X_BEARER_TOKEN not set' };
    sources.x_expansion = { discovered: 0, status: 'skipped' };
  }

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1b: X INLINE ENRICHMENT (budget: ~45s)
  // Enrich X candidates BEFORE dedup so email-based dedup works and
  // the strict email-or-phone filter has data to check.
  // ═══════════════════════════════════════════════════════════════════

  const xCandidates = pendingCandidates.filter(p => p.creator.account.platform === 'x');
  if (xCandidates.length > 0) {
    emit('x_enrichment', `Enriching ${xCandidates.length} X candidates for email`);
    const xEnrichDeadline = Math.min(Date.now() + 45_000, deadline - 80_000);

    // Sort: candidates with websites first (they're enrichable)
    xCandidates.sort((a, b) => (b.creator.website ? 1 : 0) - (a.creator.website ? 1 : 0));

    let xEnriched = 0;
    await pLimit(xCandidates, 10, async (packet) => {
      if (Date.now() > xEnrichDeadline || aborted()) return;

      const contact: DiscoveredCreator['contact'] = {};

      // Strategy 1: extract email from X bio text directly
      if (packet.creator.bio) {
        const bioEmail = extractEmailFromBio(packet.creator.bio);
        if (bioEmail) contact.email = bioEmail;
      }

      // Strategy 2: fast-enrich the linked website (root + /contact + /about + link-in-bio)
      if (!contact.email && packet.creator.website) {
        counts.enrichment_attempts++;
        try {
          const enr = await fastEnrich(packet.creator.website, { maxTotalMs: 4_000, perRequestMs: 2_500 });
          if (enr.email) { contact.email = enr.email; counts.enrichment_success++; }
          if (enr.phone) contact.phone = enr.phone;
          if (enr.contact_form_url) contact.contact_form_url = enr.contact_form_url;
        } catch { /* continue */ }
      }

      packet.creator = { ...packet.creator, contact };
      packet._xEnriched = true;
      xEnriched++;

      if (contact.email) counts.x_with_email++;
      counts.x_enriched++;

      if (xEnriched % 10 === 0) {
        emit('x_enrichment', `X enriched ${xEnriched}/${xCandidates.length} (${counts.x_with_email} emails)`, {
          batch_index: xEnriched, batch_total: xCandidates.length,
        });
      }
    }, () => Date.now() > xEnrichDeadline || aborted());

    emit('x_enrichment', `X enrichment done — ${counts.x_with_email} emails from ${xEnriched} candidates`);
  }

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1c: SECONDARY SOURCES (budget: ~50s)
  // YouTube, Instagram seeds, LinkedIn seeds, Google CSE, Reddit
  // run in parallel. Same logic as before, just a different deadline.
  // ═══════════════════════════════════════════════════════════════════

  emit('discovery', 'Running secondary sources');
  const secondaryDeadline = Math.min(Date.now() + 50_000, deadline - 60_000);
  const secondarySignal = timeoutSignal(secondaryDeadline, signal);
  const secondaryTasks: Promise<void>[] = [];

  // YouTube
  if (hasYouTube) {
    secondaryTasks.push((async () => {
      try {
        const priorityGroups: YouTubeKeywordGroup[] = [
          'forex', 'prop_firm', 'day_trading', 'mentor', 'options',
          'crypto', 'smart_money', 'futures', 'stocks',
        ];
        const results = await discoverYouTubeCreators({
          groups: priorityGroups, maxPerQuery: 10, minSubscribers: 100,
          secondPage: false, maxQueries: 35, concurrency: 6, signal: secondarySignal,
        });
        sources.youtube = { discovered: results.length, status: 'ok' };
        counts.discovered += results.length;
        pendingCandidates.push(...results);
        emit('discovery', `YouTube returned ${results.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources.youtube = { discovered: 0, status: 'error', note: msg };
        counts.errors++;
      }
    })());
  } else {
    sources.youtube = { discovered: 0, status: 'skipped', note: 'YOUTUBE_API_KEY not set' };
  }

  // Instagram + LinkedIn web discovery
  for (const platform of ['instagram', 'linkedin'] as const) {
    secondaryTasks.push((async () => {
      const sourceKey = platform === 'instagram' ? 'instagram_web' : 'linkedin_web';
      try {
        const candidates = await discoverViaWebSearch({ platform });
        const handlePageCount = new Map<string, number>();
        for (const c of candidates) if (c.handle) handlePageCount.set(c.handle, (handlePageCount.get(c.handle) ?? 0) + 1);
        const seen = new Set<string>();
        const converted: CandidatePacket[] = [];
        for (const c of candidates) {
          if (!c.handle || seen.has(c.handle)) continue;
          seen.add(c.handle);
          const isSeed = c.sourceUrl === 'seed_data';
          if (!isSeed) {
            const v = verifyCandidate(c, null, handlePageCount.get(c.handle) ?? 1);
            if (!v.shouldStore) continue;
          }
          converted.push({
            creator: {
              name: c.name,
              slug: c.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
              website: c.websiteUrl ?? null,
              bio: isSeed ? `Known ${platform} trading influencer/educator` : `Discovered via web search: ${c.sourceTitle}`,
              source_type: isSeed ? 'seed' : 'web_search',
              source_url: c.sourceUrl,
              account: {
                platform, handle: c.handle,
                profile_url: c.profileUrl || `https://${platform === 'instagram' ? 'instagram.com' : 'linkedin.com/in'}/${c.handle}`,
                followers: 0, platform_id: c.handle, bio: '', verified: false,
              },
            },
            posts: [],
          });
        }
        sources[sourceKey] = { discovered: converted.length, status: 'ok' };
        counts.discovered += converted.length;
        pendingCandidates.push(...converted);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources[platform === 'instagram' ? 'instagram_web' : 'linkedin_web'] = { discovered: 0, status: 'error', note: msg };
        counts.errors++;
      }
    })());
  }

  // Google CSE
  if (isGoogleSearchConfigured()) {
    secondaryTasks.push((async () => {
      try {
        const candidates = await discoverAcrossPlatforms({ concurrency: 4, timeoutMs: 8_000, signal: secondarySignal });
        const converted = candidates.map(crossPlatformToPacket).filter((p): p is CandidatePacket => p !== null);
        sources.google_cse = { discovered: converted.length, status: 'ok' };
        counts.discovered += converted.length;
        pendingCandidates.push(...converted);
      } catch (err) {
        sources.google_cse = { discovered: 0, status: 'error', note: String(err) };
        counts.errors++;
      }
    })());
  } else {
    sources.google_cse = { discovered: 0, status: 'skipped', note: 'GOOGLE_CLOUD_API_KEY / GOOGLE_CSE_CX not set' };
  }

  // Reddit
  if (isRedditConfigured()) {
    secondaryTasks.push((async () => {
      try {
        const { crossPlatformHandles } = await discoverViaReddit({
          postsPerSub: 40, timeframe: 'month', minUpvotes: 20, concurrency: 4, signal: secondarySignal,
        });
        const converted = crossPlatformHandles.map(crossPlatformToPacket).filter((p): p is CandidatePacket => p !== null);
        sources.reddit = { discovered: converted.length, status: 'ok' };
        counts.discovered += converted.length;
        pendingCandidates.push(...converted);
      } catch (err) {
        sources.reddit = { discovered: 0, status: 'error', note: String(err) };
        counts.errors++;
      }
    })());
  } else {
    sources.reddit = { discovered: 0, status: 'skipped', note: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set' };
  }

  await Promise.race([
    Promise.allSettled(secondaryTasks),
    sleep(Math.max(0, secondaryDeadline - Date.now())),
  ]);

  emit('discovery', `All sources complete — ${counts.discovered} raw candidates (X: ${counts.x_discovered}+${counts.x_expanded})`);

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: DEDUP (in-memory + DB + email-based)
  // ═══════════════════════════════════════════════════════════════════

  emit('dedup', 'Deduplicating candidates');

  const seenLocal = new Set<string>();
  const seenEmails = new Set<string>();
  const preFiltered: CandidatePacket[] = [];

  for (const packet of pendingCandidates) {
    const key = `${packet.creator.account.platform}::${(packet.creator.account.handle || '').toLowerCase().replace(/^@/, '')}`;
    if (seenLocal.has(key)) continue;
    seenLocal.add(key);

    // In-memory email dedup
    const email = packet.creator.contact?.email?.toLowerCase();
    if (email) {
      if (seenEmails.has(email)) { counts.duplicates++; continue; }
      seenEmails.add(email);
    }

    // Prop firm filter
    const firm = classifyPropFirm({
      name: packet.creator.name, slug: packet.creator.slug,
      website: packet.creator.website, bio: packet.creator.bio,
    });
    if (firm.is_prop_firm) { counts.excluded_prop_firm++; continue; }

    preFiltered.push(packet);
  }

  // Batch DB dedup (now includes email-based dedup)
  const existing = await buildExistingIndex(preFiltered.map(p => ({
    website: p.creator.website, account: p.creator.account, contact: p.creator.contact,
  })));

  const newCandidates: CandidatePacket[] = [];
  for (const packet of preFiltered) {
    if (isAlreadyKnown(packet.creator, existing)) {
      counts.duplicates++;
      continue;
    }
    newCandidates.push(packet);
  }

  counts.attempted = newCandidates.length;
  emit('dedup', `${newCandidates.length} unique new candidates after dedup`);

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: ENRICHMENT + UPSERT (budget: ~60s)
  // X candidates were already enriched in Phase 1b — skip them.
  // Secondary candidates get enriched here.
  // Hard filter: email OR phone required for insertion.
  // ═══════════════════════════════════════════════════════════════════

  // Sort: X-enriched candidates first (they already have contact data),
  // then website-having candidates, then the rest
  newCandidates.sort((a, b) => {
    const aScore = (a._xEnriched ? 4 : 0) + (a.creator.website ? 2 : 0) + (a.creator.contact?.email ? 1 : 0);
    const bScore = (b._xEnriched ? 4 : 0) + (b.creator.website ? 2 : 0) + (b.creator.contact?.email ? 1 : 0);
    return bScore - aScore;
  });

  const enrichTarget = newCandidates.slice(0, maxEnrichCandidates);
  let processed = 0;
  const total = enrichTarget.length;

  emit('enrichment', `Processing ${total} candidates`, { batch_index: 0, batch_total: total });

  const enrichmentDeadline = Math.max(Date.now() + 10_000, deadline - 40_000);
  const useKnowledgeGraph = isKnowledgeGraphConfigured();

  await pLimit(enrichTarget, enrichConcurrency, async (packet) => {
    if (Date.now() > enrichmentDeadline || aborted()) return;

    let mutableCreator = packet.creator;

    // Skip enrichment for X candidates that were already enriched in Phase 1b
    if (!packet._xEnriched) {
      // KG fallback for no-website proper names
      if (useKnowledgeGraph && !mutableCreator.website && looksLikeProperName(mutableCreator.name)) {
        try {
          const kg = await knowledgeGraphBest(mutableCreator.name, { timeoutMs: 4_000 });
          if (kg) {
            const recoveredWebsite = kg.url && !/wikipedia\.org|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com/i.test(kg.url)
              ? kg.url : null;
            mutableCreator = {
              ...mutableCreator,
              website: mutableCreator.website || recoveredWebsite,
              bio: mutableCreator.bio || kg.detailedDescription || kg.description || null,
            };
          }
        } catch { /* continue */ }
      }

      // Bio email extraction
      if (!mutableCreator.contact?.email && mutableCreator.bio) {
        const bioEmail = extractEmailFromBio(mutableCreator.bio);
        if (bioEmail) {
          mutableCreator = { ...mutableCreator, contact: { ...mutableCreator.contact, email: bioEmail } };
        }
      }

      // Fast-enrich website
      if (!mutableCreator.contact?.email && mutableCreator.website) {
        counts.enrichment_attempts++;
        try {
          const enr = await fastEnrich(mutableCreator.website, { maxTotalMs: 5_500, perRequestMs: 3_000 });
          const contact = { ...mutableCreator.contact };
          if (enr.email) { contact.email = enr.email; counts.enrichment_success++; }
          if (enr.phone) contact.phone = enr.phone;
          if (enr.contact_form_url) contact.contact_form_url = enr.contact_form_url;
          mutableCreator = { ...mutableCreator, contact };
        } catch { /* continue */ }
      }
    }

    const creator: DiscoveredCreator = mutableCreator;

    try {
      const result = await upsertCreator(creator, packet.posts);
      if (result.action === 'created') {
        counts.inserted++;
        if (result.had_email) counts.with_email++;
        if (result.had_phone) counts.with_phone++;
        if (result.had_form) counts.with_form++;
      } else if (result.action === 'updated') {
        counts.duplicates++;
        if (result.had_email) counts.with_email++;
        if (result.had_phone) counts.with_phone++;
        if (result.had_form) counts.with_form++;
      } else if (result.action === 'skipped') {
        if (result.error === 'no_contact_path') { counts.rejected++; counts.hard_filtered++; }
        else if (result.error === 'is_prop_firm') counts.excluded_prop_firm++;
        else counts.errors++;
      }
    } catch (err) {
      counts.errors++;
      log.warn('refresh-pipeline: upsert failed', { name: creator.name, error: String(err) });
    }

    processed++;
    if (processed % 10 === 0 || processed === total) {
      emit('enrichment', `Processed ${processed}/${total} (inserted ${counts.inserted}, email ${counts.with_email})`, {
        batch_index: processed, batch_total: total,
      });
    }
  }, () => Date.now() > enrichmentDeadline || aborted());

  if (timeIsUp()) return finalize('time_budget');

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: FOLLOW-UP ENRICHMENT (budget: ~30s)
  // Re-enrich stored leads that have a website but no email yet.
  // ═══════════════════════════════════════════════════════════════════

  if (isSupabaseConfigured() && remaining() > 10_000) {
    emit('followup_enrichment', 'Re-enriching stored leads missing email');
    const maxRows = Math.max(0, Math.floor((remaining() - 10_000) / (6000 / enrichConcurrency)));
    const limitFetch = Math.min(60, Math.max(0, maxRows));

    if (limitFetch > 0) {
      try {
        const { data: leads } = await supabaseAdmin
          .from('creators')
          .select('id, website, public_email, public_phone, contact_form_url')
          .not('website', 'is', null)
          .is('public_email', null)
          .neq('excluded_from_leads', true)
          .order('total_followers', { ascending: false })
          .limit(limitFetch);

        if (leads && leads.length > 0) {
          let followupProcessed = 0;
          await pLimit(leads, Math.min(enrichConcurrency, leads.length), async (lead) => {
            if (remaining() < 5_000 || aborted()) return;
            if (!lead.website) return;
            counts.enrichment_attempts++;
            try {
              const enr = await fastEnrich(lead.website, { maxTotalMs: 5_000, perRequestMs: 2_800 });
              const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
              let changed = false;
              if (enr.email && !lead.public_email) { updates.public_email = enr.email; counts.with_email++; counts.enrichment_success++; changed = true; }
              if (enr.phone && !lead.public_phone) { updates.public_phone = enr.phone; counts.with_phone++; changed = true; }
              if (enr.contact_form_url && !lead.contact_form_url) { updates.contact_form_url = enr.contact_form_url; counts.with_form++; changed = true; }
              if (changed) {
                await supabaseAdmin.from('creators').update(updates).eq('id', lead.id);
                const { data: full } = await supabaseAdmin.from('creators').select('*').eq('id', lead.id).single();
                const { data: accs } = await supabaseAdmin.from('creator_accounts').select('followers, platform, verified').eq('creator_id', lead.id);
                if (full) {
                  await supabaseAdmin.from('creators').update({
                    lead_score: computeLeadScore({ creator: full, accounts: accs ?? [] }),
                    confidence_score: computeConfidenceScore({ creator: full, accounts: accs ?? [] }),
                  }).eq('id', lead.id);
                }
              }
            } catch { counts.errors++; }
            followupProcessed++;
            if (followupProcessed % 5 === 0) {
              emit('followup_enrichment', `Re-enriched ${followupProcessed}/${leads.length}`, {
                batch_index: followupProcessed, batch_total: leads.length,
              });
            }
          }, () => remaining() < 5_000 || aborted());
        }
      } catch (err) {
        log.warn('refresh-pipeline: follow-up enrichment failed', { error: String(err) });
      }
    }
  }

  // ─── Phase 5: NL niche classification (bounded) ───────────────────
  if (isSupabaseConfigured() && isNaturalLanguageConfigured() && remaining() > 8_000) {
    emit('followup_enrichment', 'Classifying niches from bios');
    try {
      const { data: unclassified } = await supabaseAdmin
        .from('creators').select('id, name')
        .is('niche', null).neq('excluded_from_leads', true)
        .order('lead_score', { ascending: false }).limit(20);

      if (unclassified && unclassified.length > 0) {
        const ids = unclassified.map(u => u.id);
        const { data: accountBios } = await supabaseAdmin
          .from('creator_accounts').select('creator_id, bio').in('creator_id', ids);
        const bioByCreator = new Map<string, string>();
        for (const row of accountBios ?? []) {
          if (row.bio && !bioByCreator.has(row.creator_id)) bioByCreator.set(row.creator_id, row.bio);
        }
        let classified = 0;
        await pLimit(unclassified, 4, async (row) => {
          if (remaining() < 4_000 || aborted()) return;
          const bio = bioByCreator.get(row.id);
          if (!bio || bio.length < 120) return;
          try {
            const niche = await classifyNicheWithNL(bio, { timeoutMs: 4_000 });
            if (niche) {
              await supabaseAdmin.from('creators').update({ niche, updated_at: new Date().toISOString() }).eq('id', row.id);
              classified++;
            }
          } catch { /* ignore */ }
        }, () => remaining() < 4_000 || aborted());
        if (classified > 0) emit('followup_enrichment', `Classified ${classified} niches via NL API`);
      }
    } catch { /* ignore */ }
  }

  return finalize(aborted() ? 'aborted' : timeIsUp() ? 'time_budget' : 'completed');

  // ─── finalize ─────────────────────────────────────────────────────
  function finalize(reason: RefreshResult['stopped_reason']): RefreshResult {
    const completedIso = new Date().toISOString();
    const emailRate = counts.inserted > 0 ? counts.with_email / counts.inserted : 0;
    const enrichRate = counts.enrichment_attempts > 0 ? counts.enrichment_success / counts.enrichment_attempts : 0;
    const result: RefreshResult = {
      ...counts, phase: 'done',
      message: reason === 'completed'
        ? `Done — ${counts.inserted} new leads (${Math.round(emailRate * 100)}% with email)`
        : `Stopped (${reason}) — ${counts.inserted} new leads (${Math.round(emailRate * 100)}% with email)`,
      elapsed_ms: Date.now() - started,
      time_budget_ms: timeBudgetMs,
      remaining_ms: remaining(),
      sources,
      started_at: startedIso,
      completed_at: completedIso,
      email_rate: Math.round(emailRate * 100) / 100,
      enrichment_rate: Math.round(enrichRate * 100) / 100,
      stopped_reason: reason,
    };
    emit('done', result.message);
    log.info('refresh-pipeline: done', {
      reason, inserted: counts.inserted, duplicates: counts.duplicates,
      with_email: counts.with_email, x_discovered: counts.x_discovered,
      x_with_email: counts.x_with_email, hard_filtered: counts.hard_filtered,
      enrichment_rate: result.enrichment_rate,
      elapsed_ms: result.elapsed_ms,
    });
    return result;
  }
}

// ─── utils ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function crossPlatformToPacket(c: CrossPlatformCandidate): CandidatePacket | null {
  const dbPlatforms: Platform[] = ['instagram', 'linkedin', 'x', 'youtube'];
  if (!dbPlatforms.includes(c.platform as Platform)) return null;
  const platform = c.platform as Platform;
  return {
    creator: {
      name: c.name || c.handle,
      slug: c.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      website: null,
      bio: `Discovered via ${c.sourceTitle.startsWith('r/') ? 'Reddit' : 'Google CSE'}: ${c.sourceTitle}`.slice(0, 500),
      source_type: c.sourceTitle.startsWith('r/') ? 'reddit' : 'google_cse',
      source_url: c.sourceUrl,
      account: {
        platform, handle: c.handle, profile_url: c.profileUrl,
        followers: 0, platform_id: c.handle, bio: '', verified: false,
      },
    },
    posts: [],
  };
}

function looksLikeProperName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim();
  if (clean.length < 4 || clean.length > 60) return false;
  const words = clean.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^[A-Z][a-zA-Z'.-]{1,}$/.test(w));
}

function timeoutSignal(deadline: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener('abort', () => controller.abort(), { once: true });
  const ms = Math.max(0, deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return controller.signal;
}
