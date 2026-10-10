import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseService } from '../../../common/supabase/supabase.service';
import type { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import type { Logger } from '../../../common/logger/logger.service';
import { BOMsService } from '../../../modules/boms/boms.service';
import { ProjectsService } from '../../../modules/projects/projects.service';
import { loadBomTotals, readAllRows } from '../../../modules/boms/bom-totals';

jest.mock('@/common/supabase/supabase.service', () => ({ SupabaseService: class {} }), { virtual: true });
jest.mock('@/common/logger/logger.service', () => ({ Logger: class {} }), { virtual: true });
jest.mock('../../../modules/projects/projects.repository', () => ({ ProjectsRepository: class {} }));

const PROJECT = '11111111-1111-4111-8111-111111111111';
const snapshot = (id: string, own_cost: number, changes: Record<string, unknown> = {}) => ({
  id: `cost-${id}`, bom_item_id: id, own_cost, currency_code: 'USD', currency_integrity: 'consistent', is_stale: false, ...changes,
});
const item = (id: string, parent_item_id: string | null = null, quantity = 1, bom_id = 'bom') => ({ id, parent_item_id, quantity, bom_id });
const hierarchy = () => ({
  boms: [{ id: 'bom', project_id: PROJECT }],
  bom_items: [item('assembly', null, 2), item('child', 'assembly', 3)],
  bom_item_costs: [snapshot('assembly', 5, { total_cost: 35 }), snapshot('child', 10, { total_cost: 10 })],
});

function database(tables: Record<string, any[]>, failure?: string, cap = 500) {
  const requests: Array<{ table: string; from: number; to: number; ids: unknown[] }> = [];
  const client = { from(table: string) {
    let column: string | null = null, ids: unknown[] = [];
    const selected = () => (tables[table] ?? []).filter(row => !column || ids.includes(row[column]));
    const q = {
      select: () => q,
      in: (key: string, values: unknown[]) => { column = key; ids = values; return q; },
      eq: (key: string, value: unknown) => { column = key; ids = [value]; return q; },
      order: () => q,
      maybeSingle: async () => ({ data: selected()[0] ?? null, error: null }),
      range: async (from: number, to: number) => {
        requests.push({ table, from, to, ids });
        const all = selected();
        return { data: failure === table ? null : all.slice(from, Math.min(to + 1, from + cap)),
          error: failure === table ? { message: 'fixture failure' } : null, count: all.length };
      },
    };
    return q;
  } } as unknown as SupabaseClient;
  return { client, requests };
}
const rates = () => ({ getSnapshot: jest.fn().mockResolvedValue({
  convertOptional: (from: string, to: string) => from === to ? 1 : from === 'INR' && to === 'USD' ? 0.012 : from === 'USD' && to === 'INR' ? 1 / 0.012 : null,
}) });
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;

function services(client: SupabaseClient) {
  const supabase = { getClient: () => client, getUserClient: () => client } as unknown as SupabaseService;
  const fx = rates();
  const boms = new BOMsService(supabase, logger, fx as unknown as ExchangeRateService);
  const projectRepository = { findById: async () => ({ target_bom_cost: 100, target_bom_cost_currency: 'INR' }) };
  const projects = new ProjectsService(supabase, projectRepository as any, logger, fx as unknown as ExchangeRateService);
  return { boms, projects, fx };
}

describe('shared persisted BOM/project totals', () => {
  it('both services report 70 for the hierarchy, using complete own snapshots without double counting', async () => {
    const { client } = database(hierarchy());
    const { boms, projects } = services(client);
    expect((await (boms as any).computeBomsCosts('fixture', ['bom'])).get('bom')).toBe(70);
    const project = (await (projects as any).computeProjectsAggregates(client, [PROJECT], 'fixture')).get(PROJECT);
    expect(project).toEqual({ actualCost: 70, bomCount: 1, bomItemCount: 2 });
  });

  it('uses all five cost categories, not the incomplete material/process sum of 10', async () => {
    const { client, requests } = database({ bom_items: [item('part')], bom_item_costs: [snapshot('part', 18)],
      process_cost_records: [{ bom_item_id: 'part', total_cost_per_part: 10 }] });
    const fx = rates();
    expect((await loadBomTotals(client, ['bom'], fx.getSnapshot, jest.fn())).get('bom')?.totalCost).toBe(18);
    expect(requests.every(r => ['bom_items', 'bom_item_costs'].includes(r.table))).toBe(true);
  });

  it.each(['bom_items', 'bom_item_costs'])('fails closed when %s cannot be read', async failure => {
    const { client } = database(hierarchy(), failure);
    const { boms, projects } = services(client);
    expect((await (boms as any).computeBomsCosts('fixture', ['bom'])).get('bom')).toBeNull();
    expect((await (projects as any).computeProjectsAggregates(client, [PROJECT], 'fixture')).get(PROJECT).actualCost).toBeNull();
  });

  it('does not turn an unreadable project BOM list into a final zero', async () => {
    const { client } = database(hierarchy(), 'boms');
    expect((await (services(client).projects as any).computeProjectsAggregates(client, [PROJECT], 'fixture')).get(PROJECT).actualCost).toBeNull();
  });

  it('requires every child snapshot and propagates unresolved BOMs to the project', async () => {
    const tables = hierarchy(); tables.bom_item_costs = [snapshot('assembly', 5)];
    const { client } = database(tables);
    const { boms, projects } = services(client);
    expect((await (boms as any).computeBomsCosts('fixture', ['bom'])).get('bom')).toBeNull();
    expect((await (projects as any).computeProjectsAggregates(client, [PROJECT], 'fixture')).get(PROJECT).actualCost).toBeNull();
  });

  it.each([0, 99])('never falls back to entered money when snapshot own cost %s is stale', async amount => {
    const { client } = database({ bom_items: [{ ...item('part'), unit_cost: 99 }], bom_item_costs: [snapshot('part', amount, { is_stale: true })] });
    const { boms } = services(client);
    expect((await (boms as any).computeBomsCosts('fixture', ['bom'])).get('bom')).toBeNull();
  });

  it('returns null variances for unresolved cost analysis instead of claiming savings', async () => {
    const tables = hierarchy(); tables.bom_item_costs = [];
    const { client } = database(tables);
    const analysis = await services(client).projects.getCostAnalysis(PROJECT, 'user', 'fixture');
    expect(analysis.actualBomCost).toBeNull();
    expect(analysis.costVariance).toBeNull();
    expect(analysis.costVariancePercentage).toBeNull();
  });

  it('converts actual costs into the target denomination before cost-analysis subtraction', async () => {
    const { client } = database(hierarchy());
    const analysis = await services(client).projects.getCostAnalysis(PROJECT, 'user', 'fixture');
    expect(analysis.currency).toBe('INR');
    expect(analysis.actualBomCost).toBeCloseTo(70 / 0.012);
    expect(analysis.costVariance).toBeCloseTo(70 / 0.012 - 100);
  });

  it('reads all item/snapshot pages even when the server cap is smaller than the requested page', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => item(String(i)));
    const { client, requests } = database({ bom_items: items, bom_item_costs: items.map(i => snapshot(i.id, 1)) }, undefined, 100);
    const fx = rates();
    expect((await loadBomTotals(client, ['bom'], fx.getSnapshot, jest.fn())).get('bom')).toEqual({ totalCost: 1001, itemCount: 1001 });
    expect(fx.getSnapshot).toHaveBeenCalledTimes(1);
    expect(requests.every(r => r.ids.length <= 200)).toBe(true);
  });

  it('uses one FX snapshot for multiple BOMs and resolves verified zeros', async () => {
    const { client } = database({ bom_items: [item('inr'), item('zero', null, 1, 'empty-cost')],
      bom_item_costs: [snapshot('inr', 5000, { currency_code: 'INR' }), snapshot('zero', 0)] });
    const fx = rates();
    const totals = await loadBomTotals(client, ['bom', 'empty-cost', 'no-items'], fx.getSnapshot, jest.fn());
    expect(totals.get('bom')?.totalCost).toBe(60);
    expect(totals.get('empty-cost')?.totalCost).toBe(0);
    expect(totals.get('no-items')?.totalCost).toBe(0);
    expect(fx.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('withholds foreign money without FX but still resolves reporting-currency snapshots', async () => {
    const { client } = database({ bom_items: [item('usd'), item('inr', null, 1, 'foreign')],
      bom_item_costs: [snapshot('usd', 18), snapshot('inr', 5000, { currency_code: 'INR' })] });
    const totals = await loadBomTotals(client, ['bom', 'foreign'], async () => { throw new Error('offline'); }, jest.fn());
    expect(totals.get('bom')?.totalCost).toBe(18);
    expect(totals.get('foreign')?.totalCost).toBeNull();
  });
});

describe('readAllRows', () => {
  it('rejects a truncated page rather than accepting a partial total', async () => {
    await expect(readAllRows(async () => ({ data: [], error: null, count: 3 }))).rejects.toThrow('Truncated');
  });
  it('rejects changing or unavailable exact counts', async () => {
    await expect(readAllRows(async from => ({ data: [from], error: null, count: from ? 3 : 2 }))).rejects.toThrow('changing');
    await expect(readAllRows(async () => ({ data: [], error: null, count: null }))).rejects.toThrow('Incomplete');
  });
});
