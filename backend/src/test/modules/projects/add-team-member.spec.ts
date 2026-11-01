import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../../../modules/projects/projects.service';
import { TeamMemberRole } from '../../../modules/projects/dto/project-team-member.dto';

jest.mock('@/common/database/database.service', () => ({ DatabaseService: class {} }), { virtual: true });
jest.mock('@/common/logger/logger.service', () => ({ Logger: class {} }), { virtual: true });
jest.mock('../../../modules/projects/projects.repository', () => ({ ProjectsRepository: class {} }));

const PROJECT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const NOT_A_MEMBER = 'No member of this organization with that email or user id. Invite them to the organization first.';

interface Fixture {
  existing?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
  /** Active members of ORG visible to the caller. */
  orgMembers?: string[];
  orgError?: unknown;
  team?: Array<{ id: string; user_id: string; role: string; created_at: string; email?: string | null }>;
  projectOrg?: string | null;
}

function setup(directoryId: string | null | Error, fixture: Fixture = {}) {
  const inserts: unknown[] = [];
  const orgQueries: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      if (table === 'organization_members') {
        const filters: Record<string, unknown> = {};
        const q: any = {
          select: () => q,
          eq: (col: string, v: unknown) => { filters[col] = v; return q; },
          in: async (col: string, ids: string[]) => {
            filters[col] = ids;
            orgQueries.push(filters);
            if (fixture.orgError) return { data: null, error: fixture.orgError };
            const visible = filters.organization_id === ORG && filters.status === 'active' ? fixture.orgMembers ?? [MEMBER] : [];
            return { data: ids.filter((id) => visible.includes(id)).map((user_id) => ({ user_id })), error: null };
          },
        };
        return q;
      }
      const q: any = {
        select: () => q,
        eq: () => q,
        then: (resolve: (r: unknown) => void) => resolve({ data: fixture.team ?? [], error: null }),
        maybeSingle: async () => fixture.existing ?? { data: null, error: null },
        insert: (row: unknown) => { inserts.push(row); return q; },
        single: async () => fixture.insert ?? {
          data: { id: 'm1', user_id: MEMBER, role: 'viewer', created_at: 'now', email: 'member@org.co' }, error: null,
        },
      };
      return q;
    },
  };
  const database = { getUserClient: () => client };
  const repository = { findById: async () => ({ id: PROJECT, organization_id: 'projectOrg' in fixture ? fixture.projectOrg : ORG }) };
  const accounts: Record<string, { id: string; email: string; fullName: string }> = {
    [MEMBER]: { id: MEMBER, email: 'member@org.co', fullName: 'Mem Ber' },
    [OUTSIDER]: { id: OUTSIDER, email: 'outsider@other.co', fullName: 'Out Sider' },
  };
  const directory = {
    findIdByEmail: jest.fn(async () => { if (directoryId instanceof Error) throw directoryId; return directoryId; }),
    findByIds: jest.fn(async (ids: string[]) => new Map(ids.filter((id) => accounts[id]).map((id) => [id, accounts[id]]))),
  };
  const service = new ProjectsService(database as any, repository as any, {} as any, {} as any, directory as any);
  return { service, inserts, directory, orgQueries };
}

describe('ProjectsService.addTeamMember', () => {
  it('adds an active member of the project organization found by email, storing the account email', async () => {
    const { service, inserts, orgQueries } = setup(MEMBER);
    const result = await service.addTeamMember(PROJECT, { email: 'Member@Org.co' }, 'owner', 'token');
    expect(result.teamMember).toMatchObject({ userId: MEMBER, email: 'member@org.co', name: 'Mem Ber' });
    expect(inserts).toEqual([{ project_id: PROJECT, user_id: MEMBER, role: TeamMemberRole.VIEWER, email: 'member@org.co' }]);
    expect(orgQueries).toEqual([{ organization_id: ORG, status: 'active', user_id: [MEMBER] }]);
  });

  it('gives the same 404 for an unknown email and for an account of another organization', async () => {
    const unknown = setup(null);
    const foreign = setup(OUTSIDER);
    const a = await unknown.service.addTeamMember(PROJECT, { email: 'nobody@b.co' }, 'owner', 'token').catch((e) => e);
    const b = await foreign.service.addTeamMember(PROJECT, { email: 'outsider@other.co' }, 'owner', 'token').catch((e) => e);
    for (const e of [a, b]) {
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.message).toBe(NOT_A_MEMBER);
    }
    expect(unknown.inserts).toEqual([]);
    expect(foreign.inserts).toEqual([]);
    expect(foreign.directory.findByIds).not.toHaveBeenCalled();
  });

  it('refuses an arbitrary user id outside the organization without reading their directory entry', async () => {
    const { service, inserts, directory } = setup(null);
    await expect(service.addTeamMember(PROJECT, { userId: OUTSIDER }, 'owner', 'token')).rejects.toThrow(NOT_A_MEMBER);
    expect(inserts).toEqual([]);
    expect(directory.findByIds).not.toHaveBeenCalled();
  });

  it('refuses everyone when the project has no organization (fails closed)', async () => {
    const { service, inserts } = setup(MEMBER, { projectOrg: null });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(NotFoundException);
    expect(inserts).toEqual([]);
  });

  it('surfaces a failed membership check instead of adding anyway', async () => {
    const { service, inserts } = setup(MEMBER, { orgError: { message: 'boom' } });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(InternalServerErrorException);
    expect(inserts).toEqual([]);
  });

  it('refuses a person who is already a member', async () => {
    const { service, inserts } = setup(MEMBER, { existing: { data: { id: 'm0' }, error: null } });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(ConflictException);
    expect(inserts).toEqual([]);
  });

  it('maps a unique violation on insert (concurrent add) to a conflict', async () => {
    const { service } = setup(MEMBER, { insert: { data: null, error: { code: '23505', message: 'duplicate key' } } });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(ConflictException);
  });

  it('surfaces a failed duplicate check instead of inserting anyway', async () => {
    const { service, inserts } = setup(MEMBER, { existing: { data: null, error: { message: 'relation does not exist' } } });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(InternalServerErrorException);
    expect(inserts).toEqual([]);
  });

  it('surfaces an unavailable user directory instead of inventing a placeholder member', async () => {
    const { service, inserts } = setup(new Error('user directory unavailable'));
    await expect(service.addTeamMember(PROJECT, { email: 'a@b.co' }, 'owner', 'token')).rejects.toThrow(InternalServerErrorException);
    expect(inserts).toEqual([]);
  });

  it('surfaces an insert failure', async () => {
    const { service } = setup(MEMBER, { insert: { data: null, error: { code: '42703', message: 'column "email" does not exist' } } });
    await expect(service.addTeamMember(PROJECT, { userId: MEMBER }, 'owner', 'token')).rejects.toThrow(InternalServerErrorException);
  });
});

describe('ProjectsService.getTeamMembers', () => {
  it('returns directory data only for active members of the project organization', async () => {
    const { service, directory } = setup(null, {
      team: [
        { id: 't1', user_id: MEMBER, role: 'viewer', created_at: 'now', email: null },
        { id: 't2', user_id: OUTSIDER, role: 'viewer', created_at: 'now', email: null },
      ],
    });
    const result = await service.getTeamMembers(PROJECT, 'owner', 'token');
    expect(directory.findByIds).toHaveBeenCalledWith([MEMBER]);
    expect(result.members[0]).toMatchObject({ userId: MEMBER, email: 'member@org.co', name: 'Mem Ber' });
    expect(result.members[1]).toMatchObject({ userId: OUTSIDER, email: undefined, name: 'Team Member' });
    expect(JSON.stringify(result)).not.toContain('outsider@other.co');
    expect(JSON.stringify(result)).not.toContain('Out Sider');
  });
});
