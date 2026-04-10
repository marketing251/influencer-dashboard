/**
 * GET /api/refresh-leads/diagnose
 *
 * Runs a single lightweight call against every discovery source and
 * returns a per-source status report. Used to figure out why a source
 * is silently returning 0 candidates in the main refresh pipeline —
 * instead of guessing, we call each API once and surface the raw
 * error message + response shape.
 *
 * Output format:
 * {
 *   ok: boolean,
 *   ts: "2026-04-10T...",
 *   env: { youtube_api_key: true, x_bearer_token: true, ... },
 *   sources: {
 *     youtube:    { status: "ok" | "error" | "skipped", message, sample?, duration_ms },
 *     x:          { ... },
 *     google_cse: { ... },
 *     reddit:     { ... },
 *     knowledge_graph: { ... },
 *     natural_language: { ... },
 *   }
 * }
 *
 * This endpoint does NOT write to the database. It is safe to hit
 * repeatedly and costs <~1s per API call.
 */

import { NextResponse } from 'next/server';
import { googleSearch, isGoogleSearchConfigured } from '@/lib/integrations/google-search';
import { knowledgeGraphLookup, isKnowledgeGraphConfigured } from '@/lib/integrations/google-knowledge-graph';
import { classifyText, isNaturalLanguageConfigured } from '@/lib/integrations/google-natural-language';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SourceReport {
  status: 'ok' | 'error' | 'skipped';
  message: string;
  sample?: unknown;
  duration_ms: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T | null; error: string | null; ms: number }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, error: null, ms: Date.now() - start };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err), ms: Date.now() - start };
  }
}

function skipped(reason: string): SourceReport {
  return { status: 'skipped', message: reason, duration_ms: 0 };
}

export async function GET() {
  const report: Record<string, SourceReport> = {};

  // ─── YouTube ──────────────────────────────────────────────────────
  if (!process.env.YOUTUBE_API_KEY) {
    report.youtube = skipped('YOUTUBE_API_KEY not set');
  } else {
    const { result, error, ms } = await timed(async () => {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'channel');
      url.searchParams.set('q', 'forex trading');
      url.searchParams.set('maxResults', '5');
      url.searchParams.set('key', process.env.YOUTUBE_API_KEY as string);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { items?: unknown[] };
      return { count: data.items?.length ?? 0 };
    });
    report.youtube = error
      ? { status: 'error', message: error, duration_ms: ms }
      : { status: 'ok', message: `Returned ${(result as { count: number }).count} channels`, sample: result, duration_ms: ms };
  }

  // ─── X (Twitter) ──────────────────────────────────────────────────
  if (!process.env.X_BEARER_TOKEN) {
    report.x = skipped('X_BEARER_TOKEN not set');
  } else {
    const { result, error, ms } = await timed(async () => {
      const url = new URL('https://api.twitter.com/2/tweets/search/recent');
      url.searchParams.set('query', '"forex trader" lang:en -is:retweet');
      url.searchParams.set('max_results', '10');
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { data?: unknown[] };
      return { count: data.data?.length ?? 0 };
    });
    report.x = error
      ? { status: 'error', message: error, duration_ms: ms }
      : { status: 'ok', message: `Returned ${(result as { count: number }).count} tweets`, sample: result, duration_ms: ms };
  }

  // ─── Google Custom Search (CSE) ───────────────────────────────────
  if (!isGoogleSearchConfigured()) {
    report.google_cse = skipped('GOOGLE_CLOUD_API_KEY or GOOGLE_CSE_CX not set');
  } else {
    const { result, error, ms } = await timed(async () => {
      // Direct call, bypassing the wrapper's swallowed errors so we see the real response
      const url = new URL('https://customsearch.googleapis.com/customsearch/v1');
      url.searchParams.set('key', process.env.GOOGLE_CLOUD_API_KEY as string);
      url.searchParams.set('cx', process.env.GOOGLE_CSE_CX as string);
      url.searchParams.set('q', 'forex trader mentor');
      url.searchParams.set('num', '5');
      const res = await fetch(url.toString());
      const bodyText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 400)}`);
      const data = JSON.parse(bodyText) as {
        items?: { title: string; link: string }[];
        searchInformation?: { totalResults?: string };
        error?: { code: number; message: string };
      };
      if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.message}`);
      return {
        count: data.items?.length ?? 0,
        totalResults: data.searchInformation?.totalResults,
        firstThreeUrls: (data.items ?? []).slice(0, 3).map(i => i.link),
      };
    });
    report.google_cse = error
      ? { status: 'error', message: error, duration_ms: ms }
      : { status: 'ok', message: `Returned ${(result as { count: number }).count} results`, sample: result, duration_ms: ms };
  }

  // Wrapper test — confirms the wrapper layer still works
  if (isGoogleSearchConfigured()) {
    const { result, error, ms } = await timed(async () => googleSearch('forex trader mentor', { num: 5 }));
    report.google_cse_wrapper = error
      ? { status: 'error', message: error, duration_ms: ms }
      : {
          status: (result as unknown[])?.length > 0 ? 'ok' : 'error',
          message: `Wrapper returned ${(result as unknown[])?.length ?? 0} results`,
          sample: result,
          duration_ms: ms,
        };
  }

  // ─── Google Knowledge Graph ───────────────────────────────────────
  if (!isKnowledgeGraphConfigured()) {
    report.knowledge_graph = skipped('GOOGLE_KG_API_KEY / GOOGLE_CLOUD_API_KEY not set');
  } else {
    const { result, error, ms } = await timed(async () =>
      knowledgeGraphLookup('Rayner Teo', { limit: 1, timeoutMs: 5_000 }),
    );
    report.knowledge_graph = error
      ? { status: 'error', message: error, duration_ms: ms }
      : {
          status: 'ok',
          message: `Returned ${(result as unknown[])?.length ?? 0} entities`,
          sample: result,
          duration_ms: ms,
        };
  }

  // ─── Google Natural Language ──────────────────────────────────────
  if (!isNaturalLanguageConfigured()) {
    report.natural_language = skipped('GOOGLE_NL_API_KEY / GOOGLE_CLOUD_API_KEY not set');
  } else {
    const { result, error, ms } = await timed(async () =>
      classifyText(
        'This is a day trader who teaches forex trading strategies and price action analysis for beginners. We cover scalping, swing trading and prop firm challenges.',
        { timeoutMs: 5_000 },
      ),
    );
    report.natural_language = error
      ? { status: 'error', message: error, duration_ms: ms }
      : {
          status: 'ok',
          message: `Returned ${(result as unknown[])?.length ?? 0} categories`,
          sample: result,
          duration_ms: ms,
        };
  }

  // ─── Reddit ───────────────────────────────────────────────────────
  {
    const { result, error, ms } = await timed(async () => {
      const url = 'https://www.reddit.com/r/Forex/top.json?t=week&limit=5';
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'InfluencerDashboard/1.0 (+https://propaccount.com)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
      }
      const data = (await res.json()) as {
        data?: { children?: { data?: { title?: string; url?: string } }[] };
      };
      return {
        count: data.data?.children?.length ?? 0,
        firstTitle: data.data?.children?.[0]?.data?.title ?? null,
      };
    });
    report.reddit = error
      ? { status: 'error', message: error, duration_ms: ms }
      : { status: 'ok', message: `Returned ${(result as { count: number }).count} posts`, sample: result, duration_ms: ms };
  }

  return NextResponse.json({
    ok: Object.values(report).every(r => r.status !== 'error'),
    ts: new Date().toISOString(),
    env: {
      youtube_api_key: Boolean(process.env.YOUTUBE_API_KEY),
      x_bearer_token: Boolean(process.env.X_BEARER_TOKEN),
      google_cloud_api_key: Boolean(process.env.GOOGLE_CLOUD_API_KEY),
      google_cse_cx: Boolean(process.env.GOOGLE_CSE_CX),
      google_kg_api_key: Boolean(process.env.GOOGLE_KG_API_KEY),
      google_nl_api_key: Boolean(process.env.GOOGLE_NL_API_KEY),
      brave_search_api_key: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    },
    sources: report,
  });
}
