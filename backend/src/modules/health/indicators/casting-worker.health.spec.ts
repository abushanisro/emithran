import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { HealthCheckError } from '@nestjs/terminus';

import { CastingWorkerHealthIndicator } from './casting-worker.health';

const indicator = (env: Record<string, string>) => new CastingWorkerHealthIndicator(new ConfigService(env));

describe('CastingWorkerHealthIndicator', () => {
  let dir: string;
  let server: Server | null = null;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'casting-health-')); });
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    rmSync(dir, { recursive: true, force: true });
  });
  const listen = (path: string) => new Promise<void>((resolve) => { server = createServer(() => undefined).listen(path, resolve); });

  it('is not configured, and still ready, without a socket or with the runner switched off', async () => {
    await expect(indicator({}).check('casting_worker')).resolves.toEqual({ casting_worker: { status: 'up', configured: false } });
    const off = indicator({ CASTING_WORKER_SOCKET: join(dir, 'w.sock'), CASTING_ANALYSIS_RUNNER: 'off' });
    await expect(off.check('casting_worker')).resolves.toEqual({ casting_worker: { status: 'up', configured: false } });
  });

  it('is ready when the host accepts a connection, even if it never answers (a busy host is not down)', async () => {
    const path = join(dir, 'w.sock');
    await listen(path);
    await expect(indicator({ CASTING_WORKER_SOCKET: path }).check('casting_worker')).resolves.toEqual({ casting_worker: { status: 'up', configured: true } });
  });

  it('is not ready when nothing listens, with a reason code and never the socket path', async () => {
    const path = join(dir, 'missing.sock');
    const error = await indicator({ CASTING_WORKER_SOCKET: path }).check('casting_worker').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HealthCheckError);
    const causes = JSON.stringify((error as HealthCheckError).causes);
    expect(causes).toContain('"reason":"unreachable"');
    expect(causes).not.toContain(path);
    expect(causes).not.toContain(dir);
  });
});
