import { CalculatorsServiceV2 } from '../../../modules/calculators/calculators.service';

/** 299 calculators, 100 a page: page 3 is the last (it says so), page 4 is empty, never a 500. */
type Mapping = { calculator_id: string | null; calculator_name: string | null; process_group: string };
function service(
  result: { data: unknown[] | null; error: { code: string; message: string } | null; count: number | null }, orders: string[] = [], mappings: Mapping[] = [],
) {
  const q = {
    select: () => q, order: (column: string) => { orders.push(column); return q; }, range: () => q, or: () => q, eq: () => q,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  // process_calculator_mappings: rows linked by calculator id, or (calculator_id NULL) naming the calculator.
  const m = (filter: (r: Mapping) => boolean) => {
    const chain = { in: (col: keyof Mapping, values: string[]) => ({ then: (resolve: (v: unknown) => void) => resolve({ data: mappings.filter((r) => filter(r) && values.includes(String(r[col]))), error: null }) }) };
    return chain;
  };
  const mq = { select: () => ({ in: m(() => true).in, is: () => m((r) => r.calculator_id === null) }) };
  const svc = Object.create(CalculatorsServiceV2.prototype) as CalculatorsServiceV2;
  Object.assign(svc, { logger: { log: jest.fn(), error: jest.fn() }, databaseService: { getClient: () => ({ from: (t: string) => (t === 'process_calculator_mappings' ? mq : q) }) } });
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

  it('is in a total order (newest first, ties by id), so no calculator is on two pages or on none', async () => {
    // The calculators one migration creates share one created_at; ordered by it alone, their order changed from page to page.
    const orders: string[] = [];
    await service({ data: rows(10), error: null, count: 10 }, orders).findAll({ page: 1, limit: 100 } as never, 'u', 't');
    expect(orders).toEqual(['created_at', 'id']);
  });

  it('names the process groups each calculator computes an operation of, linked by id or by name; a helper has none', async () => {
    const calcs = [{ id: 'a', name: 'Machining - Drilling', retired_at: null }, { id: 'b', name: 'Forging - Upset', retired_at: null }, { id: 'c', name: 'Additive - Parts per build', retired_at: null }];
    const r = await service({ data: calcs, error: null, count: 3 }, [], [
      { calculator_id: 'a', calculator_name: 'Machining - Drilling', process_group: 'Sheet Metal' },
      { calculator_id: 'a', calculator_name: 'Machining - Drilling', process_group: 'Machining' },
      { calculator_id: null, calculator_name: 'Forging - Upset', process_group: 'Forging' },
    ]).findAll({ page: 1, limit: 100 } as never, 'u', 't');
    expect(r.calculators.map((c: any) => [c.id, c.process_groups])).toEqual([['a', ['Machining', 'Sheet Metal']], ['b', ['Forging']], ['c', []]]);
  });

  it('any other database error still fails', async () => {
    await expect(service({ data: null, error: { code: '42501', message: 'permission denied' }, count: null }).findAll({ page: 1 } as never, 'u', 't'))
      .rejects.toThrow('permission denied');
  });
});
