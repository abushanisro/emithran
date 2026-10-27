// The one place logs are persisted: error messages only, to a daily file,
// never to the database. Both loggers write here — the winston Logger service
// and Nest's ConsoleLogger behind every `new Logger(Name)` (main.ts) — so an
// error is kept wherever it was raised. Info / warn / debug go to the console
// only.
//
// Retention: ERROR_LOG_RETENTION_DAYS (15). Rotation deletes files past it, and
// on start-up any older *.log left in the directory (including the retired
// application-*.log files) is removed too.
//
// ERROR_LOG_DIR (default "logs"); ERROR_LOG_FILE=false turns the file off.
// Off under Jest so tests never write files.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

export const ERROR_LOG_RETENTION_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

let sink: winston.Logger | null | undefined;

function enabled(): boolean {
  if (process.env.ERROR_LOG_FILE === 'false') return false;
  if (process.env.ERROR_LOG_FILE === 'true') return true;
  return process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID;
}

export function errorLogDir(): string {
  return process.env.ERROR_LOG_DIR || 'logs';
}

/** Deletes *.log files in `dir` last modified more than `days` ago. Returns the names removed. */
export function pruneOldLogFiles(dir: string, days = ERROR_LOG_RETENTION_DAYS, now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > days * DAY_MS) {
        fs.unlinkSync(file);
        removed.push(name);
      }
    } catch {
      // A file that vanished or cannot be removed is not worth failing over.
    }
  }
  return removed;
}

function errorSink(): winston.Logger | null {
  if (sink !== undefined) return sink;
  if (!enabled()) return (sink = null);
  const dir = errorLogDir();
  pruneOldLogFiles(dir);
  sink = winston.createLogger({
    level: 'error',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
      new DailyRotateFile({
        dirname: dir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: `${ERROR_LOG_RETENTION_DAYS}d`,
        auditFile: path.join(dir, '.error-log-audit.json'),
      }),
    ],
  });
  return sink;
}

/** Appends one error entry to today's error file. Never throws. */
export function writeErrorToFile(message: unknown, context?: string, stack?: string): void {
  try {
    const target = errorSink();
    if (!target) return;
    const text = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    const trace = stack ?? (message instanceof Error ? message.stack : undefined);
    target.error(text, { ...(context && { context }), ...(trace && { stack: trace }) });
  } catch {
    // Logging must never break the caller.
  }
}

/** Test hook: forget the sink so the next write re-reads the environment. */
export function resetErrorLogFileForTests(): void {
  sink?.close();
  sink = undefined;
}
