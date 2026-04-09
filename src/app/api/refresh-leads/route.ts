/**
 * POST /api/refresh-leads
 *
 *   - Default: runs the full Refresh Leads pipeline and returns the final
 *     JSON result. Uses the ~300s Vercel Pro budget.
 *   - With `?stream=1`: streams progress events as newline-delimited JSON
 *     so the UI can show "Batch X of Y" while the refresh is in-flight.
 */

import type { NextRequest } from 'next/server';
import {
  runRefreshPipeline,
  type RefreshProgress,
  type RefreshResult,
} from '@/lib/refresh-pipeline';
import { log } from '@/lib/logger';

// Vercel Pro gives us up to 300s. Keep a small buffer inside the pipeline
// (see `timeBudgetMs`) so we always return a response before Vercel kills us.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PIPELINE_TIME_BUDGET_MS = 270_000;

export async function POST(request: NextRequest) {
  const stream = request.nextUrl.searchParams.get('stream') === '1';

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (event: RefreshProgress | RefreshResult) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          } catch {
            // Controller closed (client disconnected) — ignore
          }
        };

        try {
          const result = await runRefreshPipeline({
            timeBudgetMs: PIPELINE_TIME_BUDGET_MS,
            onProgress: sendEvent,
            signal: request.signal,
          });
          // Final event (also emitted inside the pipeline, but we re-emit
          // the full result here for UI convenience)
          sendEvent(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('api.refresh-leads: stream failed', { error: message });
          try {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ phase: 'done', error: message, message }) + '\n',
              ),
            );
          } catch { /* ignore */ }
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // Non-streaming path: just run and return the final result
  try {
    const result = await runRefreshPipeline({
      timeBudgetMs: PIPELINE_TIME_BUDGET_MS,
      signal: request.signal,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    log.error('api.refresh-leads: failed', { error: message });
    return Response.json({ error: message }, { status: 500 });
  }
}
