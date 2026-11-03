// The one spelling of a path: /api/v1/<resource>. Booted with the same configuration main.ts uses (common/http/api-prefix.ts).
import { BadRequestException, Controller, Get, type INestApplication, VERSION_NEUTRAL } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { configureApiPrefix } from '../../../common/http/api-prefix';

@Controller({ path: 'machine-rates', version: '1' })
class RatesController {
  @Get(':id')
  one(): { id: string } {
    return { id: 'rate' };
  }

  @Get('bad/input')
  bad(): never {
    throw new BadRequestException('The id is not valid');
  }
}

@Controller({ path: 'health', version: VERSION_NEUTRAL })
class HealthController {
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }
}

@Controller({ version: VERSION_NEUTRAL })
class RootController {
  @Get()
  root(): { ok: boolean } {
    return { ok: true };
  }

  @Get('ping')
  ping(): { pong: boolean } {
    return { pong: true };
  }
}

describe('the API prefix', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [RatesController, HealthController, RootController] }).compile();
    app = moduleRef.createNestApplication();
    configureApiPrefix(app);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('serves a resource at /api/v1/<resource>', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/machine-rates/7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'rate' });
  });

  it.each(['/v1/api/machine-rates/7', '/machine-rates/7', '/api/machine-rates/7', '/api/v2/machine-rates/7', '/api/v1/mhr/7'])('has no other spelling: %s is 404', async (url) => {
    expect((await request(app.getHttpServer()).get(url)).status).toBe(404);
  });

  it('serves the health checks at /api/health/* with no version', async () => {
    expect((await request(app.getHttpServer()).get('/api/health/live')).status).toBe(200);
  });

  it('keeps the liveness routes at the root', async () => {
    expect((await request(app.getHttpServer()).get('/')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/ping')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/api/ping')).status).toBe(404);
  });

  it('answers an API error as RFC 9457 problem details, and never echoes the query string', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/machine-rates/bad/input?token=SECRET');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'The id is not valid', instance: '/api/v1/machine-rates/bad/input' });
    expect(typeof res.body.code).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });
});
