import { join } from 'path';
import {
  CASTING_LOOKUP_KEYS,
  resolveCastingMaterial,
  resolveCastingReference,
  type CastingReferenceRows,
} from '../../../../../modules/bom-items/costing/casting/casting-reference';
import {
  crewedHourlyRate,
  selectHpdcMachines,
  type HpdcMachine,
} from '../../../../../modules/bom-items/costing/casting/hpdc-machine';
import {
  computeHpdc,
  hpdcCycleSeeds,
  overflowRow,
  resolveHpdcCavities,
  HPDC_CALCULATOR,
} from '../../../../../modules/bom-items/costing/casting/hpdc-engine';
import { runReferenceCalculator } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { buildCastingCostSummary, castingProcessOfFamily } from '../../../../../modules/bom-items/costing/casting/casting-cost-summary';

// Real data only: memory/Die Casting, read with the CSV reader the machine
// seed (migration 845) uses. Machines are shaped by that seed's rules
// (MHR = Direct OH + Indirect OH, LHR = Labor Rate); alloys by migration 855's
// (raw_materials columns + raw_material_properties keyed by the header,
// snake-cased, unit dropped).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Die Casting');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;
// The die-casting calculators exactly as migration 893 stores them.
const calculators = dieCastingSpecAsCalculators();
/** The shot of the High Pressure Die Casting calculator for one dry cycle (its per-machine input). */
const shotOn = (cyc: ReturnType<typeof hpdcCycleSeeds>, dryS: number) => {
  if (!cyc.ok) throw new Error('cycle');
  return runReferenceCalculator(calculators, HPDC_CALCULATOR, cyc.seeds.with({ 'Dry Cycle Time': { value: dryS, source: 'test' } }));
};

const rows: CastingReferenceRows = {
  variables: csv('Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
  lookups: Object.fromEntries(
    CASTING_LOOKUP_KEYS.map((k) => [k, csv(`Lookup/${k}.csv`)]),
  ),
};

const materialRows = csv('Raw Material/materials_master.csv');
const PROPERTY_HEADERS: Record<string, string> = {
  chamber_type: 'Chamber Type', clamping_pressure: 'Clamping Pressure (MPa)', cooling_factor: 'Cooling Factor (s/mm)',
  injection_temp: 'Injection Temp (C)', liquidus_temp: 'Liquidus Temp (C)', solidus_temp: 'Solidus Temp (C)',
  mold_temp: 'Mold Temp (C)', die_life: 'Die Life (cycles)', yield_loss_factor: 'Yield Loss Factor',
};
const alloy = (name: string) => {
  const r = materialRows.find((m) => m['Name'] === name);
  if (!r) throw new Error(`${name} not in materials_master.csv`);
  const properties: Record<string, number | null> = {};
  for (const [key, header] of Object.entries(PROPERTY_HEADERS)) {
    properties[key] = r[header] === '' || r[header] == null ? null : Number(r[header]);
  }
  return {
    source: r,
    material: resolveCastingMaterial({
      row: { name: r['Name'], material_type: r['Material Type'], density_kg_m3: r['Density (kg/m^3)'], cost_usa: r['Unit Cost (USD/kg)'], cut_code: r['Cut Code'] },
      properties,
    }),
  };
};

const machines: HpdcMachine[] = csv('Machine/high_pressure_die_casting_machines.csv').map((r, i) => ({
  id: `hpdc${i}`,
  name: String(r['Name']),
  machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
  labourRatePerHr: Number(r['Labor Rate (USD/hr)']),
  operators: Number(r['Number of Operators']),
  setupTimeHr: Number(r['Setup Time (hr)']),
  clampingForceKn: Number(r['Clamping Force (kN)']),
  tieBarHorMm: Number(r['Tie Bar Distance Hor (mm)']),
  tieBarVertMm: Number(r['Tie Bar Distance Vert (mm)']),
  maxMoldHeightMm: Number(r['Max Mold Height (mm)']),
  dryCycleTimeS: Number(r['Dry Cycle Time (s)']),
}));

describe('die casting reference (memory/Die Casting)', () => {
  it('resolves every variable and lookup the engines read', () => {
    const { reference, missing } = resolveCastingReference(rows);
    expect(missing).toEqual([]);
    const v = new Map(rows.variables.map((x) => [x.key, Number(x.value)]));
    expect(reference!.clampForceSafetyFactor).toBe(v.get('clampForceSafetyFactor'));
    expect(reference!.defaultSurfaceQuality!.index).toBe(v.get('partSurfaceQuality'));
    expect(reference!.toolLifeShotsByType.size).toBe(csv('Lookup/tblToolLife.csv').length);
  });

  it('names a missing variable and returns no reference', () => {
    const { reference, missing } = resolveCastingReference({
      ...rows, variables: rows.variables.filter((x) => x.key !== 'clampForceSafetyFactor'),
    });
    expect(reference).toBeNull();
    expect(missing).toContain('variables: clampForceSafetyFactor');
  });

  it('reads chamber type from Chamber Type: zinc hot, aluminum cold', () => {
    expect(alloy('Zinc - Zamak 5').material.chamber).toBe('hot');
    expect(alloy('Aluminum, AA 380.0').material.chamber).toBe('cold');
    expect(alloy('Magnesium AZ91D').material.chamber).toBe('hot');
  });
});

describe('HPDC clamp force and machine selection', () => {
  const { reference } = resolveCastingReference(rows);
  const al380 = alloy('Aluminum, AA 380.0');

  const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
  const geometry = { projectedAreaMm2: 10_000, footprintMm: [100, 80] as [number, number], wallNominalMm: 3, wallMaxMm: 6, partVolumeMm3: 30_000, partLengthMm: 100 };

  it('required clamp = projected area x alloy clamping pressure x safety factor (Clamp Force calculator)', () => {
    const r = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry, machines, batchSize: 1000, costContext });
    const expected = (10_000 * Number(al380.source['Clamping Pressure (MPa)']) * reference!.clampForceSafetyFactor) / 1000;
    expect(r.requiredClampKn!).toBeCloseTo(expected, 9);
    expect(r.calculatorRuns['Clamp Force']!.trace.length).toBeGreaterThan(0);
  });

  it('is not derivable without a measured projected area', () => {
    const r = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry: { ...geometry, projectedAreaMm2: null }, machines, batchSize: 1000, costContext });
    expect(r.requiredClampKn).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/Clamp force not derivable/);
  });

  it('keeps only machines with enough clamp whose tie bars clear the footprint, cheapest first', () => {
    const requiredKn = 2000;
    const footprintMm: [number, number] = [300, 200];
    const { checks, capable } = selectHpdcMachines({ machines, requiredKn, footprintMm });
    expect(checks).toHaveLength(machines.length);
    expect(capable.length).toBeGreaterThan(0);
    expect(capable.length).toBeLessThan(machines.length);
    for (const m of capable) {
      expect(m.clampingForceKn!).toBeGreaterThanOrEqual(requiredKn);
      const fits = (300 < m.tieBarHorMm! && 200 < m.tieBarVertMm!) || (200 < m.tieBarHorMm! && 300 < m.tieBarVertMm!);
      expect(fits).toBe(true);
    }
    for (let i = 1; i < capable.length; i++) expect(crewedHourlyRate(capable[i]!)).toBeGreaterThanOrEqual(crewedHourlyRate(capable[i - 1]!));
    for (const c of checks.filter((x) => !x.capable)) expect(c.reasons.length).toBeGreaterThan(0);
  });

  it('finds no machine when the footprint exceeds every tie-bar spacing', () => {
    const widest = Math.max(...machines.map((m) => Math.max(m.tieBarHorMm!, m.tieBarVertMm!)));
    const { capable } = selectHpdcMachines({ machines, requiredKn: 1, footprintMm: [widest + 1, widest + 1] });
    expect(capable).toEqual([]);
  });
});

describe('HPDC cycle time and casting line', () => {
  const { reference } = resolveCastingReference(rows);
  const ref = reference!;
  const v = ref.variables;
  const al380 = alloy('Aluminum, AA 380.0');
  // A 100 x 80 mm plate-like casting: projected 8000 mm2, 3 mm walls, 6 mm thickest.
  const geometry = { projectedAreaMm2: 8000, footprintMm: [100, 80] as [number, number], wallNominalMm: 3, wallMaxMm: 6, partVolumeMm3: 30_000, partLengthMm: 100 };
  const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

  it('composes the agreed terms from the alloy and memory variables', () => {
    const run = shotOn(hpdcCycleSeeds({ reference: ref, material: al380.material, geometry }), 2);
    expect(run.missing).toEqual([]);
    const c = run.outputs;
    const src = al380.source;
    const lube = v.lubeTimeConstant + v.lubeTimeCoefficient * 2 * 8000;
    expect(c['Lube Time']).toBeCloseTo(lube, 12);
    expect(c['Eject Time']).toBeCloseTo(lube * v.ejectTimeHPDC, 12);
    expect(c['Solidification Time']).toBeCloseTo(Number(src['Cooling Factor (s/mm)']) * 6, 12);
    const solids = csv('Lookup/tblPercentSolids.csv').find((x) => Number(x['Index']) === v.partSurfaceQuality)!['Percent Solids'];
    const z = csv('Lookup/tblLatentHeatConstant.csv').find((x) => x['Material Name'] === src['Material Type'])!['Latent Heat Constant (°C)'];
    const [ti, tf, td] = [src['Injection Temp (C)'], src['Liquidus Temp (C)'], src['Mold Temp (C)']].map(Number);
    const fill = v.solidificationConstantHPDC * ((ti! - tf! + Number(solids) * Number(z)) / (tf! - td!)) * 3;
    expect(c['Fill Time']).toBeCloseTo(fill, 12);
    expect(c['Shot Time']).toBeCloseTo((2 + v.ladleFillTime + lube + lube * v.ejectTimeHPDC + fill + Number(src['Cooling Factor (s/mm)']) * 6) * v.cycleTimeAdjustmentFactor, 12);
    expect(run.value).toBeCloseTo(c['Shot Time']!, 12);
  });

  it('names what is missing instead of substituting it', () => {
    const r = hpdcCycleSeeds({ reference: ref, material: { ...al380.material, coolingFactorSPerMm: null }, geometry: { ...geometry, wallMaxMm: null } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.join(' | ')).toMatch(/Cooling Factor/);
    expect(r.missing.join(' | ')).toMatch(/maximum wall/);
  });

  it('overflow ratio is the row at or below the wall; High for quality 1-2, Low otherwise', () => {
    const rowsOv = csv('Lookup/tblOverflowDim.csv').map((x) => ({ w: Number(x['Wall Thickness (mm)']), hi: Number(x['Overflow Volume Ratio High']), lo: Number(x['Overflow Volume Ratio Low']) }));
    const second = rowsOv[1]!;
    const last = rowsOv[rowsOv.length - 1]!;
    expect(overflowRow(ref, second.w + 0.01, 1)!.ratio).toBe(second.hi);
    expect(overflowRow(ref, second.w + 0.01, 3)!.ratio).toBe(second.lo);
    expect(overflowRow(ref, last.w * 4, 5)!.ratio).toBe(last.lo);
    expect(overflowRow(ref, rowsOv[0]!.w - 0.1, 3)).toBeNull();
  });

  it('prices every capable machine and keeps the cheapest per part', () => {
    const r = computeHpdc({
      reference: ref, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name,
      geometry, machines, batchSize: 1000, costContext,
    });
    const line = r.processLines[0]!;
    expect(line.physicsGap).toBeUndefined();
    expect(line.totalCost).toBeGreaterThan(0);
    const cyc = hpdcCycleSeeds({ reference: ref, material: al380.material, geometry });
    const { capable } = selectHpdcMachines({ machines, requiredKn: r.requiredClampKn!, footprintMm: geometry.footprintMm });
    const perPart = (m: HpdcMachine) => {
      const min = shotOn(cyc, m.dryCycleTimeS!).outputs['Shot Time']! / 60;
      return (m.machineRatePerHr! / 60) * min + (m.labourRatePerHr! / 60) * m.operators! * min
        + ((m.machineRatePerHr! / 60) + (m.labourRatePerHr! / 60) * m.operators!) * ((m.setupTimeHr ?? 0) * 60 / 1000);
    };
    const cheapest = Math.min(...capable.map(perPart));
    expect(line.totalCost).toBeCloseTo(cheapest, 2);
    expect(r.shotVolumeMm3).toBeGreaterThan(geometry.partVolumeMm3);
    // The line carries the calculator that computed it: its trace and the lookup rows.
    expect(line.calculatorId).toBe('Die Casting - High Pressure Die Casting');
    expect(line.calculationTrace!.some((t) => t.fieldName === 'Fill Time' && t.formula)).toBe(true);
    expect(line.lookupMatches!['Percent Solids']!.table).toBe('tblPercentSolids');
  });

  it('says why the machine was chosen: every machine, its cost or the failed criteria', () => {
    const r = computeHpdc({
      reference: ref, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name,
      geometry, machines, batchSize: 1000, costContext,
    });
    const line = r.processLines[0]!;
    const c = line.machineChoice!;
    expect(c.chosen).toBe(line.machineName);
    expect(c.candidates).toHaveLength(machines.length);
    expect(c.candidates[0]!.status).toBe('chosen');
    const capable = c.candidates.filter((x) => x.status !== 'rejected');
    expect(capable.length).toBe(c.capableCount);
    for (let i = 1; i < capable.length; i++) expect(capable[i]!.perPartCost!).toBeGreaterThanOrEqual(capable[i - 1]!.perPartCost!);
    expect(c.candidates.filter((x) => x.status === 'rejected').every((x) => x.reasons.length > 0)).toBe(true);
    expect(c.criteria.join(' ')).toMatch(/Clamping force at least/);
  });

  it('a part too big for every machine is a disclosed gap with no cost', () => {
    const r = computeHpdc({
      reference: ref, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name,
      geometry: { ...geometry, footprintMm: [1e5, 1e5] }, machines, batchSize: 1000, costContext,
    });
    expect(r.processLines[0]!.totalCost).toBe(0);
    expect(r.processLines[0]!.physicsGap).toBeDefined();
  });

  it('a grade that is not a die-casting alloy is a disclosed gap', () => {
    const r = computeHpdc({
      reference: ref, referenceMissing: [], calculators, material: null, materialGrade: 'SS304',
      geometry, machines, batchSize: 1000, costContext,
    });
    expect(r.warnings.join(' ')).toMatch(/SS304/);
    expect(r.processLines[0]!.physicsGap).toBeDefined();
  });
});

describe('HPDC cavities per die (layoutNumCav, defaultNumCavities, largePartThreshold)', () => {
  const { reference } = resolveCastingReference(rows);
  const ref = reference!;
  const al380 = alloy('Aluminum, AA 380.0');
  const layoutRows = csv('Lookup/layoutNumCav.csv').map((x) => ({
    l: Number(x['Cavities Length Wise']), w: Number(x['Cavities Width Wise']), n: Number(x['Number of Cavities']),
  }));
  const vars = new Map(rows.variables.map((x) => [x.key, Number(x.value)]));
  const geometry = { projectedAreaMm2: 8000, footprintMm: [100, 80] as [number, number], wallNominalMm: 3, wallMaxMm: 6, partVolumeMm3: 30_000, partLengthMm: 100 };
  const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
  const run = (cavityCountOverride: number | null, g = geometry) => computeHpdc({
    reference: ref, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name,
    geometry: g, machines, batchSize: 1000, costContext, cavityCountOverride,
  });

  it('no Cost Guide choice: memory defaultNumCavities, every layout offered', () => {
    const r = resolveHpdcCavities({ reference: ref, requested: null, partMassKg: 0.1 });
    expect(r.ok).toBe(true);
    expect(r.cavities.count).toBe(vars.get('defaultNumCavities'));
    expect(r.cavities.constrainedBy).toBe('default');
    expect(r.cavities.layouts).toEqual(layoutRows.map((x) => x.n).sort((a, b) => a - b));
  });

  it('a Cost Guide count takes its layoutNumCav arrangement', () => {
    const four = layoutRows.find((x) => x.n === 4)!;
    const r = resolveHpdcCavities({ reference: ref, requested: 4, partMassKg: 0.1 });
    expect(r.ok && r.cavities).toMatchObject({ count: 4, lengthWise: four.l, widthWise: four.w, constrainedBy: 'user' });
  });

  it('a count with no die layout is not costed, and says so', () => {
    const r = run(3);
    expect(r.cavities!.constrainedBy).toBe('unverified');
    expect(r.processLines[0]!.physicsGap).toBeDefined();
    expect(r.warnings.join(' ')).toMatch(/3 cavities has no die layout/);
  });

  it('a part above largePartThreshold is cast one at a time', () => {
    const threshold = vars.get('largePartThreshold')!;
    const r = resolveHpdcCavities({ reference: ref, requested: 4, partMassKg: threshold + 1 });
    expect(r.ok).toBe(true);
    expect(r.cavities).toMatchObject({ count: 1, constrainedBy: 'large_part' });
    expect(r.ok && r.note).toMatch(/largePartThreshold/);
  });

  it('n cavities: clamp x n, lube area x n, per-part time and cost = shot / n', () => {
    const one = run(null);
    const two = run(2);
    expect(two.cavities!.count).toBe(2);
    expect(two.requiredClampKn!).toBeCloseTo(2 * one.requiredClampKn!, 9);
    const cyc2 = hpdcCycleSeeds({ reference: ref, material: al380.material, geometry, cavities: 2 });
    expect(shotOn(cyc2, 2).outputs['Lube Time']).toBeCloseTo(ref.variables.lubeTimeConstant + ref.variables.lubeTimeCoefficient * 2 * 2 * 8000, 12);
    const { capable } = selectHpdcMachines({
      machines, requiredKn: two.requiredClampKn!, footprintMm: geometry.footprintMm,
      layout: { lengthWise: two.cavities!.lengthWise, widthWise: two.cavities!.widthWise },
    });
    const perPart = (m: HpdcMachine) => {
      const min = shotOn(cyc2, m.dryCycleTimeS!).outputs['Shot Time']! / 2 / 60;
      const crew = (m.machineRatePerHr! / 60) + (m.labourRatePerHr! / 60) * m.operators!;
      return crew * min + crew * ((m.setupTimeHr ?? 0) * 60 / 1000);
    };
    expect(two.processLines[0]!.totalCost).toBeCloseTo(Math.min(...capable.map(perPart)), 2);
    expect(two.processLines[0]!.totalCost).toBeLessThan(one.processLines[0]!.totalCost);
    expect(two.shotVolumeMm3!).toBeCloseTo(2 * one.shotVolumeMm3!, 6);
  });

  it('the layout, not one part, must clear the tie bars', () => {
    // A footprint that fits the widest machine alone but not 12 x 8 of it.
    const widest = Math.max(...machines.map((m) => Math.min(m.tieBarHorMm!, m.tieBarVertMm!)));
    const fp: [number, number] = [widest / 4, widest / 4];
    const single = selectHpdcMachines({ machines, requiredKn: 1, footprintMm: fp });
    const many = selectHpdcMachines({ machines, requiredKn: 1, footprintMm: fp, layout: { lengthWise: 12, widthWise: 8 } });
    expect(single.capable.length).toBeGreaterThan(0);
    expect(many.capable).toEqual([]);
    expect(many.checks.some((c) => c.reasons.some((x) => /12×8 cavity layout/.test(x)))).toBe(true);
  });

  it('the summary exposes the cavity choice for the Cost Guide', () => {
    const hpdc = run(2);
    const s = buildCastingCostSummary({
      family: 'die_cast', process: 'die_casting', hpdc,
      materialGrade: al380.material.name, materialCostPerKg: 5, materialDensityKgM3: al380.material.densityKgM3!,
      materialSource: 'db', partVolumeMm3: 30_000, batchSize: 1000, warnings: [], ratesSource: 'test',
    });
    expect(s.dieCasting).toMatchObject({ cavityCount: 2, cavityConstrainedBy: 'user', defaultCavityCount: vars.get('defaultNumCavities') });
    expect(s.dieCasting!.cavityLayouts).toContain(2);
  });
});

describe('casting Cost Summary', () => {
  const { reference } = resolveCastingReference(rows);
  const al380 = alloy('Aluminum, AA 380.0');
  const geometry = { projectedAreaMm2: 8000, footprintMm: [100, 80] as [number, number], wallNominalMm: 3, wallMaxMm: 6, partVolumeMm3: 30_000, partLengthMm: 100 };
  const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
  const base = {
    materialGrade: al380.material.name, materialCostPerKg: 5, materialDensityKgM3: al380.material.densityKgM3!,
    materialSource: 'db' as const, partVolumeMm3: 30_000, batchSize: 1000, warnings: [], ratesSource: 'test',
    calculators, alloy: { name: al380.material.name, densityKgM3: al380.material.densityKgM3, yieldLossFactor: al380.material.yieldLossFactor },
  };
  /** Melted metal per part, the shot shared across cavities (what the Melting calculator gives). */
  const melted = (h: { shotVolumeMm3: number | null; cavities: { count: number } | null }) => (h.shotVolumeMm3! / h.cavities!.count / 1e9) * al380.material.densityKgM3!;

  it('maps each casting family to its process, and nothing else', () => {
    expect(castingProcessOfFamily('die_cast')).toBe('die_casting');
    expect(castingProcessOfFamily('sand_cast')).toBe('sand_casting');
    expect(castingProcessOfFamily('investment_cast')).toBe('investment_casting');
    expect(castingProcessOfFamily('milled')).toBeNull();
  });

  it('die casting: material from volume x density x price, process from the HPDC line', () => {
    const hpdc = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry, machines, batchSize: 1000, costContext });
    const s = buildCastingCostSummary({ ...base, family: 'die_cast', process: 'die_casting', hpdc });
    const kg = (30_000 / 1e9) * al380.material.densityKgM3!;
    const factor = Number(al380.source['Yield Loss Factor']);
    expect(s.materialCost).toBeCloseTo(kg * factor * 5, 2);
    expect(s.totalProcessCost).toBe(hpdc.processLines[0]!.totalCost);
    expect(s.totalCost).toBeCloseTo(s.materialCost + s.totalProcessCost, 2);
  });

  it('metal: part x Yield Loss Factor charged; overflow melted, remelted, not charged', () => {
    const hpdc = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry, machines, batchSize: 1000, costContext });
    const s = buildCastingCostSummary({ ...base, family: 'die_cast', process: 'die_casting', hpdc, meltedKg: melted(hpdc) });
    const kg = (30_000 / 1e9) * al380.material.densityKgM3!;
    const meltedKg = melted(hpdc);
    const m = s.dieCasting!.metal;
    expect(m.yieldLossFactor).toBe(Number(al380.source['Yield Loss Factor']));
    expect(m.partKg).toBeCloseTo(kg, 3);
    expect(m.chargedKg).toBeCloseTo(kg * m.yieldLossFactor!, 3);
    expect(m.meltedKg!).toBeCloseTo(meltedKg, 3);
    expect(m.returnedKg!).toBeCloseTo(meltedKg - kg, 3);
    expect(s.grossWeightKg).toBeCloseTo(meltedKg, 3);
    expect(s.calculatorRuns!['Net Material Usage']!.value).toBeCloseTo(kg, 9);
    expect(s.calculatorRuns!['Gross Material Usage']!.value).toBeCloseTo(kg * m.yieldLossFactor!, 9);
    expect(s.warnings.join(' ')).toMatch(/remelted in-house: not charged/);
    expect(s.warnings.join(' ')).toMatch(/Biscuit metal not in the shot/);
  });

  it('the runner feeding each cavity is in the shot (thickest wall + additionalRunnerThickness, ingateGap)', () => {
    const withLength = { ...geometry, partLengthMm: 100 };
    const hpdc = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry: withLength, machines, batchSize: 1000, costContext });
    const v = reference!.variables;
    const h = 6 + v.additionalRunnerThickness;
    const runner = h * h * v.runnerAspectRatio * Math.max(1, Math.ceil(100 / v.ingateGap)) * v.ingateGap;
    const ratio = overflowRow(reference!, geometry.wallNominalMm, reference!.defaultSurfaceQuality!.index)!.ratio;
    expect(hpdc.shotVolumeMm3!).toBeCloseTo(30_000 * (1 + ratio) + runner, 6);
    expect(hpdc.calculatorRuns['Shot Volume']!.lookupMatches['Overflow Ratio']!.table).toBe('tblOverflowDim');
  });

  it('melted metal per part is the shot shared across cavities', () => {
    const hpdc = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry, machines, batchSize: 1000, costContext, cavityCountOverride: 2 });
    const one = computeHpdc({ reference, referenceMissing: [], calculators, material: al380.material, materialGrade: al380.material.name, geometry, machines, batchSize: 1000, costContext });
    const s2 = buildCastingCostSummary({ ...base, family: 'die_cast', process: 'die_casting', hpdc, meltedKg: melted(hpdc) });
    const s1 = buildCastingCostSummary({ ...base, family: 'die_cast', process: 'die_casting', hpdc: one, meltedKg: melted(one) });
    expect(s2.dieCasting!.metal.meltedKg!).toBeCloseTo(s1.dieCasting!.metal.meltedKg!, 6);
    expect(s2.materialCost).toBeCloseTo(s1.materialCost, 6);
  });

  it('an alloy with no Yield Loss Factor is charged its part metal and says so', () => {
    const noFactor = { ...al380.material, yieldLossFactor: null };
    const hpdc = computeHpdc({ reference, referenceMissing: [], calculators, material: noFactor, materialGrade: noFactor.name, geometry, machines, batchSize: 1000, costContext });
    const s = buildCastingCostSummary({ ...base, alloy: { ...base.alloy, yieldLossFactor: null }, family: 'die_cast', process: 'die_casting', hpdc });
    const kg = (30_000 / 1e9) * al380.material.densityKgM3!;
    expect(s.materialCost).toBeCloseTo(kg * 5, 2);
    expect(s.warnings.join(' ')).toMatch(/Gross Material Usage not derived.*Yield Loss Factor.*charged with no melt loss/);
  });

  it('sand casting has no engine yet: a named, uncosted line', () => {
    const s = buildCastingCostSummary({ ...base, family: 'sand_cast', process: 'sand_casting', hpdc: null });
    expect(s.processLines).toHaveLength(1);
    expect(s.processLines[0]!.totalCost).toBe(0);
    expect(s.processLines[0]!.physicsGap).toBeDefined();
    expect(s.warnings.join(' ')).toMatch(/Sand Casting has no cost engine/);
  });
});
