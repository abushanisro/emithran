// The public prefix is /api/v1, an alias for the controllers under /v1/api (common/http/api-v1.ts). Booted for real, with Nest's URI
// versioning as main.ts sets it, so the alias is proven against the router and not against a mock.
import { BadRequestException, Controller, Get, type INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { apiV1Middleware } from '../../../common/http/api-v1';

@Controller({ path: 'api/machine-rates', version: '1' })
class RatesController {
  @Get(':id')
  one(): { id: string } {
    return { id: 'rate' };
  }
}

@Controller({ path: 'api/things', version: '1' })
class ThingsController {
  @Get(':id')
  one(): { id: string } {
    return { id: 'a' };
  }

  @Get('bad/input')
  bad(): never {
    throw new BadRequestException('The id is not valid');
  }
}

async function boot(env: Record<string, string | undefined> = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [ThingsController, RatesController] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(apiV1Middleware(env));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

describe('/api/v1 prefix', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await boot(); });
  afterAll(async () => { await app.close(); });

  it('routes /api/v1/<path> to the same controller as /v1/api/<path>', async () => {
    const [fresh, legacy] = await Promise.all([request(app.getHttpServer()).get('/api/v1/things/1'), request(app.getHttpServer()).get('/v1/api/things/1')]);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ id: 'a' });
    expect(legacy.body).toEqual({ id: 'a' });
  });

  it('answers errors on the new prefix as RFC 9457 problem details, with a stable code', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/things/bad/input?token=SECRET');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The id is not valid',
      instance: '/api/v1/things/bad/input',
    });
    expect(typeof res.body.code).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('keeps the old error body on the old prefix, and marks that prefix deprecated', async () => {
    const res = await request(app.getHttpServer()).get('/v1/api/things/bad/input');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('The id is not valid');
    expect(res.headers.deprecation).toBe('@1793664000');
    expect(res.headers.link).toBe('</api/v1/things/bad/input>; rel="successor-version"');
    expect(res.headers.sunset).toBeUndefined();
  });

  it('does not mark the new prefix deprecated', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/things/1');
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.link).toBeUndefined();
  });

  it('adds Sunset to the old prefix once LEGACY_API_SUNSET names the date', async () => {
    const dated = await boot({ LEGACY_API_SUNSET: 'Wed, 30 Jun 2027 00:00:00 GMT' });
    try {
      const res = await request(dated.getHttpServer()).get('/v1/api/things/1');
      expect(res.headers.sunset).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
    } finally {
      await dated.close();
    }
  });

  it('leaves everything outside the two prefixes alone', async () => {
    const res = await request(app.getHttpServer()).get('/api/things/1');
    expect(res.status).toBe(404);
    expect(res.headers.deprecation).toBeUndefined();
  });

  describe('renamed resources', () => {
    it('serves the new name without a deprecation notice', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/machine-rates/7');
      expect(res.status).toBe(200);
      expect(res.headers.deprecation).toBeUndefined();
    });

    it('routes the old name on the new prefix to the new controller, and says where it moved', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/mhr/7?x=1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'rate' });
      expect(res.headers.deprecation).toBe('@1793664000');
      expect(res.headers.link).toBe('</api/v1/machine-rates/7>; rel="successor-version"');
    });

    it('routes the old name on the old prefix the same way, with the successor on the new prefix', async () => {
      const res = await request(app.getHttpServer()).get('/v1/api/mhr/7');
      expect(res.status).toBe(200);
      expect(res.headers.link).toBe('</api/v1/machine-rates/7>; rel="successor-version"');
    });

    it('answers a problem on the new prefix, even through an old name', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/mhr');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    });
  });

  it('links the deprecation notice too once API_DEPRECATION_DOCS_URL is set, with both link relations in one header', async () => {
    const documented = await boot({ API_DEPRECATION_DOCS_URL: 'https://docs.example.com/deprecations/v1' });
    try {
      const res = await request(documented.getHttpServer()).get('/v1/api/things/1');
      expect(res.headers.link).toBe('</api/v1/things/1>; rel="successor-version", <https://docs.example.com/deprecations/v1>; rel="deprecation"; type="text/html"');
    } finally {
      await documented.close();
    }
  });
});
