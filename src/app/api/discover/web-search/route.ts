import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { webSearchInstagramProvider, webSearchLinkedInProvider } from '@/lib/discovery/web-search-provider';
import { upsertCreator, logDiscoveryRun } from '@/lib/pipeline';
import { withLogging, log } from '@/lib/logger';

export const maxDuration = 120;

export async function POST() {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    return NextResponse.json({ error: 'BRAVE_SEARCH_API_KEY not configured' }, { status: 400 });
  }

  const results: Record<string, { discovered: number; new: number; updated: number; errors: string[] }> = {};

  for (const provider of [webSearchInstagramProvider, webSearchLinkedInProvider]) {
    const { result: discoveries, error: err } = await withLogging(
      `api.discover.web-search.${provider.platform}`,
      () => provider.discover(),
    );

    let newCount = 0, updatedCount = 0;
    const errors: string[] = [];

    if (discoveries) {
      for (const { creator, posts } of discoveries) {
        const r = await upsertCreator(creator, posts);
        if (r.action === 'created') newCount++;
        else if (r.action === 'updated') updatedCount++;
        if (r.error) errors.push(`${r.name}: ${r.error}`);
      }
      await logDiscoveryRun(provider.platform as 'instagram' | 'linkedin', newCount, updatedCount, errors, 'completed');
    } else {
      errors.push(err ?? 'Unknown error');
    }

    results[provider.platform] = { discovered: discoveries?.length ?? 0, new: newCount, updated: updatedCount, errors };
  }

  log.info('api.discover.web-search: done', results);
  return NextResponse.json({
    message: 'Web search discovery completed',
    database: isSupabaseConfigured() ? 'connected' : 'not configured',
    ...results,
  });
}
