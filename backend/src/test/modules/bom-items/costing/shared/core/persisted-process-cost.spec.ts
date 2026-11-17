import {
  PERSISTED_PROCESS_COST_COLUMNS,
  processCostRowInUsd,
  processCostRowsInUsd,
  resolvePersistedProcessCost,
  sumPersistedProcessCost,
} from '../../../../../../modules/bom-items/costing/shared/core/persisted-process-cost';

// The single read path for a persisted process cost (P1b-iv-b). Plain rows in,
// numbers out -- nothing to mock, which is why the four duplicated copies of
// this logic were extracted here.
describe('resolvePersistedProcessCost (P1b-iv-b)', () => {
  // A real route-applied row: the engine charged 0.023329 for fiber_laser,
  // while the rate-only formula on the same row derives 0.011885 -- a 1.963x
  // difference, because the engine cost includes labour, QA inspection
  // sampling and yield loss that the formula cannot see.
  const fiberLaser = {
    total_cost_per_part: 0.023329,
    setup_cost_per_part: 0.000002,
    total_cycle_cost_per_part: 0.023327,
    machine_rate: 19.227545, labor_rate: 1.73, setup_manning: 1, setup_time: 15,
    batch_size: 25000, heads: 1, cycle_time: 4.8, parts_per_cycle: 1, scrap: 0,
  };

  it('prefers the stored engine cost over re-deriving it', () => {
    const r = resolvePersistedProcessCost(fiberLaser);
    expect(r.source).toBe('stored');
    expect(r.totalCostPerPart).toBe(0.023329);
    expect(r.setupCostPerPart).toBe(0.000002);
    expect(r.cycleCostPerPart).toBe(0.023327);
  });

  it('does not quietly substitute the poorer rate-only figure', () => {
    // What the old boms.service.ts / cost-aggregation.service.ts would have
    // reported for the same row.
    const derived = resolvePersistedProcessCost({ ...fiberLaser, total_cost_per_part: null });
    expect(derived.source).toBe('derived_legacy_fallback');
    // The two genuinely differ, which is the whole reason this preference
    // exists. If this ever becomes equal, the fixture stopped being realistic.
    expect(Math.abs(derived.totalCostPerPart - 0.023329)).toBeGreaterThan(0.001);
  });

  // 50 of 105 active rows still have nothing stored. Reading the column alone
  // would report them as 0 and drop real cost out of BOM totals.
  it('falls back to the established formula when nothing is stored', () => {
    const r = resolvePersistedProcessCost({
      total_cost_per_part: null,
      machine_rate: 60, labor_rate: 0, setup_manning: 1, setup_time: 60,
      batch_size: 10, heads: 1, cycle_time: 3600, parts_per_cycle: 1, scrap: 0,
    });
    expect(r.source).toBe('derived_legacy_fallback');
    // setup = (60/60 x 60) / 10 = 6 ; cycle = (3600/3600 x 60) / 1 = 60
    expect(r.setupCostPerPart).toBeCloseTo(6, 9);
    expect(r.cycleCostPerPart).toBeCloseTo(60, 9);
    expect(r.totalCostPerPart).toBeCloseTo(66, 9);
  });

  it('reproduces the old formula exactly, scrap included', () => {
    const row = {
      total_cost_per_part: null,
      machine_rate: 100, labor_rate: 20, setup_manning: 2, setup_time: 30,
      batch_size: 100, heads: 1, cycle_time: 120, parts_per_cycle: 2, scrap: 10,
    };
    // The formula as it was written in all four call sites.
    const setup = (30 / 60) * (100 + 20 * 2) / 100;
    const cycle = (120 / 3600) * (100 + 20 * 1) / 2;
    const expected = (setup + cycle) * 1.1;
    expect(resolvePersistedProcessCost(row).totalCostPerPart).toBeCloseTo(expected, 12);
  });

  // Components must add up to the total, or a UI showing all three contradicts
  // itself. The old copies only ever computed the total.
  it('keeps derived components consistent with the derived total', () => {
    const r = resolvePersistedProcessCost({
      total_cost_per_part: null,
      machine_rate: 100, labor_rate: 20, setup_manning: 2, setup_time: 30,
      batch_size: 100, heads: 1, cycle_time: 120, parts_per_cycle: 2, scrap: 10,
    });
    expect(r.setupCostPerPart + r.cycleCostPerPart).toBeCloseTo(r.totalCostPerPart, 12);
  });

  // NULL means never costed; 0 means the engine charged nothing. Treating a
  // genuine zero as missing would replace a real value with a derived one.
  it('treats a stored zero as a real value, not as missing', () => {
    const r = resolvePersistedProcessCost({
      total_cost_per_part: 0,
      machine_rate: 50, labor_rate: 10, setup_manning: 1, setup_time: 10,
      batch_size: 10, heads: 1, cycle_time: 60, parts_per_cycle: 1, scrap: 0,
    });
    expect(r.source).toBe('stored');
    expect(r.totalCostPerPart).toBe(0);
  });

  it('accepts numeric strings, as PostgREST returns them', () => {
    const r = resolvePersistedProcessCost({ total_cost_per_part: '0.023329' } as never);
    expect(r.source).toBe('stored');
    expect(r.totalCostPerPart).toBeCloseTo(0.023329, 9);
  });

  it('does not divide by zero on an empty batch or cycle', () => {
    const r = resolvePersistedProcessCost({
      total_cost_per_part: null,
      machine_rate: 100, labor_rate: 0, setup_manning: 1, setup_time: 30,
      batch_size: 0, heads: 1, cycle_time: 0, parts_per_cycle: 0, scrap: 0,
    });
    expect(Number.isFinite(r.totalCostPerPart)).toBe(true);
  });

  it('selects every column the resolver reads', () => {
    for (const col of [
      'total_cost_per_part', 'setup_cost_per_part', 'total_cycle_cost_per_part',
      'machine_rate', 'labor_rate', 'setup_manning', 'setup_time',
      'batch_size', 'heads', 'cycle_time', 'parts_per_cycle', 'scrap',
    ]) {
      expect(PERSISTED_PROCESS_COST_COLUMNS).toContain(col);
    }
  });
});

describe('sumPersistedProcessCost', () => {
  it('sums a mixed generation and reports how many needed the fallback', () => {
    const r = sumPersistedProcessCost([
      { total_cost_per_part: 10 },
      { total_cost_per_part: 5 },
      {
        total_cost_per_part: null,
        machine_rate: 60, labor_rate: 0, setup_manning: 1, setup_time: 60,
        batch_size: 10, heads: 1, cycle_time: 3600, parts_per_cycle: 1, scrap: 0,
      },
    ]);
    expect(r.total).toBeCloseTo(81, 9); // 10 + 5 + 66
    expect(r.storedCount).toBe(2);
    // Countable on purpose: this is how many rows still need a real engine cost.
    expect(r.fallbackCount).toBe(1);
  });

  it('returns a clean zero for an empty generation', () => {
    expect(sumPersistedProcessCost([])).toEqual({ total: 0, storedCount: 0, fallbackCount: 0 });
  });
});

describe('processCostRowInUsd: a record read in USD whatever currency it was stored in', () => {
  const toUsd = (amount: number, currency: string) => {
    if (currency !== 'INR') throw new Error(`no rate for ${currency}`);
    return amount / 64.3455;
  };
  // The India band saw line of a route applied in an India factory (applyRoute writes the factory currency).
  const indiaBandSaw = {
    currency: 'INR', organization_id: 'org-1', machine_rate: 162.15, labor_rate: 106.17, direct_rate: 268.32, total_cost_per_part: 0.64,
    setup_cost_per_part: '0.01', line_hourly_rate: 162.15, other_cost_per_part: null, cycle_time: 10.4, setup_time: 10.2, batch_size: 2500, scrap: 0,
  };

  it('converts every money column and nothing else: rates, costs; not times, counts or percentages', () => {
    const r = processCostRowInUsd(indiaBandSaw, toUsd);
    expect(r.currency).toBe('USD');
    expect(r.machine_rate).toBeCloseTo(2.52, 2);
    expect(r.labor_rate).toBeCloseTo(1.65, 2);
    expect(r.line_hourly_rate).toBeCloseTo(2.52, 2);
    expect(r.total_cost_per_part).toBeCloseTo(0.00995, 5);
    expect(r.setup_cost_per_part).toBeCloseTo(0.01 / 64.3455, 8);
    expect(r.other_cost_per_part).toBeNull();
    expect([r.cycle_time, r.setup_time, r.batch_size, r.scrap]).toEqual([10.4, 10.2, 2500, 0]);
  });

  it('a USD row, or one with no currency (the pre-707 default), is returned as it is', () => {
    const usd = { ...indiaBandSaw, currency: 'USD' };
    expect(processCostRowInUsd(usd, toUsd)).toBe(usd);
    const none = { ...indiaBandSaw, currency: null };
    expect(processCostRowInUsd(none, toUsd)).toBe(none);
  });

  it('a currency with no rate fails loudly instead of passing a foreign amount on as USD', () => {
    expect(() => processCostRowInUsd({ ...indiaBandSaw, currency: 'CNY' }, toUsd)).toThrow('no rate for CNY');
  });

  it('many rows: each with its own organization\'s rates, asked once per organization and not at all when every row is USD', async () => {
    const asked: Array<string | null> = [];
    const snapshotOf = async (org: string | null) => { asked.push(org); return { toUsd }; };
    const rows = [indiaBandSaw, { ...indiaBandSaw, machine_rate: 1190.39 }, { ...indiaBandSaw, currency: 'USD' }, { ...indiaBandSaw, organization_id: null }];
    const out = await processCostRowsInUsd(rows, snapshotOf);
    expect(out.map((r) => r.currency)).toEqual(['USD', 'USD', 'USD', 'USD']);
    expect(out[1]!.machine_rate).toBeCloseTo(18.5, 2);
    expect(out[2]).toBe(rows[2]);
    expect(asked).toEqual(['org-1', null]);
    asked.length = 0;
    await processCostRowsInUsd([{ ...indiaBandSaw, currency: 'USD' }], snapshotOf);
    expect(asked).toEqual([]);
  });
});
