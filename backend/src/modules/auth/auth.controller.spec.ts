import { AccessService } from '../../common/authz/access.service';
import type { DatabaseService } from '../../common/database/database.service';
import { AuthController } from './auth.controller';

/** The database as the caller sees it: their own active memberships, and whether they are a platform admin. */
function database(roles: string[], platformAdmin: boolean): DatabaseService {
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: roles.map((role) => ({ role })), error: null }),
  };
  return { getUserClient: () => ({ from: () => query, rpc: async () => ({ data: platformAdmin, error: null }) }) } as unknown as DatabaseService;
}

describe('AuthController', () => {
  it('returns the id, email, organization role and platform-admin flag of the authorised user, nothing else', async () => {
    const controller = new AuthController(new AccessService(database(['admin'], false)));
    await expect(controller.me({ id: 'u1', email: 'a@x.com', role: 'authenticated', secret: 'x' }, 'token')).resolves.toEqual({
      id: 'u1',
      email: 'a@x.com',
      organizationRole: 'admin',
      platformAdmin: false,
    });
  });

  it('reports the lowest role across memberships, and no role without one', async () => {
    await expect(new AuthController(new AccessService(database(['owner', 'viewer'], true))).me({ id: 'u1', email: 'a@x.com' }, 't'))
      .resolves.toMatchObject({ organizationRole: 'viewer', platformAdmin: true });
    await expect(new AuthController(new AccessService(database([], false))).me({ id: 'u1', email: 'a@x.com' }, 't'))
      .resolves.toMatchObject({ organizationRole: null });
  });
});
