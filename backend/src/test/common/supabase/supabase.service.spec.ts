import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseService } from '../../../common/supabase/supabase.service';
import { runWithRequestAuth } from '../../../common/request-context/request-auth-context';

// Real SupabaseService and real PostgREST clients: creating one makes no network call, so the trust-boundary rules can be checked
// without any mock of the client itself.
const makeService = () =>
  new SupabaseService(new ConfigService({ POSTGREST_URL: 'http://127.0.0.1:1', DB_JWT_SECRET: 's'.repeat(40) }));

describe('SupabaseService trust boundary', () => {
  describe('getClient(accessToken)', () => {
    it.each([['empty string', ''], ['blank string', '   '], ['undefined', undefined], ['null', null]])(
      'rejects a %s token instead of returning the service-role client',
      (_label, token) => {
        expect(() => makeService().getClient(token as any)).toThrow(UnauthorizedException);
      },
    );

    it('returns a user-scoped client, never the service-role client, for a real token', () => {
      const svc = makeService();
      expect(svc.getClient('some.user.jwt')).not.toBe(svc.getPrivilegedClient('test: identity check'));
    });
  });

  describe('getPrivilegedClient(reason)', () => {
    it.each([[''], ['   ']])('requires a non-empty reason (%j)', (reason) => {
      expect(() => makeService().getPrivilegedClient(reason)).toThrow(/non-empty reason/);
    });

    it('returns a client when given a reason', () => {
      expect(makeService().getPrivilegedClient('test: a')).toBeDefined();
    });
  });

  describe('getUserClient()', () => {
    it('throws outside an authenticated request instead of falling back to the service-role client', () => {
      expect(() => makeService().getUserClient()).toThrow(UnauthorizedException);
    });

    it.each([[''], ['   '], [null]])('treats a blank explicit token (%j) as absent, with no admin fallback', (token) => {
      expect(() => makeService().getUserClient(token as any)).toThrow(UnauthorizedException);
    });

    it('uses the request-scoped token and never returns the service-role client', () => {
      const svc = makeService();
      const client = runWithRequestAuth({ accessToken: 'req.jwt', userId: 'u1' }, () => svc.getUserClient());
      expect(client).not.toBe(svc.getPrivilegedClient('test: identity check'));
    });

    it('prefers an explicit token over the request context, still never the admin client', () => {
      const svc = makeService();
      const client = runWithRequestAuth({ accessToken: 'req.jwt', userId: 'u1' }, () => svc.getUserClient('explicit.jwt'));
      expect(client).not.toBe(svc.getPrivilegedClient('test: identity check'));
    });
  });
});
