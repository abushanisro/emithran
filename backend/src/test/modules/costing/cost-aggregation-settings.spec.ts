import { CostAggregationService, readSellingPriceSettings } from '../../../modules/costing/cost-aggregation.service';
import type { DatabaseService } from '../../../common/database/database.service';
import type { Logger } from '../../../common/logger/logger.service';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

/** A query builder that resolves every chain to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

function serviceWith(settings: { data: unknown; error: unknown }, tables: Record<string, { data: unknown; error: unknown }> = {}) {
  const db = {
    getPrivilegedClient: () => ({ from: () => query(settings) }),
    getUserClient: () => ({ from: (table: string) => query(tables[table] ?? { data: [], error: null }) }),
  } as unknown as DatabaseService;
  return new CostAggregationService(db, logger);
}

describe('readSellingPriceSettings', () => {
  it('reads both percentages and reports no gap when both are set', () => {
    expect(readSellingPriceSettings([{ key: 'sga_pct', value: '0.1' }, { key: 'profit_pct', value: 0 }])).toEqual({
      sgaPct: 0.1, profitPct: 0, pricingGaps: [],
    });
  });

  it('names each missing setting instead of silently dropping it', () => {
    const r = readSellingPriceSettings([{ key: 'sga_pct', value: 0.1 }, { key: 'profit_pct', value: null }]);
    expect(r.sgaPct).toBe(0.1);
    expect(r.profitPct).toBeNull();
    expect(r.pricingGaps).toHaveLength(1);
    expect(r.pricingGaps[0]).toContain('profit_pct');
  });
});

describe('CostAggregationService.computeBomItemCost', () => {
  it('throws when costing_settings cannot be read, rather than pricing without SG&A and profit', async () => {
    const service = serviceWith({ data: null, error: { message: 'permission denied' } });
    await expect(service.computeBomItemCost('b1', 't')).rejects.toThrow('costing_settings');
  });

  it('throws when a cost table cannot be read, rather than leaving that category out', async () => {
    const service = serviceWith(
      { data: [{ key: 'sga_pct', value: 0.1 }, { key: 'profit_pct', value: 0.1 }], error: null },
      { process_cost_records: { data: null, error: { message: 'timeout' } } },
    );
    await expect(service.computeBomItemCost('b1', 't')).rejects.toThrow('process_cost_records: timeout');
  });

  it('exposes a missing setting as a pricing gap on the response', async () => {
    const service = serviceWith({ data: [{ key: 'sga_pct', value: 0.1 }], error: null });
    const cost = await service.computeBomItemCost('b1', 't');
    expect(cost.profitCost).toBe(0);
    expect(cost.pricingGaps).toEqual([expect.stringContaining('profit_pct')]);
  });
});
