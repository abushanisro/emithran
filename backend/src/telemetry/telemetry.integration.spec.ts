import { spawn, spawnSync } from 'child_process';
import * as path from 'path';

import { METRIC_LABEL_KEYS } from './metrics';

// Real instrumentation, real exporters, in a plain Node child process per scenario. OpenTelemetry patches
// http/undici through require hooks, which Jest's module registry bypasses, so these cannot run in-process.
// The fixtures live in backend/test/telemetry/.
jest.setTimeout(90_000);

const backendRoot = path.resolve(__dirname, '..', '..');
const fixture = (name: string) => path.join(backendRoot, 'test', 'telemetry', name);
const nodeArgs = ['-r', 'ts-node/register/transpile-only'];

function run(name: string, args: string[] = []): { stdout: string; result: any } {
  const child = spawnSync(process.execPath, [...nodeArgs, fixture(name), ...args], { cwd: backendRoot, encoding: 'utf8', timeout: 60_000 });
  if (child.status !== 0) throw new Error(`${name} exited ${child.status}\n${child.stderr}\n${child.stdout}`);
  const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
  if (!line) throw new Error(`${name} printed no RESULT\n${child.stdout}\n${child.stderr}`);
  return { stdout: child.stdout, result: JSON.parse(line.slice('RESULT:'.length)) };
}

describe('enabled: propagation, correlation, duplicates, sensitive data', () => {
  let stdout: string;
  let r: any;
  const SERVER = 1;
  const CLIENT = 2;

  beforeAll(() => {
    ({ stdout, result: r } = run('propagation.fixture.ts'));
  });

  it('joins the trace of an incoming traceparent and forwards it, over both axios and fetch, to the downstream call', () => {
    const inTrace = r.spans.filter((s: any) => s.traceId === r.upstreamTrace);
    const clients = inTrace.filter((s: any) => s.kind === CLIENT);
    expect(clients).toHaveLength(2); // one axios (http), one fetch (undici)

    const forwarded = r.seen.slice(0, 2);
    for (const call of forwarded) {
      const [, traceId, parentId, flags] = call.traceparent.split('-');
      expect(traceId).toBe(r.upstreamTrace);
      expect(flags).toBe('01');
      expect(clients.map((s: any) => s.spanId)).toContain(parentId); // the downstream's parent is the client span
    }
    expect(new Set(forwarded.map((c: any) => c.traceparent.split('-')[2])).size).toBe(2); // two distinct client spans
  });

  it('creates exactly one client span per outbound call: no duplicate spans', () => {
    const clients = r.spans.filter((s: any) => s.kind === CLIENT);
    expect(clients).toHaveLength(4); // 2 requests x (1 axios + 1 fetch)
    expect(new Set(clients.map((s: any) => s.spanId)).size).toBe(4);
    expect(r.spans.filter((s: any) => s.name === 'costing.route_comparison')).toHaveLength(2); // one per request
  });

  it('starts a new root trace when no traceparent arrives, and propagates that one instead', () => {
    const second = r.seen.slice(2, 4).map((c: any) => c.traceparent.split('-')[1]);
    expect(second[0]).toBe(second[1]);
    expect(second[0]).not.toBe(r.upstreamTrace);
    expect(r.spans.some((s: any) => s.traceId === second[0] && s.kind === SERVER && s.attributes['http.route'] === '/parts/:id')).toBe(true);
  });

  it('names the server span by route pattern and puts the costing span in the same trace', () => {
    const server = r.spans.find((s: any) => s.traceId === r.upstreamTrace && s.kind === SERVER && s.attributes['http.route']);
    expect(server.name).toBe('GET /parts/:id');
    const costing = r.spans.find((s: any) => s.traceId === r.upstreamTrace && s.name === 'costing.route_comparison');
    expect(costing).toBeDefined();
  });

  it('correlates BOTH logging paths with the request trace', () => {
    const nestLine = stdout.split('\n').find((l) => l.includes('nest-path line for item-aaa-111'))!;
    expect(nestLine).toMatch(new RegExp(`trace_id=${r.upstreamTrace} span_id=[0-9a-f]{16}`));
    const winstonLine = stdout.split('\n').find((l) => l.includes('winston-path line for item-aaa-111'))!;
    expect(winstonLine).toContain(`"trace_id":"${r.upstreamTrace}"`);

    const otherTrace = r.seen[2].traceparent.split('-')[1];
    expect(stdout.split('\n').find((l) => l.includes('nest-path line for item-bbb-222'))).toContain(`trace_id=${otherTrace}`);
    expect(stdout.split('\n').find((l) => l.includes('winston-path line for item-bbb-222'))).toContain(`"trace_id":"${otherTrace}"`);
  });

  it('exports no credential, query string, filename, customer name or id in any span or metric', () => {
    const exported = JSON.stringify({ spans: r.spans, metrics: r.metrics });
    for (const secret of ['SECRET-TOKEN', 'QUERY-SECRET', 'bracket.step', 'ACME', 'item-aaa-111', 'item-bbb-222', 'user-ccc-333', 'authorization', '?file=', 'customer=']) {
      expect(exported).not.toContain(secret);
    }
    const allowedSpanKeys = /^(http\.|url\.scheme|server\.|network\.|error\.type|component|emithran\.|nestjs\.)/;
    for (const span of r.spans) for (const key of Object.keys(span.attributes)) expect(key).toMatch(allowedSpanKeys);
  });

  it('keeps every metric label inside the allow-list, counts guard rejections and unmatched routes, and carries no id', () => {
    const allowed = new Set<string>(METRIC_LABEL_KEYS);
    for (const metric of r.metrics) for (const key of metric.labelKeys) expect(allowed.has(key)).toBe(true);

    expect(r.blockedStatus).toBe(403);
    const server = r.metrics.find((m: any) => m.name === 'emithran.http.server.duration').labels as Record<string, string>[];
    expect(server).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 'http.route': '/parts/:id', 'emithran.status_class': '2xx' }),
        expect.objectContaining({ 'http.route': '/blocked', 'emithran.status_class': '4xx' }), // rejected before any interceptor
        expect.objectContaining({ 'http.route': 'unmatched', 'emithran.status_class': '4xx' }),
      ]),
    );
    expect(JSON.stringify(server)).not.toMatch(/item-|user-/);
    expect(r.metrics.map((m: any) => m.name)).not.toContain('http.server.request.duration'); // replaced by ours
  });
});

describe('sampling is decided by this service, never by the caller', () => {
  const SERVER = 1;

  it('does not record a request just because the caller says "sampled" (the web client says it on every request)', () => {
    const { result: r } = run('propagation.fixture.ts', ['0', '01']);
    expect(r.spans).toEqual([]); // ratio 0: nothing recorded, whatever the incoming flag
    // The trace id still continues downstream (correlation survives), carrying THIS service's decision: not sampled.
    const [, traceId, , flags] = r.seen[0].traceparent.split('-');
    expect(traceId).toBe(r.upstreamTrace);
    expect(flags).toBe('00');
  });

  it('does record a request the caller marked "not sampled" when the local ratio keeps it', () => {
    const { result: r } = run('propagation.fixture.ts', ['1', '00']);
    expect(r.spans.some((s: any) => s.traceId === r.upstreamTrace && s.kind === SERVER)).toBe(true);
    expect(r.seen[0].traceparent.split('-')[3]).toBe('01'); // downstream is told to record, by this service's decision
  });

  it('still counts the request in metrics when the trace is not sampled', () => {
    const { result: r } = run('propagation.fixture.ts', ['0', '01']);
    const server = r.metrics.find((m: any) => m.name === 'emithran.http.server.duration');
    expect(server.labels).toContainEqual(expect.objectContaining({ 'http.route': '/parts/:id', 'emithran.status_class': '2xx' }));
  });
});

describe('disabled: no OTEL_EXPORTER_OTLP_ENDPOINT', () => {
  it('loads and initialises no SDK, passes @Traced straight through, and adds no trace fields', () => {
    const { result } = run('disabled.fixture.ts');
    expect(result.handleIsNull).toBe(true);
    expect(result.active).toBe(false);
    expect(result.loaded).toEqual([]); // no sdk-*, exporter-*, instrumentation-*, resources, core in the module cache
    expect(result.samePromise).toBe(true);
    expect(result.rejection).toBe('boom');
    expect(result.winstonLines.join('')).not.toMatch(/trace_id|span_id/);
    expect(result.consoleLines.join('')).not.toMatch(/trace_id|span_id/);
  });
});

describe('fail open: the telemetry backend is dead or hanging', () => {
  const felt = (r: any) => {
    expect(r.unhandled).toBe(0); // no unhandled promise rejection
    expect(r.uncaught).toBe(0); // no uncaught exception
    expect(r.maxStuckMs).toBeLessThan(500); // requests are not delayed while exports are failing or stuck
    expect(r.heapDeltaMb).toBeLessThan(100); // 50,000 spans do not pile up in memory
  };

  it('connection refused', () => {
    const { result } = run('failopen.fixture.ts', ['dead']);
    felt(result);
    expect(result.shutdownMs).toBeLessThan(3_500);
  });

  it('collector accepts connections and never answers (flooded past the queue bound)', () => {
    const { result } = run('failopen.fixture.ts', ['hanging']);
    felt(result);
    expect(result.shutdownMs).toBeLessThan(3_500);
  });

  it('shutdown is bounded by its timeout when the final flush itself hangs', () => {
    const { result } = run('failopen.fixture.ts', ['hanging', 'noflood']);
    felt(result);
    expect(result.shutdownMs).toBeGreaterThan(2_000); // it really waited on the hung export
    expect(result.shutdownMs).toBeLessThan(3_800); // and gave up at the 3 s bound
  });

  // POSIX signals only: on Windows SIGTERM terminates the process without running handlers.
  (process.platform === 'win32' ? it.skip : it)('SIGTERM with a hanging collector ends the process within the bound, by the original signal', async () => {
    const child = spawn(process.execPath, [...nodeArgs, fixture('signal.fixture.ts')], { cwd: backendRoot });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture never became READY')), 30_000);
      child.stdout.on('data', (d) => { if (String(d).includes('READY')) { clearTimeout(timer); resolve(); } });
      child.on('error', reject);
    });
    const sent = Date.now();
    child.kill('SIGTERM');
    const { signal } = await new Promise<{ signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (_code, sig) => resolve({ signal: sig })));
    expect(signal).toBe('SIGTERM');
    expect(Date.now() - sent).toBeLessThan(5_000);
  });
});
