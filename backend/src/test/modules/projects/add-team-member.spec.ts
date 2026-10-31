import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../../../modules/projects/projects.service';
import { TeamMemberRole } from '../../../modules/projects/dto/project-team-member.dto';

jest.mock('@/common/database/database.service', () => ({ DatabaseService: class {} }), { virtual: true });
jest.mock('@/common/logger/logger.service', () => ({ Logger: class {} }), { virtual: true });
jest.mock('../../../modules/projects/projects.repository', () => ({ ProjectsRepository: class {} }));

const PROJECT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

interface Fixture {
  existing?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
}

function setup(directoryId: string | null | Error, fixture: Fixture = {}) {
  const inserts: unknown[] = [];
  const client = {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => fixture.existing ?? { data: null, error: null },
        insert: (row: unknown) => { inserts.push(row); return q; },
        single: async () => fixture.insert ?? {
          data: { id: 'm1', user_id: MEMBER, role: 'viewer', created_at: 'now', email: 'a@b.co' }, error: null,
        },
      };
      return q;
    },
  };
  const database = { getUserClient: () => client };
  const repository = { findById: async () => ({ id: PROJECT }) };
  const directory = {
    findIdByEmail: jest.fn(async () => { if (directoryId instanceof Error) throw directoryId; return directoryId; }),
  };
  const service = new ProjectsService(database as any, repository as any, {} as any, {} as any, directory as any);
  return { service, inserts, directory };
}

describe('ProjectsService.addTeamMember', () => {
  it('adds a known user found by email', async () => {
    const { service, inserts } = setup(MEMBER);
    const result = await service.addTeamMember(PROJECT, { email: 'a@b.co' }, 'owner', 'token');
    expect(result.teamMember.userId).toBe(MEMBER);
    expect(inserts).toEqual([{ project_id: PROJECT, user_id: MEMBER, role: TeamMemberRole.VIEWER, email: 'a@b.co' }]);
  });

  it('refuses an unknown email instead of inventing a placeholder member', async () => {
    const { service, inserts } = setup(null);
    await expect(service.addTeamMember(PROJECT, { email: 'nobody@b.co' }, 'owner', 'token')).rejects.toThrow(NotFoundException);
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
