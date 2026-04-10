/**
 * Google Knowledge Graph Search API integration.
 *
 * Looks up entities (people, organizations) by name to get structured data:
 *   - official description
 *   - website URL (via `url` field)
 *   - `detailedDescription.articleBody` (Wikipedia-style summary)
 *   - `@type` tags (Person, Organization, etc.)
 *
 * We use this as an enrichment fallback for notable creators whose bios we
 * can't extract from a website — e.g. a seed lead with no website but a
 * well-known name like "Timothy Sykes" or "Rayner Teo" will still get
 * enriched with a bio and a canonical URL.
 *
 * Env: GOOGLE_KG_API_KEY (or falls back to GOOGLE_CLOUD_API_KEY).
 * Free quota; no credit card surprises.
 * Docs: https://developers.google.com/knowledge-graph
 */

import { log } from '../logger';

const BASE = 'https://kgsearch.googleapis.com/v1/entities:search';

export interface KnowledgeGraphEntity {
  name: string;
  description: string | null;
  detailedDescription: string | null;
  url: string | null;
  types: string[];
  resultScore: number;
  imageUrl: string | null;
}

function apiKey(): string | null {
  return process.env.GOOGLE_KG_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || null;
}

export function isKnowledgeGraphConfigured(): boolean {
  return Boolean(apiKey());
}

interface KGRawResult {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  detailedDescription?: { articleBody?: string; url?: string };
  url?: string;
  image?: { contentUrl?: string };
}

interface KGRawElement {
  '@type'?: string;
  result?: KGRawResult;
  resultScore?: number;
}

interface KGResponse {
  itemListElement?: KGRawElement[];
  error?: { code: number; message: string };
}

export interface KnowledgeGraphOpts {
  /** Max entities to return. Default 3. */
  limit?: number;
  /** Restrict to these schema.org types, e.g. ['Person', 'Organization']. */
  types?: string[];
  /** Only return results above this minimum score. Default 20. */
  minScore?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Look up an entity by name.
 * Returns an empty array on failure, quota, or network issues.
 */
export async function knowledgeGraphLookup(
  query: string,
  opts: KnowledgeGraphOpts = {},
): Promise<KnowledgeGraphEntity[]> {
  const key = apiKey();
  if (!key || !query?.trim()) return [];

  const { limit = 3, types, minScore = 20, signal, timeoutMs = 6_000 } = opts;

  const url = new URL(BASE);
  url.searchParams.set('key', key);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('indent', 'false');
  url.searchParams.set('languages', 'en');
  if (types?.length) {
    for (const t of types) url.searchParams.append('types', t);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(url.toString(), { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      log.debug('kg: request failed', { query: query.slice(0, 40), status: res.status });
      return [];
    }

    const data = (await res.json()) as KGResponse;
    if (data.error) {
      log.warn('kg: api error', { code: data.error.code, message: data.error.message });
      return [];
    }

    const elements = data.itemListElement ?? [];
    return elements
      .filter(el => (el.resultScore ?? 0) >= minScore && el.result)
      .map(el => {
        const r = el.result as KGRawResult;
        const rawTypes = r['@type'];
        const typeList = Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : [];
        return {
          name: r.name ?? '',
          description: r.description ?? null,
          detailedDescription: r.detailedDescription?.articleBody ?? null,
          url: r.url ?? r.detailedDescription?.url ?? null,
          types: typeList,
          resultScore: el.resultScore ?? 0,
          imageUrl: r.image?.contentUrl ?? null,
        };
      });
  } catch (err) {
    log.debug('kg: fetch failed', { query: query.slice(0, 40), error: String(err) });
    return [];
  }
}

/**
 * Look up a single entity, returning the top match only, scoped to trading-relevant types.
 */
export async function knowledgeGraphBest(query: string, opts: Omit<KnowledgeGraphOpts, 'limit'> = {}): Promise<KnowledgeGraphEntity | null> {
  const results = await knowledgeGraphLookup(query, {
    ...opts,
    limit: 1,
    types: opts.types ?? ['Person', 'Organization'],
  });
  return results[0] ?? null;
}
