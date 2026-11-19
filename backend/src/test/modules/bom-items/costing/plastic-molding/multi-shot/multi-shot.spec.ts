// Multi-shot molding (Assembly Plastic Molding) on the real memory/ data: the presses of memory/Assembly plastic molding with the attributes
// migration 1085 gives them (from memory/Countries data), a PC substrate and a TPE overmold priced by the injection engine.
import { readdirSync } from 'fs';
import { join } from 'path';

import { sandMachineFromRow, type SandMachine } from '../../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { resolveSandReference } from '../../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { plasticMoldingCalculatorsByName } from '../../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import {
  assemblyPlasticMoldingCalculatorsByName, loadAssemblyPlasticMoldingCalculatorSpec,
} from '../../../../../../modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculator-spec';
import {
  MULTI_SHOT_CYCLE_CALC, MULTI_SHOT_DESIGN_HOURS_FACTOR, MULTI_SHOT_PRESS_CLASS, chooseMultiShotRoute, multiShotPressOf, multiShotRouteKeyOf,
  pressGaps, priceMultiShotRoutes, shotEntriesOf, type MultiShotPress, type MultiShotShot, type ShotNeed,
} from '../../../../../../modules/bom-items/costing/plastic-molding/multi-shot/multi-shot';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { runReferenceCalculator } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { realMaterialClamp, realPlasticReference, realResinInputs } from '../real-plastic-reference';

import type { CostSummaryDto, ProcessLineCost } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';
import type { MoldInsert } from '../../../../../../modules/bom-items/costing/plastic-molding/insert/insert-molding';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const MEMORY = join(__dirname, '../../../../../../../../memory');
const DIR = join(MEMORY, 'Assembly plastic molding');
const clean = (h: string) => h.replace(/^﻿/, '');
const rows = (path: string) => readCsv(path).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [clean(k), v])));
const n = (v: unknown) => Number(v);

// The staged reference (2026-AssyPlastic), as the engine reads it.
const ref = resolveSandReference({
  variables: rows(join(DIR, 'plastic_molding_variables.csv')).map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: null })),
  lookups: readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv'))
    .map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(join(DIR, 'Lookup', f)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v]))) } })),
});
// The presses: rates from the USA file, attributes from the India export (what migration 1085 writes, by name).
const india = new Map(rows(join(MEMORY, 'Countries data/India_XML_Data_.csv')).filter((r) => r['Commodity'] === 'Assembly Plastic Molding' && r['Machine Type'] === 'Multi-Shot Molding').map((r) => [String(r['name']), r]));
const presses: MultiShotPress[] = rows(join(DIR, 'Machines/injection_molders.csv')).flatMap((r, i) => {
  const name = String(r['Name']).replace('2900kN | 2K | 1060g', '2900kN | 2K | 1860g');
  const a = india.get(name);
  if (!a) return [];
  const machine: SandMachine = sandMachineFromRow({
    id: `press-${i}`, machine_name: name, machine_class: MULTI_SHOT_PRESS_CLASS, location: 'USA',
    mhr_usd_per_hour: n(r['Direct Overhead Rate (USD / hr)']) + n(r['Indirect Overhead Rate (USD / hr)']),
    usd_labor_rate_per_hr: r['Labor Rate (USD / hr)'], operators: r['Number of Operators'], setup_time_hr: r['Setup Time (hr)'],
    specs: {
      injection_units: n(a['numInjectionBarrels']), stations: n(a['numMoldStations']), rotating_stack: String(a['rotatingStackPlaten']).toUpperCase() === 'TRUE',
      orientation: a['orientation'], tool_index_time_s: n(a['toolIndexTime']),
    },
  }, () => null);
  const p = multiShotPressOf(machine, { maxTonnage: n(a['clampForce']) / 9.80665, shotCapacityG: n(a['maxShotSize']) },
    { injectionRateMm3PerS: n(a['maxInjectionRate']), dryCycleTimeS: n(a['dryCycleTime']), goodPartYield: 1 });
  return p ? [p] : [];
});
const spec = loadAssemblyPlasticMoldingCalculatorSpec();
const calculators = assemblyPlasticMoldingCalculatorsByName();
const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

const shotInput = (material: string, over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 20_000, surfaceArea: 15_000, wallThicknessNominalMm: 2, materialGrade: material, materialCostPerKg: 4, materialDensityKgM3: 1100,
  materialSource: 'db', batchSize: 1000, family: 'plastic_molded',
  mhrRate: { rate: 40, labourRate: 30, source: 'mhr_database', machineClass: 'injection_molding', machineName: 'Injection press', commodityCode: null },
  deburrRate: { rate: 0, labourRate: 30, source: 'mhr_database', machineClass: 'deburring', machineName: null, commodityCode: null },
  inspectionRate: { rate: 0, labourRate: 30, source: 'mhr_database', machineClass: 'cmm', machineName: null, commodityCode: null },
  machineClampTonnes: null, machineShotCapacityG: null, pressTiming: null, goodPartYield: null,
  calculators: plasticMoldingCalculatorsByName(), materialClamp: realMaterialClamp(material), realResinInputs: realResinInputs(material), materialType: material,
  plasticReference: realPlasticReference(), location: 'USA', bboxMaxMm: 80, bboxMidMm: 60, bboxMinMm: 20, cadFaceCount: 300,
  signals: { projectedAreaMm2: 3000, undercutCount: 0 }, annualVolume: 10_000, productionLifeYears: 3, ...over,
});
const shot = (name: string, material: string, over: Partial<InjectionMoldingCostInput> = {}): MultiShotShot =>
  ({ name, source: 'bom', itemId: null, grade: material, volumePct: null, input: shotInput(material, over) });
const needOf = (s: MultiShotShot): ShotNeed => {
  const im = computeInjectionMoldedCostSummary(s.input).injectionMolding;
  return { clampT: im?.clampRequiredT ?? null, shotGppsG: im?.shotRequiredG ?? null, reason: null };
};
const appendLines = (dto: CostSummaryDto, lines: ProcessLineCost[]): CostSummaryDto => ({
  ...dto, processLines: [...dto.processLines, ...lines],
  totalProcessCost: dto.totalProcessCost + lines.reduce((t, l) => t + l.totalCost, 0), totalCost: dto.totalCost + lines.reduce((t, l) => t + l.totalCost, 0),
});
const price = (shots: MultiShotShot[], components: MoldInsert[] = []) => priceMultiShotRoutes({
  shots, needs: shots.map(needOf), presses, components, batchSize: 1000,
  loading: { ref, spec, calculators, loaders, costContext: ZERO },
  mold: { surfaceAreaMm2: shots.reduce((t, s) => t + s.input.surfaceArea, 0), designHoursFactor: MULTI_SHOT_DESIGN_HOURS_FACTOR, tryouts: 5 },
  onPress: (s, p) => ({
    ...s.input,
    mhrRate: { rate: p.machine.machineRatePerHr ?? 0, labourRate: p.machine.labourRatePerHr, operators: p.machine.operators ?? 1, source: 'mhr_database', machineClass: MULTI_SHOT_PRESS_CLASS, machineName: p.machine.name, commodityCode: null },
    machineClampTonnes: p.clampT, machineShotCapacityG: p.shotPerUnitG, pressTiming: p.timing, goodPartYield: 1,
  }),
  runEngine: (i) => computeInjectionMoldedCostSummary(i),
  cycle: (longest, load, index) => {
    const run = runReferenceCalculator(calculators, MULTI_SHOT_CYCLE_CALC, {
      'Longest Shot Cycle': { value: longest, source: 'test' }, 'Load Time': { value: load, source: 'test' }, 'Tool Index Time': { value: index, source: 'test' },
    }, 'Shot Cycle');
    return run.value == null ? null : { sec: run.value, trace: run.trace };
  },
  toLocal: (l) => l,
  appendLines,
});
// The 19 loaders of memory/Assembly plastic molding (migration 1085 gives them loading / max_payload).
const loaders: SandMachine[] = rows(join(DIR, 'Machines/machines_pick_and_place.csv')).map((r, i) => sandMachineFromRow({
  id: `loader-${i}`, machine_name: r['Name'], machine_class: 'assembly_plastic_molding_pick_and_place', location: 'USA',
  mhr_usd_per_hour: n(r['Direct Overhead Rate (USD / hr)']) + n(r['Indirect Overhead Rate (USD / hr)']),
  usd_labor_rate_per_hr: r['Labor Rate (USD / hr)'], operators: r['Number of Operators'], setup_time_hr: r['Setup Time (hr)'],
  specs: { max_payload: n(r['Max Payload (kg)']), loading: r['Loading Type'] },
}, () => null));

describe('the multi-shot presses (memory/, migration 1085)', () => {
  it('reads all 78: horizontal 2K, vertical 2K/3K/4K, 1 to 5 stations, each with its tool index time', () => {
    expect(presses).toHaveLength(78);
    expect(new Set(presses.map((p) => p.orientation))).toEqual(new Set(['Horizontal', 'Vertical']));
    expect(Math.max(...presses.map((p) => p.units))).toBe(4);
    const stack = presses.find((p) => p.machine.name === 'Horizontal Injection Molder | 2900kN | 2K | 1860g | 4 Station | Rotary Stack')!;
    expect(stack).toMatchObject({ units: 2, stations: 4, rotatingStack: true, indexSec: 2.5, shotPerUnitG: 1860 });
  });

  it('a press needs a unit and a station per shot, each shot within a unit, and the shots\' clamp together', () => {
    const p = presses.find((x) => x.machine.name === 'Horizontal Injection Molder | 1,000kN | 2K | 100g')!;
    expect(pressGaps(p, [{ clampT: 20, shotGppsG: 30, reason: null }, { clampT: 20, shotGppsG: 30, reason: null }])).toEqual(['2 shots need 2 mold stations; it has 1']);
    const two = presses.find((x) => x.machine.name === 'Horizontal Injection Molder | 1,000kN | 2K | 100g | 2 Station')!;
    expect(pressGaps(two, [{ clampT: 60, shotGppsG: 30, reason: null }, { clampT: 50, shotGppsG: 120, reason: null }])).toEqual([
      'a shot of 120 g GPPS is over a unit\'s 100 g',
      `the shots inject together and need 110 t of clamp; it has ${Math.round((1000 / 9.80665) * 100) / 100} t`,
    ]);
    expect(pressGaps(two, [{ clampT: 1, shotGppsG: 1, reason: null }, { clampT: 1, shotGppsG: 1, reason: null }, { clampT: 1, shotGppsG: 1, reason: null }]))
      .toEqual(['3 shots need 3 injection units; it has 2', '3 shots need 3 mold stations; it has 2']);
  });
});

describe('a PC substrate overmolded with TPE', () => {
  const shots = [shot('Substrate', 'Polycarbonate'), shot('Overmold', 'TPE', { volume: 8_000, surfaceArea: 9_000, signals: { projectedAreaMm2: 2500, undercutCount: 0 } })];
  const routes = price(shots);

  it('prices both orientations on their cheapest capable press, and quotes the cheaper', () => {
    expect(routes.map((r) => [r.key, r.complete])).toEqual([['horizontal', true], ['vertical', true]]);
    for (const r of routes) expect(r.press!.orientation).toBe(r.key === 'horizontal' ? 'Horizontal' : 'Vertical');
    const quoted = chooseMultiShotRoute(routes, null);
    expect(quoted.summary.totalCost).toBe(Math.min(...routes.map((r) => r.summary.totalCost)));
  });

  it('cycles the press for the longest shot, then its tool index time; the press line is Multi-Shot Molding at that cycle', () => {
    for (const r of routes) {
      expect(r.cycleSec).toBeCloseTo(Math.max(...r.shotCycles) + r.press!.indexSec, 1);
      const line = r.summary.processLines.find((l) => l.process === 'Multi-Shot Molding')!;
      expect(line.machineName).toBe(r.press!.machine.name);
      expect(line.physicsGap).toBeUndefined();
    }
  });

  it('carries both materials, each dried, and one multi-shot mold over both surfaces (design x1.2, 5 try-outs)', () => {
    const r = routes[0]!;
    const alone = computeInjectionMoldedCostSummary(shots[0]!.input);
    expect(r.summary.materialCost).toBeGreaterThan(alone.materialCost);
    expect(r.summary.processLines.some((l) => l.process === 'Material Drying (Overmold)') || r.summary.processLines.every((l) => !l.process.startsWith('Material Drying'))).toBe(true);
    const trace = r.summary.tooling?.calculationTrace ?? [];
    expect(trace.find((t) => t.fieldName === 'Part Surface Area')?.value).toBe(24_000);
    expect(trace.find((t) => t.fieldName === 'Number of Tryouts')?.value).toBe(5);
  });

  it('a component loaded every shot is Pick and Place on the reference\'s default robot (loadManualOrRobotic 6-Axis)', () => {
    const withPin = price(shots, [{ id: 'c', name: 'Steel pin', perPart: 2, massKg: 0.005, source: 'bom' }]);
    const r = withPin[0]!;
    const pick = r.summary.processLines.find((l) => l.process === 'Pick and Place')!;
    expect(pick.physicsGap).toBeUndefined();
    expect(r.loaderName).toMatch(/6-Axis|TX|LR Mate|Flexion|C8/);
    expect(r.loadSecPerPart).toBeCloseTo(2 * 6, 6); // 2 x tblComponentLoadTime Robotic 6 s (the 0.5 kg row)
  });
});

describe('what cannot be molded is named', () => {
  it('three shots: no horizontal press has three units, and the route says what the nearest lacks', () => {
    const three = price([shot('A', 'Polycarbonate'), shot('B', 'TPE'), shot('C', 'ABS')]);
    const h = three.find((r) => r.key === 'horizontal')!;
    expect(h.complete).toBe(false);
    const gapLine = h.summary.processLines.find((l) => l.process === 'Multi-Shot Molding')!;
    expect(gapLine.physicsGap && 'reason' in gapLine.physicsGap ? gapLine.physicsGap.reason : '').toMatch(/^No horizontal press molds the 3 shots \(nearest, .*3 shots need 3 injection units; it has 2/);
    expect(three.find((r) => r.key === 'vertical')!.complete).toBe(true);
  });
});

describe('the Cost Guide shots and the route ids', () => {
  it('reads the extra shots (grade and share of the volume), dropping what cannot be a shot', () => {
    expect(shotEntriesOf({ multiShotShots: [{ grade: 'TPE', volumePct: 30 }, { grade: '', volumePct: 20 }, { grade: 'ABS', volumePct: 100 }] })).toEqual([{ grade: 'TPE', volumePct: 30 }]);
    expect(shotEntriesOf({})).toEqual([]);
  });

  it('route ids round-trip', () => {
    expect(multiShotRouteKeyOf('ms-vertical')).toBe('vertical');
    expect(multiShotRouteKeyOf('im-insert-manual')).toBeNull();
  });

  it('the multi-shot design hours are 1.2 x the plain table in every cell (memory/Assembly plastic molding vs memory/Assembly molding)', () => {
    const multi = rows(join(DIR, 'Lookup/tblMultiShotMoldBaseDesignHrs.csv'));
    const plain = rows(join(MEMORY, 'Assembly molding/Lookup/tblMoldBaseDesignHrs.csv'));
    expect(multi).toHaveLength(plain.length);
    multi.forEach((m, i) => {
      for (const k of Object.keys(m).filter((c) => c !== 'Number of Cavities')) expect(n(m[k])).toBeCloseTo(n(plain[i]![k]) * MULTI_SHOT_DESIGN_HOURS_FACTOR, 2);
    });
  });
});
