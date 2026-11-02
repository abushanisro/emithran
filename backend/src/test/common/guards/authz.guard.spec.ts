// AuthzGuard: default deny. A route without a declared policy is refused; organization roles and platform admins are read from the
// database as the caller (AccessService), whose answers are faked here at the database client.
import { Controller, ExecutionContext, ForbiddenException, Get, Logger, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuditService } from '../../../common/audit/audit.service';
import { AccessService } from '../../../common/authz/access.service';
import { Authenticated, OrgRole, PlatformAdmin } from '../../../common/authz/authz-policy';
import type { DatabaseService } from '../../../common/database/database.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthzGuard } from '../../../common/guards/authz.guard';

@OrgRole('member')
@Controller('things')
class ThingsController {
  @Get() @OrgRole('viewer') list() {}
  @Post() create() {}
  @Post('settings') @OrgRole('admin') settings() {}
  @Post('platform') @PlatformAdmin() platform() {}
  @Get('me') @Authenticated() me() {}
  @Get('health') @Public() health() {}
}

@Controller('forgotten')
class ForgottenController {
  @Get() list() {}
}

function database(roles: string[], platformAdmin = false): DatabaseService {
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: roles.map((role) => ({ role })), error: null }),
  };
  return { getUserClient: () => ({ from: () => query, rpc: async () => ({ data: platformAdmin, error: null }) }) } as unknown as DatabaseService;
}

function context(controller: any, method: string, request: object = { user: { id: 'u1' }, accessToken: 't' }): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthzGuard', () => {
  const recordDenied = jest.fn().mockResolvedValue(undefined);
  const audit = { recordDenied } as unknown as AuditService;
  const guard = (roles: string[], platformAdmin = false) => new AuthzGuard(new Reflector(), new AccessService(database(roles, platformAdmin)), audit);

  beforeEach(() => {
    recordDenied.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('refuses and logs a route that declares no policy, even for an owner', async () => {
    await expect(guard(['owner']).canActivate(context(ForgottenController, 'list'))).rejects.toThrow(ForbiddenException);
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('ForgottenController.list declares no authorization policy'));
  });

  it.each([
    ['viewer', 'list', true],
    ['viewer', 'create', false],
    ['member', 'create', true],
    ['member', 'settings', false],
    ['admin', 'settings', true],
    ['owner', 'settings', true],
  ])('a %s calling %s: allowed=%s', async (role, method, allowed) => {
    const result = guard([role]).canActivate(context(ThingsController, method));
    if (allowed) await expect(result).resolves.toBe(true);
    else {
      await expect(result).rejects.toThrow(ForbiddenException);
      expect(recordDenied).toHaveBeenCalledWith(expect.stringMatching(/^org_role_/), 'u1', { actor: { kind: 'user', userId: 'u1' } });
    }
  });

  it('acts with the lowest role across memberships, and refuses someone with none', async () => {
    await expect(guard(['admin', 'viewer']).canActivate(context(ThingsController, 'create'))).rejects.toThrow(ForbiddenException);
    await expect(guard([]).canActivate(context(ThingsController, 'list'))).rejects.toThrow(ForbiddenException);
    await expect(guard(['superuser']).canActivate(context(ThingsController, 'list'))).rejects.toThrow(ForbiddenException);
  });

  it('lets only platform admins through @PlatformAdmin, whatever their organization role', async () => {
    await expect(guard(['owner'], false).canActivate(context(ThingsController, 'platform'))).rejects.toThrow(ForbiddenException);
    expect(recordDenied).toHaveBeenCalledWith('platform_admin_required', 'u1', expect.anything());
    await expect(guard([], true).canActivate(context(ThingsController, 'platform'))).resolves.toBe(true);
  });

  it('lets any signed-in person through @Authenticated and anyone through @Public', async () => {
    await expect(guard([]).canActivate(context(ThingsController, 'me'))).resolves.toBe(true);
    await expect(guard([]).canActivate(context(ThingsController, 'me', {}))).rejects.toThrow(ForbiddenException);
    await expect(guard([]).canActivate(context(ThingsController, 'health', {}))).resolves.toBe(true);
  });
});
