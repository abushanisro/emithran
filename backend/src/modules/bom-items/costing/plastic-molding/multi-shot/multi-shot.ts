// Multi-shot molding (memory/Assembly plastic molding; decisions 2026-11-19): two or three materials molded one onto another on a 2K/3K
// multi-shot press. Pure.
//   - the shots: the part's BOM children that are moldable plastics (each its own CAD and material), else the part and the Cost Guide's extra
//     materials (each a share of the part's volume);
//   - the press: one route per orientation (horizontal, vertical), each on the cheapest press of that orientation that molds the shots: an
//     injection unit and a station per shot, each shot within a unit's capacity, the shots' clamp together within its clamp;
//   - the cycle: every station molds at once, so the press waits for the longest shot (each timed by the injection engine with its own
//     material), or the loading of the components, then indexes (the press's tool index time);
//   - the components: the part's other BOM children (metal, bought parts), loaded by Pick and Place (tblComponentLoadTime);
//   - one multi-shot mold: every shot's surface, the multi-shot design hours and try-outs.
import { INSERT_MOLDING_ROUTES, insertLoading, type LoadingStep, type MoldInsert } from '../insert/insert-molding';
import { MULTI_SHOT_PROCESS_GROUP } from '../../shared/core/part-family-process-group';
import { gap } from '../../casting/casting-finishing';

import type { CalculationTraceStep, CostSummaryDto, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CostContext } from '../../casting/casting-finishing';
import type { SandMachine } from '../../casting/sand/sand-machines';
import type { SandReference } from '../../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';
import type { InjectionMoldingCostInput } from '../process/cost-injection-molding-engine';

export { MULTI_SHOT_PROCESS_GROUP };

export const MULTI_SHOT_DOMAIN = 'assembly_plastic_molding';
export const MULTI_SHOT_PRESS_CLASS = 'assembly_plastic_molding_multi_shot_molding';
export const MULTI_SHOT_LOADER_CLASS = 'assembly_plastic_molding_pick_and_place';
export const COMPONENT_LOADING_CALC = 'Assembly Plastic Molding - Component loading';
export const MULTI_SHOT_CYCLE_CALC = 'Assembly Plastic Molding - Multi-shot cycle';

/** The Cost Guide keys of a multi-shot part. */
export const MULTI_SHOT_ROUTE_KEY = 'multiShotRoute';
export const MULTI_SHOT_SHOTS_KEY = 'multiShotShots';

/** tblMultiShotMoldBaseDesignHrs is this multiple of the plain mold base design hours in every cell (memory/; the data spec checks it). */
export const MULTI_SHOT_DESIGN_HOURS_FACTOR = 1.2;

/** The press orientations, each a route (defaultMultiShotMoldingMachineOrientation "No Preference": both are priced, the cheapest quoted). */
export const MULTI_SHOT_ROUTES = [
  { key: 'horizontal', label: 'Multi-shot · horizontal press', orientation: 'Horizontal' },
  { key: 'vertical', label: 'Multi-shot · vertical press', orientation: 'Vertical' },
] as const;
export type MultiShotRouteKey = (typeof MULTI_SHOT_ROUTES)[number]['key'];
export const multiShotRouteId = (key: string) => `ms-${key}`;
export const MULTI_SHOT_ROUTE_IDS: readonly string[] = MULTI_SHOT_ROUTES.map((r) => multiShotRouteId(r.key));
export const multiShotRouteKeyOf = (routeId: string): MultiShotRouteKey | null =>
  MULTI_SHOT_ROUTES.find((r) => multiShotRouteId(r.key) === routeId)?.key ?? null;

/** Pick and Place of a multi-shot part: the components loaded every shot, with insert molding's loading code and this process's table. */
export const COMPONENT_LOADING_STEP: LoadingStep = {
  process: 'Pick and Place', processGroup: MULTI_SHOT_PROCESS_GROUP, machineClass: MULTI_SHOT_LOADER_CLASS,
  calculator: COMPONENT_LOADING_CALC, domain: MULTI_SHOT_DOMAIN, loadTimeTable: 'tblComponentLoadTime', noun: 'component',
};

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A multi-shot press as the engine reads it (its HR Rates row; the attributes are migration 1085's). */
/** The press's HR Rates timing (dry cycle, injection rate, good-part yield), as the injection engine reads it. */
type PressRecord = NonNullable<InjectionMoldingCostInput['pressTiming']> & { goodPartYield?: number | null };

export interface MultiShotPress {
  machine: SandMachine;
  orientation: string;
  units: number;
  stations: number;
  rotatingStack: boolean;
  indexSec: number;
  clampT: number;
  shotPerUnitG: number;
  timing: PressRecord | null;
}

/** The press of a row, or null when the row has no multi-shot attributes (migration 1085 not run). */
export function multiShotPressOf(machine: SandMachine, typed: { maxTonnage: number | null; shotCapacityG: number | null }, timing: PressRecord | null): MultiShotPress | null {
  const s = machine.specs;
  const units = num(s['injection_units']);
  const stations = num(s['stations']);
  const indexSec = num(s['tool_index_time_s']);
  if (units == null || stations == null || indexSec == null || typed.maxTonnage == null || typed.shotCapacityG == null) return null;
  return {
    machine, orientation: String(s['orientation'] ?? ''), units, stations, rotatingStack: s['rotating_stack'] === true,
    indexSec, clampT: typed.maxTonnage, shotPerUnitG: typed.shotCapacityG, timing,
  };
}

/** One shot: its material and geometry, as the injection engine takes them. */
export interface MultiShotShot {
  name: string;
  source: 'bom' | 'part' | 'cost_guide';
  itemId: string | null;
  grade: string | null;
  /** Its share of the part's volume (%), for a Cost Guide shot; null for a BOM shot (its own CAD). */
  volumePct: number | null;
  input: InjectionMoldingCostInput;
}

/** What a shot needs of a press: the clamp (t) and the GPPS-equivalent shot (g) the injection engine derives from it; null when not derivable. */
export interface ShotNeed { clampT: number | null; shotGppsG: number | null; reason: string | null }

/** The Cost Guide's extra shots of a part with no shot children: each a material grade and its share of the part's volume. */
export interface ShotEntry { grade: string; volumePct: number }

export function shotEntriesOf(overrides: Record<string, unknown> | null | undefined): ShotEntry[] {
  const raw = overrides?.[MULTI_SHOT_SHOTS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const pct = num(r['volumePct']);
    return typeof r['grade'] === 'string' && r['grade'].trim() && pct != null && pct > 0 && pct < 100 ? [{ grade: r['grade'].trim(), volumePct: pct }] : [];
  });
}

/** Why `press` cannot mold the shots (empty when it can): a unit and a station per shot, each shot within a unit, their clamp together. */
export function pressGaps(press: MultiShotPress, needs: readonly ShotNeed[]): string[] {
  const n = needs.length;
  const gaps: string[] = [];
  if (press.units < n) gaps.push(`${n} shots need ${n} injection units; it has ${press.units}`);
  if (press.stations < n) gaps.push(`${n} shots need ${n} mold stations; it has ${press.stations}`);
  const biggest = Math.max(...needs.map((s) => s.shotGppsG ?? 0));
  if (biggest > press.shotPerUnitG) gaps.push(`a shot of ${r2(biggest)} g GPPS is over a unit's ${press.shotPerUnitG} g`);
  const clamp = needs.reduce((t, s) => t + (s.clampT ?? 0), 0);
  if (clamp > press.clampT) gaps.push(`the shots inject together and need ${r2(clamp)} t of clamp; it has ${r2(press.clampT)} t`);
  return gaps;
}

/** One orientation's route: the quote on its cheapest capable press, or why it has none. */
export interface MultiShotRoute {
  key: MultiShotRouteKey;
  label: string;
  summary: CostSummaryDto;
  complete: boolean;
  press: MultiShotPress | null;
  /** Each shot's injection cycle (s) on the press, in shot order; empty without a press. */
  shotCycles: number[];
  cycleSec: number | null;
  loaderName: string | null;
  loadSecPerPart: number | null;
}

export const isGapLine = (l: ProcessLineCost) => l.physicsGap != null;

/** The multi-shot cycle calculator run: max(the longest shot, the loading) + the tool index time; null when it could not run. */
export type CycleRun = (longestShotSec: number, loadSec: number, indexSec: number) => { sec: number; trace: CalculationTraceStep[] } | null;

/**
 * Every orientation's route. A route prices each capable press of its orientation (every shot by `runEngine` on it) and keeps the cheapest
 * complete quote; with none capable, the molding is a named gap that says what the nearest press lacks.
 */
export function priceMultiShotRoutes(input: {
  shots: readonly MultiShotShot[];
  needs: readonly ShotNeed[];
  presses: readonly MultiShotPress[];
  components: readonly MoldInsert[];
  loading: { ref: SandReference; spec: DomainCalculatorSpec; calculators: Readonly<Record<string, ReferenceCalculatorDef>>; loaders: readonly SandMachine[]; costContext: CostContext };
  batchSize: number;
  mold: NonNullable<InjectionMoldingCostInput['multiShotMold']>;
  /** The shot's input on the press: its rate, clamp, shot capacity, timing and yield. */
  onPress: (shot: MultiShotShot, press: MultiShotPress) => InjectionMoldingCostInput;
  runEngine: (input: InjectionMoldingCostInput) => CostSummaryDto;
  cycle: CycleRun;
  /** USD -> the factory currency the engine's lines are in (the loader is priced in USD). */
  toLocal: (line: ProcessLineCost) => ProcessLineCost;
  appendLines: (dto: CostSummaryDto, lines: ProcessLineCost[]) => CostSummaryDto;
}): MultiShotRoute[] {
  // The components load by the reference's default method (loadManualOrRobotic: 6-Axis), on the cheapest loader of that method.
  const method = (input.loading.ref.text('loadManualOrRobotic') ?? '6-Axis').toLowerCase();
  const loadRoute = INSERT_MOLDING_ROUTES.find((r) => r.loading === method) ?? INSERT_MOLDING_ROUTES[2];
  const loading = input.components.length > 0
    ? insertLoading({ ...input.loading, inserts: input.components, route: loadRoute, batchSize: input.batchSize, step: COMPONENT_LOADING_STEP })
    : null;
  const loadSec = loading?.secPerPart ?? 0;

  const priceOn = (press: MultiShotPress) => {
    // The other shots first: their own injection cycles on this press (the engine's, unchanged: the hook only records it).
    const others = input.shots.slice(1).map((shot) => {
      let mold: number | null = null;
      const summary = input.runEngine({ ...input.onPress(shot, press), shotCycle: (sec) => { mold = sec; return null; } });
      return { shot, summary, mold: mold as number | null };
    });
    // The first shot carries the press line, timed by the multi-shot cycle over every shot and the mold that holds them all.
    let first: number | null = null;
    let cycleSec: number | null = null;
    const base = input.runEngine({
      ...input.onPress(input.shots[0]!, press),
      multiShotMold: input.mold,
      shotCycle: (sec, cavities) => {
        first = sec;
        const run = input.cycle(Math.max(sec, ...others.map((o) => o.mold ?? 0)), loadSec * cavities, press.indexSec);
        cycleSec = run?.sec ?? null;
        return run;
      },
    });
    const extra: ProcessLineCost[] = [];
    for (const o of others) {
      // A shot its press cannot mold, or its material cannot, makes the route incomplete: its molding line's gap, named for the shot.
      const molding = o.summary.processLines.find((l) => l.machineClass === MULTI_SHOT_PRESS_CLASS);
      if (molding?.physicsGap) extra.push({ ...gap(`Multi-Shot Molding (${o.shot.name})`, MULTI_SHOT_PROCESS_GROUP, MULTI_SHOT_PRESS_CLASS, 'reason' in molding.physicsGap ? molding.physicsGap.reason : 'not costed') });
      // Each material is dried by its own dryer.
      extra.push(...o.summary.processLines.filter((l) => l.process === 'Material Drying').map((l) => ({ ...l, process: `Material Drying (${o.shot.name})` })));
    }
    if (loading) extra.push(input.toLocal(loading.step.line));
    let summary = input.appendLines(base, extra);
    // Every shot's material is in the part.
    const otherMaterial = others.reduce((t, o) => t + o.summary.materialCost, 0);
    summary = { ...summary, materialCost: summary.materialCost + otherMaterial, totalCost: summary.totalCost + otherMaterial };
    return {
      summary, complete: !summary.processLines.some(isGapLine), press,
      shotCycles: [first, ...others.map((o) => o.mold)].map((s) => (s == null ? 0 : r2(s))),
      cycleSec: cycleSec != null ? r2(cycleSec) : null,
    };
  };

  return MULTI_SHOT_ROUTES.map((route) => {
    const pool = input.presses.filter((p) => p.orientation === route.orientation);
    const capable = pool.filter((p) => pressGaps(p, input.needs).length === 0);
    const priced = capable.map(priceOn).sort((a, b) => Number(b.complete) - Number(a.complete) || a.summary.totalCost - b.summary.totalCost);
    const best = priced[0];
    const loader = { loaderName: loading?.step.machine?.name ?? null, loadSecPerPart: loading?.secPerPart != null ? r2(loading.secPerPart) : null };
    if (best) return { key: route.key, label: route.label, ...best, ...loader };
    // No press of this orientation molds the shots: the nearest (fewest shortfalls, then the smallest) says what it lacks.
    const nearest = [...pool].sort((a, b) => pressGaps(a, input.needs).length - pressGaps(b, input.needs).length || a.clampT - b.clampT)[0];
    const why = pool.length === 0 ? `no ${route.orientation.toLowerCase()} multi-shot press on file for this location`
      : `no ${route.orientation.toLowerCase()} press molds the ${input.shots.length} shots (nearest, ${nearest!.machine.name}: ${pressGaps(nearest!, input.needs).join('; ')})`;
    const base = input.runEngine(input.shots[0]!.input);
    const summary = input.appendLines({ ...base, processLines: base.processLines.filter((l) => l.machineClass !== MULTI_SHOT_PRESS_CLASS && l.process !== 'Injection Molding') },
      [gap('Multi-Shot Molding', MULTI_SHOT_PROCESS_GROUP, MULTI_SHOT_PRESS_CLASS, `${why[0]!.toUpperCase()}${why.slice(1)}.`)]);
    return { key: route.key, label: route.label, summary, complete: false, press: null, shotCycles: [], cycleSec: null, ...loader };
  });
}

/** The route to quote: the one forced (route comparison) or set in the Cost Guide, else the cheapest complete one, else the fewest gaps. */
export function chooseMultiShotRoute(routes: readonly MultiShotRoute[], chosen: string | null | undefined): MultiShotRoute {
  const set = routes.find((r) => r.key === chosen);
  if (set) return set;
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.summary.totalCost - b.summary.totalCost);
  return complete[0] ?? [...routes].sort((a, b) => a.summary.processLines.filter(isGapLine).length - b.summary.processLines.filter(isGapLine).length)[0]!;
}
