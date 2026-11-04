import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { figuresOf, SandSnapshotsService, type SnapshotContext } from '../../../../../modules/bom-items/costing/casting/sand/sand-snapshots.service';

const input = { bomItemId: 'item-1', userId: 'user-1', organizationId: 'org-1', token: 't' };
const context: SnapshotContext = { location: 'Chennai', batchSize: 250, productionLifeYears: 3, plantOverrides: [{ variable: 'finishAllowance', value: '0.8' }], referenceSourceVersion: '2026-SandCasting' };
const summary = { totalCost: 11.75, materialCost: 10, sandCasting: { complete: true, mouldingMachine: 'DISA 130', cavities: 2 } };

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'snap-1', label: 'quote rev A', summary, context, status: 'submitted', created_by: 'user-1', created_at: '2026-11-05T00:00:00Z',
  reviewed_by: null, reviewed_at: null, review_note: null, ...over,
});

/** A chainable fake of the query builders: every call is recorded, the awaited result is the one set for the table and verb. */
function setup(options: { item?: object | null; found?: object | null; inserted?: object; updated?: object | null; list?: object[] } = {}) {
  const { item = { id: 'item-1' }, found = null, inserted = stored(), updated = stored({ status: 'approved', reviewed_by: 'user-2', reviewed_at: 't', review_note: 'ok ok' }), list = [] } = options;
  const calls: Array<{ table: string; verb: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const builder = (table: string) => {
    const call = { table, verb: 'select', payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
    calls.push(call);
    const b: Record<string, unknown> = {};
    const self = () => b;
    b['select'] = self;
    b['order'] = () => Promise.resolve({ data: list, error: null });
    b['eq'] = (k: string, v: unknown) => { call.filters.push([k, v]); return b; };
    b['insert'] = (p: unknown) => { call.verb = 'insert'; call.payload = p; return b; };
    b['update'] = (p: unknown) => { call.verb = 'update'; call.payload = p; return b; };
    b['single'] = () => Promise.resolve({ data: inserted, error: null });
    b['maybeSingle'] = () => Promise.resolve({ data: table === 'bom_items' ? item : call.verb === 'update' ? updated : found, error: null });
    return b;
  };
  const client = { from: builder };
  const database = { getUserClient: () => client, getPrivilegedClient: () => client };
  const audits: Array<Record<string, unknown>> = [];
  const audit = { recordBestEffort: (e: Record<string, unknown>) => { audits.push(e); return Promise.resolve(); } };
  const service = new SandSnapshotsService(database as never, audit as never);
  return { service, calls, audits };
}

describe('freezing a cost', () => {
  it('stores the summary and what it was computed with, as the author, and audits it', async () => {
    const { service, calls, audits } = setup();
    const snap = await service.create(input, '  quote rev A ', summary, context);
    const insert = calls.find((c) => c.verb === 'insert')!;
    expect(insert.table).toBe('sand_cost_snapshots');
    expect(insert.payload).toMatchObject({ bom_item_id: 'item-1', organization_id: 'org-1', label: 'quote rev A', summary, context, created_by: 'user-1' });
    expect(snap).toMatchObject({ id: 'snap-1', status: 'submitted', figures: { pieceCost: 11.75, materialCost: 10, mouldingMachine: 'DISA 130', cavities: 2 } });
    expect(audits[0]).toMatchObject({ action: 'sand_snapshot.created', targetId: 'item-1', meta: { snapshotId: 'snap-1', pieceCost: 11.75 } });
  });

  it('refuses a part the user cannot see, a summary with no sand route, and an incomplete route', async () => {
    await expect(setup({ item: null }).service.create(input, 'a label', summary, context)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup().service.create(input, 'a label', { totalCost: 1 }, context)).rejects.toMatchObject({ response: { code: 'not_sand_cast' } });
    await expect(setup().service.create(input, 'a label', { sandCasting: { complete: false } }, context)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('reviewing a snapshot', () => {
  const reviewer = { userId: 'user-2', organizationId: 'org-1', token: 't' };

  it('a different member approves it with a note; the review is stored and audited', async () => {
    const { service, calls, audits } = setup({ found: stored({ bom_item_id: 'item-1' }) });
    const snap = await service.review(reviewer, 'snap-1', 'approved', ' ok ok ');
    const update = calls.find((c) => c.verb === 'update')!;
    expect(update.payload).toMatchObject({ status: 'approved', reviewed_by: 'user-2', review_note: 'ok ok' });
    expect(update.filters).toContainEqual(['status', 'submitted']);
    expect(snap.status).toBe('approved');
    expect(audits[0]).toMatchObject({ action: 'sand_snapshot.reviewed', targetId: 'item-1', meta: { snapshotId: 'snap-1', decision: 'approved', note: 'ok ok' } });
  });

  it('the author cannot review their own snapshot', async () => {
    await expect(setup({ found: stored() }).service.review({ userId: 'user-1', organizationId: 'org-1', token: 't' }, 'snap-1', 'approved', 'fine')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a snapshot is reviewed once, and an unknown one is not found', async () => {
    await expect(setup({ found: stored({ status: 'rejected' }) }).service.review(reviewer, 'snap-1', 'approved', 'fine')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ found: null }).service.review(reviewer, 'snap-9', 'approved', 'fine')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a review lost to someone else a moment earlier is a conflict, and nothing is audited', async () => {
    const { service, audits } = setup({ found: stored(), updated: null });
    await expect(service.review(reviewer, 'snap-1', 'rejected', 'wrong rate')).rejects.toBeInstanceOf(ConflictException);
    expect(audits).toEqual([]);
  });
});

describe('the list and the key figures', () => {
  it('lists the part\'s snapshots with their key figures', async () => {
    const { service } = setup({ list: [stored(), stored({ id: 'snap-2', status: 'approved', summary: { totalCost: 9 } })] });
    const list = await service.list('item-1', 't');
    expect(list.map((s) => [s.id, s.figures.pieceCost, s.figures.mouldingMachine])).toEqual([['snap-1', 11.75, 'DISA 130'], ['snap-2', 9, null]]);
  });

  it('reads a figure only when it is a number', () => {
    expect(figuresOf({ totalCost: 'x', materialCost: Number.NaN, sandCasting: { cavities: '2' } })).toEqual({ pieceCost: null, materialCost: null, mouldingMachine: null, cavities: null });
  });
});
