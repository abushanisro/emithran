// The Part Summary of a costed part: component, production and material facts, the cost by category and by process, and the part's costs and targets. A projection of the
// same applied cost table every other view reads (cost-table.ts), the item and the scenario's resolved inputs: nothing is priced here, so this view can never disagree with the
// Part Details view. A value the model does not hold is null, with the reason in `notModelled`, never a zero and never an estimate.
// All money is USD (a persisted cost table is USD-native, see persisted-currency-contract.ts); the page converts to the display currency.
import type { CostRow, CostTable, CostValue } from './cost-table';

export type CostCategoryKey = 'material' | 'labor' | 'overhead' | 'setup' | 'investment' | 'other';

export interface PartSummary {
  currency: 'USD';
  /** 'applied': read from the applied cost table. 'none': nothing has been applied yet, so there is no cost to summarise (the facts of the part are still given). */
  basis: 'applied' | 'none';
  component: {
    /** Mass of the material the part consumes, scrap included: finish mass over the material utilization. Null when either is not on file. */
    roughMassKg: number | null;
    finishMassKg: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    surfaceAreaMm2: number | null;
    volumeMm3: number | null;
  };
  production: {
    /** The Digital Factory the part is costed in. Secondary and toolshop factories are not recorded by the model. */
    digitalFactory: { primary: string | null; secondary: string | null; toolshop: string | null };
    annualVolume: number | null;
    batchSize: number | null;
    productionLifeYears: number | null;
    lifetimeVolume: number | null;
  };
  material: {
    /** The library the material row comes from (price source and version). */
    catalog: string | null;
    name: string | null;
    /** Stock form of the material (Granules, Sheet ...). Null when the library row has none. */
    stock: string | null;
    composition: string | null;
    utilizationPct: number | null;
    unitCostUsdPerKg: number | null;
  };
  /** Each category's cost per part and its share of the sum of the categories (which is the piece part cost). */
  costByCategory: Array<{ key: CostCategoryKey; label: string; usd: number; pct: number | null }>;
  /** Each process's cost per part (its cycle and its amortized setup) and its share of the cost of all the processes. */
  costByProcess: Array<{ process: string; usd: number; pct: number | null }>;
  costs: {
    piecePartCostUsd: number | null;
    /** Piece part cost plus the period costs (indirect overhead, SG&A, margin). Not modelled: the model holds no authoritative formula for them (formula G-10). */
    fullyBurdenedCostUsd: number | null;
    totalCapitalInvestmentsUsd: number | null;
    targetCostUsd: number | null;
    varianceToTargetCostPct: number | null;
    targetMassKg: number | null;
    varianceToTargetMassPct: number | null;
  };
  /** Why a value is null, by name: the page shows the reason beside the dash. */
  notModelled: Partial<Record<'secondaryFactory' | 'toolshop' | 'stock' | 'fullyBurdenedCost' | 'targetCost' | 'targetMass', string>>;
  /** The cost objects that carry no cost (not costed): what the banner is about. */
  uncosted: string[];
}

export interface PartSummaryInput {
  item: {
    lengthMm?: number | null;
    widthMm?: number | null;
    heightMm?: number | null;
    surfaceAreaMm2?: number | null;
    volumeMm3?: number | null;
  };
  /** The scenario's resolved production inputs (resolveCostingInputs). */
  inputs: { batchSize: number | null; location: string | null; annualVolume: number | null; productionLifeYears: number | null };
  /** The applied cost table; null when nothing was applied. */
  table: CostTable | null;
  material: { name: string | null; stockForm: string | null; priceSource: string | null; priceVersion: string | null } | null;
}

const CATEGORY_LABELS: Record<CostCategoryKey, string> = {
  material: 'Material', labor: 'Labor', overhead: 'Overhead', setup: 'Setup', investment: 'Investment', other: 'Other',
};

const NOT_MODELLED = {
  secondaryFactory: 'The cost model records one Digital Factory per part: no secondary factory is on file.',
  toolshop: 'The cost model does not record a toolshop for the part.',
  stock: 'The material row in the library has no stock form.',
  fullyBurdenedCost: 'Not modelled: the period costs (indirect overhead, SG&A, margin) have no authoritative formula in the reference data, so a fully burdened cost would be an estimate.',
  targetCost: 'Not modelled: no target cost is on file.',
  targetMass: 'Not modelled: no target mass is on file.',
} as const;

const num = (v: CostValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const positive = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The cost of a process row per part: its cycle (machine, labor) and its amortized setup. */
function processCostOf(row: CostRow): number {
  return (num(row.values.processCost) ?? 0) + (num(row.values.amortizedBatchSetup) ?? 0);
}

export function buildPartSummary(input: PartSummaryInput): PartSummary {
  const { item, inputs, table, material } = input;
  const part = table?.rows.find((r) => r.kind === 'part') ?? null;
  const v = part?.values ?? {};

  const finishMassKg = num(v.finishMassKg);
  const utilizationPct = num(v.utilizationPct);
  const roughMassKg = finishMassKg != null && utilizationPct != null && utilizationPct > 0 ? r4(finishMassKg / (utilizationPct / 100)) : null;

  // The categories are columns of the part row: material, labor and overhead (the machine) of the cycle, the amortized setup, the tooling (the investment spread over the
  // parts), and the rest (logistics, procured parts, and whatever of the process cost is neither labor nor machine). Their sum is the piece part cost.
  const labor = num(v.laborCost) ?? 0;
  const overhead = num(v.directOverhead) ?? 0;
  const processCost = num(v.processCost) ?? 0;
  const amounts: Record<CostCategoryKey, number> = {
    material: num(v.materialCost) ?? 0,
    labor,
    overhead,
    setup: num(v.amortizedBatchSetup) ?? 0,
    investment: num(v.tooling) ?? 0,
    other: (num(v.logistics) ?? 0) + (num(v.otherDirect) ?? 0) + Math.max(0, processCost - labor - overhead),
  };
  const total = (Object.values(amounts) as number[]).reduce((s, x) => s + x, 0);
  const costByCategory = part
    ? (Object.keys(CATEGORY_LABELS) as CostCategoryKey[]).map((key) => ({ key, label: CATEGORY_LABELS[key], usd: r4(amounts[key]), pct: pct(amounts[key], total) }))
    : [];

  const processRows = (table?.rows ?? []).filter((r) => r.kind === 'process');
  const processTotal = processRows.reduce((s, r) => s + processCostOf(r), 0);
  const costByProcess = processRows.map((r) => ({ process: r.name, usd: r4(processCostOf(r)), pct: pct(processCostOf(r), processTotal) }));

  const annualVolume = positive(inputs.annualVolume);
  const life = positive(inputs.productionLifeYears);
  const piece = part ? num(v.pieceCost) : null;
  const target = part ? num(v.targetCost) : null;

  return {
    currency: 'USD',
    basis: part ? 'applied' : 'none',
    component: {
      roughMassKg,
      finishMassKg,
      lengthMm: positive(item.lengthMm),
      widthMm: positive(item.widthMm),
      heightMm: positive(item.heightMm),
      surfaceAreaMm2: positive(item.surfaceAreaMm2),
      volumeMm3: positive(item.volumeMm3),
    },
    production: {
      digitalFactory: { primary: inputs.location, secondary: null, toolshop: null },
      annualVolume,
      batchSize: positive(inputs.batchSize),
      productionLifeYears: life,
      lifetimeVolume: annualVolume != null && life != null ? annualVolume * life : null,
    },
    material: {
      catalog: material?.priceSource ? `${material.priceSource}${material.priceVersion ? ` ${material.priceVersion}` : ''}` : null,
      name: material?.name ?? (typeof v.materialComposition === 'string' ? v.materialComposition : null),
      stock: material?.stockForm || null,
      composition: typeof v.materialComposition === 'string' ? v.materialComposition : null,
      utilizationPct,
      unitCostUsdPerKg: num(v.materialUnitCost),
    },
    costByCategory,
    costByProcess,
    costs: {
      piecePartCostUsd: piece,
      fullyBurdenedCostUsd: null,
      totalCapitalInvestmentsUsd: part ? num(v.capitalInvestment) : null,
      targetCostUsd: target,
      varianceToTargetCostPct: target != null && target > 0 && piece != null ? Math.round(((piece - target) / target) * 1000) / 10 : null,
      targetMassKg: null,
      varianceToTargetMassPct: null,
    },
    notModelled: {
      secondaryFactory: NOT_MODELLED.secondaryFactory,
      toolshop: NOT_MODELLED.toolshop,
      ...(material?.stockForm ? {} : { stock: NOT_MODELLED.stock }),
      fullyBurdenedCost: NOT_MODELLED.fullyBurdenedCost,
      ...(target == null ? { targetCost: NOT_MODELLED.targetCost } : {}),
      targetMass: NOT_MODELLED.targetMass,
    },
    uncosted: (table?.rows ?? []).filter((r) => r.status === 'attention').map((r) => r.name),
  };
}
