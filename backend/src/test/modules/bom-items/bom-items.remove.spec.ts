// BOMItemsService.remove: one path, written as the caller. Production lot materials the caller cannot see (another member's
// lot, migration 067) make the delete refuse with 409 before anything changes, naming the blocking lots; the privileged client
// only ever reads which lots use the item. An admin's forced delete goes to delete_bom_item_cascade() (migration 945).
import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { BOM_ITEM_IN_PRODUCTION_LOTS, BOMItemsService, IN_ANOTHER_MEMBERS_LOT } from '../../../modules/bom-items/bom-items.service';

type Rows = Record<string, Array<Record<string, unknown>>>;
const ITEM = 'item-1';

/**
 * `all` is the database; `hidden` holds ids of production_lot_materials rows RLS hides from the caller. `failOn` makes a
 * table's read fail. Records every write and every privileged call.
 */
function harness(all: Rows, hidden: Set<string> = new Set(), failOn?: string) {
  const writes: string[] = [];
  const privileged: string[] = [];
  const makeClient = (asService: boolean) => ({
    from(table: string) {
      const filters: Array<[string, unknown[]]> = [];
      let op: 'select' | 'delete' | 'update' = 'select';
      let head = false;
      const visibleRows = () => (all[table] ?? []).filter((r) => asService || table !== 'production_lot_materials' || !hidden.has(r.id as string));
      const matching = () => visibleRows().filter((r) => filters.every(([col, vals]) => vals.includes(r[col])));
      const run = async () => {
        if (failOn === table && op === 'select') return { data: null, error: { message: `${table} unreadable`, code: 'XX000' }, count: null };
        if (op === 'select') {
          const rows = matching();
          return { data: head ? null : rows, error: null, count: rows.length };
        }
        if (asService) throw new Error('privileged write');
        writes.push(`${op} ${table}`);
        if (op === 'delete') {
          const gone = new Set(matching());
          if (table === 'bom_items' && (all.production_lot_materials ?? []).some((m) => [...gone].some((g) => g.id === m.bom_item_id))) {
            return { data: null, error: { code: '23503', message: 'violates foreign key constraint "production_lot_materials_bom_item_id_fkey"' } };
          }
          all[table] = (all[table] ?? []).filter((r) => !gone.has(r));
        }
        return { data: null, error: null, count: null };
      };
      const q: any = {
        select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; if (asService) privileged.push(`read ${table}`); return q; },
        delete: () => { op = 'delete'; return q; },
        update: () => { op = 'update'; return q; },
        eq: (col: string, v: unknown) => { filters.push([col, [v]]); return q; },
        in: (col: string, vs: unknown[]) => { filters.push([col, vs]); return q; },
        limit: () => q,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject),
      };
      return q;
    },
    rpc: () => { throw new Error('no RPC is used'); },
  });
  const db = { getUserClient: () => makeClient(false), getPrivilegedClient: () => makeClient(true) };
  const service = new (BOMItemsService as any)(db, ...Array.from({ length: 16 }, () => ({}))) as BOMItemsService;
  return { service, writes, privileged, all };
}

const base = (): Rows => ({
  bom_items: [{ id: ITEM, part_number: 'P-1', parent_item_id: null }],
  production_lot_materials: [],
  process_routes: [],
  process_route_steps: [],
});

describe('BOMItemsService.remove', () => {
  it("refuses with 409 naming the blocking lots when another member's production lot uses the part, and changes nothing", async () => {
    const rows = base();
    rows.production_lot_materials = [
      { id: 'mine', bom_item_id: ITEM, production_lot_id: 'lot-mine' },
      { id: 'theirs-1', bom_item_id: ITEM, production_lot_id: 'lot-theirs' },
      { id: 'theirs-2', bom_item_id: ITEM, production_lot_id: 'lot-theirs' },
      { id: 'other', bom_item_id: ITEM, production_lot_id: 'lot-other' },
    ];
    const { service, writes, privileged, all } = harness(rows, new Set(['theirs-1', 'theirs-2', 'other']));
    const refusal = service.remove(ITEM, 'u', 't');
    await expect(refusal).rejects.toThrow(new ConflictException(IN_ANOTHER_MEMBERS_LOT));
    await expect(refusal).rejects.toMatchObject({
      response: { code: BOM_ITEM_IN_PRODUCTION_LOTS, details: { visibleLotIds: ['lot-mine'], hiddenLotCount: 2 } },
    });
    expect(writes).toEqual([]);
    expect(privileged).toEqual(['read production_lot_materials']);
    expect(all.production_lot_materials).toHaveLength(4);
    expect(all.bom_items).toHaveLength(1);
  });

  it("removes the caller's own lot materials, routes and the item, all as the caller", async () => {
    const rows = base();
    rows.production_lot_materials = [{ id: 'mine', bom_item_id: ITEM, production_lot_id: 'lot-mine' }];
    rows.process_routes = [{ id: 'r1', bom_item_id: ITEM }];
    rows.process_route_steps = [{ id: 's1', process_route_id: 'r1' }];
    const { service, writes, all } = harness(rows);
    await service.remove(ITEM, 'u', 't');
    expect(writes).toEqual([
      'delete production_lot_materials', 'delete process_route_steps', 'delete process_routes', 'update bom_items', 'delete bom_items',
    ]);
    expect(all.bom_items).toHaveLength(0);
    expect(all.production_lot_materials).toHaveLength(0);
  });

  it('is 404 for an item the caller cannot see', async () => {
    const rows = base();
    rows.bom_items = [];
    await expect(harness(rows).service.remove(ITEM, 'u', 't')).rejects.toThrow(NotFoundException);
  });

  it.each(['bom_items', 'production_lot_materials', 'process_routes'])('throws, changing nothing further, when %s cannot be read', async (table) => {
    const { service, writes } = harness(base(), new Set(), table);
    await expect(service.remove(ITEM, 'u', 't')).rejects.toThrow(InternalServerErrorException);
    expect(writes).toEqual([]);
  });
});

describe('BOMItemsService.forceRemove', () => {
  /** The database answers delete_bom_item_cascade() the way migration 945 does for this caller. */
  const serviceAnswering = (answer: { data?: unknown; error?: { code: string; message: string } }) => {
    const calls: Array<{ fn: string; args: unknown; token: string }> = [];
    const db = {
      getUserClient: (token: string) => ({ rpc: async (fn: string, args: unknown) => { calls.push({ fn, args, token }); return { data: null, error: null, ...answer }; } }),
      getPrivilegedClient: () => { throw new Error('a forced delete never uses the privileged client'); },
    };
    return { service: new (BOMItemsService as any)(db, ...Array.from({ length: 16 }, () => ({}))) as BOMItemsService, calls };
  };

  it('runs delete_bom_item_cascade as the caller and returns what it removed', async () => {
    const { service, calls } = serviceAnswering({ data: { lotMaterials: 3, lots: 2 } });
    await expect(service.forceRemove(ITEM, 'token')).resolves.toEqual({ lotMaterials: 3, lots: 2 });
    expect(calls).toEqual([{ fn: 'delete_bom_item_cascade', args: { p_item_id: ITEM }, token: 'token' }]);
  });

  it("is 403 for someone who is not an admin of the item's organization and 404 for an unknown item", async () => {
    await expect(serviceAnswering({ error: { code: '42501', message: 'not an admin' } }).service.forceRemove(ITEM, 't')).rejects.toThrow(ForbiddenException);
    await expect(serviceAnswering({ error: { code: 'P0002', message: 'not found' } }).service.forceRemove(ITEM, 't')).rejects.toThrow(NotFoundException);
  });
});
