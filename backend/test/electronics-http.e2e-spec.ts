// Electronics costing over HTTP: the real app (AppModule), real auth guard, real
// organization guard, multipart upload, validation pipe, response envelope and RLS, with a
// real sign-in. Only the queue driver is the in-process one (ELECTRONICS_QUEUE_DRIVER=memory);
// the pg-boss adapter has its own e2e (electronics-pgboss.e2e-spec.ts).
process.env.ELECTRONICS_QUEUE_DRIVER ??= 'memory'; // set to pg-boss (with ELECTRONICS_QUEUE_DATABASE_URL) to run this suite through the real queue

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { CustomValidationPipe } from '../src/common/pipes/validation.pipe';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { RequestAuthInterceptor } from '../src/common/interceptors/request-auth.interceptor';

jest.setTimeout(180_000);

const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

describe('[e2e] electronics costing over HTTP — real app, real auth, real DB', () => {
  let app: INestApplication;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new CustomValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor(), new RequestAuthInterceptor());
    await app.init();

    const config = app.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env.local');
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    token = data.session.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function waitForJob(jobId: string): Promise<Record<string, any>> {
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer()).get(`/v1/api/electronics/jobs/${jobId}`).set(auth());
      expect(res.status).toBe(200);
      const job = res.body.data;
      if (job.state === 'completed' || job.state === 'failed') return job;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`job ${jobId} did not finish`);
  }

  // Authentication itself (401 on a missing or forged token) is SupabaseAuthGuard's own
  // behaviour and is refused only when NODE_ENV=production; outside production a missing or
  // invalid token is served as the configured dev bypass account, so it cannot be asserted here.

  it('serves the reference coverage with no engine ready', async () => {
    const res = await request(app.getHttpServer()).get('/v1/api/electronics/reference-coverage').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.summary.ready).toBe(0);
    expect(res.body.data.engines.length).toBeGreaterThan(10);
  });

  it.each([
    ['a missing batch size', {}],
    ['a zero batch size', { batchSize: 0 }],
    ['a fractional batch size', { batchSize: 2.5 }],
    ['a non-uuid upload id', { uploadId: 'abc', batchSize: 5 }],
  ])('rejects a quote request with %s', async (_name, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/v1/api/electronics/quotes')
      .set(auth())
      .send({ uploadId: '00000000-0000-4000-8000-000000000000', ...body });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a job, result, or upload that does not exist (or is not the caller organization)', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const server = app.getHttpServer();
    expect((await request(server).get(`/v1/api/electronics/jobs/${ghost}`).set(auth())).status).toBe(404);
    expect((await request(server).get(`/v1/api/electronics/results/${ghost}`).set(auth())).status).toBe(404);
    expect(
      (await request(server).post('/v1/api/electronics/quotes').set(auth()).send({ uploadId: ghost, batchSize: 5 })).status,
    ).toBe(404);
  });

  it('answers 400 for a malformed id', async () => {
    expect((await request(app.getHttpServer()).get('/v1/api/electronics/jobs/not-a-uuid').set(auth())).status).toBe(400);
  });

  describe('upload validation at the edge', () => {
    const post = () => request(app.getHttpServer()).post('/v1/api/electronics/uploads').set(auth());

    it('rejects a request with no files', async () => {
      expect((await post().field('kind', 'board').field('tier', 'C')).status).toBe(400);
    });

    it('rejects an unknown kind or tier', async () => {
      expect((await post().field('kind', 'panel').field('tier', 'C').attach('files', EMPTY_ZIP, 'a.zip')).status).toBe(400);
      expect((await post().field('kind', 'board').field('tier', 'Z').attach('files', EMPTY_ZIP, 'a.zip')).status).toBe(400);
    });

    it('rejects a file whose content does not match its extension, and one with an unsupported extension', async () => {
      const bad = await post().field('kind', 'board').field('tier', 'D').attach('files', Buffer.from('not a png'), 'photo.png');
      expect(bad.status).toBe(400);
      const exe = await post().field('kind', 'board').field('tier', 'D').attach('files', Buffer.from('MZ'), 'run.exe');
      expect(exe.status).toBe(400);
    });

    it('records a failed parse (no parser for a gerber archive) as a failed job, not a server error', async () => {
      const res = await post().field('kind', 'board').field('tier', 'B').attach('files', EMPTY_ZIP, 'gerbers.zip');
      expect(res.status).toBe(201);
      const job = await waitForJob(res.body.data.jobId);
      expect(job.state).toBe('failed');
      expect(job.error).toMatch(/No parser/);
    });
  });
});
