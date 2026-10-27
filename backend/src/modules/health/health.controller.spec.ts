import * as http from 'http';
import type { AddressInfo } from 'net';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { ELECTRONICS_JOB_QUEUE, type QueueHealth } from '../electronics-costing/infrastructure/queue/job-queue.port';
import { ElectronicsQueueHealthIndicator } from '../electronics-costing/infrastructure/queue/queue.health';
import { HealthController } from './health.controller';
import { EngineHealthIndicator } from './indicators/engine.health';
import { SupabaseHealthIndicator } from './indicators/supabase.health';

// A stand-in engine we can switch between answering, erroring and hanging.
type Behaviour = 'up' | 'http503' | 'hang';
class FakeEngine {
  behaviour: Behaviour = 'up';
  paths: string[] = [];
  private readonly sockets = new Set<import('net').Socket>();
  private readonly server = http.createServer((req, res) => {
    this.paths.push(req.url ?? '');
    if (this.behaviour === 'hang') return; // never answer
    res.statusCode = this.behaviour === 'http503' ? 503 : 200;
    res.end('{}');
  });
  url = '';

  async start(): Promise<void> {
    this.server.on('connection', (socket) => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

// `from('projects').select('id').limit(1).abortSignal(..)` -> { error }
const databaseReturning = (error: { message: string } | null) => ({
  getPrivilegedClient: () => ({ from: () => ({ select: () => ({ limit: () => ({ abortSignal: async () => ({ error }) }) }) }) }),
});

describe('HealthController: liveness and readiness', () => {
  let app: INestApplication | undefined;
  const cad = new FakeEngine();
  const ecad = new FakeEngine();

  // Everything a test may change before boot(). Reset for each test.
  let database: ReturnType<typeof databaseReturning>;
  let ecadConfigured: boolean;
  let queueHealth: QueueHealth;

  const server = () => app!.getHttpServer();

  /** Builds the app from the current state above. Tests change the state, then call this. */
  async function boot(): Promise<void> {
    await app?.close();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TerminusModule,
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ CAD_ENGINE_URL: cad.url, ECAD_ENGINE_URL: ecadConfigured ? ecad.url : '' })],
        }),
      ],
      controllers: [HealthController],
      providers: [
        SupabaseHealthIndicator,
        EngineHealthIndicator,
        ElectronicsQueueHealthIndicator,
        { provide: SupabaseService, useValue: database },
        { provide: ELECTRONICS_JOB_QUEUE, useValue: { health: async () => queueHealth } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  beforeAll(async () => {
    await cad.start();
    await ecad.start();
  });
  afterAll(async () => {
    await cad.stop();
    await ecad.stop();
  });

  beforeEach(() => {
    cad.behaviour = 'up';
    ecad.behaviour = 'up';
    cad.paths = [];
    ecad.paths = [];
    ecadConfigured = true;
    database = databaseReturning(null);
    queueHealth = { configured: true, ready: true };
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('GET /api/health/live', () => {
    it('is 200 and depends on nothing', async () => {
      await boot();
      const res = await request(server()).get('/api/health/live').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('stays 200 while readiness is failing (an outage must not restart a healthy process)', async () => {
      database = databaseReturning({ message: 'connection refused' });
      cad.behaviour = 'http503';
      queueHealth = { configured: true, ready: false };
      await boot();

      await request(server()).get('/api/health/ready').expect(503);
      await request(server()).get('/api/health/live').expect(200);
    });
  });

  describe('GET /api/health/ready', () => {
    it('is 200 when the database, both engines and the queue answer', async () => {
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info).toMatchObject({
        database: { status: 'up' },
        cad_engine: { status: 'up' },
        ecad_engine: { status: 'up' },
        electronics_queue: { status: 'up' },
      });
    });

    it('probes each engine on its own /ready route', async () => {
      await boot();
      await request(server()).get('/api/health/ready').expect(200);
      expect(cad.paths).toEqual(['/ready']);
      expect(ecad.paths).toEqual(['/ready']);
    });

    it('is 503 and names cad_engine when it answers an error status', async () => {
      cad.behaviour = 'http503';
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(res.body.error.cad_engine).toMatchObject({ status: 'down', reason: 'http_503' });
      expect(res.body.info.ecad_engine.status).toBe('up'); // the others are still reported as up
    });

    it('is 503 and names ecad_engine when it is unreachable', async () => {
      const unreachable = new FakeEngine();
      await unreachable.start();
      const url = unreachable.url;
      await unreachable.stop(); // nothing listens on this port any more
      ecad.url = url;
      try {
        await boot();
        const res = await request(server()).get('/api/health/ready').expect(503);
        expect(res.body.error.ecad_engine).toMatchObject({ status: 'down', reason: 'unreachable' });
      } finally {
        await ecad.stop();
        await ecad.start(); // fresh listener for the tests after this one
      }
    });

    it('times out a hanging engine in about 2 s instead of hanging the probe', async () => {
      cad.behaviour = 'hang';
      await boot();
      const started = Date.now();
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(res.body.error.cad_engine).toMatchObject({ status: 'down', reason: 'timeout' });
    });

    it('is 503 with a reason code when the database query fails', async () => {
      database = databaseReturning({ message: 'permission denied for table projects' });
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(res.body.error.database).toMatchObject({ status: 'down', reason: 'query_failed' });
    });

    it('is 503 and names electronics_queue when a configured queue does not answer', async () => {
      queueHealth = { configured: true, ready: false };
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(res.body.error.electronics_queue).toMatchObject({ status: 'down', configured: true, reason: 'unreachable' });
      expect(res.body.info.database.status).toBe('up');
    });

    it('does not fail readiness for an engine with no URL configured, and says so', async () => {
      ecadConfigured = false;
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(200);
      expect(res.body.info.ecad_engine).toEqual({ status: 'up', configured: false });
    });

    it('does not fail readiness for a queue with no backend configured, and says so', async () => {
      queueHealth = { configured: false, ready: false };
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(200);
      expect(res.body.info.electronics_queue).toEqual({ status: 'up', configured: false });
    });

    it('never reveals an engine address or a driver error message in the public response', async () => {
      cad.behaviour = 'http503';
      database = databaseReturning({ message: 'password authentication failed for user "postgres" at 10.0.0.5' });
      queueHealth = { configured: true, ready: false };
      await boot();
      const res = await request(server()).get('/api/health/ready').expect(503);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/127\.0\.0\.1|localhost|10\.0\.0\.5|password|postgres|ECONNREFUSED/i);
    });
  });

  describe('GET /api/health (existing contract, unchanged)', () => {
    it('still answers 200 with the supabase indicator and ignores dependency state', async () => {
      cad.behaviour = 'http503';
      queueHealth = { configured: true, ready: false };
      await boot();
      const res = await request(server()).get('/api/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', info: { supabase: { status: 'up' } } });
      expect(Object.keys(res.body.info)).toEqual(['supabase']);
    });
  });
});
