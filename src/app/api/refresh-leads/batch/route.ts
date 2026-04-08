import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { upsertCreator, logDiscoveryRun } from '@/lib/pipeline';
import { discoverYouTubeCreators } from '@/lib/integrations/youtube';
import { discoverViaWebSearch } from '@/lib/integrations/web-search';
import { fastEnrich } from '@/lib/integrations/fast-enrich';
import { enrichFromWebsite } from '@/lib/integrations/website-enrichment';
import { supabaseAdmin } from '@/lib/db';
import { computeLeadScore, computeConfidenceScore } from '@/lib/scoring';
import { extractAllSignals } from '@/lib/social-links';
import { verifyCandidate } from '@/lib/verification';
import { log } from '@/lib/logger';

export const maxDuration = 10;

type BatchType = 'seeds_ig' | 'seeds_li' | 'youtube' | 'enrich';

export async function POST(request: NextRequest) {
  const batch = request.nextUrl.searchParams.get('type') as BatchType;
  if (!batch) return NextResponse.json({ error: 'Missing ?type=' }, { status: 400 });

  try {
    switch (batch) {
      case 'seeds_ig': return NextResponse.json(await runSeeds('instagram'));
      case 'seeds_li': return NextResponse.json(await runSeeds('linkedin'));
      case 'youtube': return NextResponse.json(await runYouTube());
      case 'enrich': return NextResponse.json(await runEnrich());
      default: return NextResponse.json({ error: `Unknown: ${batch}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('batch: failed', { batch, error: msg });
    return NextResponse.json({ error: msg, batch }, { status: 500 });
  }
}

// ─── Seeds: inline fast-enrich, prioritize contactable ──────────────

async function runSeeds(platform: 'instagram' | 'linkedin') {
  const candidates = await discoverViaWebSearch({ platform });
  let newCount = 0, updated = 0, errors = 0, rejected = 0, excludedPropFirm = 0, enrichedEmail = 0;

  // Sort: candidates with websites first (enrichable)
  const sorted = [...candidates].sort((a, b) => (b.websiteUrl ? 1 : 0) - (a.websiteUrl ? 1 : 0));

  for (const candidate of sorted) {
    const isSeed = candidate.sourceUrl === 'seed_data';
    if (!isSeed) {
      const v = verifyCandidate(candidate, null, 1);
      if (!v.shouldStore) continue;
    }

    // Skip candidates without websites — they can't be contacted
    if (!candidate.websiteUrl) { rejected++; continue; }

    // Fast-enrich: grab email/phone from the website BEFORE inserting
    let email: string | null = null;
    let phone: string | null = null;
    let contactForm: string | null = null;
    try {
      const enr = await fastEnrich(candidate.websiteUrl);
      email = enr.email;
      phone = enr.phone;
      contactForm = enr.contact_form_url;
      if (email) enrichedEmail++;
    } catch { /* continue without enrichment */ }

    const creator = {
      name: candidate.name,
      slug: candidate.handle!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      website: candidate.websiteUrl,
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

    // If created, immediately update with enriched contact info
    if (result.action === 'created' && result.creator_id && (email || phone || contactForm)) {
      const updates: Record<string, unknown> = {};
      if (email) updates.public_email = email;
      if (phone) updates.public_phone = phone;
      if (contactForm) updates.contact_form_url = contactForm;
      await supabaseAdmin.from('creators').update(updates).eq('id', result.creator_id);
    }

    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updated++;
    else if (result.action === 'skipped') {
      if (result.error === 'no_contact_path') rejected++;
      else if (result.error === 'is_prop_firm') excludedPropFirm++;
      else errors++;
    }
  }

  log.info('batch.seeds: done', { platform, candidates: candidates.length, new: newCount, updated, rejected, enrichedEmail });
  return { batch: `seeds_${platform}`, discovered: candidates.length, new: newCount, updated, rejected, excluded_prop_firm: excludedPropFirm, emails: enrichedEmail, errors };
}

// ─── YouTube: inline fast-enrich for creators with websites ─────────

async function runYouTube() {
  if (!process.env.YOUTUBE_API_KEY) {
    return { batch: 'youtube', discovered: 0, new: 0, updated: 0, errors: 0, skipped: 'No YOUTUBE_API_KEY' };
  }

  const discoveries = await discoverYouTubeCreators({ maxPerQuery: 10, minSubscribers: 500, maxPages: 1 });
  let newCount = 0, updated = 0, errors = 0, rejected = 0, excludedPropFirm = 0, enrichedEmail = 0;

  // Sort: creators with websites first
  const sorted = [...discoveries].sort((a, b) => (b.creator.website ? 1 : 0) - (a.creator.website ? 1 : 0));

  for (const { creator, posts } of sorted) {
    // Fast-enrich if website exists
    let email: string | null = null;
    let phone: string | null = null;
    let contactForm: string | null = null;
    if (creator.website) {
      try {
        const enr = await fastEnrich(creator.website);
        email = enr.email;
        phone = enr.phone;
        contactForm = enr.contact_form_url;
        if (email) enrichedEmail++;
      } catch { /* continue */ }
    }

    const result = await upsertCreator(creator, posts);

    if (result.action === 'created' && result.creator_id && (email || phone || contactForm)) {
      const updates: Record<string, unknown> = {};
      if (email) updates.public_email = email;
      if (phone) updates.public_phone = phone;
      if (contactForm) updates.contact_form_url = contactForm;
      await supabaseAdmin.from('creators').update(updates).eq('id', result.creator_id);
    }

    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updated++;
    else if (result.action === 'skipped') {
      if (result.error === 'no_contact_path') rejected++;
      else if (result.error === 'is_prop_firm') excludedPropFirm++;
      else errors++;
    }
  }

  await logDiscoveryRun('youtube', newCount, updated, [], 'completed');
  log.info('batch.youtube: done', { discovered: discoveries.length, new: newCount, updated, rejected, enrichedEmail });
  return { batch: 'youtube', discovered: discoveries.length, new: newCount, updated, rejected, excluded_prop_firm: excludedPropFirm, emails: enrichedEmail, errors };
}

// ─── Deep enrich: full website crawl for existing leads missing email ─

async function runEnrich() {
  if (!isSupabaseConfigured()) return { batch: 'enrich', attempted: 0, emails: 0, phones: 0 };

  const { data: creators } = await supabaseAdmin
    .from('creators')
    .select('id, website, public_email, public_phone, contact_form_url, prop_firms_mentioned')
    .not('website', 'is', null)
    .is('public_email', null)
    .neq('excluded_from_leads', true)
    .order('total_followers', { ascending: false })
    .limit(3);

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

      const links = enrichment.social_links.map(l => l.url).join(' ');
      const signals = extractAllSignals(links);
      if (signals.instagram_url) { updates.instagram_url = signals.instagram_url; changed = true; }
      if (signals.linkedin_url) { updates.linkedin_url = signals.linkedin_url; changed = true; }
      if (signals.youtube_url) { updates.youtube_url = signals.youtube_url; changed = true; }
      if (signals.x_url) { updates.x_url = signals.x_url; changed = true; }

      if (changed) {
        await supabaseAdmin.from('creators').update(updates).eq('id', creator.id);
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
