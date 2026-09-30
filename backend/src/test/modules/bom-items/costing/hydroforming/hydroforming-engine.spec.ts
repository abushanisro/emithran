import { join } from 'path';
import {
  computeHydroforming,
  drawCount,
  stepLookup,
  type BlankPress,
  type HydroformPress,
  type HydroformingReference,
  type StepTable,
} from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-engine';

// Real data only: memory/Sheetmetal Hydroforming, read with the same CSV reader
// the machine seed (migration 828) uses, and the presses shaped by the seed's
// own rules (MHR = Direct OH + Indirect OH, LHR = Labor Rate).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Sheetmetal Hydroforming');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const variables = new Map<string, number>();
for (const r of csv('hydroforming_digital_factory_variables (1).csv')) {
  const v = r['String Value'];
  const n = v === true ? 1 : v === false ? 0 : Number(v);
  if (Number.isFinite(n)) variables.set(String(r['Variable Name']), n);
}
const step = (file: string, k: string, v: string): StepTable =>
  csv(`Lookup/${file}`).map((r) => ({ key: Number(r[k]), value: Number(r[v]) }));
const reference: HydroformingReference = {
  variables,
  materialHandling: step('tblMaterialHandling.csv', 'Weight (kg)', 'Load Time (s)'),
  cleanRate: step('tblCleanRate.csv', 'Component Area (mm^2)', 'Manual Clean Rate (mm^2 / s)'),
  pressAdvance: step('pressMaterialAdvanceRate.csv', 'Part Length (mm)', 'Strokes Per Minute'),
  drawReduction: csv('Lookup/drawReductionPercentage.csv').map((r) => ({
    thicknessMm: Number(r['Material Thickness (mm)']),
    ratiosPct: ['Draw Punch Ratio00', 'Draw Punch Ratio01', 'Draw Punch Ratio02', 'Draw Punch Ratio03'].map((k) => Number(r[k])),
  })),
};
const hydroformPresses: HydroformPress[] = csv('Machine/machines_hydroform.csv').map((r, i) => ({
  id: `hf${i}`,
  name: String(r['Name']),
  formingType: String(r['Machine Forming Type']).toLowerCase(),
  maxDrawDepthMm: r['Max Draw Depth (mm)'],
  formingAreaDiaMm: r['Forming Area Dia (mm)'],
  formingAreaLengthMm: r['Forming Area Length (mm)'],
  formingAreaWidthMm: r['Forming Area Width (mm)'],
  maxToolDiaMm: r['Max Tool Dia (mm)'],
  isPreferred: r['Is Preferred'] === true,
}));
const blankPresses: BlankPress[] = csv('Machine/machines_offline_blank.csv').map((r, i) => ({
  id: `ob${i}`,
  name: String(r['Name']),
  pressForceKn: r['Press Force (kN)'],
  machineRatePerHr: (r['Direct Overhead Rate (USD / hr)'] ?? 0) + (r['Indirect Overhead Rate (USD / hr)'] ?? 0),
  labourRatePerHr: r['Labor Rate (USD / hr)'],
  operators: r['Number of Operators'],
  setupTimeHr: r['Setup Time (hr)'],
}));

const costContext = {
  qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0,
};
// A deep cup: 180 mm equal-area blank drawn to 80 mm wide, 80 mm deep, 1 mm steel.
const deepCup = { depthMm: 80, openingWidthMm: 80, developedAreaMm2: (Math.PI / 4) * 180 * 180 };
const run = (shell = deepCup, utsMpa: number | null = 300) => computeHydroforming({
  shell, thicknessMm: 1.0, densityKgM3: 7850, utsMpa, shearStrengthMpa: 250, batchSize: 100,
  reference, hydroformPresses, blankPresses, costContext,
});
const line = (r: ReturnType<typeof run>, process: string) => r.processLines.find((l) => l.process === process)!;

describe('stepLookup / drawCount', () => {
  it('reads the first breakpoint at or above the value', () => {
    expect(stepLookup(reference.materialHandling, 0.2)).toBe(8);
    expect(stepLookup(reference.pressAdvance, 180)).toBe(10);
  });

  it('counts draws from the thickness row of drawReductionPercentage', () => {
    // 1.0 mm -> row 1.02: 52%, then 70%: 180 x .52 = 93.6 > 80, x .70 = 65.5 <= 80.
    expect(drawCount(180, 80, 1.0, reference.drawReduction, 0)).toMatchObject({ draws: 2 });
    expect(drawCount(180, 100, 1.0, reference.drawReduction, 0)).toMatchObject({ draws: 1 });
  });

  it('derates the reduction for a high-strength material, so more draws may be needed', () => {
    // 180 x 52% = 93.6 <= 94: one draw. Derated 10%: 100 - 48 x 0.9 = 56.8%,
    // 180 x 56.8% = 102.2 > 94: a second draw is needed.
    const plain = drawCount(180, 94, 1.0, reference.drawReduction, 0)!;
    const derated = drawCount(180, 94, 1.0, reference.drawReduction, 0.1)!;
    expect(plain.draws).toBe(1);
    expect(derated.draws).toBe(2);
  });
});

describe('computeHydroforming — deep cup (depth/width 1.0)', () => {
  const r = run();

  it('chooses Deep Draw above fluidCellFormingRatioThreshold and counts its draws', () => {
    expect(r.process).toBe('Hydroform Deep Draw');
    expect(r.draws).toBe(2);
    expect(r.blankDiameterMm).toBeCloseTo(180, 1);
  });

  it('costs the Offline Blank on the cheapest press with enough force, from its own rates', () => {
    const blank = line(r, 'Offline Blank');
    const forceKn = (Math.PI * 180 * 1.0 * 250) / 1000;
    const capable = blankPresses.filter((p) => (p.pressForceKn ?? 0) >= forceKn && (p.machineRatePerHr ?? 0) > 0);
    const cheapest = capable.reduce((a, b) =>
      a.machineRatePerHr! + a.labourRatePerHr! * a.operators! <= b.machineRatePerHr! + b.labourRatePerHr! * b.operators! ? a : b);
    expect(blank.machineName).toBe(cheapest.name);
    expect(blank.cycleTimeMin).toBeCloseTo(1 / 10, 3); // 10 strokes/min at a 180 mm blank
    expect(blank.totalCost).toBeGreaterThan(0);
    expect(blank.rateSource).toBe('mhr_database');
  });

  it('shows the hydroform operation times but does not cost the line (no forming time, no press rate)', () => {
    const hf = line(r, 'Hydroform Deep Draw');
    expect(hf.totalCost).toBe(0);
    expect(hf.rateSource).toBe('no_db_rate');
    expect(hf.physicsGap?.gapType).toBe('unsupported_operation');
    const names = hf.featureBreakdown!.map((o) => o.name);
    expect(names).toEqual(['Loading', 'Clean Tooling', 'Visual Inspection', 'Unloading']);
    expect(hf.featureBreakdown!.find((o) => o.name === 'Loading')!.timeSec).toBe(8);
    expect(hf.featureBreakdown!.find((o) => o.name === 'Visual Inspection')!.timeSec).toBe(variables.get('defaultInspectionTime'));
    expect(hf.machineName).toBeTruthy();
    expect(r.trace.find((t) => t.label === 'Deep Draw Forming')!.value).toMatch(/not costed/);
  });
});

describe('computeHydroforming — shallow tray (depth/width below the threshold)', () => {
  const r = run({ depthMm: 30, openingWidthMm: 80, developedAreaMm2: 19000 });

  it('chooses Fluid Cell and adds the throw pad', () => {
    expect(r.process).toBe('Hydroform Fluid Cell');
    expect(r.draws).toBe(1);
    const names = line(r, 'Hydroform Fluid Cell').featureBreakdown!.map((o) => o.name);
    expect(names).toContain('Throw pad');
  });
});
