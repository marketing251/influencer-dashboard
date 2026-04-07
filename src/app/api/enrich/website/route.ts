import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';
import { enrichFromWebsite } from '@/lib/integrations/website-enrichment';
import { computeLeadScore, computeConfidenceScore } from '@/lib/scoring';
import { withLogging, log } from '@/lib/logger';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { creator_id, url } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url (string) is required' }, { status: 400 });
  }

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'URL must be http or https' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const { result: enrichment, error: enrichError } = await withLogging(
    'api.enrich.website',
    () => enrichFromWebsite(url),
    { creator_id, url },
  );

  if (enrichError || !enrichment) {
    return NextResponse.json({ error: enrichError ?? 'Enrichment failed' }, { status: 500 });
  }

  // Persist enrichment to database if configured
  if (isSupabaseConfigured() && creator_id) {
    try {
      // Fetch current creator to merge (don't overwrite good data with empty)
      const { data: current } = await supabaseAdmin
        .from('creators')
        .select('*')
        .eq('id', creator_id)
        .single();

      if (current) {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

        // Only set email if we found one and creator doesn't have one yet
        if (enrichment.emails.length > 0 && !current.public_email) {
          updates.public_email = enrichment.emails[0];
        }
        if (enrichment.phones.length > 0 && !current.public_phone) {
          updates.public_phone = enrichment.phones[0];
        }

        // Boolean flags: only upgrade from false to true (never downgrade)
        if (enrichment.has_course && !current.has_course) updates.has_course = true;
        if (enrichment.has_discord && !current.has_discord) updates.has_discord = true;
        if (enrichment.has_telegram && !current.has_telegram) updates.has_telegram = true;

        // Merge prop firms
        if (enrichment.prop_firms_mentioned.length > 0) {
          const merged = [...new Set([...(current.prop_firms_mentioned ?? []), ...enrichment.prop_firms_mentioned])];
          updates.prop_firms_mentioned = merged;
          updates.promoting_prop_firms = true;
        }

        // Set website if not already set
        if (!current.website) updates.website = url;

        await supabaseAdmin.from('creators').update(updates).eq('id', creator_id);

        // Recalculate scores
        const { data: accounts } = await supabaseAdmin
          .from('creator_accounts')
          .select('followers, platform, verified')
          .eq('creator_id', creator_id);

        const merged = { ...current, ...updates };
        const leadScore = computeLeadScore({ creator: merged, accounts: accounts ?? [] });
        const confidenceScore = computeConfidenceScore({ creator: merged, accounts: accounts ?? [] });

        await supabaseAdmin.from('creators').update({
          lead_score: leadScore,
          confidence_score: confidenceScore,
        }).eq('id', creator_id);

        log.info('api.enrich.website: creator updated', { creator_id, leadScore, confidenceScore });
      }
    } catch (err) {
      log.error('api.enrich.website: db update failed', { creator_id, error: String(err) });
    }
  }

  return NextResponse.json({
    message: 'Enrichment completed',
    creator_id: creator_id ?? null,
    url,
    enrichment,
  });
}
