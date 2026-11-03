// docs/API.md rule 5: a delete answers 204 with no body (200 only when it returns data, and says so), and a create answers 201 with
// a Location header. Booted for real with the same interceptor main.ts uses.
import { Body, Controller, Delete, HttpCode, HttpStatus, type INestApplication, Param, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';

@Controller('api/things')
class ThingsController {
  @Post()
  create(@Body() body: { name: string }): { id: string; name: string } {
    return { id: 'abc 1', name: body.name };
  }

  @Post(':id/send')
  send(@Param('id') id: string): { id: string; sent: boolean } {
    return { id, sent: true };
  }

  @Post('imports')
  @HttpCode(HttpStatus.ACCEPTED)
  accept(): { id: string } {
    return { id: 'job-1' };
  }

  @Post('plain')
  plain(): { ok: boolean } {
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): { message: string } {
    return { message: 'deleted' };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  removeAll(): { deleted: number } {
    return { deleted: 3 };
  }
}

describe('response shapes', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ThingsController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('a create answers 201 with the new item\'s URL in Location', async () => {
    const res = await request(app.getHttpServer()).post('/api/things').send({ name: 'x' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/things/abc%201');
    expect(res.body.data).toEqual({ id: 'abc 1', name: 'x' });
  });

  it('keeps the query string out of Location', async () => {
    const res = await request(app.getHttpServer()).post('/api/things?token=SECRET').send({ name: 'x' });
    expect(res.headers.location).toBe('/api/things/abc%201');
  });

  it('an action on an item is not a creation: no Location', async () => {
    const res = await request(app.getHttpServer()).post('/api/things/7/send');
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
  });

  it('a handler that does not answer 201 (accepted work) gets no Location', async () => {
    const res = await request(app.getHttpServer()).post('/api/things/imports');
    expect(res.status).toBe(202);
    expect(res.headers.location).toBeUndefined();
  });

  it('a result without an id gets no Location', async () => {
    const res = await request(app.getHttpServer()).post('/api/things/plain');
    expect(res.headers.location).toBeUndefined();
  });

  it('a delete answers 204 with no body, whatever the handler returns', async () => {
    const res = await request(app.getHttpServer()).delete('/api/things/1');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('a delete that returns data says so with 200 and keeps its body', async () => {
    const res = await request(app.getHttpServer()).delete('/api/things');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 3 });
  });
});
