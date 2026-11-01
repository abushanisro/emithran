import { Controller, Get, Injectable, Post, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';
import { SpendsAi, throttlerOptions } from '../throttling/throttlers';

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

describe('ClientIpThrottlerGuard with API keys', () => {
  // getTracker is protected; this exposes it without booting the throttler.
  class Probe extends ClientIpThrottlerGuard {
    track(req: Record<string, unknown>) {
      return this.getTracker(req);
    }
  }
  const probe = Object.create(Probe.prototype) as Probe;

  it('counts a request made with an API key against the key, whatever address it comes from', async () => {
    await expect(probe.track({ apiKey: { id: 'key-1' }, headers: {}, ip: '10.0.0.1' })).resolves.toBe('api-key:key-1');
    await expect(probe.track({ apiKey: { id: 'key-1' }, headers: {}, ip: '10.0.0.2' })).resolves.toBe('api-key:key-1');
  });

  it('counts everything else by client address', async () => {
    await expect(probe.track({ headers: {}, ip: '10.0.0.1' })).resolves.not.toMatch(/^api-key:/);
  });
});

describe('ClientIpThrottlerGuard for signed-in users', () => {
  class Probe extends ClientIpThrottlerGuard {
    track(req: Record<string, unknown>) {
      return this.getTracker(req);
    }
  }
  const probe = Object.create(Probe.prototype) as Probe;

  it('counts a signed-in person by user id, whatever address the request comes from', async () => {
    await expect(probe.track({ user: { id: 'u-1' }, headers: {}, ip: '10.0.0.1' })).resolves.toBe('user:u-1');
    await expect(probe.track({ user: { id: 'u-1' }, headers: {}, ip: '10.0.0.9' })).resolves.toBe('user:u-1');
  });

  it('still counts an API key against the key, and an anonymous caller by address', async () => {
    await expect(probe.track({ apiKey: { id: 'k' }, user: { id: 'owner' }, headers: {}, ip: '10.0.0.1' })).resolves.toBe('api-key:k');
    await expect(probe.track({ user: {}, headers: {}, ip: '10.0.0.1' })).resolves.toBe('10.0.0.1');
  });
});

describe('Rate limits behind the BFF (every request from one address)', () => {
  /** Stands in for RequestAuthGuard, which runs first and sets request.user from the verified token. */
  @Injectable()
  class FakeAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      const user = req.headers['x-test-user'];
      if (typeof user === 'string') req.user = { id: user };
      return true;
    }
  }

  @Controller('work')
  class WorkController {
    @Get('list')
    list() {
      return { ok: true };
    }

    @Post('chat')
    @SpendsAi()
    chat() {
      return { ok: true };
    }

    @Post('generate')
    @SpendsAi()
    generate() {
      return { ok: true };
    }
  }

  let app: INestApplication;
  beforeAll(async () => {
    const limits: Record<string, number> = { THROTTLE_TTL: 60_000, THROTTLE_LIMIT: 3, AI_LIMIT_PER_MINUTE: 2 };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerOptions((name, fallback) => limits[name] ?? fallback))],
      controllers: [WorkController],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const call = (method: 'get' | 'post', path: string, user?: string) => {
    const req = request(app.getHttpServer())[method](path);
    return (user ? req.set('x-test-user', user) : req).then((r) => r.status);
  };

  it('one user exhausting an endpoint does not lock out another user on the same address', async () => {
    const a = [];
    for (let i = 0; i < 4; i++) a.push(await call('get', '/work/list', 'a'));
    expect(a).toEqual([200, 200, 200, 429]);
    expect(await call('get', '/work/list', 'b')).toBe(200);
  });

  it('caps AI endpoints per user, with one budget shared by every AI endpoint', async () => {
    expect([await call('post', '/work/chat', 'c'), await call('post', '/work/generate', 'c'), await call('post', '/work/chat', 'c')]).toEqual([201, 201, 429]);
    expect(await call('post', '/work/generate', 'c')).toBe(429);
    expect(await call('post', '/work/chat', 'd')).toBe(201); // another user has their own budget
    expect(await call('get', '/work/list', 'c')).toBe(200); // the AI cap does not touch other endpoints
  });
});

describe('AI endpoints carry the AI cap', () => {
  it.each([
    ['copilot chat', () => require('../../modules/copilot/copilot.controller').CopilotController.prototype.chat],
    ['process-plan generate', () => require('../../modules/process-plan-generator/process-plan-generator.controller').ProcessPlanGeneratorController.prototype.generate],
  ])('%s is marked @SpendsAi', (_name, handler) => {
    expect(Reflect.getMetadata('emithran:spends-ai', handler())).toBe(true);
  });
});
