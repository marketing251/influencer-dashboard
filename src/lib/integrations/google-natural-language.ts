/**
 * Google Cloud Natural Language API integration.
 *
 * Two capabilities we actually use:
 *   1. analyzeEntities — extracts people/orgs/URLs from a bio
 *   2. classifyText    — returns Google's content categories (e.g. "/Finance/Investing/Foreign Exchange")
 *
 * Used as a fallback when the rule-based `classifyNiche()` misses on a
 * bio that's clearly trading-related but uses slang or wordings the regex
 * doesn't cover.
 *
 * Env: GOOGLE_NL_API_KEY (or falls back to GOOGLE_CLOUD_API_KEY).
 * Quota: 5,000 units/month free, then ~$1 per 1,000 units.
 * classifyText requires at least 20 tokens of English text.
 *
 * Docs: https://cloud.google.com/natural-language/docs/reference/rest
 */

import { log } from '../logger';

const BASE = 'https://language.googleapis.com/v1';

function apiKey(): string | null {
  return process.env.GOOGLE_NL_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || null;
}

export function isNaturalLanguageConfigured(): boolean {
  return Boolean(apiKey());
}

// ─── Types ──────────────────────────────────────────────────────────

export interface NLCategory {
  name: string;       // e.g. "/Finance/Investing/Foreign Exchange"
  confidence: number; // 0..1
}

export interface NLEntity {
  name: string;
  type: string;       // PERSON, ORGANIZATION, LOCATION, WORK_OF_ART, CONSUMER_GOOD, OTHER, etc.
  salience: number;   // 0..1
  mentions: number;
  wikipediaUrl: string | null;
}

interface RawCategoryResponse {
  categories?: { name: string; confidence: number }[];
  error?: { code: number; message: string };
}

interface RawEntityMention { text?: { content?: string }; type?: string }
interface RawEntity {
  name?: string;
  type?: string;
  salience?: number;
  mentions?: RawEntityMention[];
  metadata?: { wikipedia_url?: string };
}
interface RawEntitiesResponse {
  entities?: RawEntity[];
  error?: { code: number; message: string };
}

export interface NLOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Minimum token count required by classifyText. Below this the API 400s. */
const CLASSIFY_MIN_WORDS = 20;

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

async function nlFetch<T>(path: string, body: unknown, opts: NLOpts): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;

  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set('key', key);

  const { signal, timeoutMs = 6_000 } = opts;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // 400 here is expected for short text — log at debug only
      const body = await res.text().catch(() => '');
      log.debug('nl: request non-ok', { path, status: res.status, body: body.slice(0, 200) });
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.debug('nl: fetch failed', { path, error: String(err) });
    return null;
  }
}

/**
 * Classify text into Google content categories.
 * Returns [] when the API is unconfigured, text too short, or request fails.
 */
export async function classifyText(text: string, opts: NLOpts = {}): Promise<NLCategory[]> {
  if (!isNaturalLanguageConfigured() || !text) return [];
  if (wordCount(text) < CLASSIFY_MIN_WORDS) return [];

  const data = await nlFetch<RawCategoryResponse>(
    'documents:classifyText',
    {
      document: { type: 'PLAIN_TEXT', content: text.slice(0, 100_000), language: 'en' },
      classificationModelOptions: { v1Model: {} },
    },
    opts,
  );

  if (!data || data.error) return [];
  return (data.categories ?? []).map(c => ({ name: c.name, confidence: c.confidence }));
}

/**
 * Extract named entities (people, orgs, locations, products, URLs).
 */
export async function analyzeEntities(text: string, opts: NLOpts = {}): Promise<NLEntity[]> {
  if (!isNaturalLanguageConfigured() || !text) return [];

  const data = await nlFetch<RawEntitiesResponse>(
    'documents:analyzeEntities',
    {
      document: { type: 'PLAIN_TEXT', content: text.slice(0, 100_000), language: 'en' },
      encodingType: 'UTF8',
    },
    opts,
  );

  if (!data || data.error) return [];
  return (data.entities ?? []).map(e => ({
    name: e.name ?? '',
    type: e.type ?? 'OTHER',
    salience: e.salience ?? 0,
    mentions: e.mentions?.length ?? 0,
    wikipediaUrl: e.metadata?.wikipedia_url ?? null,
  }));
}

// ─── Niche classification helper ────────────────────────────────────

/**
 * Map Google content categories onto our internal niche taxonomy.
 * Returns `null` if no category matched one of our buckets.
 */
export function mapCategoriesToNiche(categories: NLCategory[]): string | null {
  if (!categories.length) return null;

  // Sort by confidence, scan highest-first
  const sorted = [...categories].sort((a, b) => b.confidence - a.confidence);

  for (const { name } of sorted) {
    const lower = name.toLowerCase();
    if (lower.includes('foreign exchange') || lower.includes('/forex')) return 'forex';
    if (lower.includes('cryptocurrency') || lower.includes('/crypto')) return 'crypto';
    if (lower.includes('futures')) return 'futures';
    if (lower.includes('options')) return 'options';
    if (lower.includes('stocks') || lower.includes('/equities')) return 'stocks';
    if (lower.includes('day trad') || lower.includes('/trading')) return 'day_trading';
    if (lower.includes('investing') || lower.includes('finance')) return 'stocks';
  }
  return null;
}

/**
 * One-shot niche classification: takes raw bio text, returns a niche string
 * (forex, crypto, futures, options, stocks, day_trading) or null on any failure.
 */
export async function classifyNicheWithNL(text: string, opts: NLOpts = {}): Promise<string | null> {
  const cats = await classifyText(text, opts);
  return mapCategoriesToNiche(cats);
}
