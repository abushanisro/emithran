import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('ClientIpThrottlerGuard behind a Cloudflare tunnel', () => {
  let app: INestApplication;
  const before = process.env.TRUST_CLOUDFLARE_HEADERS;

  async function boot(trust: 'true' | 'false'): Promise<void> {
    process.env.TRUST_CLOUDFLARE_HEADERS = trust;
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 2 }] })],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }
  const ping = (ip?: string) => {
    const call = request(app.getHttpServer()).get('/ping');
    return (ip ? call.set('CF-Connecting-IP', ip) : call).then((r) => r.status);
  };

  afterEach(async () => {
    await app.close();
    if (before === undefined) delete process.env.TRUST_CLOUDFLARE_HEADERS;
    else process.env.TRUST_CLOUDFLARE_HEADERS = before;
  });

  it('limits each real client separately, so one abusive address does not lock everyone out', async () => {
    await boot('true');
    expect([await ping('203.0.113.1'), await ping('203.0.113.1'), await ping('203.0.113.1')]).toEqual([200, 200, 429]);
    expect(await ping('203.0.113.2')).toBe(200); // a different user is unaffected
  });

  it('without the trust flag every request shares the peer address, and a forged header buys nothing', async () => {
    await boot('false');
    expect([await ping('203.0.113.1'), await ping('203.0.113.2'), await ping('203.0.113.3')]).toEqual([200, 200, 429]);
  });
});
