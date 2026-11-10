// With ALLOW_DEV_AUTH_BYPASS=false (the default) the real app must answer 401 to a missing or a
// forged bearer token, on electronics routes and on an unrelated module. Real AppModule, real guard;
// nothing mocked. (A real Auth0 sign-in is covered by e2e/auth.setup.ts.)
//
// The flag is set before AppModule is imported: ConfigModule is evaluated once per process, so
// the "on" case lives in auth-bypass-on.e2e-spec.ts. ADMIN_FALLBACK_EMAIL stays configured on
// purpose: having it must not be enough to get in.
process.env.ALLOW_DEV_AUTH_BYPASS = 'false';
process.env.ELECTRONICS_QUEUE_DRIVER = 'memory';

import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './support/create-e2e-app';

jest.setTimeout(180_000);

const GHOST = '00000000-0000-4000-8000-000000000000';
const ROUTES: Array<['get' | 'post', string]> = [
  ['get', '/api/v1/electronic-coverage-reports'],
  ['get', `/api/v1/electronic-jobs/${GHOST}`],
  ['get', `/api/v1/electronic-results/${GHOST}`],
  ['post', '/api/v1/electronic-uploads'],
  ['post', '/api/v1/electronic-quotes'],
  ['get', '/api/v1/machine-rates/picker'],
];

describe('[e2e] dev auth bypass OFF — real app, real auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();

    const config = app.get(ConfigService);
    expect(config.get('ADMIN_FALLBACK_EMAIL')).toBeTruthy();
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

  it('401 for a structurally valid JWT that Auth0 never issued', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: GHOST, role: 'authenticated', exp: 4102444800 })}.signature`;
    const res = await request(app.getHttpServer()).get('/api/v1/electronic-coverage-reports').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('the query-string token path is also verified, not trusted', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/electronic-coverage-reports?token=not-a-real-token');
    expect(res.status).toBe(401);
  });
});
