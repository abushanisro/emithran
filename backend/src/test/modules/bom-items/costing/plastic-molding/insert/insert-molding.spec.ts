import { readdirSync } from 'fs';
import { join } from 'path';

import { sandMachineFromRow, type SandMachine } from '../../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { resolveSandReference } from '../../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { plasticMoldingCalculatorsByName } from '../../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import {
  assemblyMoldingCalculatorsByName, loadAssemblyMoldingCalculatorSpec,
} from '../../../../../../modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculator-spec';
import {
  INSERT_MOLDING_ROUTES, chooseInsertRoute, insertLoading, insertMoldingRouteId, insertMoldingRouteKeyOf, insertsOf, isTablePress, loadTimeRow,
  priceInsertRoutes, shotCycle, type MoldInsert,
} from '../../../../../../modules/bom-items/costing/plastic-molding/insert/insert-molding';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { realMaterialClamp, realPlasticReference, realPress, realResinInputs } from '../real-plastic-reference';

import type { AssemblyComponent } from '../../../../../../modules/bom-items/costing/assembly/assembly-joints';
import type { CostSummaryDto, ProcessLineCost } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const DIR = join(__dirname, '../../../../../../../../memory/Assembly molding');
const clean = (h: string) => h.replace(/^﻿/, '');
const rows = (rel: string) => readCsv(join(DIR, rel)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [clean(k), v])));

// The real memory/Assembly molding data, staged as the engine reads it.
const ref = resolveSandReference({
  variables: rows('variables_extract.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: null })),
  lookups: readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv'))
    .map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v]))) } })),
});
// The 19 insert loaders of memory/Assembly molding/Machines (a manual station, 3-axis and 6-axis robots), as HR Rates rows.
const loaders: SandMachine[] = rows('Machines/machines_insert_pick_and_place.csv').map((r, i) => sandMachineFromRow({
  id: `loader-${i}`, machine_name: r['Primary ID Name'], machine_class: 'assembly_molding_insert_pick_and_place', location: 'USA',
  mhr_usd_per_hour: Number(r['Direct Overhead Rate (USD / hr)']) + Number(r['Indirect Overhead Rate (USD / hr)']),
  usd_labor_rate_per_hr: r['Labor Rate (USD / hr)'], operators: r['Number of Operators'], setup_time_hr: r['Setup Time (hr)'],
  specs: { max_payload: Number(r['Max Payload']), loading: r.Loading },
}, () => null));
const spec = loadAssemblyMoldingCalculatorSpec();
const calculators = assemblyMoldingCalculatorsByName();
const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const insert = (perPart: number, massKg: number | null, name = 'M4 brass insert'): MoldInsert => ({ id: null, name, perPart, massKg, source: 'cost_guide' });
const route = (key: string) => INSERT_MOLDING_ROUTES.find((r) => r.key === key)!;
const load = (key: string, inserts: MoldInsert[]) => insertLoading({ ref, spec, calculators, inserts, route: route(key), loaders, batchSize: 1000, costContext: ZERO });
const gapOf = (l: ProcessLineCost) => (l.physicsGap && 'reason' in l.physicsGap ? l.physicsGap.reason : '');

describe('the inserts', () => {
  it('are the part\'s BOM children, else the Cost Guide\'s count and weight, else none', () => {
    const child = { id: 'c1', name: 'Brass nut', quantity: 4, massKg: 0.003 } as AssemblyComponent;
    expect(insertsOf([child], { insertMoldingInserts: { count: 9, weightKg: 1 } })).toEqual([{ id: 'c1', name: 'Brass nut', perPart: 4, massKg: 0.003, source: 'bom' }]);
    expect(insertsOf([], { insertMoldingInserts: { count: 2, weightKg: 0.01, name: 'Pin' } })).toEqual([{ id: null, name: 'Pin', perPart: 2, massKg: 0.01, source: 'cost_guide' }]);
    expect(insertsOf([], {})).toEqual([]);
  });

  it('with neither, are the insert candidates the CAD recognised, with no weight (R_M-0230-039_STIFFNER 2: 3 candidates, nothing entered)', () => {
    expect(insertsOf([], {}, 3)).toEqual([{ id: null, name: 'Insert candidate (CAD)', perPart: 3, massKg: null, source: 'cad' }]);
    // the BOM and the Cost Guide still win over the CAD
    expect(insertsOf([], { insertMoldingInserts: { count: 2 } }, 3)[0]).toMatchObject({ perPart: 2, source: 'cost_guide' });
    expect(insertsOf([], {}, 0)).toEqual([]);
    expect(insertsOf([], {}, null)).toEqual([]);
  });

  it('load by componentLoadTime: the first row of the method whose weight takes the insert', () => {
    expect(loadTimeRow(ref, 'Manual', 0.1)).toMatchObject({ 'Load Time (s)': 8, 'Weight (kg)': 0.2 });
    expect(loadTimeRow(ref, 'Robotic', 0.1)).toMatchObject({ 'Load Time (s)': 6, 'Weight (kg)': 0.5 });
    expect(loadTimeRow(ref, 'Manual', 2)).toMatchObject({ 'Load Time (s)': 18, 'Weight (kg)': 5 });
  });

  it('a rotary or shuttle table loads while it molds; no table does not', () => {
    expect([isTablePress('Rotary'), isTablePress('Shuttle'), isTablePress('No table'), isTablePress(null)]).toEqual([true, true, false, false]);
  });
});

describe('the loading, on the cheapest loader of the method that carries the inserts', () => {
  it('two 0.1 kg inserts by hand: 2 x 8 s x handlingMultiplier 1.15 x insertionMultiplier 1.2, at the manual station', () => {
    const l = load('manual', [insert(2, 0.1)]);
    expect(l.secPerPart).toBeCloseTo(2 * 8 * 1.15 * 1.2, 6);
    expect(l.step.machine?.name).toBe('Manual');
    expect(l.step.line.process).toBe('Insert Pick and Place');
  });

  it('by robot: 2 x 6 s, on the cheapest 3-axis robot; a 15 kg insert only on a robot that carries it', () => {
    expect(load('3_axis', [insert(2, 0.1)]).secPerPart).toBeCloseTo(12, 6);
    const heavy = load('6_axis', [insert(1, 15)]);
    expect(heavy.step.machine?.name).toBe('Staubli TX160L - 2535mm');
  });

  it('an insert with no weight loads in the lightest band of its method (Cannula Holder Right: 10 CAD candidates, no weight)', () => {
    expect(loadTimeRow(ref, 'Manual', null)).toMatchObject({ 'Load Time (s)': 8, 'Weight (kg)': 0.2 });
    const byHand = load('manual', [insert(10, null)]);
    expect(byHand.secPerPart).toBeCloseTo(10 * 8 * 1.15 * 1.2, 6);
    expect(byHand.step.line.physicsGap).toBeUndefined();
    // the robot must carry the top of that band (0.5 kg), and the trace says the band was assumed
    const byRobot = load('3_axis', [insert(10, null)]);
    expect(byRobot.secPerPart).toBeCloseTo(60, 6);
    expect(JSON.stringify(byRobot.step.line.calculationTrace)).toContain('no weight given, so the lightest band (up to 0.5 kg)');
  });

  it('no inserts: nothing to load, a $0 No Cost Feature that says so (never a refusal); an insert no robot of the method carries is a gap', () => {
    // Apply never fails (the user's decision 2026-11-20): what the part lacks is said once, plainly, and the molding is still priced.
    const none = load('manual', []);
    expect(none.secPerPart).toBe(0);
    expect(none.step.line).toMatchObject({ process: 'No Cost Feature', rateSource: 'no_cost_feature', totalCost: 0 });
    expect(none.step.line.physicsGap).toBeUndefined();
    expect(none.step.line.operation).toBe('Insert Pick and Place: the part has no inserts, so none are loaded or costed. Add them under it in the BOM, or their count and weight in the Cost Guide.');
    expect(gapOf(load('3_axis', [insert(1, 25)]).step.line)).toContain('payload does not carry the 25 kg insert');
  });
});

describe('the shot of an insert press', () => {
  const hook = (table: boolean) => shotCycle({ calculators, spec, loadSecPerPart: 11.04, tablePress: table, pressName: 'Magna V30' });
  it('a table press takes the longer of molding and loading (2 cavities load 22.08 s); with no table they add', () => {
    expect(hook(true)(20, 2)!.sec).toBeCloseTo(22.08, 6);
    expect(hook(true)(30, 2)!.sec).toBeCloseTo(30, 6);
    expect(hook(false)(20, 2)!.sec).toBeCloseTo(42.08, 6);
  });
});

describe('the injection engine with an insert press\'s shot', () => {
  const press = realPress('Arburg Allrounder 420 C 1300 - 350');
  const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
    volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040,
    materialSource: 'db', batchSize: 1000, family: 'plastic_molded',
    mhrRate: { rate: press.mhrUsd, labourRate: 30, source: 'mhr_database', machineClass: 'assembly_molding_insert_injection_molding', machineName: 'Insert press', commodityCode: null },
    deburrRate: { rate: 0, labourRate: 30, source: 'mhr_database', machineClass: 'deburring', machineName: null, commodityCode: null },
    inspectionRate: { rate: 0, labourRate: 30, source: 'mhr_database', machineClass: 'cmm', machineName: null, commodityCode: null },
    machineClampTonnes: press.maxTonnage, machineShotCapacityG: press.shotCapacityGrams, pressTiming: press.timing, goodPartYield: press.goodPartYield,
    calculators: plasticMoldingCalculatorsByName(), materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
    plasticReference: realPlasticReference(), location: 'USA', bboxMaxMm: 100, bboxMidMm: 100, bboxMinMm: 30, cadFaceCount: 900,
    signals: { projectedAreaMm2: 10_000, undercutCount: 0 }, ...over,
  });
  const moldLine = (s: CostSummaryDto) => s.processLines.find((l) => l.process === 'Insert Injection Molding')!;

  it('names the press line Insert Injection Molding, and times it by the shot the hook returns, its steps after the cycle\'s', () => {
    const plain = moldLine(computeInjectionMoldedCostSummary(part()));
    let seen: [number, number] | null = null;
    const withShot = moldLine(computeInjectionMoldedCostSummary(part({
      shotCycle: (mold, cavities) => { seen = [mold, cavities]; return { sec: mold + 10, trace: [{ fieldName: 'Shot Cycle', displayLabel: 'Shot Cycle', kind: 'calculated', value: mold + 10 }] }; },
    })));
    expect(seen).not.toBeNull();
    const [, cavities] = seen!;
    expect(withShot.cycleTimeMin * 60).toBeCloseTo(plain.cycleTimeMin * 60 + 10 / cavities / (press.goodPartYield ?? 1), 1);
    expect(withShot.calculationTrace!.at(-1)!.fieldName).toBe('Shot Cycle');
  });
});

describe('the routes', () => {
  const base = { cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0 } } as unknown as CostSummaryDto;
  const engine = (shot: ReturnType<typeof shotCycle> | null) => {
    const sec = shot ? shot(20, 2)!.sec : 20;
    return { ...base, processLines: [{ process: 'Insert Injection Molding', totalCost: sec / 100, cycleTimeMin: sec / 120 }], totalCost: sec / 100, totalProcessCost: sec / 100 } as unknown as CostSummaryDto;
  };
  const append = (dto: CostSummaryDto, lines: ProcessLineCost[]) => ({ ...dto, processLines: [...dto.processLines, ...lines], totalCost: dto.totalCost + lines.reduce((s, l) => s + l.totalCost, 0) });
  const price = (inserts: MoldInsert[], tablePress = true) => priceInsertRoutes({
    ref, spec, calculators, inserts, loaders, batchSize: 1000, costContext: ZERO, press: { name: 'Magna V30', tablePress }, toLocal: (l) => l, runEngine: engine, appendLines: append,
  });

  it('prices every load method: the press shot overlaps the load on a table press, and each route carries its loader', () => {
    const routes = price([insert(2, 0.1)]);
    expect(routes.map((r) => [r.key, r.complete, r.loaderName])).toEqual([['manual', true, 'Manual'], ['3_axis', true, expect.any(String)], ['6_axis', true, expect.any(String)]]);
    const manual = routes[0];
    expect(manual.moldingCycleSec).toBe(20);
    expect(manual.shotSec).toBeCloseTo(Math.max(20, 2 * 2 * 8 * 1.15 * 1.2), 2);
    expect(manual.summary.processLines.map((l) => l.process)).toEqual(['Insert Injection Molding', 'Insert Pick and Place']);
  });

  it('the loader line lists its catalog operation for each insert: Manual Load by hand, Robotic Load by robot', () => {
    const routes = price([insert(2, 0.1)]);
    const loads = (key: string) => routes.find((r) => r.key === key)!.summary.processLines.at(-1)!.catalogOperations;
    expect(loads('manual')).toEqual([expect.objectContaining({ operations: ['Manual Load'], featureType: 'AssemblyComponentGcd', variant: 'M4 brass insert', count: 2, status: 'resolved' })]);
    expect(loads('6_axis')![0]!.operations).toEqual(['Robotic Load']);
    expect(price([])[0]!.summary.processLines.at(-1)!.catalogOperations).toBeUndefined();
  });

  it('quotes the cheapest complete route, or the one set; ids round-trip', () => {
    const routes = price([insert(2, 0.1)]);
    const cheapest = [...routes].sort((a, b) => a.summary.totalCost - b.summary.totalCost)[0];
    expect(chooseInsertRoute(routes, null).key).toBe(cheapest.key);
    expect(chooseInsertRoute(routes, '6_axis').key).toBe('6_axis');
    expect(INSERT_MOLDING_ROUTES.map((r) => insertMoldingRouteKeyOf(insertMoldingRouteId(r.key)))).toEqual(['manual', '3_axis', '6_axis']);
  });

  it('with no inserts every route is the molding alone, complete, with the loading a No Cost Feature saying why', () => {
    const routes = price([]);
    expect(routes.every((r) => r.complete)).toBe(true);
    expect(routes[0].summary.processLines.at(-1)!).toMatchObject({ process: 'No Cost Feature', totalCost: 0 });
    expect(routes[0].summary.processLines.at(-1)!.operation).toContain('no inserts');
  });
});
