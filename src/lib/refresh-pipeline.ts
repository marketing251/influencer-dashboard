/**
 * Time-aware Refresh Leads pipeline for Vercel Pro (~300s budget).
 *
 * Phases:
 *   1. Backfill prop-firm exclusion on existing rows (so stale firms
 *      disappear from lead queries without a full rewrite).
 *   2. Parallel discovery across YouTube, X, Instagram seeds, LinkedIn seeds.
 *      Each source runs independently inside Promise.allSettled — a broken
 *      source never kills the whole refresh.
 *   3. In-memory + batched DB dedup so we never hit the network for a lead
 *      we already have.
 *   4. Concurrent fast-enrich + upsert workers, sorted so leads most likely
 *      to be contactable (with websites) run first.
 *   5. Backfill pass that enriches stored leads still missing an email,
 *      until the time budget runs out.
 *
 * Every meaningful state change emits a progress event via `onProgress`
 * so the UI can stream "Batch X of Y" updates over NDJSON.
 */

import { supabaseAdmin, isSupabaseConfigured } from './db';
import {
  discoverYouTubeCreators,
  ALL_YOUTUBE_GROUPS,
} from './integrations/youtube';
import { discoverXCreators } from './integrations/x';
import { discoverViaWebSearch } from './integrations/web-search';
import { fastEnrich, isPlaceholderEmail } from './integrations/fast-enrich';
import { knowledgeGraphBest, isKnowledgeGraphConfigured } from './integrations/google-knowledge-graph';
import { classifyNicheWithNL, isNaturalLanguageConfigured } from './integrations/google-natural-language';
import { verifyCandidate } from './verification';
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
  | 'discovery'
  | 'dedup'
  | 'enrichment'
  | 'followup_enrichment'
  | 'done';

export interface RefreshCounts {
  attempted: number;       // unique candidates considered after dedup
  discovered: number;      // total raw candidates returned from all providers
  inserted: number;
  duplicates: number;
  rejected: number;        // no contact path
  excluded_prop_firm: number;
  with_email: number;
  with_phone: number;
  with_form: number;
  errors: number;
}

export interface RefreshSources {
  youtube: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  x: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  instagram_web: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
  linkedin_web: { discovered: number; status: 'ok' | 'skipped' | 'error'; note?: string };
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
  stopped_reason: 'completed' | 'time_budget' | 'aborted';
}

export interface RefreshOpts {
  /** Total wall-clock budget for the pipeline. Default 265_000 (Pro 300 − buffer). */
  timeBudgetMs?: number;
  /** Concurrency for the fast-enrich + upsert phase. */
  enrichConcurrency?: number;
  /** Max candidates to enrich in phase 3 (prevents runaway enrichment of 1000s). */
  maxEnrichCandidates?: number;
  /** Callback invoked on each progress event (for NDJSON streaming). */
  onProgress?: (event: RefreshProgress) => void;
  /** External abort signal — e.g. client disconnected. */
  signal?: AbortSignal;
}

type CandidatePacket = { creator: DiscoveredCreator; posts: DiscoveredPost[] };

// ─── Helper ─────────────────────────────────────────────────────────

function emptyCounts(): RefreshCounts {
  return {
    attempted: 0, discovered: 0, inserted: 0, duplicates: 0,
    rejected: 0, excluded_prop_firm: 0,
    with_email: 0, with_phone: 0, with_form: 0, errors: 0,
  };
}

function emptySources(): RefreshSources {
  return {
    youtube: { discovered: 0, status: 'ok' },
    x: { discovered: 0, status: 'ok' },
    instagram_web: { discovered: 0, status: 'ok' },
    linkedin_web: { discovered: 0, status: 'ok' },
  };
}

/** Run async work with a concurrency limit. */
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
      ...counts,
      phase,
      message,
      elapsed_ms: Date.now() - started,
      time_budget_ms: timeBudgetMs,
      remaining_ms: remaining(),
      sources,
      ...extra,
    };
    try { onProgress?.(event); } catch { /* never let the sink break the pipeline */ }
  };

  emit('init', 'Starting refresh');
  log.info('refresh-pipeline: starting', { timeBudgetMs, enrichConcurrency, maxEnrichCandidates });

  // ─── Phase 0a: prop-firm exclusion backfill (cheap, short) ────────
  if (isSupabaseConfigured()) {
    emit('backfill_exclusion', 'Cleaning prop-firm exclusions');
    try {
      const updated = await backfillPropFirmExclusion();
      if (updated > 0) emit('backfill_exclusion', `Excluded ${updated} prop-firm rows from leads`);
    } catch (err) {
      log.warn('refresh-pipeline: exclusion backfill failed', { error: String(err) });
    }
  }

  // ─── Phase 0b: null out placeholder/template emails that slipped in
  // (e.g. "johnappleseed@gmail.com" from Apple's docs). We only scan the
  // top 500 most-recently-seen rows to keep this cheap. Scores are NOT
  // recomputed here — the next enrichment pass will handle that.
  if (isSupabaseConfigured()) {
    try {
      const { data: suspect } = await supabaseAdmin
        .from('creators')
        .select('id, public_email')
        .not('public_email', 'is', null)
        .order('last_seen_at', { ascending: false })
        .limit(500);

      const toNull: string[] = [];
      for (const row of suspect ?? []) {
        if (row.public_email && isPlaceholderEmail(row.public_email)) toNull.push(row.id);
      }
      if (toNull.length > 0) {
        await supabaseAdmin
          .from('creators')
          .update({ public_email: null, updated_at: new Date().toISOString() })
          .in('id', toNull);
        log.info('refresh-pipeline: nulled placeholder emails', { count: toNull.length });
        emit('backfill_exclusion', `Removed ${toNull.length} placeholder/template emails`);
      }
    } catch (err) {
      log.warn('refresh-pipeline: placeholder email cleanup failed', { error: String(err) });
    }
  }

  if (timeIsUp()) return finalize('time_budget');

  // ─── Phase 1: parallel discovery ──────────────────────────────────
  emit('discovery', 'Discovering candidates from YouTube, X, and seed lists');

  const hasYouTube = Boolean(process.env.YOUTUBE_API_KEY);
  const hasX = Boolean(process.env.X_BEARER_TOKEN);

  // Use a 90s soft budget for discovery (everything in parallel anyway)
  const discoveryDeadline = Math.min(Date.now() + 90_000, deadline - 30_000);
  const discoverySignal = timeoutSignal(discoveryDeadline, signal);

  const discoveryTasks: Promise<void>[] = [];
  const pendingCandidates: CandidatePacket[] = [];

  // YouTube — cycles through all keyword groups each refresh
  if (hasYouTube) {
    discoveryTasks.push((async () => {
      try {
        const results = await discoverYouTubeCreators({
          groups: ALL_YOUTUBE_GROUPS,
          maxPerQuery: 10,
          minSubscribers: 500,
          secondPage: true,
          concurrency: 6,
          signal: discoverySignal,
        });
        sources.youtube = { discovered: results.length, status: 'ok' };
        counts.discovered += results.length;
        pendingCandidates.push(...results);
        emit('discovery', `YouTube returned ${results.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources.youtube = { discovered: 0, status: 'error', note: msg };
        counts.errors++;
        log.warn('refresh-pipeline: youtube failed', { error: msg });
        emit('discovery', `YouTube failed: ${msg}`);
      }
    })());
  } else {
    sources.youtube = { discovered: 0, status: 'skipped', note: 'YOUTUBE_API_KEY not set' };
  }

  // X — rate-limited, catch errors locally
  if (hasX) {
    discoveryTasks.push((async () => {
      try {
        const results = await discoverXCreators({
          maxPerQuery: 20,
          minFollowers: 1_000,
          delayMs: 1_500,
        });
        sources.x = { discovered: results.length, status: 'ok' };
        counts.discovered += results.length;
        pendingCandidates.push(...results);
        emit('discovery', `X returned ${results.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources.x = { discovered: 0, status: 'error', note: msg };
        counts.errors++;
        log.warn('refresh-pipeline: x failed', { error: msg });
        emit('discovery', `X failed: ${msg}`);
      }
    })());
  } else {
    sources.x = { discovered: 0, status: 'skipped', note: 'X_BEARER_TOKEN not set' };
  }

  // Web discovery (Instagram + LinkedIn) — seeds + Brave if configured
  for (const platform of ['instagram', 'linkedin'] as const) {
    discoveryTasks.push((async () => {
      const sourceKey = platform === 'instagram' ? 'instagram_web' : 'linkedin_web';
      try {
        const candidates = await discoverViaWebSearch({ platform });

        // Verify + convert to DiscoveredCreator
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
              bio: isSeed
                ? `Known ${platform} trading influencer/educator`
                : `Discovered via web search: ${c.sourceTitle}`,
              source_type: isSeed ? 'seed' : 'web_search',
              source_url: c.sourceUrl,
              account: {
                platform,
                handle: c.handle,
                profile_url: c.profileUrl || `https://${platform === 'instagram' ? 'instagram.com' : 'linkedin.com/in'}/${c.handle}`,
                followers: 0,
                platform_id: c.handle,
                bio: '',
                verified: false,
              },
            },
            posts: [],
          });
        }

        sources[sourceKey] = { discovered: converted.length, status: 'ok' };
        counts.discovered += converted.length;
        pendingCandidates.push(...converted);
        emit('discovery', `${platform} web returned ${converted.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources[sourceKey] = { discovered: 0, status: 'error', note: msg };
        counts.errors++;
        log.warn('refresh-pipeline: web-search failed', { platform, error: msg });
        emit('discovery', `${platform} web failed: ${msg}`);
      }
    })());
  }

  // Wait for all discovery sources (or discovery deadline)
  await Promise.race([
    Promise.allSettled(discoveryTasks),
    sleep(Math.max(0, discoveryDeadline - Date.now())),
  ]);

  emit('discovery', `Discovery phase complete — ${counts.discovered} raw candidates`);

  if (timeIsUp()) return finalize('time_budget');

  // ─── Phase 2: deduplicate (in-memory + DB batch) ──────────────────
  emit('dedup', 'Deduplicating candidates');

  // In-memory dedup by (platform, handle) and domain and prop-firm classification
  const seenLocal = new Set<string>();
  const preFiltered: CandidatePacket[] = [];
  for (const packet of pendingCandidates) {
    const key = `${packet.creator.account.platform}::${(packet.creator.account.handle || '').toLowerCase().replace(/^@/, '')}`;
    if (seenLocal.has(key)) continue;
    seenLocal.add(key);

    // Reject prop firms up front (also upsert-side will catch them)
    const firm = classifyPropFirm({
      name: packet.creator.name,
      slug: packet.creator.slug,
      website: packet.creator.website,
      bio: packet.creator.bio,
    });
    if (firm.is_prop_firm) {
      counts.excluded_prop_firm++;
      continue;
    }

    preFiltered.push(packet);
  }

  // Batch DB dedup
  const existing = await buildExistingIndex(preFiltered.map(p => ({ website: p.creator.website, account: p.creator.account })));

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

  // ─── Phase 3: fast-enrich + upsert (concurrent, time-bounded) ─────
  // Prioritize candidates that are most likely to have contact info:
  //   websites > link-in-bio > bio-only seeds
  newCandidates.sort((a, b) => {
    const aw = a.creator.website ? 2 : 0;
    const bw = b.creator.website ? 2 : 0;
    return bw - aw;
  });

  const enrichTarget = newCandidates.slice(0, maxEnrichCandidates);
  let processed = 0;
  const total = enrichTarget.length;

  emit('enrichment', `Enriching ${total} candidates`, { batch_index: 0, batch_total: total });

  // Reserve ~40s at the end for the follow-up phase
  const enrichmentDeadline = Math.max(Date.now() + 10_000, deadline - 40_000);

  const useKnowledgeGraph = isKnowledgeGraphConfigured();

  await pLimit(enrichTarget, enrichConcurrency, async (packet) => {
    if (Date.now() > enrichmentDeadline || aborted()) return;

    // Knowledge Graph fallback: if the candidate has no website and looks like
    // a real person's name, try to recover a canonical URL + bio.
    let mutableCreator = packet.creator;
    if (useKnowledgeGraph && !mutableCreator.website && looksLikeProperName(mutableCreator.name)) {
      try {
        const kg = await knowledgeGraphBest(mutableCreator.name, { timeoutMs: 4_000 });
        if (kg) {
          const recoveredWebsite = kg.url && !/wikipedia\.org|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com/i.test(kg.url)
            ? kg.url
            : null;
          const recoveredBio = kg.detailedDescription || kg.description;
          mutableCreator = {
            ...mutableCreator,
            website: mutableCreator.website || recoveredWebsite,
            bio: mutableCreator.bio || recoveredBio || null,
          };
        }
      } catch { /* continue without KG data */ }
    }

    // Fast-enrich if we have a website
    const contact: { email?: string | null; phone?: string | null; contact_form_url?: string | null } = {};
    if (mutableCreator.website) {
      try {
        const enr = await fastEnrich(mutableCreator.website, { maxTotalMs: 5_500, perRequestMs: 3_000 });
        contact.email = enr.email;
        contact.phone = enr.phone;
        contact.contact_form_url = enr.contact_form_url;
      } catch { /* continue without enrichment */ }
    }

    const creator: DiscoveredCreator = { ...mutableCreator, contact };

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
        if (result.error === 'no_contact_path') counts.rejected++;
        else if (result.error === 'is_prop_firm') counts.excluded_prop_firm++;
        else counts.errors++;
      }
    } catch (err) {
      counts.errors++;
      log.warn('refresh-pipeline: upsert failed', { name: packet.creator.name, error: String(err) });
    }

    processed++;
    // Throttle progress events to every 5 candidates + edge cases
    if (processed % 5 === 0 || processed === total) {
      emit('enrichment', `Enriched ${processed}/${total} (inserted ${counts.inserted}, email ${counts.with_email})`, {
        batch_index: processed,
        batch_total: total,
      });
    }
  }, () => Date.now() > enrichmentDeadline || aborted());

  if (timeIsUp()) return finalize('time_budget');

  // ─── Phase 4: follow-up enrichment of stored leads missing email ──
  if (isSupabaseConfigured() && remaining() > 10_000) {
    emit('followup_enrichment', 'Enriching existing leads missing email');

    // How many rows can we realistically enrich in the time left?
    // Assume ~6s per row at concurrency `enrichConcurrency`.
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
            try {
              const enr = await fastEnrich(lead.website, { maxTotalMs: 5_000, perRequestMs: 2_800 });
              const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
              let changed = false;
              if (enr.email && !lead.public_email) { updates.public_email = enr.email; counts.with_email++; changed = true; }
              if (enr.phone && !lead.public_phone) { updates.public_phone = enr.phone; counts.with_phone++; changed = true; }
              if (enr.contact_form_url && !lead.contact_form_url) { updates.contact_form_url = enr.contact_form_url; counts.with_form++; changed = true; }
              if (changed) {
                await supabaseAdmin.from('creators').update(updates).eq('id', lead.id);
                // Refresh scores
                const { data: full } = await supabaseAdmin.from('creators').select('*').eq('id', lead.id).single();
                const { data: accs } = await supabaseAdmin.from('creator_accounts').select('followers, platform, verified').eq('creator_id', lead.id);
                if (full) {
                  await supabaseAdmin.from('creators').update({
                    lead_score: computeLeadScore({ creator: full, accounts: accs ?? [] }),
                    confidence_score: computeConfidenceScore({ creator: full, accounts: accs ?? [] }),
                  }).eq('id', lead.id);
                }
              }
            } catch (err) {
              counts.errors++;
              log.debug('refresh-pipeline: follow-up enrich failed', { id: lead.id, error: String(err) });
            }
            followupProcessed++;
            if (followupProcessed % 5 === 0) {
              emit('followup_enrichment', `Re-enriched ${followupProcessed}/${leads.length}`, {
                batch_index: followupProcessed,
                batch_total: leads.length,
              });
            }
          }, () => remaining() < 5_000 || aborted());
        }
      } catch (err) {
        log.warn('refresh-pipeline: follow-up enrichment failed', { error: String(err) });
      }
    }
  }

  // ─── Phase 5: niche classification via Natural Language API (cheap, bounded) ─
  // Quota-conscious: only classify leads that are missing a niche AND have
  // enough bio text to actually produce a result. Capped at 20 per refresh so
  // we stay comfortably inside the 5,000-unit free monthly quota.
  if (isSupabaseConfigured() && isNaturalLanguageConfigured() && remaining() > 8_000) {
    emit('followup_enrichment', 'Classifying niches from bios');
    try {
      const { data: unclassified } = await supabaseAdmin
        .from('creators')
        .select('id, name')
        .is('niche', null)
        .neq('excluded_from_leads', true)
        .order('lead_score', { ascending: false })
        .limit(20);

      // Bios live on creator_accounts, not creators — batch-fetch them
      if (unclassified && unclassified.length > 0) {
        const ids = unclassified.map(u => u.id);
        const { data: accountBios } = await supabaseAdmin
          .from('creator_accounts')
          .select('creator_id, bio')
          .in('creator_id', ids);

        const bioByCreator = new Map<string, string>();
        for (const row of accountBios ?? []) {
          if (row.bio && !bioByCreator.has(row.creator_id)) bioByCreator.set(row.creator_id, row.bio);
        }

        let classified = 0;
        await pLimit(unclassified, 4, async (row) => {
          if (remaining() < 4_000 || aborted()) return;
          const bio = bioByCreator.get(row.id);
          if (!bio || bio.length < 120) return; // skip short bios (<20 words ~ 120 chars)
          try {
            const niche = await classifyNicheWithNL(bio, { timeoutMs: 4_000 });
            if (niche) {
              await supabaseAdmin.from('creators').update({ niche, updated_at: new Date().toISOString() }).eq('id', row.id);
              classified++;
            }
          } catch (err) {
            log.debug('refresh-pipeline: NL classify failed', { id: row.id, error: String(err) });
          }
        }, () => remaining() < 4_000 || aborted());
        if (classified > 0) emit('followup_enrichment', `Classified ${classified} niches via NL API`);
      }
    } catch (err) {
      log.warn('refresh-pipeline: niche classification failed', { error: String(err) });
    }
  }

  return finalize(aborted() ? 'aborted' : timeIsUp() ? 'time_budget' : 'completed');

  // ─── finalize helper ──────────────────────────────────────────────
  function finalize(reason: RefreshResult['stopped_reason']): RefreshResult {
    const completedIso = new Date().toISOString();
    const emailRate = counts.inserted > 0 ? counts.with_email / counts.inserted : 0;
    const result: RefreshResult = {
      ...counts,
      phase: 'done',
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
      stopped_reason: reason,
    };
    emit('done', result.message);
    log.info('refresh-pipeline: done', {
      reason,
      inserted: counts.inserted,
      duplicates: counts.duplicates,
      with_email: counts.with_email,
      elapsed_ms: result.elapsed_ms,
    });
    return result;
  }
}

// ─── utils ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Heuristic: does `name` look like a real person's name worth looking up
 * in Google Knowledge Graph? We only call KG for 2-4 capitalized-word names
 * to avoid burning quota on handles like "forextrader123" or brand names.
 */
function looksLikeProperName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim();
  if (clean.length < 4 || clean.length > 60) return false;
  const words = clean.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^[A-Z][a-zA-Z'.-]{1,}$/.test(w));
}

/** Build an AbortSignal that fires when the deadline passes OR the parent aborts. */
function timeoutSignal(deadline: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener('abort', () => controller.abort(), { once: true });
  const ms = Math.max(0, deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), ms);
  // Don't keep the event loop alive just for this timer
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return controller.signal;
}
