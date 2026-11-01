import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OrganizationsService } from '../../../modules/organizations/organizations.service';
import { DatabaseService } from '../../../common/database/database.service';
import { UserDirectory } from '../../../common/database/user-directory';
import { FakePostgrest } from '../../support/fake-postgrest';

const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'user-token';

describe('OrganizationsService', () => {
  let db: FakePostgrest;
  let service: OrganizationsService;

  beforeEach(async () => {
    db = new FakePostgrest();
    await db.start();
    const database = new DatabaseService(
      new ConfigService({ POSTGREST_URL: db.url, DB_JWT_SECRET: 'x'.repeat(32) }),
    );
    service = new OrganizationsService(database, new UserDirectory(database));
  });

  afterEach(() => db.stop());

  const calls = (method: string, path: string) => db.seen.filter((s) => s.method === method && s.path === path);

  it("reads the caller's own organization with the caller's token, so RLS decides", async () => {
    db.reply('GET', '/organizations', [{ id: ORG, name: 'Acme', owner_id: USER }]);

    expect(await service.mine(USER, TOKEN)).toEqual({ id: ORG, name: 'Acme', owner_id: USER });
    const [read] = calls('GET', '/organizations');
    expect(read?.query.get('owner_id')).toBe(`eq.${USER}`);
    expect(read?.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('answers null when the caller owns no organization', async () => {
    db.reply('GET', '/organizations', []);
    expect(await service.mine(USER, TOKEN)).toBeNull();
  });

  it('creates the organization owned by the caller, then the owner membership and the default workspace', async () => {
    db.reply('POST', '/organizations', [{ id: ORG, name: 'Acme', owner_id: USER }])
      .reply('POST', '/rpc/add_organization_owner_membership', null)
      .reply('POST', '/workspaces', []);

    expect(await service.create(USER, { name: 'Acme', country: 'IN' }, TOKEN)).toMatchObject({ id: ORG });
    expect(calls('POST', '/organizations')[0]?.body).toMatchObject({ name: 'Acme', country: 'IN', owner_id: USER });
    // the owner membership goes through the checked function (migration 942), never a direct table write
    expect(calls('POST', '/rpc/add_organization_owner_membership')[0]?.body).toEqual({ p_organization_id: ORG });
    expect(calls('POST', '/organization_members')).toHaveLength(0);
    expect(calls('POST', '/workspaces')[0]?.body).toMatchObject({ organization_id: ORG, name: 'Default', is_default: true, created_by: USER });
  });

  it('fails instead of leaving an organization without its owner membership', async () => {
    db.reply('POST', '/organizations', [{ id: ORG, name: 'Acme', owner_id: USER }])
      .reply('POST', '/rpc/add_organization_owner_membership', { message: 'duplicate key', code: '23505' }, 409);

    await expect(service.create(USER, { name: 'Acme' }, TOKEN)).rejects.toThrow('duplicate key');
    expect(calls('POST', '/workspaces')).toHaveLength(0);
  });

  it('updates only the fields sent, and answers 404 when RLS hides the organization', async () => {
    db.reply('PATCH', '/organizations', [{ id: ORG, city: 'Pune' }]).reply('PATCH', '/organizations', []);

    await service.update(ORG, { city: 'Pune', addressLine1: 'Plot 4' }, TOKEN);
    expect(calls('PATCH', '/organizations')[0]?.body).toEqual({ city: 'Pune', address_line1: 'Plot 4' });
    expect(calls('PATCH', '/organizations')[0]?.query.get('id')).toBe(`eq.${ORG}`);

    await expect(service.update(ORG, { city: 'Pune' }, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 when a delete removed nothing, rather than reporting success', async () => {
    db.reply('DELETE', '/workspaces', []);
    await expect(service.removeWorkspace(ORG, 'w1', TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    const [del] = calls('DELETE', '/workspaces');
    expect(del?.query.get('id')).toBe('eq.w1');
    expect(del?.query.get('organization_id')).toBe(`eq.${ORG}`);
  });

  it('lists members with email and display name, falling back to the invited email', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    db.reply('GET', '/organization_members', [
      { id: 'm1', organization_id: ORG, user_id: USER, role: 'owner', status: 'active', invited_email: null },
      { id: 'm2', organization_id: ORG, user_id: null, role: 'member', status: 'invited', invited_email: 'new@acme.com' },
      { id: 'm3', organization_id: ORG, user_id: OTHER, role: 'viewer', status: 'active', invited_email: null },
    ])
      .reply('POST', '/rpc/directory_users', [{ id: USER, email: 'owner@acme.com', full_name: 'Owner' }])
      .reply('GET', '/user_profiles', [{ user_id: USER, display_name: 'The Owner' }]);

    const members = await service.members(ORG, TOKEN);

    expect(members.map((m) => [m.id, m.email, m.display_name])).toEqual([
      ['m1', 'owner@acme.com', 'The Owner'],
      ['m2', 'new@acme.com', null],
      ['m3', null, null],
    ]);
    expect(calls('GET', '/organization_members')[0]?.query.get('order')).toBe('joined_at.asc');
    expect(calls('POST', '/rpc/directory_users')[0]?.body).toEqual({ p_ids: [USER, OTHER] });
  });

  it('invites by normalised email through the checked function (the database records the caller as inviter)', async () => {
    db.reply('POST', '/rpc/invite_organization_member', 'new-id');
    await service.invite(ORG, { email: '  New@Acme.COM ', role: 'admin' }, TOKEN);
    expect(calls('POST', '/rpc/invite_organization_member')[0]?.body).toEqual({ p_organization_id: ORG, p_email: 'new@acme.com', p_role: 'admin' });
    expect(calls('POST', '/rpc/invite_organization_member')[0]?.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses an invite or removal by a caller who is not an owner or admin (403), and a member of another organization (404)', async () => {
    db.reply('POST', '/rpc/invite_organization_member', { message: 'not an owner or admin', code: '42501' }, 403)
      .reply('POST', '/rpc/remove_organization_member', { message: 'Member not found', code: 'P0002' }, 404);
    await expect(service.invite(ORG, { email: 'x@acme.com', role: 'member' }, TOKEN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeMember(ORG, 'm9', TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls('POST', '/rpc/remove_organization_member')[0]?.body).toEqual({ p_organization_id: ORG, p_member_id: 'm9' });
  });

  it('lists workspaces default first, then oldest first', async () => {
    db.reply('GET', '/workspaces', [{ id: 'w1' }]);
    await service.workspaces(ORG, TOKEN);
    expect(calls('GET', '/workspaces')[0]?.query.get('order')).toBe('is_default.desc,created_at.asc');
  });
});
