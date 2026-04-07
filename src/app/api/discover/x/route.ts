import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { discoverXCreators } from '@/lib/integrations/x';
import { upsertCreator, logDiscoveryRun } from '@/lib/pipeline';
import { withLogging, log } from '@/lib/logger';

export const maxDuration = 60; // Vercel function timeout (seconds)

export async function POST() {
  if (!process.env.X_BEARER_TOKEN) {
    return NextResponse.json(
      { error: 'X_BEARER_TOKEN not configured. Set it in environment variables.' },
      { status: 400 },
    );
  }

  const { result: discoveries, error: discoverError, durationMs } = await withLogging(
    'api.discover.x',
    () => discoverXCreators({
      maxPerQuery: 20,
      minFollowers: 1_000,
      delayMs: 2_000,
    }),
  );

  if (discoverError || !discoveries) {
    await logDiscoveryRun('x', 0, 0, [discoverError ?? 'Unknown error'], 'failed');
    return NextResponse.json({ error: discoverError }, { status: 500 });
  }

  // Upsert each discovered creator
  let newCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  for (const { creator, posts } of discoveries) {
    const result = await upsertCreator(creator, posts);
    if (result.action === 'created') newCount++;
    else if (result.action === 'updated') updatedCount++;
    if (result.error) errors.push(`${result.name}: ${result.error}`);
  }

  // Log discovery run
  const status = errors.length > discoveries.length / 2 ? 'failed' : 'completed';
  await logDiscoveryRun('x', newCount, updatedCount, errors, status as 'completed' | 'failed');

  const summary = {
    message: 'X discovery completed',
    discovered: discoveries.length,
    new: newCount,
    updated: updatedCount,
    skipped: discoveries.length - newCount - updatedCount,
    errors: errors.length,
    error_details: errors.slice(0, 10),
    database: isSupabaseConfigured() ? 'connected' : 'mock (no database)',
    durationMs,
  };

  log.info('api.discover.x: done', summary);
  return NextResponse.json(summary);
}
