// The opt-in: with ALLOW_DEV_AUTH_BYPASS=true (outside production) the guard serves a request
// with no token as ADMIN_FALLBACK_EMAIL. This documents that the bypass still works when asked
// for, so turning the default off did not remove the local-development path.
process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
process.env.ELECTRONICS_QUEUE_DRIVER = 'memory';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './support/create-e2e-app';

jest.setTimeout(180_000);

describe('[e2e] dev auth bypass ON (explicit opt-in)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a request with no token as the configured bypass account', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/electronic-coverage-reports');
    expect(res.status).toBe(200);
  });

  // The bypass covers a request with NO token only (request-auth.guard.ts): a token that is presented and invalid is rejected outright,
  // bypass or not, so a client cannot choose which identity it gets by sending garbage.
  it('rejects a forged token even with the bypass on: the bypass only covers a request with no token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/electronic-coverage-reports')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
