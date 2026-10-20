// The opt-in: with ALLOW_DEV_AUTH_BYPASS=true (outside production) the guard serves a request
// with no token as ADMIN_FALLBACK_EMAIL. This documents that the bypass still works when asked
// for, so turning the default off did not remove the local-development path.
process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
process.env.ELECTRONICS_QUEUE_DRIVER = 'memory';

import { Test } from '@nestjs/testing';
import { VersioningType, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { CustomValidationPipe } from '../src/common/pipes/validation.pipe';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { RequestAuthInterceptor } from '../src/common/interceptors/request-auth.interceptor';

jest.setTimeout(180_000);

describe('[e2e] dev auth bypass ON (explicit opt-in)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new CustomValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor(), new RequestAuthInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a request with no token as the configured bypass account', async () => {
    const res = await request(app.getHttpServer()).get('/v1/api/electronics/reference-coverage');
    expect(res.status).toBe(200);
  });

  it('serves a request with a forged token as the bypass account', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/api/electronics/reference-coverage')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(200);
  });
});
