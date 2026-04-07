/**
 * Structured logger for pipeline operations.
 * Outputs JSON lines for easy parsing in Vercel logs.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', msg, meta);
  },
};

/**
 * Wraps an async pipeline step with timing and error logging.
 */
export async function withLogging<T>(
  step: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<{ result: T | null; error: string | null; durationMs: number }> {
  const start = Date.now();
  log.info(`${step}: started`, meta);
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    log.info(`${step}: completed`, { ...meta, durationMs });
    return { result, error: null, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    log.error(`${step}: failed`, { ...meta, error: message, durationMs });
    return { result: null, error: message, durationMs };
  }
}
