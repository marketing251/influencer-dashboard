import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/db';
import { classifyPropFirm } from '@/lib/prop-firm-classifier';
import { log } from '@/lib/logger';

export const maxDuration = 30;

/**
 * POST /api/classify-prop-firms
 * Scans all existing creators and marks prop firms.
 * Safe to run multiple times — idempotent.
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'No database' }, { status: 503 });
  }

  const { data: creators } = await supabaseAdmin
    .from('creators')
    .select('id, name, slug, website, notes');

  if (!creators?.length) {
    return NextResponse.json({ message: 'No creators to classify', classified: 0 });
  }

  let classified = 0;
  let excluded = 0;
  const excluded_names: string[] = [];

  for (const c of creators) {
    const result = classifyPropFirm({ name: c.name, slug: c.slug, website: c.website, bio: c.notes });

    if (result.is_prop_firm) {
      await supabaseAdmin.from('creators').update({
        is_prop_firm: true,
        excluded_from_leads: true,
      }).eq('id', c.id);
      excluded++;
      excluded_names.push(c.name);
    } else {
      // Ensure non-prop-firms are not marked
      await supabaseAdmin.from('creators').update({
        is_prop_firm: false,
        excluded_from_leads: false,
      }).eq('id', c.id);
    }
    classified++;
  }

  log.info('classify-prop-firms: done', { classified, excluded, excluded_names });

  return NextResponse.json({
    message: `Classified ${classified} creators. ${excluded} excluded as prop firms.`,
    classified,
    excluded,
    excluded_names,
  });
}
