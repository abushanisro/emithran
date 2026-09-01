// Org-scoped tenancy Phase 4 (.claude/plans/delegated-gliding-swan.md):
// BaseRepository.create() is the sole insert path for its one live subclass
// (ProjectsRepository). Proves organization_id is written when resolved,
// and omitted (not written as null) when the caller doesn't pass one —
// BaseRepository is generic infra shared by any future subclass that may
// not have this column at all.
import { BaseRepository } from '../../../common/repositories/base.repository';
import { type Logger } from '../../../common/logger/logger.service';

class TestRepository extends BaseRepository<any> {
  constructor(logger: Logger) {
    super('test_table', logger);
  }
}

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('BaseRepository.create', () => {
  it('writes organization_id when the caller resolves one', async () => {
    const chain = makeChain({ data: { id: 'row-1' }, error: null });
    const client = { from: jest.fn().mockReturnValue(chain) } as any;
    const repo = new TestRepository({ error: jest.fn(), log: jest.fn() } as unknown as Logger);

    await repo.create(client, { name: 'Test' }, 'user-456', 'org-789');

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test', user_id: 'user-456', organization_id: 'org-789' }),
    );
  });

  it('omits organization_id entirely when none is resolved (not written as null)', async () => {
    const chain = makeChain({ data: { id: 'row-1' }, error: null });
    const client = { from: jest.fn().mockReturnValue(chain) } as any;
    const repo = new TestRepository({ error: jest.fn(), log: jest.fn() } as unknown as Logger);

    await repo.create(client, { name: 'Test' }, 'user-456');

    const inserted = chain.insert.mock.calls[0][0];
    expect(inserted).not.toHaveProperty('organization_id');
  });
});
