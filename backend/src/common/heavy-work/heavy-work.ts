import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { BadRequestException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';


import { type ArchiveLimits, type ExpandedArchive } from '../archive/expand-archive';
import { xlsxZipLimits } from '../archive/xlsx-limits';
import { TryAgainLaterException } from '../http/try-again-later.exception';
import { currentRequestAuth } from '../request-context/request-auth-context';
import { RESOURCE_LIMITS, type HeavyWorkLimits } from '../resource-limits';
import { workbookFromData } from './workbook-data';

import type { HeavyResult, HeavyTask } from './heavy-tasks';
import type * as ExcelJS from 'exceljs';

// Parsing untrusted uploads (workbooks, design-pack archives) is the most memory- and CPU-hungry thing the API does, so it is
// contained in two ways (limits in common/resource-limits.ts):
// - each parse runs in its own worker thread with a capped V8 heap and a deadline: a file that needs more ends that thread with a
//   413, while the API keeps serving everyone else;
// - only so many parses run at once in this process, and one organization (or, without one, one user) gets only its share; a
//   request over either is refused at once with Retry-After (503 when the server is full, 429 when the caller is), never queued
//   behind work it cannot see.

/** Counts parses in flight, in total and per tenant. */
export class HeavyWorkSlots {
  private running = 0;
  private readonly perTenant = new Map<string, number>();

  constructor(private readonly limits: Pick<HeavyWorkLimits, 'maxConcurrent' | 'maxPerTenant' | 'retryAfterSeconds'>) {}

  /** Takes a slot for the tenant, or throws TryAgainLaterException. The returned function gives it back (once). */
  acquire(tenant: string): () => void {
    const mine = this.perTenant.get(tenant) ?? 0;
    if (mine >= this.limits.maxPerTenant) {
      throw new TryAgainLaterException(HttpStatus.TOO_MANY_REQUESTS, 'Another file of yours is still being read. Try again shortly.', this.limits.retryAfterSeconds);
    }
    if (this.running >= this.limits.maxConcurrent) {
      throw new TryAgainLaterException(HttpStatus.SERVICE_UNAVAILABLE, 'The server is reading other files. Try again shortly.', this.limits.retryAfterSeconds);
    }
    this.running++;
    this.perTenant.set(tenant, mine + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      const left = (this.perTenant.get(tenant) ?? 1) - 1;
      if (left > 0) this.perTenant.set(tenant, left);
      else this.perTenant.delete(tenant);
    };
  }
}

const slots = new HeavyWorkSlots(RESOURCE_LIMITS.heavyWork);

/** Whose share a parse counts against: the request's organization, or its user when the route resolves none. */
function currentTenant(): string {
  const auth = currentRequestAuth();
  if (auth?.organizationId) return `org:${auth.organizationId}`;
  if (auth?.userId) return `user:${auth.userId}`;
  // Every caller is an authenticated route; anything else is a wiring mistake, not something to let through uncounted.
  throw new Error('Heavy work must run inside an authenticated request.');
}

/** Runs fn while holding one of this process's heavy-work slots for the current request's tenant. */
export async function withHeavyWorkSlot<T>(fn: () => Promise<T>, slotPool: HeavyWorkSlots = slots): Promise<T> {
  const release = slotPool.acquire(currentTenant());
  try {
    return await fn();
  } finally {
    release();
  }
}

// Compiled, the worker is heavy-work.worker.js next to this file. Run from TypeScript sources (tests, ts-node scripts), it is the
// .ts file, which the worker thread needs ts-node to load.
const WORKER_FILE = path.join(__dirname, `heavy-work.worker${path.extname(__filename)}`);
const WORKER_EXEC_ARGV = path.extname(__filename) === '.ts' ? ['--require', 'ts-node/register/transpile-only'] : undefined;

const tooBig = () => new PayloadTooLargeException('The file needs more memory or time to read than this server allows. Split it into smaller files.');

/** Runs one task in a fresh worker thread under the configured heap cap and deadline. */
export function runInWorker(task: HeavyTask, limits: Pick<HeavyWorkLimits, 'workerHeapMb' | 'timeoutMs'> = RESOURCE_LIMITS.heavyWork): Promise<HeavyResult> {
  return new Promise<HeavyResult>((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: task,
      execArgv: WORKER_EXEC_ARGV,
      resourceLimits: { maxOldGenerationSizeMb: limits.workerHeapMb },
    });
    let settled = false;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      void worker.terminate();
      outcome();
    };
    const deadline = setTimeout(() => { settle(() => { reject(tooBig()); }); }, limits.timeoutMs);
    worker.once('message', (result: HeavyResult) => { settle(() => { resolve(result); }); });
    worker.once('error', (error: Error & { code?: string }) => { settle(() => { reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? tooBig() : error); }); },
    );
    worker.once('exit', (code) => { settle(() => { reject(new Error(`Heavy-work worker stopped (exit code ${code}) without a result.`)); }); });
  });
}

/**
 * An uploaded .xlsx as an ExcelJS workbook holding its cell values, read in a worker after both layers of the archive gate
 * (verifyZip) passed. The only way uploaded workbook bytes reach ExcelJS. Takes a heavy-work slot for the request.
 */
export function readWorkbook(bytes: Buffer, limits = xlsxZipLimits()): Promise<ExcelJS.Workbook> {
  return withHeavyWorkSlot(async () => {
    const result = await runInWorker({ kind: 'workbook', bytes, limits });
    if (result.kind !== 'workbook') throw new Error('Heavy-work worker answered a workbook with something else.');
    if (!result.ok) throw new BadRequestException(result.message);
    return workbookFromData(result.sheets);
  });
}

/** An uploaded .zip unpacked in a worker (expand-archive.ts). The caller holds the heavy-work slot, if it serves a request. */
export async function expandArchiveInWorker(name: string, bytes: Buffer, limits: ArchiveLimits): Promise<ExpandedArchive> {
  const result = await runInWorker({ kind: 'archive', name, bytes, limits });
  if (result.kind !== 'archive') throw new Error('Heavy-work worker answered an archive with something else.');
  const { archive } = result;
  if (!archive.ok) return archive;
  // Transferred buffers arrive as plain Uint8Arrays; wrap them (no copy) so callers get Buffers as before.
  const entries = archive.entries.map((e) => ({ ...e, bytes: Buffer.from(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength) }));
  return { ...archive, entries };
}
