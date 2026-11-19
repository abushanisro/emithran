import { CalculatorsServiceV2 } from '../../../modules/calculators/calculators.service';

/** 299 calculators, 100 a page: page 3 is the last (it says so), page 4 is empty, never a 500. */
function service(result: { data: unknown[] | null; error: { code: string; message: string } | null; count: number | null }) {
  const q = { select: () => q, order: () => q, range: () => q, or: () => q, eq: () => q, then: (resolve: (v: unknown) => void) => resolve(result) };
  const svc = Object.create(CalculatorsServiceV2.prototype) as CalculatorsServiceV2;
  Object.assign(svc, { logger: { log: jest.fn(), error: jest.fn() }, databaseService: { getClient: () => ({ from: () => q }) } });
  return svc;
}
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, retired_at: null }));

describe('the calculators list, page by page', () => {
  it('a page past the last is empty (the database refuses its range)', async () => {
    const r = await service({ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: 299 })
      .findAll({ page: 4, limit: 100 } as never, 'u', 't');
    expect(r).toEqual({ calculators: [], total: 299, page: 4, limit: 100, hasMore: false });
  });

  it('says whether rows follow: page 2 of 299 has more, page 3 does not', async () => {
    expect((await service({ data: rows(100), error: null, count: 299 }).findAll({ page: 2, limit: 100 } as never, 'u', 't')).hasMore).toBe(true);
    expect((await service({ data: rows(99), error: null, count: 299 }).findAll({ page: 3, limit: 100 } as never, 'u', 't')).hasMore).toBe(false);
  });

  it('any other database error still fails', async () => {
    await expect(service({ data: null, error: { code: '42501', message: 'permission denied' }, count: null }).findAll({ page: 1 } as never, 'u', 't'))
      .rejects.toThrow('permission denied');
  });
});
