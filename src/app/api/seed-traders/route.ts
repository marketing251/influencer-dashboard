/**
 * POST /api/seed-traders
 *
 * One-shot importer for the hardcoded trader/YouTube seed lists
 * in `src/lib/seed-data/trader-seeds.ts`. Runs each through the
 * standard upsertCreator flow — fast-enriches websites for contact
 * info, dedupes against existing DB records, and inserts/updates
 * as appropriate.
 *
 * Safe to re-run. Subsequent calls update existing creators with
 * fresher enrichment data instead of creating duplicates.
 *
 * Use:
 *   curl -X POST https://your-domain/api/seed-traders
 *
 * Response shape:
 *   { traders: { inserted, updated, skipped, errors },
 *     youtube: { inserted, updated, skipped, errors },
 *     sample_errors: string[] }
 */

import { NextResponse } from 'next/server';
import { TRADER_SEEDS, YOUTUBE_SEEDS } from '@/lib/seed-data/trader-seeds';
import { upsertCreator, type DiscoveredCreator } from '@/lib/pipeline';
import { fastEnrich } from '@/lib/integrations/fast-enrich';
import { log } from '@/lib/logger';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ImportStats {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

function prettify(handle: string): string {
  return handle
    .replace(/[_.\-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function toProfileUrl(platform: string, handle: string): string {
  switch (platform) {
    case 'instagram': return `https://instagram.com/${handle}`;
    case 'linkedin':  return `https://linkedin.com/in/${handle}`;
    case 'x':         return `https://x.com/${handle}`;
    case 'youtube':   return `https://youtube.com/@${handle}`;
    default:          return `https://${handle}`;
  }
}

/**
 * Enrich a website URL (when present) and return a contact block.
 * Time-bounded so a single slow site can't stall the whole import.
 */
async function enrichOrEmpty(website: string | null): Promise<{
  email: string | null;
  phone: string | null;
  contact_form_url: string | null;
}> {
  if (!website) return { email: null, phone: null, contact_form_url: null };
  try {
    const r = await fastEnrich(website, { maxTotalMs: 8_000 });
    return {
      email: r.email,
      phone: r.phone,
      contact_form_url: r.contact_form_url,
    };
  } catch {
    return { email: null, phone: null, contact_form_url: null };
  }
}

export async function POST() {
  const started = Date.now();
  const sampleErrors: string[] = [];

  // ─── Trader (IG-handle) seeds ────────────────────────────────────
  const traderStats: ImportStats = {
    total: TRADER_SEEDS.length, inserted: 0, updated: 0, skipped: 0, errors: 0,
  };

  // Run in limited concurrency so we don't hammer sites / exhaust Vercel time
  const TRADER_CONCURRENCY = 4;
  let i = 0;
  const traderWorkers = Array.from({ length: TRADER_CONCURRENCY }, async () => {
    while (i < TRADER_SEEDS.length) {
      const seed = TRADER_SEEDS[i++];
      try {
        const contact = await enrichOrEmpty(seed.website);
        const data: DiscoveredCreator = {
          name: seed.name || prettify(seed.handle),
          slug: seed.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          website: seed.website,
          bio: seed.niche,
          source_type: 'trader_seed',
          source_url: seed.website || toProfileUrl(seed.platform, seed.handle),
          contact,
          account: {
            platform: seed.platform,
            handle: seed.handle,
            profile_url: toProfileUrl(seed.platform, seed.handle),
            followers: 0,
            platform_id: seed.handle,
            bio: seed.niche,
            verified: false,
          },
        };
        const result = await upsertCreator(data);
        if (result.action === 'created') traderStats.inserted++;
        else if (result.action === 'updated') traderStats.updated++;
        else {
          traderStats.skipped++;
          if (result.error && result.error !== 'no_contact_path' && result.error !== 'is_prop_firm') {
            traderStats.errors++;
            if (sampleErrors.length < 10) sampleErrors.push(`${seed.handle}: ${result.error}`);
          }
        }
      } catch (err) {
        traderStats.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        if (sampleErrors.length < 10) sampleErrors.push(`${seed.handle}: ${msg}`);
        log.warn('seed-traders: trader import failed', { handle: seed.handle, error: msg });
      }
    }
  });
  await Promise.all(traderWorkers);

  // ─── YouTube channel seeds ───────────────────────────────────────
  const youtubeStats: ImportStats = {
    total: YOUTUBE_SEEDS.length, inserted: 0, updated: 0, skipped: 0, errors: 0,
  };

  // YouTube seeds are few — run serially to keep it simple
  for (const seed of YOUTUBE_SEEDS) {
    try {
      const data: DiscoveredCreator = {
        name: seed.name,
        slug: seed.channelId.toLowerCase(),
        website: null,
        bio: seed.niche,
        source_type: 'youtube_seed',
        source_url: seed.channelUrl,
        contact: {
          email: seed.email,
          phone: null,
          contact_form_url: null,
        },
        account: {
          platform: 'youtube',
          handle: seed.name,
          profile_url: seed.channelUrl,
          followers: seed.subscribers,
          platform_id: seed.channelId,
          bio: seed.niche,
          verified: false,
        },
      };
      const result = await upsertCreator(data);
      if (result.action === 'created') youtubeStats.inserted++;
      else if (result.action === 'updated') youtubeStats.updated++;
      else {
        youtubeStats.skipped++;
        if (result.error && result.error !== 'no_contact_path' && result.error !== 'is_prop_firm') {
          youtubeStats.errors++;
          if (sampleErrors.length < 10) sampleErrors.push(`${seed.name}: ${result.error}`);
        }
      }
    } catch (err) {
      youtubeStats.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      if (sampleErrors.length < 10) sampleErrors.push(`${seed.name}: ${msg}`);
      log.warn('seed-traders: youtube import failed', { name: seed.name, error: msg });
    }
  }

  const elapsedMs = Date.now() - started;
  const summary = {
    ok: true,
    elapsed_ms: elapsedMs,
    traders: traderStats,
    youtube: youtubeStats,
    total_inserted: traderStats.inserted + youtubeStats.inserted,
    total_updated: traderStats.updated + youtubeStats.updated,
    sample_errors: sampleErrors,
  };
  log.info('seed-traders: done', summary);
  return NextResponse.json(summary);
}
