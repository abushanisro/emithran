// Logging policy (2026-10-27): only error messages are persisted, to a daily
// file kept 15 days -- never to the database. Both loggers (the winston Logger
// service and Nest's ConsoleLogger behind `new Logger(Name)`) feed that file.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ERROR_LOG_RETENTION_DAYS,
  pruneOldLogFiles,
  resetErrorLogFileForTests,
  startErrorLogCleanup,
  writeErrorToFile,
} from '../../../common/logger/error-log-file';
import { FileErrorConsoleLogger } from '../../../common/logger/file-error-console-logger';
import { Logger } from '../../../common/logger/logger.service';

const DAY = 24 * 60 * 60 * 1000;

describe('error log file', () => {
  let dir: string;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errlog-'));
    process.env.ERROR_LOG_FILE = 'true';
    process.env.ERROR_LOG_DIR = dir;
    resetErrorLogFileForTests();
  });
  afterEach(() => {
    resetErrorLogFileForTests();
    process.env = { ...env };
    // winston may still hold the file for a moment (Windows refuses to delete it then): retry instead of failing the test
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  /** Entries written so far, once winston has flushed the file. */
  async function entries(): Promise<Array<Record<string, string>>> {
    await new Promise((r) => setTimeout(r, 200));
    const files = fs.readdirSync(dir).filter((f) => /^error-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    return files.flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  }

  it('keeps 15 days', () => {
    expect(ERROR_LOG_RETENTION_DAYS).toBe(15);
  });

  it('writes an error with its context and stack', async () => {
    writeErrorToFile('Apply failed', 'BOMItemsController', 'Error: boom\n    at x');
    const [e] = await entries();
    expect(e).toMatchObject({ level: 'error', message: 'Apply failed', context: 'BOMItemsController', stack: 'Error: boom\n    at x' });
    expect(e.timestamp).toBeDefined();
  });

  it('Nest `new Logger(Name).error` reaches the file; log and warn do not', async () => {
    const logger = new FileErrorConsoleLogger({ logLevels: [] });
    logger.log('request ok', 'HTTP');
    logger.warn('slow', 'HTTP');
    logger.error('lookup failed', 'trace-line', 'SheetMetalLookupService');
    const all = await entries();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ message: 'lookup failed', context: 'SheetMetalLookupService', stack: 'trace-line' });
  });

  it('the winston Logger service writes only its errors to the file', async () => {
    const logger = new Logger();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    (logger as any).logger.transports.forEach((t: any) => { t.silent = true; });
    logger.log('info line', 'X');
    logger.warn('warn line', 'X');
    logger.error('error line', undefined, 'X');
    const all = await entries();
    expect(all.map((e) => e.message)).toEqual(['error line']);
  });

  it('writes nothing when turned off', async () => {
    process.env.ERROR_LOG_FILE = 'false';
    resetErrorLogFileForTests();
    writeErrorToFile('ignored');
    expect(await entries()).toEqual([]);
  });

  it('removes *.log files older than the retention, keeps newer ones and other files', () => {
    const now = Date.now();
    const touch = (name: string, ageDays: number) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, 'x');
      const t = new Date(now - ageDays * DAY);
      fs.utimesSync(f, t, t);
    };
    touch('application-2026-10-01.log', 26);
    touch('error-2026-10-11.log', 16);
    touch('error-2026-10-20.log', 7);
    touch('.error-log-audit.json', 30);
    expect(pruneOldLogFiles(dir, 15, now).sort()).toEqual(['application-2026-10-01.log', 'error-2026-10-11.log']);
    expect(fs.readdirSync(dir).sort()).toEqual(['.error-log-audit.json', 'error-2026-10-20.log']);
  });

  it('cleanup runs at start-up without any error being written, then daily', () => {
    jest.useFakeTimers();
    try {
      const stale = (name: string) => {
        const f = path.join(dir, name);
        fs.writeFileSync(f, 'x');
        const t = new Date(Date.now() - 20 * DAY);
        fs.utimesSync(f, t, t);
      };
      stale('application-2026-10-01.log');
      const timer = startErrorLogCleanup();
      expect(fs.readdirSync(dir)).toEqual([]);
      stale('error-2026-10-02.log');
      jest.advanceTimersByTime(DAY);
      expect(fs.readdirSync(dir)).toEqual([]);
      clearInterval(timer!);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleanup is off when the error file is off', () => {
    process.env.ERROR_LOG_FILE = 'false';
    expect(startErrorLogCleanup()).toBeNull();
  });
});
