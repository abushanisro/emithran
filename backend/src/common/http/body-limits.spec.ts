import { Body, Controller, Injectable, Post, type CanActivate } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { configureBodyParsers } from './body-limits';

const seen = { guard: 0, handler: 0 };

@Injectable()
class CountingGuard implements CanActivate {
  canActivate(): boolean {
    seen.guard++;
    return true;
  }
}

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown) {
    seen.handler++;
    return { items: Array.isArray(body) ? body.length : Object.keys(body as object).length };
  }
}

describe('configureBodyParsers', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
      providers: [{ provide: APP_GUARD, useClass: CountingGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureBodyParsers(app);
    app.useGlobalFilters(new GlobalExceptionFilter()); // as main.ts does: a parser error must keep its 413
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    seen.guard = 0;
    seen.handler = 0;
  });

  const denseJson = (bytes: number) => `[${'{},'.repeat(Math.floor(bytes / 3))}{}]`;

  it('parses an ordinary JSON body', async () => {
    const res = await request(app.getHttpServer()).post('/echo').set('Content-Type', 'application/json').send(denseJson(500 * 1024));
    expect(res.status).toBe(201);
    expect(seen.handler).toBe(1);
  });

  it('refuses a JSON body over 1 MB with 413 before any guard or handler runs', async () => {
    const res = await request(app.getHttpServer()).post('/echo').set('Content-Type', 'application/json').send(denseJson(2 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe('Request body is too large.');
    expect(seen).toEqual({ guard: 0, handler: 0 });
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(app.getHttpServer()).post('/echo').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expect(seen.handler).toBe(0);
  });

  it('refuses an urlencoded body over 1 MB the same way', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`a=${'x'.repeat(2 * 1024 * 1024)}`);
    expect(res.status).toBe(413);
    expect(seen).toEqual({ guard: 0, handler: 0 });
  });

  it('main.ts installs these parsers and turns Nest\'s own off', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source: string = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', '..', 'main.ts'), 'utf8');
    expect(source).toContain('bodyParser: false');
    expect(source).toContain('configureBodyParsers(app)');
    expect(source).not.toMatch(/express\.(json|urlencoded)\(/);
  });
});
