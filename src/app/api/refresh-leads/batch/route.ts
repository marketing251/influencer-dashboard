import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { upsertCreator, logDiscoveryRun } from '@/lib/pipeline';
import { discoverYouTubeCreators } from '@/lib/integrations/youtube';
import { discoverViaWebSearch } from '@/lib/integrations/web-search';
import { enrichFromWebsite } from '@/lib/integrations/website-enrichment';
import { supabaseAdmin } from '@/lib/db';
import { computeLeadScore, computeConfidenceScore } from '@/lib/scoring';
import { extractAllSignals } from '@/lib/social-links';
import { verifyCandidate } from '@/lib/verification';
import { log } from '@/lib/logger';

export const maxDuration = 10;

type BatchType = 'seeds_ig' | 'seeds_li' | 'youtube' | 'enrich';

/**
 * Batch refresh endpoint — called multiple times by the client.
 * Each call does one small unit of work within 10s.
 * POST /api/refresh-leads/batch?type=seeds_ig
 */
export async function POST(request: NextRequest) {
  const batch = request.nextUrl.searchParams.get('type') as BatchType;

  if (!batch) {
    return NextResponse.json({ error: 'Missing ?type= param (seeds_ig|seeds_li|youtube|enrich)' }, { status: 400 });
  }

  try {
    switch (batch) {
      case 'seeds_ig':
        return NextResponse.json(await runSeeds('instagram'));
      case 'seeds_li':
        return NextResponse.json(await runSeeds('linkedin'));
      case 'youtube':
        return NextResponse.json(await runYouTube());
      case 'enrich':
        return NextResponse.json(await runEnrich());
      default:
        return NextResponse.json({ error: `Unknown batch type: ${batch}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('batch: failed', { batch, error: msg });
    return NextResponse.json({ error: msg, batch }, { status: 500 });
  }
}

// ─── Seeds (instant — no HTTP, just DB inserts) ─────────────────────

async function runSeeds(platform: 'instagram' | 'linkedin') {
  const candidates = await discoverViaWebSearch({ platform });
  let newCount = 0, updated = 0, errors = 0;

  // Verify and upsert each candidate
  for (const candidate of candidates) {
    const isSeed = candidate.sourceUrl === 'seed_data';
    if (!isSeed) {
      const v = verifyCandidate(candidate, null, 1);
      if (!v.shouldStore) continue;
    }

    const creator = {
      name: candidate.name,
      slug: candidate.handle!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      website: candidate.websiteUrl ?? null,
      bio: isSeed ? `Known ${platform} trading influencer` : `Found: ${candidate.sourceTitle}`,
      source_type: isSeed ? 'seed' : 'web_search',
      source_url: candidate.sourceUrl,
      account: {
        platform: platform as 'instagram' | 'linkedin',
        handle: candidate.handle!,
        profile_url: candidate.profileUrl || `https://${platform === 'instagram' ? 'instagram.com' : 'linkedin.com/in'}/${candidate.handle}`,
        followers: 0, platform_id: candidate.handle!, bio: '', verified: false,
      },
    };

    const result = await upsertCreator(creator);
    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updated++;
    if (result.error) errors++;
  }

  log.info('batch.seeds: done', { platform, candidates: candidates.length, new: newCount, updated });
  return { batch: `seeds_${platform}`, discovered: candidates.length, new: newCount, updated, errors };
}

// ─── YouTube (API calls — fits in ~8s for 15 queries) ────────────────

async function runYouTube() {
  if (!process.env.YOUTUBE_API_KEY) {
    return { batch: 'youtube', discovered: 0, new: 0, updated: 0, errors: 0, skipped: 'No YOUTUBE_API_KEY' };
  }

  const discoveries = await discoverYouTubeCreators({ maxPerQuery: 10, minSubscribers: 500, maxPages: 1 });
  let newCount = 0, updated = 0, errors = 0;

  for (const { creator, posts } of discoveries) {
    const result = await upsertCreator(creator, posts);
    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updated++;
    if (result.error) errors++;
  }

  await logDiscoveryRun('youtube', newCount, updated, [], 'completed');
  log.info('batch.youtube: done', { discovered: discoveries.length, new: newCount, updated });
  return { batch: 'youtube', discovered: discoveries.length, new: newCount, updated, errors };
}

// ─── Enrich (crawl websites for emails) ──────────────────────────────

async function runEnrich() {
  if (!isSupabaseConfigured()) return { batch: 'enrich', attempted: 0, emails: 0, phones: 0 };

  const { data: creators } = await supabaseAdmin
    .from('creators')
    .select('id, website, public_email, public_phone, contact_form_url, prop_firms_mentioned')
    .not('website', 'is', null)
    .is('public_email', null)
    .order('total_followers', { ascending: false })
    .limit(8); // enrich 8 creators within ~8s

  let emails = 0, phones = 0;

  for (const creator of creators ?? []) {
    try {
      const enrichment = await enrichFromWebsite(creator.website);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let changed = false;

      if (enrichment.emails.length > 0 && !creator.public_email) { updates.public_email = enrichment.emails[0]; emails++; changed = true; }
      if (enrichment.phones.length > 0 && !creator.public_phone) { updates.public_phone = enrichment.phones[0]; phones++; changed = true; }
      if (enrichment.contact_form_url && !creator.contact_form_url) { updates.contact_form_url = enrichment.contact_form_url; changed = true; }
      if (enrichment.has_course) { updates.has_course = true; changed = true; }
      if (enrichment.has_discord) { updates.has_discord = true; changed = true; }
      if (enrichment.has_telegram) { updates.has_telegram = true; changed = true; }
      if (enrichment.prop_firms_mentioned.length > 0) {
        updates.promoting_prop_firms = true;
        updates.prop_firms_mentioned = [...new Set([...(creator.prop_firms_mentioned ?? []), ...enrichment.prop_firms_mentioned])];
        changed = true;
      }

      const allLinks = enrichment.social_links.map(l => l.url).join(' ');
      const signals = extractAllSignals(allLinks);
      if (signals.instagram_url) { updates.instagram_url = signals.instagram_url; changed = true; }
      if (signals.linkedin_url) { updates.linkedin_url = signals.linkedin_url; changed = true; }
      if (signals.youtube_url) { updates.youtube_url = signals.youtube_url; changed = true; }
      if (signals.x_url) { updates.x_url = signals.x_url; changed = true; }

      if (changed) {
        await supabaseAdmin.from('creators').update(updates).eq('id', creator.id);
        // Recalculate scores
        const { data: full } = await supabaseAdmin.from('creators').select('*').eq('id', creator.id).single();
        const { data: accs } = await supabaseAdmin.from('creator_accounts').select('followers, platform, verified').eq('creator_id', creator.id);
        if (full) {
          await supabaseAdmin.from('creators').update({
            lead_score: computeLeadScore({ creator: full, accounts: accs ?? [] }),
            confidence_score: computeConfidenceScore({ creator: full, accounts: accs ?? [] }),
          }).eq('id', creator.id);
        }
      }
    } catch (err) {
      log.warn('batch.enrich: failed', { creator_id: creator.id, error: String(err) });
    }
  }

  log.info('batch.enrich: done', { attempted: creators?.length ?? 0, emails, phones });
  return { batch: 'enrich', attempted: creators?.length ?? 0, emails, phones };
}
