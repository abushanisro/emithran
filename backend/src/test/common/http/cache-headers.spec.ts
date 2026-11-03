// docs/API.md rule 8: reads are revalidated with an ETag that covers the data (not the changing envelope), never cached by a shared
// cache; writes are not stored. Booted for real with the interceptor main.ts uses.
import { Controller, Delete, Get, HttpCode, HttpStatus, type INestApplication, Post, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';

import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';

let version = 1;

@Controller('api/rates')
class RatesController {
  @Get()
  list(): Array<{ code: string; rate: number }> {
    return [{ code: 'EUR', rate: version }];
  }

  @Get('stream')
  stream(@Res() res: Response): void {
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.type('text/event-stream').send('data: hi\n\n');
  }

  @Post()
  create(): { id: string } {
    return { id: 'r1' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): void {}
}

describe('cache headers', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [RatesController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { version = 1; });

  it('a read is private and must be revalidated, and carries an ETag', async () => {
    const res = await request(app.getHttpServer()).get('/api/rates');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers.etag).toMatch(/^W\/"[\w-]+"$/);
  });

  it('answers 304 with no body when the data is unchanged, although the timestamp in the envelope is new', async () => {
    const first = await request(app.getHttpServer()).get('/api/rates');
    await new Promise((r) => setTimeout(r, 5)); // the envelope timestamp differs
    const second = await request(app.getHttpServer()).get('/api/rates').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('answers 200 with the new data once the data has changed', async () => {
    const first = await request(app.getHttpServer()).get('/api/rates');
    version = 2;
    const second = await request(app.getHttpServer()).get('/api/rates').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual([{ code: 'EUR', rate: 2 }]);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });

  it('a write is never stored', async () => {
    const created = await request(app.getHttpServer()).post('/api/rates');
    expect(created.headers['cache-control']).toBe('no-store');
    const removed = await request(app.getHttpServer()).delete('/api/rates/r1');
    expect(removed.headers['cache-control']).toBe('no-store');
  });

  it('leaves a handler\'s own Cache-Control alone (the stream)', async () => {
    const res = await request(app.getHttpServer()).get('/api/rates/stream');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
  });
});
