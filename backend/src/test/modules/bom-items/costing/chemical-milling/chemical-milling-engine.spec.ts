/**
 * chemical-milling-engine.ts on the real memory/Machining reference: the four
 * station CSVs (Etch Cell, Mask Cure, DeMask, Scribe), the chem-mill lookup
 * tables and variables, and the processes.csv default machines.
 */
import {
  computeChemicalMilling, chemicalMillingCallout, splitChemicallyMilledPockets,
  type ChemMillPartFacts,
} from '../../../../../modules/bom-items/costing/chemical-milling/chemical-milling-engine';
import type { SecondaryMachine, SecondaryReference } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';
import { readMachiningMemoryCsv } from '../machining/real-reference-tables';

const n = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : Number(v));
const bool = (v: string | undefined) => (v === 'True' ? true : v === 'False' ? false : undefined);

function reference(): SecondaryReference {
  const variables = new Map(readMachiningMemoryCsv('variables.csv').map((r) => [r['variableName']!, r['stringValue']!]));
  const lookups = new Map<string, Array<Record<string, unknown>>>([
    ['tblMaskingMaterials', readMachiningMemoryCsv('lookup/tblMaskingMaterials.csv').map((r) => ({ Maskant: r['Maskant'], 'Heated Cure': bool(r['Heated Cure']), 'Cure Time (hr)': n(r['Cure Time (hr)']) }))],
    ['tblChemicalMilling', readMachiningMemoryCsv('lookup/tblChemicalMilling__rows.csv').map((r) => ({ component_area_mm2: n(r['component_area_mm2']), peel_rate_mm2_s: n(r['peel_rate_mm2_s']) }))],
    ['tblChemicalMillingEtchingRates', readMachiningMemoryCsv('lookup/tblChemicalMillingEtchingRates__rows.csv').map((r) => ({ material_type: r['material_type'], etch_rate_mm_min: n(r['etch_rate_mm_min']) }))],
  ]);
  const defaultMachine = new Map(readMachiningMemoryCsv('processes.csv').map((r) => [r['processName']!, r['defaultMachine']!]));
  return { variables, lookups, defaultMachine };
}

type Shape = (r: Record<string, string>) => { env: Array<number | null>; specs: Record<string, unknown> };
function machines(): SecondaryMachine[] {
  const files: Array<[string, string, Shape]> = [
    ['etch_cell_usa.csv', 'etch_cell', (r) => ({ env: [n(r['limits.tank_length_mm']), n(r['limits.tank_width_mm']), n(r['limits.tank_depth_mm'])], specs: {} })],
    ['mask_cure_usa.csv', 'mask_cure', (r) => ({ env: [n(r['limits.useable_length_mm']), n(r['limits.useable_width_mm']), n(r['limits.useable_height_mm'])], specs: { heated_cure: bool(r['limits.heated_cure']) } })],
    ['scribe_usa.csv', 'scribe', (r) => ({ env: [n(r['limits.bed_length_mm']), n(r['limits.bed_width_mm']), n(r['limits.bed_height_mm'])], specs: { feed_rate_mm_per_min: n(r['rates.feed_rate_mm_per_min']), programming_time_hr: n(r['time.programming_time_hr']) } })],
    ['demask_usa.csv', 'demask', () => ({ env: [null, null, null], specs: {} })],
  ];
  return files.flatMap(([file, machineClass, shape]) => readMachiningMemoryCsv(`machine/${file}`).map((r, i): SecondaryMachine => {
    const { env, specs } = shape(r);
    return {
      id: `${machineClass}-${i}`, name: r['name']!, machineClass,
      mhrUsd: n(r['accounting.direct_overhead_rate_usd_per_hr'])! + n(r['accounting.indirect_overhead_rate_usd_per_hr'])!,
      lhrUsd: n(r['accounting.labor_rate_usd_per_hr'])!, operators: n(r['accounting.number_of_operators'])!,
      laborTimeStandard: n(r['accounting.labor_time_standard'])!, setupHr: n(r['time.setup_time_hr'])!,
      goodPartYield: n(r['yields.good_part_yield']) ?? 0,
      maxXmm: env[0] ?? null, maxYmm: env[1] ?? null, maxZmm: env[2] ?? null, maxLengthMm: null, maxWorkpieceKg: null, specs,
    };
  }));
}

const REF = reference();
const MACHINES = machines();
const part = (overrides: Partial<ChemMillPartFacts> = {}): ChemMillPartFacts => ({
  bboxMm: { length: 400, width: 300, height: 20 }, surfaceAreaMm2: 280_000, weightKg: 5, wallThicknessMm: null,
  materialCutCode: null, features: [], batchSize: 50, materialClass: 'aluminum',
  pockets: [{ id: 'p1', lengthMm: 100, widthMm: 80, depthMm: 1.5, count: 2 }],
  ...overrides,
});
const line = (r: ReturnType<typeof computeChemicalMilling>, p: string) => r.find((l) => l.process === p)!;

describe('chemical milling (memory/Machining reference)', () => {
  it('prices nothing without a drawing callout', () => {
    const r = computeChemicalMilling(part(), null, REF, MACHINES);
    expect(r.every((l) => l.status === 'not_applicable')).toBe(true);
  });

  it('Etch Cell: deepest pocket / aluminium etch rate plus rinse, dry and desmut per tank load, plus pocket peeling', () => {
    const etch = line(computeChemicalMilling(part(), 'CHEM MILL', REF, MACHINES), 'Etch Cell');
    expect(etch.status).toBe('costed');
    expect(etch.machine!.name).toBe('Etch Cell - 1.8m x 1.0m x 1.2m Tank Size'); // processes.csv default
    // 400 x 300 x 20 box in the 1800 x 1050 x 1200 tank fits far more than the batch of 50.
    const perLoadMin = 1.5 / 0.0381 + 25 + 25 + 10 + 10;
    const peelSec = (2 * 100 * 80) / 4166; // part area 280 000 mm2 -> the 1 000 000 mm2 row
    const beforeYield = (perLoadMin * 60) / 50 + peelSec;
    const yieldFrac = etch.machine!.goodPartYield;
    expect(etch.cycleTimeSec!).toBeCloseTo(yieldFrac > 0 ? beforeYield / yieldFrac : beforeYield, 1);
    expect(etch.warnings.join(' ')).toContain('Depth Inspecting');
  });

  it('Mask Cure: the default heated oven cures in 1 h, shared across the parts that fit', () => {
    const cure = line(computeChemicalMilling(part(), 'CHEM MILL', REF, MACHINES), 'Mask Cure');
    expect(cure.machine!.name).toBe('Curing Oven - 1.3m x 1.3m x 1.4m Useable Oven Size');
    expect(cure.trace.find((t) => t.label === 'Maskant cure time')!.value).toBe(1);
    expect(cure.trace.find((t) => t.label === 'Parts per load')!.value).toBe(50);
  });

  it('Scribe and DeMask price the pocket outline at the machine feed rate and the reference dressing rate', () => {
    const r = computeChemicalMilling(part(), 'CHEM MILL', REF, MACHINES);
    const outline = 2 * 2 * (100 + 80);
    expect(line(r, 'Scribe').trace.find((t) => t.label === 'Scribed outline')!.value).toBe(outline);
    const demask = line(r, 'DeMask');
    expect(demask.trace.find((t) => t.label === 'Dressing edges')!.value).toBeCloseTo(outline / 10, 1);
    expect(demask.trace.find((t) => t.label === 'Peeling residual maskant')!.value).toBeCloseTo(280_000 / 4166, 1);
  });

  it('names what is missing instead of pricing it: plastic has no etch rate; no pockets means nothing to etch', () => {
    expect(line(computeChemicalMilling(part({ materialClass: 'plastic' }), 'CHEM MILL', REF, MACHINES), 'Etch Cell').status).toBe('gap');
    expect(computeChemicalMilling(part({ pockets: [] }), 'CHEM MILL', REF, MACHINES).every((l) => l.status === 'gap')).toBe(true);
  });

  it('reads the analyzer callout and pulls pockets out of the milling sequence only when there is one', () => {
    expect(chemicalMillingCallout({ chemical_milling: 'None' })).toBeNull();
    expect(chemicalMillingCallout({})).toBeNull();
    expect(chemicalMillingCallout({ chemical_milling: 'CHEM MILL' })).toBe('CHEM MILL');
    const features = [{ feature_type: 'PocketV2' }, { feature_type: 'SimpleHole' }];
    expect(splitChemicallyMilledPockets(features, null).filteredFeatures).toHaveLength(2);
    expect(splitChemicallyMilledPockets(features, 'CHEM MILL')).toEqual({ filteredFeatures: [{ feature_type: 'SimpleHole' }], etchedPocketGroups: 1 });
  });
});
