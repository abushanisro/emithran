import * as http from 'http';
import type { AddressInfo } from 'net';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { HealthController } from './health.controller';
import { EngineHealthIndicator } from './indicators/engine.health';
import { SupabaseHealthIndicator } from './indicators/supabase.health';

// A stand-in engine we can switch between answering, refusing, erroring and hanging.
type Behaviour = 'up' | 'http503' | 'hang';
class FakeEngine {
  behaviour: Behaviour = 'up';
  private readonly sockets = new Set<import('net').Socket>();
  private readonly server = http.createServer((_req, res) => {
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
  let app: INestApplication;
  const cad = new FakeEngine();
  const ecad = new FakeEngine();
  let database: ReturnType<typeof databaseReturning>;
  let ecadConfigured = true;
  let cadUrl: string | undefined;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    await cad.start();
    await ecad.start();
  });
  afterAll(async () => {
    await cad.stop();
    await ecad.stop();
  });

  beforeEach(async () => {
    cad.behaviour = 'up';
    ecad.behaviour = 'up';
    ecadConfigured = true;
    cadUrl = undefined;
    database = databaseReturning(null);
    const moduleRef = await Test.createTestingModule({
      imports: [
        TerminusModule,
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ CAD_ENGINE_URL: cadUrl ?? cad.url, ECAD_ENGINE_URL: ecadConfigured ? ecad.url : '' })],
        }),
      ],
      controllers: [HealthController],
      providers: [SupabaseHealthIndicator, EngineHealthIndicator, { provide: SupabaseService, useValue: database }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => app.close());

  describe('GET /api/health/live', () => {
    it('is 200 and depends on nothing', async () => {
      const res = await request(server()).get('/api/health/live').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('stays 200 while readiness is failing (an outage must not restart a healthy process)', async () => {
      database = databaseReturning({ message: 'connection refused' });
      await app.close();
      cad.behaviour = 'http503';
      // Rebuild with a failing database and a failing engine.
      const moduleRef = await Test.createTestingModule({
        imports: [TerminusModule, ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [() => ({ CAD_ENGINE_URL: cad.url, ECAD_ENGINE_URL: ecad.url })] })],
        controllers: [HealthController],
        providers: [SupabaseHealthIndicator, EngineHealthIndicator, { provide: SupabaseService, useValue: database }],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      await request(server()).get('/api/health/ready').expect(503);
      await request(server()).get('/api/health/live').expect(200);
    });
  });

  describe('GET /api/health/ready', () => {
    it('is 200 when the database and both engines answer', async () => {
      const res = await request(server()).get('/api/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info).toMatchObject({ database: { status: 'up' }, cad_engine: { status: 'up' }, ecad_engine: { status: 'up' } });
    });

    it('is 503 and names cad_engine when it answers an error status', async () => {
      cad.behaviour = 'http503';
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(res.body.error.cad_engine).toMatchObject({ status: 'down', reason: 'http_503' });
      expect(res.body.info.ecad_engine.status).toBe('up'); // the others are still reported as up
    });

    it('is 503 and names ecad_engine when it is unreachable', async () => {
      await ecad.stop();
      try {
        const res = await request(server()).get('/api/health/ready').expect(503);
        expect(res.body.error.ecad_engine).toMatchObject({ status: 'down', reason: 'unreachable' });
      } finally {
        await ecad.start(); // new port; later tests build their config from ecad.url
      }
    });

    it('times out a hanging engine in about 2 s instead of hanging the probe', async () => {
      cad.behaviour = 'hang';
      const started = Date.now();
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(res.body.error.cad_engine).toMatchObject({ status: 'down', reason: 'timeout' });
    });

    it('is 503 with a reason code when the database query fails', async () => {
      database.getPrivilegedClient = databaseReturning({ message: 'permission denied for table projects' }).getPrivilegedClient;
      const res = await request(server()).get('/api/health/ready').expect(503);
      expect(res.body.error.database).toMatchObject({ status: 'down', reason: 'query_failed' });
    });

    it('does not fail readiness for an engine with no URL configured, and says so', async () => {
      await app.close();
      ecadConfigured = false;
      const moduleRef = await Test.createTestingModule({
        imports: [TerminusModule, ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [() => ({ CAD_ENGINE_URL: cad.url, ECAD_ENGINE_URL: '' })] })],
        controllers: [HealthController],
        providers: [SupabaseHealthIndicator, EngineHealthIndicator, { provide: SupabaseService, useValue: database }],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      const res = await request(server()).get('/api/health/ready').expect(200);
      expect(res.body.info.ecad_engine).toEqual({ status: 'up', configured: false });
    });

    it('never reveals an engine address or a driver error message in the public response', async () => {
      cad.behaviour = 'http503';
      database.getPrivilegedClient = databaseReturning({ message: 'password authentication failed for user "postgres" at 10.0.0.5' }).getPrivilegedClient;
      const res = await request(server()).get('/api/health/ready').expect(503);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/127\.0\.0\.1|localhost|10\.0\.0\.5|password|postgres|ECONNREFUSED/i);
    });
  });

  describe('GET /api/health (existing contract, unchanged)', () => {
    it('still answers 200 with the supabase indicator and ignores dependency state', async () => {
      cad.behaviour = 'http503';
      const res = await request(server()).get('/api/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', info: { supabase: { status: 'up' } } });
      expect(Object.keys(res.body.info)).toEqual(['supabase']);
    });
  });
});
