import { buildPartSummary, type PartSummaryInput } from '../../../../../modules/bom-items/costing/shared/part-summary';
import type { CostRow, CostTable } from '../../../../../modules/bom-items/costing/shared/cost-table';

// The Part Summary is a projection of the applied cost table. The fixture is the applied cost table of the real Back cover (nylon, injection molding, tooling).

const row = (kind: CostRow['kind'], name: string, values: CostRow['values'], status: CostRow['status'] = 'ok'): CostRow => ({ id: `${kind}:${name}`, parentId: null, kind, name, status, values });
const table = (rows: CostRow[]): CostTable => ({ currency: 'USD', columns: [], rows }) as unknown as CostTable;

const BACK_COVER = table([
  row('part', 'Back cover 270924', {
    materialCost: 0.182037, processCost: 0.06, laborCost: 0.03, directOverhead: 0.03, amortizedBatchSetup: 0.3, tooling: 1.961718, capitalInvestment: 9808.59,
    totalVariable: 2.503755, pieceCost: 2.503755, annualVolume: 1000, finishMassKg: 0.0266, materialComposition: 'Generic Nylon, Type 11 40% Glass', utilizationPct: 90, materialUnitCost: 5.864,
  }),
  row('material', 'Generic Nylon, Type 11 40% Glass', { materialCost: 0.182037 }),
  row('group', 'Plastic Molding', { processCost: 0.06, amortizedBatchSetup: 0.3 }),
  row('process', 'Injection Molding', { processCost: 0.06, laborCost: 0.03, directOverhead: 0.03, amortizedBatchSetup: 0.3 }),
  row('tooling', 'Injection mold (SPI Class104)', { tooling: 1.961718, capitalInvestment: 9808.59 }),
]);

const input = (over: Partial<PartSummaryInput> = {}): PartSummaryInput => ({
  item: { lengthMm: 170.5, widthMm: 93.6, heightMm: 48.3, surfaceAreaMm2: 25670.66, volumeMm3: 18673.86 },
  inputs: { batchSize: 250, location: 'USA', annualVolume: 1000, productionLifeYears: 5 },
  table: BACK_COVER,
  material: { name: 'Generic Nylon, Type 11 40% Glass', stockForm: null, priceSource: 'BENCHMARK', priceVersion: 'Q1-2025' },
  ...over,
});

describe('buildPartSummary: component information', () => {
  it('reads the geometry from the item and the masses from the applied cost table', () => {
    const s = buildPartSummary(input());
    expect(s.component).toEqual({ roughMassKg: 0.0296, finishMassKg: 0.0266, lengthMm: 170.5, widthMm: 93.6, heightMm: 48.3, surfaceAreaMm2: 25670.66, volumeMm3: 18673.86 });
  });

  it('the rough mass is the finish mass over the utilization, and nothing when either is missing (no multiplier is invented)', () => {
    const noUtil = table([row('part', 'p', { finishMassKg: 0.0266, pieceCost: 1 })]);
    expect(buildPartSummary(input({ table: noUtil })).component.roughMassKg).toBeNull();
    const noMass = table([row('part', 'p', { utilizationPct: 90, pieceCost: 1 })]);
    expect(buildPartSummary(input({ table: noMass })).component.roughMassKg).toBeNull();
  });

  it('a dimension the CAD did not measure is null, never 0', () => {
    const s = buildPartSummary(input({ item: { lengthMm: 0, widthMm: null, heightMm: undefined, surfaceAreaMm2: 0, volumeMm3: null } }));
    expect(s.component).toMatchObject({ lengthMm: null, widthMm: null, heightMm: null, surfaceAreaMm2: null, volumeMm3: null });
  });
});

describe('buildPartSummary: production and material information', () => {
  it('gives the scenario inputs and the lifetime volume as annual volume times production life', () => {
    const p = buildPartSummary(input()).production;
    expect(p).toEqual({ digitalFactory: { primary: 'USA', secondary: null, toolshop: null }, annualVolume: 1000, batchSize: 250, productionLifeYears: 5, lifetimeVolume: 5000 });
  });

  it('has no lifetime volume without an annual volume (never a made-up figure)', () => {
    const p = buildPartSummary(input({ inputs: { batchSize: 250, location: 'USA', annualVolume: null, productionLifeYears: 5 } })).production;
    expect(p.annualVolume).toBeNull();
    expect(p.lifetimeVolume).toBeNull();
  });

  it('names the catalog, the material, its utilization and unit cost; a library row with no stock form says so', () => {
    const s = buildPartSummary(input());
    expect(s.material).toEqual({ catalog: 'BENCHMARK Q1-2025', name: 'Generic Nylon, Type 11 40% Glass', stock: null, composition: 'Generic Nylon, Type 11 40% Glass', utilizationPct: 90, unitCostUsdPerKg: 5.864 });
    expect(s.notModelled.stock).toMatch(/no stock form/);
    expect(buildPartSummary(input({ material: { name: 'x', stockForm: 'Granules', priceSource: null, priceVersion: null } })).notModelled.stock).toBeUndefined();
  });
});

describe('buildPartSummary: cost by category and by process', () => {
  it('splits the piece part cost into the six categories, which add up to it', () => {
    const s = buildPartSummary(input());
    const by = Object.fromEntries(s.costByCategory.map((c) => [c.key, c]));
    expect(by.material).toMatchObject({ label: 'Material', usd: 0.182 });
    expect(by.labor!.usd).toBe(0.03);
    expect(by.overhead!.usd).toBe(0.03);
    expect(by.setup!.usd).toBe(0.3);
    expect(by.investment!.usd).toBe(1.9617);
    expect(by.other!.usd).toBe(0);
    expect(s.costByCategory.reduce((sum, c) => sum + c.usd, 0)).toBeCloseTo(2.503755, 3);
    expect(s.costByCategory.reduce((sum, c) => sum + (c.pct ?? 0), 0)).toBeCloseTo(100, 0);
    expect(by.investment!.pct).toBe(78.4);
  });

  it('puts logistics, procured parts and the unaccounted part of the process cost under Other', () => {
    const t = table([row('part', 'p', { materialCost: 1, processCost: 0.5, laborCost: 0.1, directOverhead: 0.1, logistics: 0.2, otherDirect: 0.3, pieceCost: 2 })]);
    const other = buildPartSummary(input({ table: t })).costByCategory.find((c) => c.key === 'other')!;
    expect(other.usd).toBeCloseTo(0.2 + 0.3 + 0.3, 4);
  });

  it('lists each process with its share of the process cost (cycle and amortized setup), shares adding to 100', () => {
    const t = table([
      row('part', 'p', { pieceCost: 3 }),
      row('process', 'Melting', { processCost: 0.1, amortizedBatchSetup: 0 }),
      row('process', 'Die Casting', { processCost: 0.6, amortizedBatchSetup: 0.1 }),
      row('process', 'Painting', { processCost: 0.2, amortizedBatchSetup: 0 }),
    ]);
    const p = buildPartSummary(input({ table: t })).costByProcess;
    expect(p.map((x) => [x.process, x.usd, x.pct])).toEqual([['Melting', 0.1, 10], ['Die Casting', 0.7, 70], ['Painting', 0.2, 20]]);
  });

  it('shows the Back cover\'s one process as all of its process cost', () => {
    expect(buildPartSummary(input()).costByProcess).toEqual([{ process: 'Injection Molding', usd: 0.36, pct: 100 }]);
  });
});

describe('buildPartSummary: component costs and targets', () => {
  it('gives the piece part cost and the capital investment from the table', () => {
    const c = buildPartSummary(input()).costs;
    expect(c.piecePartCostUsd).toBe(2.503755);
    expect(c.totalCapitalInvestmentsUsd).toBe(9808.59);
  });

  it('does not make up a fully burdened cost, a target mass or a target: each is null with its reason', () => {
    const s = buildPartSummary(input());
    expect(s.costs).toMatchObject({ fullyBurdenedCostUsd: null, targetCostUsd: null, varianceToTargetCostPct: null, targetMassKg: null, varianceToTargetMassPct: null });
    expect(s.notModelled.fullyBurdenedCost).toMatch(/period costs/);
    expect(s.notModelled.targetCost).toMatch(/no target cost/);
    expect(s.notModelled.targetMass).toMatch(/no target mass/);
  });

  it('the variance to a target cost is (piece cost - target) over the target, when the table holds one', () => {
    const t = table([row('part', 'p', { pieceCost: 2.5, targetCost: 2.0 })]);
    const s = buildPartSummary(input({ table: t }));
    expect(s.costs).toMatchObject({ targetCostUsd: 2, varianceToTargetCostPct: 25 });
    expect(s.notModelled.targetCost).toBeUndefined();
  });
});

describe('buildPartSummary: a part with nothing applied, and the cost objects that failed to cost', () => {
  it('has the facts of the part and no cost at all (nothing is estimated)', () => {
    const s = buildPartSummary(input({ table: null }));
    expect(s.basis).toBe('none');
    expect(s.component.lengthMm).toBe(170.5);
    expect(s.costByCategory).toEqual([]);
    expect(s.costByProcess).toEqual([]);
    expect(s.costs.piecePartCostUsd).toBeNull();
    expect(s.costs.totalCapitalInvestmentsUsd).toBeNull();
  });

  it('names the cost objects that carry no cost', () => {
    const t = table([row('part', 'p', { pieceCost: 1 }), row('process', 'Gate trimming', {}, 'attention'), row('process', 'Injection Molding', { processCost: 0.1 })]);
    expect(buildPartSummary(input({ table: t })).uncosted).toEqual(['Gate trimming']);
    expect(buildPartSummary(input()).uncosted).toEqual([]);
  });
});
