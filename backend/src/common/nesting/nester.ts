import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

/** The body of cad-engine's `POST /nest` (snake_case, unchanged): the same request reaches either implementation. */
export interface NestBody {
  outline_points_mm: number[][];
  holes_mm: Array<{ cx_mm: number; cy_mm: number; diameter_mm: number }>;
  sheet_width_mm: number;
  sheet_length_mm: number;
  quantity: number;
  kerf_mm: number;
  edge_margin_mm: number;
  allowed_rotations_deg?: number[];
}

export interface NestResult {
  sheet_width_mm: number;
  sheet_length_mm: number;
  parts_per_sheet: number;
  placements: Array<{ x_mm: number; y_mm: number; rotation_deg: number }>;
  utilization_pct: number;
  sheets_required: number | null;
  capped: boolean;
}

/** What the nester says about the part itself: a result, or the specific reason it cannot be nested (the Python endpoint's 422). */
export type NestAnswer = { ok: true; result: NestResult } | { ok: false; reason: string };

/** The nester could not give an answer at all (missing binary, crash, timeout, garbage): not a verdict on the part. */
export class NesterUnavailable extends Error {}

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

// One queue for the whole process: nesting is CPU-bound, so concurrent children are capped (default: half the cores) instead of every
// request starting its own and starving the API.
let active = 0;
const waiting: Array<() => void> = [];

function concurrencyLimit(): number {
  const configured = Number(process.env.NESTER_CONCURRENCY);
  return Number.isInteger(configured) && configured > 0 ? configured : Math.max(1, Math.floor(availableParallelism() / 2));
}

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= concurrencyLimit()) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

export function nesterEnabled(): boolean {
  return process.env.NESTING_ENGINE === 'rust';
}

function isAnswer(value: unknown): value is NestAnswer {
  const v = value as Partial<{ ok: unknown; reason: unknown; result: Partial<NestResult> }> | null;
  if (!v || typeof v !== 'object') return false;
  if (v.ok === false) return typeof v.reason === 'string';
  const r = v.result;
  return v.ok === true && !!r && typeof r.parts_per_sheet === 'number' && Array.isArray(r.placements) && typeof r.utilization_pct === 'number' && typeof r.capped === 'boolean';
}

/**
 * Runs the Rust `nester` binary on one request: JSON on stdin, one JSON answer on stdout. The child gets an empty environment, a
 * wall-clock deadline (it stops by itself and answers `capped: true` with what it placed, so the kill below is only the backstop), and
 * is held to the process-wide concurrency limit.
 */
export function runNester(body: NestBody, timeoutMs = Number(process.env.NESTER_TIMEOUT_MS) || 60_000): Promise<NestAnswer> {
  const bin = process.env.NESTER_BIN || '/usr/local/bin/nester';
  return slot(
    () =>
      new Promise<NestAnswer>((resolve, reject) => {
        const child = spawn(bin, ['--deadline-ms', String(Math.max(1000, timeoutMs - 2000))], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        let settled = false;
        const finish = (done: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          done();
        };
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(() => reject(new NesterUnavailable(`the nester did not answer within ${timeoutMs} ms and was killed`)));
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          if (out.length > MAX_OUTPUT_BYTES) {
            child.kill('SIGKILL');
            finish(() => reject(new NesterUnavailable('the nester answered with more data than allowed')));
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (err.length < 2000) err += chunk.toString('utf8');
        });
        child.on('error', (error) => finish(() => reject(new NesterUnavailable(`cannot run the nester (${bin}): ${error.message}`))));
        child.on('close', (code, signal) =>
          finish(() => {
            if (code !== 0) {
              return reject(new NesterUnavailable(`the nester ${signal ? `was stopped by ${signal}` : `exited with code ${code}`}: ${err.trim().slice(0, 300)}`));
            }
            let answer: unknown;
            try {
              answer = JSON.parse(out);
            } catch {
              return reject(new NesterUnavailable('the nester answered with something that is not JSON'));
            }
            if (!isAnswer(answer)) return reject(new NesterUnavailable('the nester answered outside its contract'));
            resolve(answer);
          }),
        );
        child.stdin.on('error', () => undefined); // a child that exits early closes the pipe; the close handler reports why
        child.stdin.end(JSON.stringify(body));
      }),
  );
}
