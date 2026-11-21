import { InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { BomItemStarsService } from '../../../../modules/bom-items/services/bom-item-stars.service';

type Result = { data?: unknown; error: { code?: string; message: string } | null };

/** A PostgREST stand-in: records each call on a table and answers with the result queued for that table. */
function fakeDatabase(results: Record<string, Result[]>) {
  const calls: Array<{ token: string | undefined; table: string; steps: Array<[string, unknown[]]> }> = [];
  const database = {
    getUserClient: (token?: string) => ({
      from: (table: string) => {
        const call = { token, table, steps: [] as Array<[string, unknown[]]> };
        calls.push(call);
        const answer = () => Promise.resolve(results[table]?.shift() ?? { data: null, error: null });
        const builder: Record<string, unknown> = {};
        for (const step of ['select', 'eq', 'delete', 'upsert']) {
          builder[step] = (...args: unknown[]) => { call.steps.push([step, args]); return builder; };
        }
        builder.maybeSingle = () => { call.steps.push(['maybeSingle', []]); return answer(); };
        builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => answer().then(resolve, reject);
        return builder;
      },
    }),
  };
  return { service: new BomItemStarsService(database as never), calls };
}

const missing = { code: 'PGRST205', message: "Could not find the table 'public.bom_item_stars' in the schema cache" };

describe('BomItemStarsService: each person stars BOM items for themselves', () => {
  it("lists the caller's starred items of one BOM, on the caller's own client", async () => {
    const { service, calls } = fakeDatabase({ bom_item_stars: [{ data: [{ bom_item_id: 'i1' }, { bom_item_id: 'i2' }], error: null }] });
    await expect(service.list('b1', 'tok')).resolves.toEqual(['i1', 'i2']);
    expect(calls).toEqual([{ token: 'tok', table: 'bom_item_stars', steps: [['select', ['bom_item_id']], ['eq', ['bom_id', 'b1']]] }]);
  });

  it('a database without the table yet lists no stars instead of failing the page', async () => {
    const { service } = fakeDatabase({ bom_item_stars: [{ data: null, error: missing }] });
    await expect(service.list('b1', 'tok')).resolves.toEqual([]);
  });

  it("stars an item in its own BOM, and starring it again changes nothing (an upsert that ignores the duplicate)", async () => {
    const { service, calls } = fakeDatabase({
      bom_items: [{ data: { id: 'i1', bom_id: 'b1' }, error: null }],
      bom_item_stars: [{ data: null, error: null }],
    });
    await service.star('i1', 'tok');
    expect(calls[0]).toEqual({ token: 'tok', table: 'bom_items', steps: [['select', ['id, bom_id']], ['eq', ['id', 'i1']], ['maybeSingle', []]] });
    expect(calls[1]).toEqual({
      token: 'tok',
      table: 'bom_item_stars',
      steps: [['upsert', [{ bom_item_id: 'i1', bom_id: 'b1' }, { onConflict: 'user_id,bom_item_id', ignoreDuplicates: true }]]],
    });
  });

  it('an item the caller cannot see (or that does not exist) is not found, and nothing is written', async () => {
    const { service, calls } = fakeDatabase({ bom_items: [{ data: null, error: null }] });
    await expect(service.star('i9', 'tok')).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.map((c) => c.table)).toEqual(['bom_items']);
  });

  it("unstars only the caller's star (row-level security keeps it to the caller's rows)", async () => {
    const { service, calls } = fakeDatabase({ bom_item_stars: [{ data: null, error: null }] });
    await service.unstar('i1', 'tok');
    expect(calls).toEqual([{ token: 'tok', table: 'bom_item_stars', steps: [['delete', []], ['eq', ['bom_item_id', 'i1']]] }]);
  });

  it('says stars are not available yet when the table is missing, and fails plainly on other errors', async () => {
    const before = fakeDatabase({ bom_item_stars: [{ data: null, error: missing }] });
    await expect(before.service.unstar('i1', 'tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const broken = fakeDatabase({ bom_items: [{ data: { id: 'i1', bom_id: 'b1' }, error: null }], bom_item_stars: [{ data: null, error: { code: '42501', message: 'permission denied' } }] });
    await expect(broken.service.star('i1', 'tok')).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
