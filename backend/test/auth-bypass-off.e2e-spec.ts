// With ALLOW_DEV_AUTH_BYPASS=false (the default) the real app must answer 401 to a missing or a
// forged bearer token, on electronics routes and on an unrelated module, and still serve a real
// sign-in token. Real AppModule, real guard, real DB; nothing mocked.
//
// The flag is set before AppModule is imported: ConfigModule is evaluated once per process, so
// the "on" case lives in auth-bypass-on.e2e-spec.ts. ADMIN_FALLBACK_EMAIL stays configured on
// purpose: having it must not be enough to get in.
process.env.ALLOW_DEV_AUTH_BYPASS = 'false';
process.env.ELECTRONICS_QUEUE_DRIVER = 'memory';

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

const GHOST = '00000000-0000-4000-8000-000000000000';
const ROUTES: Array<['get' | 'post', string]> = [
  ['get', '/v1/api/electronics/reference-coverage'],
  ['get', `/v1/api/electronics/jobs/${GHOST}`],
  ['get', `/v1/api/electronics/results/${GHOST}`],
  ['post', '/v1/api/electronics/uploads'],
  ['post', '/v1/api/electronics/quotes'],
  ['get', '/v1/api/mhr/picker'],
];

describe('[e2e] dev auth bypass OFF — real app, real auth', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new CustomValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor(), new RequestAuthInterceptor());
    await app.init();

    const config = app.get(ConfigService);
    expect(config.get('ADMIN_FALLBACK_EMAIL')).toBeTruthy();
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env');
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    token = data.session.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ROUTES)('%s %s: 401 with no token', async (method, url) => {
    const res = await request(app.getHttpServer())[method](url);
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)('%s %s: 401 with a forged token', async (method, url) => {
    const res = await request(app.getHttpServer())[method](url).set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('401 for a structurally valid JWT that Supabase never issued', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: GHOST, role: 'authenticated', exp: 4102444800 })}.signature`;
    const res = await request(app.getHttpServer()).get('/v1/api/electronics/reference-coverage').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('the query-string token path is also verified, not trusted', async () => {
    const res = await request(app.getHttpServer()).get('/v1/api/electronics/reference-coverage?token=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('still serves a real sign-in token', async () => {
    const res = await request(app.getHttpServer()).get('/v1/api/electronics/reference-coverage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
