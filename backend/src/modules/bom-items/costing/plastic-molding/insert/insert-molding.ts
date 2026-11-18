// Assembly Molding (insert molding): a plastic part molded around inserts that are loaded into the mold every shot. Pure.
//
// The molding is injection molding on an insert press: the injection engine prices it (computeInjectionMoldedCostSummary) with the insert
// press's rate, clamp, shot and dry cycle, and this module supplies what insert molding adds:
//   - the inserts: the part's BOM children (each with its quantity and weight), or the Cost Guide's count and weight when it has none;
//   - the loading: each insert's componentLoadTime by its weight and the load method, on the cheapest loader of that method (a manual
//     station, a 3-axis or a 6-axis robot that carries the heaviest insert);
//   - the shot: on a press with a rotary or shuttle table the next lower mold half is loaded while the other is molded, so the shot takes
//     the longer of the two; with no table the two add (calculator "Assembly Molding - Shot cycle").
// One route per load method; the cheapest complete one is quoted unless the Cost Guide (or the Workflow Builder) names one.
import { machineText, machineValue, type SandMachine } from '../../casting/sand/sand-machines';
import { seedsFor, type SeedProvider } from '../../casting/sand/sand-seeds';
import { gap } from '../../casting/casting-finishing';
import { selectAndCost, type CostedStep } from '../../casting/sand/sand-steps';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';
import { INSERT_MOLDING_PROCESS_GROUP } from '../../shared/core/part-family-process-group';

import type { CalculationTraceStep, CostSummaryDto, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { AssemblyComponent } from '../../assembly/assembly-joints';
import type { CostContext } from '../../casting/casting-finishing';
import type { SandReference } from '../../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';

export { INSERT_MOLDING_PROCESS_GROUP };

export const INSERT_MOLDING_DOMAIN = 'assembly_molding';
export const INSERT_PRESS_CLASS = 'assembly_molding_insert_injection_molding';
export const INSERT_LOADER_CLASS = 'assembly_molding_insert_pick_and_place';
export const INSERT_LOADING_CALC = 'Assembly Molding - Insert loading';
export const SHOT_CYCLE_CALC = 'Assembly Molding - Shot cycle';

/** The Cost Guide keys of an insert-molded part. */
export const INSERT_MOLDING_ROUTE_KEY = 'insertMoldingRoute';
export const INSERT_MOLDING_INSERTS_KEY = 'insertMoldingInserts';

/** The load methods, each a route: the loaders' `loading` spec and componentLoadTime's Load Method. */
export const INSERT_MOLDING_ROUTES = [
  { key: 'manual', label: 'Insert molding · manual load', loading: 'manual', method: 'Manual' },
  { key: '3_axis', label: 'Insert molding · 3-axis robot', loading: '3-axis', method: 'Robotic' },
  { key: '6_axis', label: 'Insert molding · 6-axis robot', loading: '6-axis', method: 'Robotic' },
] as const;
export type InsertMoldingRouteKey = (typeof INSERT_MOLDING_ROUTES)[number]['key'];
export const insertMoldingRouteId = (key: string) => `im-insert-${key.replace('_', '-')}`;
export const INSERT_MOLDING_ROUTE_IDS: readonly string[] = INSERT_MOLDING_ROUTES.map((r) => insertMoldingRouteId(r.key));
export const insertMoldingRouteKeyOf = (routeId: string): InsertMoldingRouteKey | null =>
  INSERT_MOLDING_ROUTES.find((r) => insertMoldingRouteId(r.key) === routeId)?.key ?? null;

/** One insert as the loading takes it: how many go in each part, and one's mass. */
export interface MoldInsert {
  id: string | null;
  name: string;
  perPart: number;
  massKg: number | null;
  /** Where the insert is defined: a BOM child, or the Cost Guide's entry. */
  source: 'bom' | 'cost_guide';
}

type Row = Readonly<Record<string, unknown>>;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The part's inserts: its BOM children, else the Cost Guide's count and weight; none when neither is given. */
export function insertsOf(children: readonly AssemblyComponent[], overrides: Record<string, unknown> | null | undefined): MoldInsert[] {
  if (children.length > 0) return children.map((c) => ({ id: c.id, name: c.name, perPart: c.quantity, massKg: c.massKg, source: 'bom' }));
  const entry = (overrides?.[INSERT_MOLDING_INSERTS_KEY] ?? null) as Row | null;
  const count = num(entry?.count);
  if (count == null || !(count > 0)) return [];
  const weight = num(entry?.weightKg);
  return [{ id: null, name: typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Insert', perPart: Math.round(count), massKg: weight != null && weight > 0 ? weight : null, source: 'cost_guide' }];
}

/** The componentLoadTime row for an insert: the first of the method whose weight takes it. */
export function loadTimeRow(ref: SandReference, method: 'Manual' | 'Robotic', massKg: number): Row | null {
  const rows = ref.table('componentLoadTime').filter((r) => r['Load Method'] === method).sort((a, b) => num(a['Weight (kg)'])! - num(b['Weight (kg)'])!);
  return rows.find((r) => num(r['Weight (kg)'])! >= massKg && num(r['Weight (kg)'])! > 0) ?? null;
}

/** Whether a press loads while it molds: a rotary or shuttle table carries a second lower mold half. */
export const isTablePress = (tableConfiguration: string | null | undefined): boolean => /^(rotary|shuttle)$/i.test((tableConfiguration ?? '').trim());

export interface InsertLoading {
  /** The loader line (Insert Pick and Place), costed on the cheapest loader of the method, or a named gap. */
  step: CostedStep;
  /** The loading time per part (s), the shot cycle's load; null when it could not be timed. */
  secPerPart: number | null;
}

/** The loading of a part's inserts by one method: the time per part from componentLoadTime, on the cheapest loader that carries them. */
export function insertLoading(input: {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  inserts: readonly MoldInsert[];
  route: (typeof INSERT_MOLDING_ROUTES)[number];
  loaders: readonly SandMachine[];
  batchSize: number;
  costContext: CostContext;
}): InsertLoading {
  const { ref, inserts, route } = input;
  const variable: SeedProvider = (name) => {
    const value = ref.number(name);
    return value == null ? null : { value, source: `Assembly Molding variable ${name}`, ref: { kind: 'variable', domain: INSERT_MOLDING_DOMAIN, name } };
  };
  const heaviest = Math.max(0, ...inserts.map((i) => i.massKg ?? 0));
  const unweighed = inserts.filter((i) => i.massKg == null).map((i) => i.name);
  // Each insert's load time, from its own componentLoadTime row; the per-part load is their sum over the inserts of the part.
  const rows = inserts.map((i) => ({ insert: i, row: i.massKg != null ? loadTimeRow(ref, route.method, i.massKg) : null }));
  const loadSec = rows.reduce((s, { insert, row }) => s + insert.perPart * (num(row?.['Load Time (s)']) ?? 0), 0);
  const loadSeed: CalcSeed = {
    value: loadSec,
    source: `componentLoadTime (${route.method}): ${rows.map(({ insert, row }) => `${insert.perPart} x ${insert.name} at ${String(insert.massKg)} kg, ${String(row?.['Load Time (s)'])} s`).join('; ')}`,
    lookup: true,
    ...(rows[0]?.row ? { ref: { kind: 'lookup' as const, domain: INSERT_MOLDING_DOMAIN, table: 'componentLoadTime', column: 'Load Time (s)', row: { 'Load Method': route.method, 'Weight (kg)': num(rows[0].row['Weight (kg)'])! } } } : {}),
  };
  // What the part lacks is not a machine's limit: it is said once, plainly, instead of as every loader failing ("no loader fits (X: ...)").
  const missingRow = rows.find((x) => !x.row);
  const partGap = inserts.length === 0 ? 'The part has no inserts: add them under it in the BOM, or their count and weight in the Cost Guide.'
    : unweighed.length ? `The weight of ${unweighed.join(', ')} is not known: set it (or its material) in the BOM, or in the Cost Guide.`
    : missingRow ? `componentLoadTime has no ${route.method} row for ${missingRow.insert.name} at ${String(missingRow.insert.massKg)} kg.`
    : null;
  if (partGap) {
    return { step: { line: gap('Insert Pick and Place', INSERT_MOLDING_PROCESS_GROUP, INSERT_LOADER_CLASS, partGap), machine: null, outcome: null, warnings: [] }, secPerPart: null };
  }
  const calc = input.spec.calculators.find((c) => c.name === INSERT_LOADING_CALC)!;
  const step = selectAndCost({
    process: 'Insert Pick and Place', machineClass: INSERT_LOADER_CLASS,
    machines: input.loaders.filter((m) => machineText(m, 'loading') === route.loading),
    criteria: [`A ${route.loading} loader`, 'Its payload carries the heaviest insert (a manual station has no limit)'],
    batchSize: input.batchSize, costContext: input.costContext, ref, partName: 'part', processGroup: INSERT_MOLDING_PROCESS_GROUP,
    evaluate: (m) => {
      const payload = machineValue(m, 'max_payload') ?? 0;
      if (route.loading !== 'manual' && payload < heaviest) return { ok: false, reasons: [`its ${payload} kg payload does not carry the ${heaviest} kg insert`] };
      const { seeds, missing } = seedsFor(calc, {
        variable,
        engine: (key) => (key.startsWith('load_time_s') ? loadSeed : key.startsWith('manual') ? { value: route.loading === 'manual' ? 1 : 0, source: route.loading === 'manual' ? 'a manual load' : `a ${route.loading} robot` } : null),
      });
      if (missing.length) return { ok: false, reasons: missing.map((x) => `${INSERT_LOADING_CALC}: ${x}`) };
      const run = runReferenceCalculator(input.calculators, INSERT_LOADING_CALC, seeds, calc.output ?? 'Cycle Time');
      if (run.value == null) return { ok: false, reasons: run.missing };
      return { ok: true, sec: run.value, run, energyCostUsd: 0, notes: [] };
    },
  });
  // The chosen loader's run is the one priced.
  return { step, secPerPart: step.outcome ? step.outcome.sec : null };
}

/**
 * The shot of an insert press: the injection cycle and the shot's insert loading (the part's load times the cavities), overlapped on a
 * table press. What the injection engine's shotCycle hook returns.
 */
export function shotCycle(input: {
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  spec: DomainCalculatorSpec;
  loadSecPerPart: number;
  tablePress: boolean;
  pressName: string | null;
}): (moldingCycleSec: number, cavities: number) => { sec: number; trace: CalculationTraceStep[]; run: ReferenceCalcRun } | null {
  return (moldingCycleSec, cavities) => {
    const calc = input.spec.calculators.find((c) => c.name === SHOT_CYCLE_CALC);
    if (!calc) return null;
    const values: Record<string, CalcSeed> = {
      molding_cycle_s: { value: moldingCycleSec, source: 'the injection cycle of the shot (Injection Molding - Cycle Time)' },
      insert_load_s: { value: r2(input.loadSecPerPart * cavities), source: `the insert loading of the part x ${cavities} cavit${cavities === 1 ? 'y' : 'ies'}` },
      table_press: { value: input.tablePress ? 1 : 0, source: input.tablePress ? `${input.pressName ?? 'the press'} has a rotary or shuttle table: it loads while it molds` : `${input.pressName ?? 'the press'} has no table: it loads with the mold open` },
    };
    const { seeds, missing } = seedsFor(calc, { engine: (key) => values[key.split(' (')[0].trim()] ?? null });
    if (missing.length) return null;
    const run = runReferenceCalculator(input.calculators, SHOT_CYCLE_CALC, seeds, calc.output ?? 'Shot Cycle');
    return run.value == null ? null : { sec: run.value, trace: run.trace, run };
  };
}

export const isGapLine = (l: ProcessLineCost) => l.physicsGap != null;

/** One load method's route: the injection quote on the insert press with the loading overlapped, and the loader line. */
export interface InsertRoute {
  key: InsertMoldingRouteKey;
  label: string;
  summary: CostSummaryDto;
  complete: boolean;
  loaderName: string | null;
  loadSecPerPart: number | null;
  moldingCycleSec: number | null;
  shotSec: number | null;
}

/**
 * Every load method's route. `runEngine` prices the molding on the insert press (the injection engine) with the shot hook it is given, or
 * none when the loading could not be timed; `appendLines` adds the loader line to that quote (totals, cycle and completeness follow).
 */
export function priceInsertRoutes(input: {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  inserts: readonly MoldInsert[];
  loaders: readonly SandMachine[];
  batchSize: number;
  costContext: CostContext;
  press: { name: string | null; tablePress: boolean };
  /** USD -> the factory currency the engine's lines are in (the loader is priced in USD, as HR Rates are). */
  toLocal: (line: ProcessLineCost) => ProcessLineCost;
  runEngine: (shot: ReturnType<typeof shotCycle> | null) => CostSummaryDto;
  appendLines: (dto: CostSummaryDto, lines: ProcessLineCost[]) => CostSummaryDto;
}): InsertRoute[] {
  return INSERT_MOLDING_ROUTES.map((route) => {
    const loading = insertLoading({ ...input, route });
    // What the engine's shot hook computed, kept for the panel (the shot and the molding cycle under it).
    const seen: { moldingCycleSec: number | null; shotSec: number | null } = { moldingCycleSec: null, shotSec: null };
    const hook = loading.secPerPart != null ? shotCycle({ ...input, loadSecPerPart: loading.secPerPart, tablePress: input.press.tablePress, pressName: input.press.name }) : null;
    const recorded = hook ? (mold: number, cavities: number) => {
      const out = hook(mold, cavities);
      seen.moldingCycleSec = mold;
      seen.shotSec = out?.sec ?? null;
      return out;
    } : null;
    // The loader's catalog operations (memory/Assembly molding operations.csv: Insert Pick and Place:Manual Load // AssemblyComponentGcd, Robotic Load):
    // one per insert, loaded the route's way.
    const loadOperation = route.method === 'Manual' ? 'Manual Load' : 'Robotic Load';
    const loaderLine: ProcessLineCost = {
      ...input.toLocal(loading.step.line),
      ...(input.inserts.length ? {
        catalogOperations: input.inserts.map((i) => ({
          operations: [loadOperation], featureType: 'AssemblyComponentGcd', variant: i.name, diameterMm: null, count: i.perPart,
          featureIds: [], status: 'resolved' as const, children: [],
        })),
      } : {}),
    };
    const summary = input.appendLines(input.runEngine(recorded), [loaderLine]);
    return {
      key: route.key, label: route.label, summary, complete: !summary.processLines.some(isGapLine),
      loaderName: loading.step.machine?.name ?? null, loadSecPerPart: loading.secPerPart != null ? r2(loading.secPerPart) : null,
      moldingCycleSec: seen.moldingCycleSec != null ? r2(seen.moldingCycleSec) : null, shotSec: seen.shotSec != null ? r2(seen.shotSec) : null,
    };
  });
}

/** The route to quote: the one forced (route comparison) or set in the Cost Guide, else the cheapest complete one, else the fewest gaps. */
export function chooseInsertRoute(routes: readonly InsertRoute[], chosen: string | null | undefined): InsertRoute {
  const set = routes.find((r) => r.key === chosen);
  if (set) return set;
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.summary.totalCost - b.summary.totalCost);
  return complete[0] ?? [...routes].sort((a, b) => a.summary.processLines.filter(isGapLine).length - b.summary.processLines.filter(isGapLine).length)[0];
}
