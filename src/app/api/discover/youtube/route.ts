import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { discoverYouTubeCreators } from '@/lib/integrations/youtube';
import { upsertCreator, logDiscoveryRun } from '@/lib/pipeline';
import { withLogging, log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Standalone YouTube discovery endpoint.
 * Also called internally by discoverLeads() via the shared pipeline.
 */
export async function POST() {
  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: 'YOUTUBE_API_KEY not configured' },
      { status: 400 },
    );
  }

  const { result: discoveries, error: discoverError, durationMs } = await withLogging(
    'api.discover.youtube',
    () => discoverYouTubeCreators({
      maxPerQuery: 10,
      minSubscribers: 500,
    }),
  );

  if (discoverError || !discoveries) {
    await logDiscoveryRun('youtube', 0, 0, [discoverError ?? 'Unknown error'], 'failed');
    return NextResponse.json({ error: discoverError }, { status: 500 });
  }

  let newCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (const { creator, posts } of discoveries) {
    const result = await upsertCreator(creator, posts);
    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updatedCount++;
    if (result.error) errors.push(`${result.name}: ${result.error}`);
  }

  const status = errors.length > discoveries.length / 2 ? 'failed' : 'completed';
  await logDiscoveryRun('youtube', newCount, updatedCount, errors, status as 'completed' | 'failed');

  const summary = {
    message: 'YouTube discovery completed',
    discovered: discoveries.length,
    new: newCount,
    updated: updatedCount,
    skipped: discoveries.length - newCount - updatedCount,
    errors: errors.length,
    error_details: errors.slice(0, 10),
    database: isSupabaseConfigured() ? 'connected' : 'not configured',
    durationMs,
  };

  log.info('api.discover.youtube: done', summary);
  return NextResponse.json(summary);
}
