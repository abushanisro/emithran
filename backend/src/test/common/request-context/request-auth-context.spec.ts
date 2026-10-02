import { ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import {
  currentRequestAuth,
  runWithRequestAuth,
} from '../../../common/request-context/request-auth-context';
import { RequestAuthInterceptor } from '../../../common/interceptors/request-auth.interceptor';

const ctxFor = (request: any) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('request auth context', () => {
  it('is empty outside a request', () => {
    expect(currentRequestAuth()).toBeUndefined();
  });

  it('exposes the token to code that runs after an await inside the scope', async () => {
    const seen = await runWithRequestAuth({ accessToken: 'tok-a', userId: 'a' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentRequestAuth();
    });
    expect(seen).toEqual({ accessToken: 'tok-a', userId: 'a' });
    expect(currentRequestAuth()).toBeUndefined();
  });

  it('keeps concurrent requests isolated from each other', async () => {
    const run = (id: string, delay: number) =>
      runWithRequestAuth({ accessToken: `tok-${id}`, userId: id }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        return currentRequestAuth()?.userId;
      });
    expect(await Promise.all([run('a', 20), run('b', 1), run('c', 10)])).toEqual(['a', 'b', 'c']);
  });
});

describe('RequestAuthInterceptor', () => {
  const interceptor = new RequestAuthInterceptor();
  const handlerReadingContext = { handle: () => defer(() => of(currentRequestAuth())) };

  it("exposes the authenticated caller's access token to the route handler", async () => {
    const request = { accessToken: 'real.jwt', user: { id: 'user-1' } };
    const seen = await lastValueFrom(interceptor.intercept(ctxFor(request), handlerReadingContext) as any);
    expect(seen).toEqual({ accessToken: 'real.jwt', userId: 'user-1' });
  });

  it.each([
    ['no token', { user: { id: 'u' } }],
    ['null token (e.g. a failed dev-bypass mint)', { accessToken: null, user: { id: 'u' } }],
    ['blank token', { accessToken: '', user: { id: 'u' } }],
    ['no user', { accessToken: 'jwt' }],
  ])('opens no scope for %s, so getUserClient() has nothing to fall back to', async (_l, request) => {
    const seen = await lastValueFrom(interceptor.intercept(ctxFor(request), handlerReadingContext) as any);
    expect(seen).toBeUndefined();
  });
});
