import { join } from 'path';
import {
  CASTING_LOOKUP_KEYS,
  resolveCastingMaterial,
  resolveCastingReference,
  wallFeasibility,
  type CastingReferenceRows,
} from '../../../../../modules/bom-items/costing/casting/casting-reference';
import type { HpdcMachine } from '../../../../../modules/bom-items/costing/casting/hpdc-machine';
import { computeGdc, GDC_PROCESS } from '../../../../../modules/bom-items/costing/casting/gdc-engine';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { HPDC_PROCESS } from '../../../../../modules/bom-items/costing/casting/hpdc-engine';
import { buildCastingCostSummary } from '../../../../../modules/bom-items/costing/casting/casting-cost-summary';
import { chooseDieCastingProcess, resolveScenarioDieCastingProcess } from '../../../../../modules/bom-items/costing/casting/die-casting-process-choice';

// Real data only: memory/Die Casting variables, lookups, alloys and the
// gravity die casting machines (shaped as migration 845 stores them).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Die Casting');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const rows: CastingReferenceRows = {
  variables: csv('Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
  lookups: Object.fromEntries(CASTING_LOOKUP_KEYS.map((k) => [k, csv(`Lookup/${k}.csv`)])),
};
const variable = (k: string) => Number(rows.variables.find((v) => v.key === k)!.value);
const PROPS: Record<string, string> = {
  chamber_type: 'Chamber Type', clamping_pressure: 'Clamping Pressure (MPa)', cooling_factor: 'Cooling Factor (s/mm)',
  injection_temp: 'Injection Temp (C)', liquidus_temp: 'Liquidus Temp (C)', solidus_temp: 'Solidus Temp (C)',
  mold_temp: 'Mold Temp (C)', die_life: 'Die Life (cycles)', yield_loss_factor: 'Yield Loss Factor',
};
const src = csv('Raw Material/materials_master.csv').find((m) => m['Name'] === 'Aluminum, AA 380.0')!;
const al380 = resolveCastingMaterial({
  row: { name: src['Name'], material_type: src['Material Type'], density_kg_m3: src['Density (kg/m^3)'], cost_usa: src['Unit Cost (USD/kg)'], cut_code: src['Cut Code'] },
  properties: Object.fromEntries(Object.entries(PROPS).map(([k, h]) => [k, src[h] === '' ? null : Number(src[h])])),
});
const machines: HpdcMachine[] = csv('Machine/gravity_die_casting_machines.csv').map((r, i) => ({
  id: `gdc${i}`, name: String(r['Name']),
  machineRatePerHr: Number(r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD/hr)']),
  labourRatePerHr: Number(r['Labor Rate (USD/hr)']), operators: Number(r['Number of Operators']), setupTimeHr: Number(r['Setup Time (hr)']),
  clampingForceKn: null,
  tieBarHorMm: Number(r['Tie Bar Distance Hor (mm)']), tieBarVertMm: Number(r['Tie Bar Distance Vert (mm)']),
  maxMoldHeightMm: Number(r['Max Mold Height (mm)']), dryCycleTimeS: Number(r['Dry Cycle Time (s)']),
  moldEfficiency: Number(r['Mold Efficiency']),
}));
const { reference } = resolveCastingReference(rows);
const ref = reference!;
// The die-casting calculators exactly as migration 893 stores them.
const calculators = dieCastingSpecAsCalculators();
/** Gravity metal yield with n cavities, from the memory variables. */
const metalYield = (n: number) => variable('materialYieldGravityDieCasting') / 100 + Math.min(variable('numCavitiesMaterialYieldAdd') * n, variable('cavityCeiling'));
const geometry = { projectedAreaMm2: 8000, footprintMm: [100, 80] as [number, number], wallNominalMm: 3, wallMaxMm: 6, partVolumeMm3: 30_000 };
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const run = (over: Partial<Parameters<typeof computeGdc>[0]> = {}) => computeGdc({
  reference: ref, referenceMissing: [], calculators, material: al380, materialGrade: al380.name, geometry, machines,
  batchSize: 1000, coreCount: 2, costContext, ...over,
});

describe('gravity die casting cycle (memory/Die Casting)', () => {
  it('composes the agreed terms and prices the cheapest capable machine per part', () => {
    const r = run();
    const line = r.processLines[0]!;
    expect(line.physicsGap).toBeUndefined();
    expect(r.processName).toBe(GDC_PROCESS);
    expect(r.requiredClampKn).toBeNull();

    const yieldFrac = metalYield(1);
    const shotMm3 = 30_000 / yieldFrac;
    expect(r.shotVolumeMm3!).toBeCloseTo(shotMm3, 6);

    const fixed = variable('ladleFillTimeGravityDieCasting')
      + (variable('lubeTimeConstant') + variable('lubeTimeCoefficient') * 2 * 8000)
      + shotMm3 / variable('moldFillRateGravityDieCasting')
      + variable('coolTimeConstantGravityDieCasting') * 6
      + variable('gravityDropTime')
      + variable('coreLoadTimeGravityDieCasting') * 2;
    const perPart = machines
      .filter((m) => (100 < m.tieBarHorMm! && 80 < m.tieBarVertMm!) || (80 < m.tieBarHorMm! && 100 < m.tieBarVertMm!))
      .map((m) => {
        const min = ((m.dryCycleTimeS! + fixed) * variable('cycleTimeAdjustmentFactor') / m.moldEfficiency!) / 60;
        const crew = m.machineRatePerHr! / 60 + (m.labourRatePerHr! / 60) * m.operators!;
        return crew * min + crew * ((m.setupTimeHr! * 60) / 1000);
      });
    expect(line.totalCost).toBeCloseTo(Math.min(...perPart), 2);
    expect(line.calculatorId).toBe('Die Casting - Gravity Die Casting');
    expect(line.calculationTrace!.find((t) => t.fieldName === 'Metal Yield')!.value).toBeCloseTo(yieldFrac, 4);
  });

  it('the shot is divided by the machine Mold Efficiency; a machine without one is not priced', () => {
    const r = run();
    const m = machines.find((x) => x.name === r.processLines[0]!.machineName)!;
    expect(r.processLines[0]!.calculationTrace!.find((t) => t.fieldName === 'Mold Efficiency')!.value).toBe(m.moldEfficiency);
    const none = run({ machines: machines.map((x) => ({ ...x, moldEfficiency: null })) });
    expect(none.processLines[0]!.physicsGap).toBeDefined();
    expect(none.warnings.join(' ')).toMatch(/Mold Efficiency on file/);
  });

  it('cores not measured (analysis before core extraction): not costed, says to re-run', () => {
    const r = run({ coreCount: null });
    expect(r.processLines[0]!.physicsGap).toBeDefined();
    expect(r.warnings.join(' ')).toMatch(/cores \(re-run analysis/);
  });

  it('the default cavity count is the gravity default', () => {
    expect(run().cavities!.count).toBe(variable('defaultNumCavitiesGravityDieCasting'));
    expect(run().cavities!.constrainedBy).toBe('default');
  });

  it('more cavities raise the metal yield, up to cavityCeiling', () => {
    const four = run({ cavityCountOverride: 4 });
    const yieldOf = (r: ReturnType<typeof run>) => Number(r.processLines[0]!.calculationTrace!.find((t) => t.fieldName === 'Metal Yield')!.value);
    if (four.cavities!.count === 4) expect(yieldOf(four)).toBeGreaterThan(yieldOf(run()));
    expect(metalYield(1000)).toBeCloseTo(variable('materialYieldGravityDieCasting') / 100 + variable('cavityCeiling'), 12);
  });

  it('names what is missing instead of substituting it', () => {
    const r = run({ geometry: { ...geometry, wallMaxMm: null } });
    expect(r.processLines[0]!.physicsGap).toBeDefined();
    expect(r.warnings.join(' ')).toMatch(/maximum wall/);
  });

  it('summary: gravity metal is part / yield, remelted, with no runner/biscuit disclosure', () => {
    const r = run();
    const s = buildCastingCostSummary({
      family: 'die_cast', process: 'die_casting', hpdc: r, materialGrade: al380.name, materialCostPerKg: 5,
      materialDensityKgM3: al380.densityKgM3!, materialSource: 'db', partVolumeMm3: 30_000, batchSize: 1000, warnings: [], ratesSource: 'test',
      calculators, alloy: { name: al380.name, densityKgM3: al380.densityKgM3, yieldLossFactor: al380.yieldLossFactor },
      meltedKg: (r.shotVolumeMm3! / r.cavities!.count / 1e9) * al380.densityKgM3!,
    });
    const kg = (30_000 / 1e9) * al380.densityKgM3!;
    expect(s.dieCasting!.metal.meltedKg!).toBeCloseTo(kg / metalYield(1), 3);
    expect(s.warnings.join(' ')).toMatch(/Gating and riser metal/);
    expect(s.warnings.join(' ')).not.toMatch(/Biscuit/);
  });
});

describe('HPDC / GDC feasibility and choice', () => {
  const wall = csv('Lookup/tblWallThickness.csv').filter((w) => w['Material Type'] === 'Aluminum');
  const limit = (p: string) => wall.find((w) => w['Process Name'] === p)!;

  it('wall feasibility reads the process tblWallThickness row', () => {
    const gdcMin = Number(limit(GDC_PROCESS)['Minimum Wall Thickness (mm)']);
    const hpdcMin = Number(limit(HPDC_PROCESS)['Minimum Wall Thickness (mm)']);
    // A wall thinner than gravity can fill but thick enough for HPDC.
    const thin = (gdcMin + hpdcMin) / 2;
    expect(wallFeasibility(ref, GDC_PROCESS, 'Aluminum', thin, thin).feasible).toBe(false);
    expect(wallFeasibility(ref, HPDC_PROCESS, 'Aluminum', thin, thin).feasible).toBe(true);
    expect(wallFeasibility(ref, GDC_PROCESS, null, 3, 6).feasible).toBeNull();
  });

  const opt = (process: string, feasible: boolean | null, total: number | null) => ({
    process, feasible, detail: '', pieceCost: total, toolingPerPart: 0, total,
  });

  it('auto: the cheapest feasible process', () => {
    expect(chooseDieCastingProcess([opt(HPDC_PROCESS, true, 5), opt(GDC_PROCESS, true, 4)], null)).toMatchObject({ chosen: GDC_PROCESS, chosenBy: 'auto' });
    expect(chooseDieCastingProcess([opt(HPDC_PROCESS, true, 5), opt(GDC_PROCESS, false, 4)], null)).toMatchObject({ chosen: HPDC_PROCESS, chosenBy: 'auto' });
  });

  it('the Cost Guide choice wins, even over a cheaper one', () => {
    expect(chooseDieCastingProcess([opt(HPDC_PROCESS, true, 5), opt(GDC_PROCESS, true, 4)], HPDC_PROCESS)).toMatchObject({ chosen: HPDC_PROCESS, chosenBy: 'user' });
    expect(resolveScenarioDieCastingProcess({ dieCastingProcess: 'Sand Casting' }, [HPDC_PROCESS, GDC_PROCESS])).toBeNull();
  });

  it('one process without an amortised die: every option is compared on piece cost alone', () => {
    const c = chooseDieCastingProcess([
      { ...opt(HPDC_PROCESS, true, 5), toolingPerPart: 0.5 },
      { ...opt(GDC_PROCESS, true, 4.8), toolingPerPart: null },
    ], null);
    expect(c.basis).toBe('piece_only');
    expect(c.options.map((o) => o.total)).toEqual([5, 4.8]);
    expect(c.chosen).toBe(GDC_PROCESS);
    const both = chooseDieCastingProcess([
      { ...opt(HPDC_PROCESS, true, 5), toolingPerPart: 0.5 },
      { ...opt(GDC_PROCESS, true, 4.8), toolingPerPart: 1 },
    ], null);
    expect(both.basis).toBe('piece_and_tooling');
    expect(both.chosen).toBe(HPDC_PROCESS);
  });

  it('nothing feasible: says so, shows the first', () => {
    expect(chooseDieCastingProcess([opt(HPDC_PROCESS, false, 5), opt(GDC_PROCESS, null, null)], null)).toMatchObject({ chosenBy: 'none_feasible', chosen: HPDC_PROCESS });
  });
});
