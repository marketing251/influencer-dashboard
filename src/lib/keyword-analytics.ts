/**
 * Keyword-yield analytics — tracks which keywords produce the best
 * net-new qualified leads and adapts future refresh query allocation.
 *
 * No ML, no heavy dependencies. Just cumulative counters per keyword,
 * a simple scoring formula, and a 70/30 exploit/explore split.
 *
 * The `keyword_performance` table persists scores across refreshes.
 * Each refresh: load scores → reorder queries → discover → record metrics.
 */

import { isSupabaseConfigured, supabaseAdmin } from './db';
import { log } from './logger';

// ─── Types ──────────────────────────────────────────────────────────

export interface KeywordBatchMetric {
  platform: string;
  keyword: string;
  category: string;
  discovery_method: 'keyword_search' | 'x_expansion' | 'youtube_search';
  candidates_found: number;
  known_skipped: number;
  new_users: number;
}

export interface KeywordPerformance {
  platform: string;
  keyword: string;
  category: string;
  total_runs: number;
  total_candidates: number;
  total_known_skipped: number;
  total_inserted: number;
  total_with_email: number;
  total_duplicates: number;
  total_rejected: number;
  performance_score: number;
  last_used_at: string;
}

// ─── Scoring ────────────────────────────────────────────────────────

/**
 * Compute a 0–100 performance score for a keyword.
 *
 * Formula (rate-based, avoids bias toward high-volume keywords):
 *   insert_rate  = total_inserted / total_candidates
 *   email_rate   = total_with_email / total_inserted
 *   dup_rate     = total_known_skipped / total_candidates
 *   score = (insert_rate × 40) + (email_rate × 40) - (dup_rate × 20) + 20
 *
 * New keywords with 0 candidates start at 50 (neutral).
 * The +20 baseline ensures even moderate performers stay above 0.
 */
export function scoreKeywordPerformance(perf: KeywordPerformance): number {
  if (perf.total_candidates === 0) return 50;

  const insertRate = perf.total_inserted / Math.max(perf.total_candidates, 1);
  const emailRate = perf.total_with_email / Math.max(perf.total_inserted, 1);
  const dupRate = perf.total_known_skipped / Math.max(perf.total_candidates, 1);

  const raw = (insertRate * 40) + (emailRate * 40) - (dupRate * 20) + 20;
  return Math.min(100, Math.max(0, Math.round(raw * 100) / 100));
}

// ─── Adaptive allocation ────────────────────────────────────────────

/**
 * Reorder a query list based on historical keyword scores.
 *
 * Strategy:
 *   1. Load all keyword_performance rows for this platform
 *   2. Known queries (in DB) → sorted by score DESC (exploit)
 *   3. New queries (not in DB) → appended at the end (explore)
 *   4. Top 70% of known queries run first, then new, then bottom 30%
 *
 * This gives high-performers the most time budget (earlier = more
 * likely to complete before time cap) while keeping exploration alive.
 *
 * @param platform - 'x', 'youtube', etc.
 * @param queries - the full ordered query list
 * @param categoryMap - optional map of query → category name
 * @returns reordered query list
 */
export async function allocateKeywordBudget(
  platform: string,
  queries: string[],
  categoryMap?: Map<string, string>,
): Promise<string[]> {
  if (!isSupabaseConfigured() || queries.length === 0) return queries;

  try {
    const { data } = await supabaseAdmin
      .from('keyword_performance')
      .select('keyword, performance_score')
      .eq('platform', platform)
      .order('performance_score', { ascending: false });

    if (!data || data.length === 0) return queries; // no history yet — use default order

    const scoreMap = new Map<string, number>();
    for (const row of data) scoreMap.set(row.keyword, row.performance_score);

    const known: { query: string; score: number }[] = [];
    const exploration: string[] = [];

    for (const q of queries) {
      const score = scoreMap.get(q);
      if (score !== undefined) {
        known.push({ query: q, score });
      } else {
        exploration.push(q);
      }
    }

    // Sort known by score descending
    known.sort((a, b) => b.score - a.score);

    // 70% exploit (top performers first) → explore → 30% bottom
    const splitIdx = Math.max(1, Math.ceil(known.length * 0.7));
    const topPerformers = known.slice(0, splitIdx).map(k => k.query);
    const bottomPerformers = known.slice(splitIdx).map(k => k.query);

    const reordered = [...topPerformers, ...exploration, ...bottomPerformers];

    log.info('keyword-analytics: budget allocated', {
      platform,
      totalQueries: queries.length,
      topPerformers: topPerformers.length,
      exploration: exploration.length,
      bottomPerformers: bottomPerformers.length,
    });

    return reordered;
  } catch (err) {
    log.warn('keyword-analytics: allocation failed, using default order', { error: String(err) });
    return queries;
  }
}

// ─── Metric recording ───────────────────────────────────────────────

/**
 * Upsert per-keyword metrics to the `keyword_performance` table.
 * Increments cumulative counters and recomputes the performance score.
 *
 * Uses Supabase's upsert with onConflict on (platform, keyword).
 */
export async function recordKeywordBatchMetrics(metrics: KeywordBatchMetric[]): Promise<void> {
  if (!isSupabaseConfigured() || metrics.length === 0) return;

  for (const m of metrics) {
    try {
      // Try to read existing row
      const { data: existing } = await supabaseAdmin
        .from('keyword_performance')
        .select('*')
        .eq('platform', m.platform)
        .eq('keyword', m.keyword)
        .maybeSingle();

      const now = new Date().toISOString();

      if (existing) {
        // Update cumulative counters
        const updated = {
          total_runs: existing.total_runs + 1,
          total_candidates: existing.total_candidates + m.candidates_found,
          total_known_skipped: existing.total_known_skipped + m.known_skipped,
          category: m.category || existing.category,
          last_used_at: now,
          updated_at: now,
        };
        const score = scoreKeywordPerformance({ ...existing, ...updated } as KeywordPerformance);
        await supabaseAdmin
          .from('keyword_performance')
          .update({ ...updated, performance_score: score })
          .eq('id', existing.id);
      } else {
        // Insert new row
        const score = m.candidates_found > 0
          ? scoreKeywordPerformance({
              platform: m.platform, keyword: m.keyword, category: m.category,
              total_runs: 1, total_candidates: m.candidates_found,
              total_known_skipped: m.known_skipped,
              total_inserted: 0, total_with_email: 0,
              total_duplicates: 0, total_rejected: 0,
              performance_score: 50, last_used_at: now,
            })
          : 50;
        await supabaseAdmin.from('keyword_performance').insert({
          platform: m.platform,
          keyword: m.keyword,
          category: m.category || null,
          total_runs: 1,
          total_candidates: m.candidates_found,
          total_known_skipped: m.known_skipped,
          performance_score: score,
          last_used_at: now,
        });
      }
    } catch (err) {
      log.debug('keyword-analytics: record failed', { keyword: m.keyword.slice(0, 50), error: String(err) });
    }
  }
}

/**
 * After enrichment/insert, update per-keyword insert + email counters.
 * Called with the keyword that discovered each successfully inserted lead.
 */
export async function updateKeywordInsertMetrics(
  platform: string,
  keyword: string,
  hadEmail: boolean,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    // Supabase doesn't support atomic increment via .update(), so we read + write
    const { data: row } = await supabaseAdmin
      .from('keyword_performance')
      .select('id, total_inserted, total_with_email, total_candidates, total_known_skipped, total_duplicates, total_rejected, total_runs')
      .eq('platform', platform)
      .eq('keyword', keyword)
      .maybeSingle();
    if (!row) return;

    const newInserted = row.total_inserted + 1;
    const newWithEmail = row.total_with_email + (hadEmail ? 1 : 0);
    const score = scoreKeywordPerformance({
      ...row,
      total_inserted: newInserted,
      total_with_email: newWithEmail,
      performance_score: 0,
      last_used_at: '', category: '', keyword, platform,
    });

    await supabaseAdmin.from('keyword_performance')
      .update({ total_inserted: newInserted, total_with_email: newWithEmail, performance_score: score, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  } catch {
    // best-effort — don't block the pipeline
  }
}

// ─── Early-stop ─────────────────────────────────────────────────────

/**
 * Should we abort pagination / deeper search for this keyword batch?
 * Returns true if the duplicate rate is too high to justify more API calls.
 */
export function shouldAbortBatchEarly(metric: KeywordBatchMetric): boolean {
  if (metric.candidates_found < 5) return false; // not enough data
  const dupRate = metric.known_skipped / metric.candidates_found;
  return dupRate > 0.8; // 80%+ known = stop wasting API calls
}

// ─── Reporting ──────────────────────────────────────────────────────

/**
 * Get top-performing keywords for a platform, ordered by score.
 */
export async function getTopPerformingKeywords(
  platform: string,
  limit = 10,
): Promise<KeywordPerformance[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data } = await supabaseAdmin
      .from('keyword_performance')
      .select('*')
      .eq('platform', platform)
      .order('performance_score', { ascending: false })
      .limit(limit);
    return (data ?? []) as KeywordPerformance[];
  } catch {
    return [];
  }
}

/**
 * Get worst-performing keywords (highest duplicate rate).
 */
export async function getWorstKeywords(
  platform: string,
  limit = 5,
): Promise<KeywordPerformance[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data } = await supabaseAdmin
      .from('keyword_performance')
      .select('*')
      .eq('platform', platform)
      .gt('total_candidates', 0)
      .order('performance_score', { ascending: true })
      .limit(limit);
    return (data ?? []) as KeywordPerformance[];
  } catch {
    return [];
  }
}
