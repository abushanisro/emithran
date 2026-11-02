// The limits that bound what one request can make this process do: how long a connection may take to send its request, what an
// uploaded archive or workbook may expand to, and how much parsing may run at once. One place, read once from the environment at
// start-up, each with a documented default. A value that is set but not a positive whole number in range stops the process at boot:
// a typo must never silently disable a limit.
//
// Memory budget (docker-compose.prod.yml gives the backend 2 GB): the main V8 heap is capped by NODE_OPTIONS=--max-old-space-size
// (about 70% of the container), and each heavy-work worker has its own heap of HEAVY_WORK_WORKER_HEAP_MB on top of it, at most
// HEAVY_WORK_MAX_CONCURRENT at a time. Raise either only together with the container's memory limit.

const MB = 1024 * 1024;

export interface HttpServerLimits {
  /** Time to receive a whole request (headers and body). Covers a slow MAX_UPLOAD_MB upload; Node's default is the same 5 minutes. */
  requestTimeoutMs: number;
  /** Time to receive the request headers (slowloris). */
  headersTimeoutMs: number;
  /** How long an idle keep-alive connection stays open. */
  keepAliveTimeoutMs: number;
  /** Headers read per request; the rest are dropped (Node's default is 2000). */
  maxHeadersCount: number;
}

export interface XlsxLimits {
  maxEntries: number;
  /** Largest part of a workbook (a sheet's XML). */
  maxEntryBytes: number;
  /** Largest embedded file under xl/media/ (pictures): never read by an import, so kept small. */
  maxMediaEntryBytes: number;
  /** What the whole workbook may expand to. */
  maxExpandedBytes: number;
  maxRatio: number;
}

export interface HeavyWorkLimits {
  /** Heavy parses (workbooks, archives) running at once in this process, across every caller. */
  maxConcurrent: number;
  /** Heavy parses one organization (or, without one, one user) may run at once. */
  maxPerTenant: number;
  /** V8 heap of the worker a parse runs in: running out ends that worker, not the API. */
  workerHeapMb: number;
  /** Wall-clock limit of one parse; the worker is stopped after it. */
  timeoutMs: number;
  /** What a refused caller is told to wait (Retry-After). */
  retryAfterSeconds: number;
}

export interface ResourceLimits {
  http: HttpServerLimits;
  /** What a CAD or electronics design pack (.zip) may expand to in total. */
  archiveMaxExpandedBytes: number;
  xlsx: XlsxLimits;
  heavyWork: HeavyWorkLimits;
}

type Env = Record<string, string | undefined>;

function whole(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`CONFIGURATION ERROR: ${name}=${raw} must be a whole number from ${min} to ${max} (default ${fallback}).`);
  }
  return value;
}

export function readResourceLimits(env: Env): ResourceLimits {
  const http: HttpServerLimits = {
    requestTimeoutMs: whole(env, 'HTTP_REQUEST_TIMEOUT_MS', 300_000, 1_000, 3_600_000),
    headersTimeoutMs: whole(env, 'HTTP_HEADERS_TIMEOUT_MS', 20_000, 1_000, 300_000),
    keepAliveTimeoutMs: whole(env, 'HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, 1_000, 300_000),
    maxHeadersCount: whole(env, 'HTTP_MAX_HEADERS_COUNT', 100, 20, 2_000),
  };
  if (http.headersTimeoutMs > http.requestTimeoutMs) {
    throw new Error('CONFIGURATION ERROR: HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS.');
  }
  const xlsx: XlsxLimits = {
    maxEntries: whole(env, 'XLSX_MAX_ENTRIES', 5_000, 10, 100_000),
    maxEntryBytes: whole(env, 'XLSX_MAX_ENTRY_MB', 20, 1, 500) * MB,
    maxMediaEntryBytes: whole(env, 'XLSX_MAX_MEDIA_ENTRY_MB', 5, 1, 500) * MB,
    maxExpandedBytes: whole(env, 'XLSX_MAX_EXPANDED_MB', 50, 1, 1_000) * MB,
    maxRatio: whole(env, 'XLSX_MAX_RATIO', 100, 2, 10_000),
  };
  return {
    http,
    archiveMaxExpandedBytes: whole(env, 'ARCHIVE_MAX_EXPANDED_MB', 256, 1, 4_096) * MB,
    xlsx,
    heavyWork: {
      maxConcurrent: whole(env, 'HEAVY_WORK_MAX_CONCURRENT', 2, 1, 64),
      maxPerTenant: whole(env, 'HEAVY_WORK_MAX_PER_TENANT', 1, 1, 64),
      workerHeapMb: whole(env, 'HEAVY_WORK_WORKER_HEAP_MB', 256, 32, 8_192),
      timeoutMs: whole(env, 'HEAVY_WORK_TIMEOUT_MS', 60_000, 1_000, 900_000),
      retryAfterSeconds: whole(env, 'HEAVY_WORK_RETRY_AFTER_SECONDS', 5, 1, 3_600),
    },
  };
}

/** This process's limits. Importing this module with an invalid setting throws, which stops the API at boot. */
export const RESOURCE_LIMITS: ResourceLimits = readResourceLimits(process.env);
