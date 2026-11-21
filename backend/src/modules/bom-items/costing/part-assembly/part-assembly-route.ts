// A weldment's routes, priced on the staged memory/Part Assembly data and the Part Assembly calculators (migration 1100). Pure.
//
// What is costed is the welding: each weld process of the weld table (part-assembly-welds.ts) is one line, its welds' calculator runs summed,
// on the cheapest capable machine of the location. The first welding step loads the components (componentLoadTime_<process>, by each one's
// weight), a later one loads the weldment as one piece, and each unloads the weldment (unloadWeldmentAllowance_<process>, by its weight); the
// laser loads, unloads and indexes by its machine's own times. Bevel cutting before, grinding, finish grinding and wire brushing after run
// along the welds flagged for them. The components themselves are not costed here: the BOM roll-up adds each child's own cost once.
//
// Two routes: Manual (MIG and spot welds by hand) and Robotic (on a robot). Laser seams are on the laser seam welder on both. A machine's
// setup is charged once per batch, on its first line. A weld the data cannot time is its own named line at no cost (Apply never fails).
import { WELD_PROCESSES, type PartAssemblyWeld, type WeldProcess } from './part-assembly-welds';
import { bevelledEdges, spotsOf, weldMetal } from './weld-geometry';
import { gap, type CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import { sumRuns } from '../machining/process/machining-trace';
import { cell, fail, routeKit, type KitRow, type RouteKit } from '../shared/calculators/route-kit';
import { cutCodeFamilyOf } from '../shared/core/cut-code';

import type { FeatureOp, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { AssemblyComponent } from '../assembly/assembly-joints';
import type { SandReference } from '../casting/sand/sand-reference';
import type { CostedStep, StepOutcome } from '../casting/sand/sand-steps';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import type { CalcSeed, ReferenceCalcRun, ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';

export const PART_ASSEMBLY_DOMAIN = 'part_assembly';
export const PART_ASSEMBLY_PROCESS_GROUP = 'Part Assembly';

/** The HR Rates machine class of each Part Assembly process (migrations 795, 827, 1099). */
export const PART_ASSEMBLY_PROCESS_CLASS: Readonly<Record<string, string>> = {
  'Manual MIG Welding': 'part_assembly_manual_mig_welding', 'Robotic MIG Welding': 'part_assembly_robotic_mig_welding',
  'Manual Spot Welding': 'part_assembly_manual_spot_welding', 'Robotic Spot Welding': 'part_assembly_robotic_spot_welding',
  'Laser Seam Welding': 'laser_seam_welding', 'Bevel Cutting': 'bevel_cutting', Grinding: 'grinding', 'Finish Grinding': 'finish_grinding',
  'Wire Brushing': 'wire_brushing',
};
export const PART_ASSEMBLY_ROUTE_CLASSES: readonly string[] = [...new Set(Object.values(PART_ASSEMBLY_PROCESS_CLASS))];

export const PART_ASSEMBLY_ROUTES = [
  { key: 'manual', label: 'Manual welding' },
  { key: 'robotic', label: 'Robotic welding' },
] as const;
export type PartAssemblyRouteKey = (typeof PART_ASSEMBLY_ROUTES)[number]['key'];

/** The process each kind of weld is made by on either route. */
const WELDER: Readonly<Record<WeldProcess, Readonly<Record<PartAssemblyRouteKey, string>>>> = {
  'MIG Welding': { manual: 'Manual MIG Welding', robotic: 'Robotic MIG Welding' },
  'Spot Welding': { manual: 'Manual Spot Welding', robotic: 'Robotic Spot Welding' },
  'Laser Seam Welding': { manual: 'Laser Seam Welding', robotic: 'Laser Seam Welding' },
};
/**
 * The load and unload tables of each arc and spot welding process (the laser seam welder loads and unloads by its machine's own times).
 * memory/Part Assembly gives manual spot welding no table of its own: its load table is the one left unlabelled, and its unload the manual
 * MIG one (the three unload tables memory has are identical).
 */
const HANDLING_TABLES: Readonly<Partial<Record<string, { load: string; unload: string }>>> = {
  'Manual MIG Welding': { load: 'componentLoadTime_manual_mig_welding', unload: 'unloadWeldmentAllowance_manual_mig_welding' },
  'Robotic MIG Welding': { load: 'componentLoadTime_robotic_mig_welding', unload: 'unloadWeldmentAllowance_robotic_mig_welding' },
  'Manual Spot Welding': { load: 'componentLoadTime_unlabelled', unload: 'unloadWeldmentAllowance_manual_mig_welding' },
  'Robotic Spot Welding': { load: 'componentLoadTime_robotic_spot_welding', unload: 'unloadWeldmentAllowance_robotic_spot_welding' },
};
const LASER_TABLE = 'laserSeamWeldTravelSpeed';
const BEVEL_TABLE = 'bevelCutSpeed';
/** The cut code families bevelCutSpeed's oxy-fuel speeds are for: carbon steels (memory: family 1 Steel). */
const BEVEL_FAMILIES: ReadonlySet<string> = new Set(['1', '2']);
/** The finishing run along the flagged welds after welding: the calculator field each one's length goes in, and what it does to them. */
const FINISHING = [
  { process: 'Grinding', flag: (w: PartAssemblyWeld) => w.grind, field: 'ground_length_mm', what: 'ground', criteria: 'A grinding speed' },
  { process: 'Finish Grinding', flag: (w: PartAssemblyWeld) => w.finishGrind, field: 'ground_length_mm', what: 'finish ground', criteria: 'A grinding speed' },
  { process: 'Wire Brushing', flag: (w: PartAssemblyWeld) => w.wireBrush, field: 'brushed_length_mm', what: 'brushed', criteria: 'A wire brushing speed' },
] as const;
/**
 * The tack length a MIG row is measured at before a welder is chosen: whether a row can be measured does not depend on it (only a tack
 * weld's length does, and that is measured again on each welder, at its own tack length).
 */
const ANY_TACK_LENGTH_MM = 1;

export interface PartAssemblyRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  components: readonly AssemblyComponent[];
  welds: readonly PartAssemblyWeld[];
  /** The finished weldment's mass (kg; null when a component has none). */
  weldment: { massKg: number | null };
  /** The plate thickness of a weld that gives none (mm), with where it came from; null when there is none to take. */
  thickness: { mm: number | null; source: string };
  /** The weldment's material and its cut code family (the laser seam and bevel tables); null when not known. */
  material: { name: string | null; cutCodeFamily: string | null };
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  batchSize: number;
  costContext: CostContext;
}

/** What one weld came to on a route: its line's process and its share of the cycle, or why it could not be made. */
export interface PartAssemblyWeldResult {
  weldId: string;
  process: string;
  cycleSec: number | null;
  wireKg: number | null;
  reason: string | null;
}

export interface PartAssemblyRoute {
  key: PartAssemblyRouteKey;
  label: string;
  lines: ProcessLineCost[];
  welds: PartAssemblyWeldResult[];
  /** The MIG wire on the weld lines (USD per weldment). */
  wireUsd: number;
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

export interface PartAssemblyRouteGap { key: PartAssemblyRouteKey; label: string; reason: string }

/** A weld its step can time, with the measures its calculator is given (a MIG weld's metal is measured on each welder). */
type Timeable =
  | { kind: 'MIG Welding'; w: PartAssemblyWeld; thicknessMm: number | null }
  | { kind: 'Spot Welding'; w: PartAssemblyWeld; spots: number; basis: string }
  | { kind: 'Laser Seam Welding'; w: PartAssemblyWeld; seamMm: number; depthMm: number; family: string; basis: string };

/** A part a welding step loads: a component (on the route's first welding step) or the weldment (on a later one). */
interface Loaded { name: string; massKg: number | null; quantity: number }

type CalcInputs = { engine: Record<string, CalcSeed | undefined>; lookups: Record<string, CalcSeed | undefined> } | { reasons: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
const gapReason = (l: ProcessLineCost): string | null => (l.physicsGap && 'reason' in l.physicsGap ? l.physicsGap.reason : l.physicsGap ? 'not costed' : null);

/** The row of a by-weight table (componentLoadTime_*, unloadWeldmentAllowance_*) that takes `massKg`: the lightest band not below it. */
export function weightRow(ref: SandReference, table: string, massKg: number): KitRow | null {
  return [...ref.table(table)].sort((a, b) => (cell(a, 'Weight (kg)') ?? 0) - (cell(b, 'Weight (kg)') ?? 0))
    .find((r) => (cell(r, 'Weight (kg)') ?? -1) >= massKg) ?? null;
}

/** The laserSeamWeldTravelSpeed row for a family, a laser power and a depth: the shallowest depth band not below it. */
export function laserRow(ref: SandReference, family: string, powerW: number, depthMm: number): KitRow | null {
  return ref.table(LASER_TABLE)
    .filter((r) => String(r['Material Cut Code Family']) === family && cell(r, 'Power') === powerW && (cell(r, 'Weld Depth') ?? -1) >= depthMm)
    .sort((a, b) => (cell(a, 'Weld Depth') ?? 0) - (cell(b, 'Weld Depth') ?? 0))[0] ?? null;
}

/**
 * A cut code's family in laserSeamWeldTravelSpeed (whose steel families 1 and 2 are bevelCutSpeed's too): its whole number, as memory numbers
 * the families (1, 2 steels; 5 stainless; 51, 52 plastics): stainless 5.21 is family 5, a thermoplastic 51.21 family 51. Null when the table
 * has no rows for it.
 */
export function laserFamilyOf(ref: SandReference, cutCode: number | null): string | null {
  return cutCodeFamilyOf(new Set(ref.table(LASER_TABLE).map((r) => String(r['Material Cut Code Family']))), cutCode);
}

/** The bevelCutSpeed row for a depth of cut: the shallowest depth not below it. */
export function bevelRow(ref: SandReference, depthMm: number): KitRow | null {
  return ref.table(BEVEL_TABLE).filter((r) => (cell(r, 'Depth of Cut (mm)') ?? -1) >= depthMm)
    .sort((a, b) => (cell(a, 'Depth of Cut (mm)') ?? 0) - (cell(b, 'Depth of Cut (mm)') ?? 0))[0] ?? null;
}

/** What a weld row gives its process's calculator, read once and checked here; or what it lacks, named. */
function timeableOf(kind: WeldProcess, w: PartAssemblyWeld, thicknessMm: number | null, material: PartAssemblyRouteInput['material']): Timeable | { missing: string } {
  switch (kind) {
    case 'MIG Welding': {
      const metal = weldMetal(w, thicknessMm, ANY_TACK_LENGTH_MM);
      return 'missing' in metal ? metal : { kind, w, thicknessMm };
    }
    case 'Spot Welding': {
      const s = spotsOf(w, thicknessMm);
      return 'missing' in s ? s : { kind, w, spots: s.spots, basis: s.basis };
    }
    case 'Laser Seam Welding': {
      if (w.lengthMm == null) return { missing: 'its length' };
      const depthMm = w.depthMm ?? thicknessMm;
      if (depthMm == null) return { missing: 'its penetration, or the plate thickness' };
      if (material.cutCodeFamily == null) return { missing: `the weldment's material cut code family (${material.name ?? 'no material set'}), for ${LASER_TABLE}` };
      const count = w.count ?? 1;
      return {
        kind, w, seamMm: w.lengthMm * count, depthMm, family: material.cutCodeFamily,
        basis: `${count} x ${w.lengthMm} mm of seam at ${depthMm} mm deep${w.depthMm == null ? ' (the plate thickness)' : ''}`,
      };
    }
  }
}

/** The load time of `parts` from a by-weight table (each part's band times its quantity), with its basis; or what it lacks. */
function loadTimeOf(ref: SandReference, table: string, parts: readonly Loaded[]): { sec: number; basis: string } | { missing: string } {
  const unweighed: string[] = [];
  const unbanded: string[] = [];
  const banded: string[] = [];
  let sec = 0;
  for (const p of parts) {
    if (p.massKg == null) { unweighed.push(p.name); continue; }
    const each = cell(weightRow(ref, table, p.massKg), 'Load Time (s)');
    if (each == null) { unbanded.push(`${p.name} (${p.massKg} kg)`); continue; }
    sec += each * p.quantity;
    banded.push(`${p.name} ${p.massKg} kg, ${each} s${p.quantity > 1 ? ` x ${p.quantity}` : ''}`);
  }
  if (unweighed.length) return { missing: `the load time of ${unweighed.join(', ')}: no weight (set it in the BOM, or the part's material and model)` };
  if (unbanded.length) return { missing: `the load time: ${table} has no band for ${unbanded.join(', ')}` };
  return { sec, basis: `${table}: ${banded.join('; ')}` };
}

export function buildPartAssemblyRoutes(input: PartAssemblyRouteInput): { routes: PartAssemblyRoute[]; gaps: PartAssemblyRouteGap[]; missing: string[] } {
  const welds = input.welds.filter((w) => w.enabled);
  if (welds.length === 0) return { routes: [], gaps: [], missing: ['the weldment has no welds: add them to the weld table in the Cost Guide'] };
  const robotic = welds.some((w) => w.process !== 'Laser Seam Welding');
  const gaps: PartAssemblyRouteGap[] = robotic ? [] : [{ key: 'robotic', label: 'Robotic welding', reason: 'the weldment has no MIG or spot weld for a robot to make' }];
  const routes = PART_ASSEMBLY_ROUTES.filter((r) => r.key === 'manual' || robotic).map((r) => buildRoute(input, r, welds));
  return { routes, gaps, missing: [] };
}

function buildRoute(inp: PartAssemblyRouteInput, route: (typeof PART_ASSEMBLY_ROUTES)[number], welds: readonly PartAssemblyWeld[]): PartAssemblyRoute {
  const { ref } = inp;
  const kit: RouteKit = routeKit({
    ref, spec: inp.spec, calculators: inp.calculators, machinesByClass: inp.machinesByClass, batchSize: inp.batchSize, costContext: inp.costContext,
    domain: PART_ASSEMBLY_DOMAIN, domainLabel: 'Part Assembly', processGroup: PART_ASSEMBLY_PROCESS_GROUP, processClass: PART_ASSEMBLY_PROCESS_CLASS,
    partName: 'weldment',
  });
  const { seed, lookupSeed, calcOf, run, step } = kit;
  const warnings: string[] = [];
  const lines: ProcessLineCost[] = [];
  const results: PartAssemblyWeldResult[] = [];
  let wireUsd = 0;
  const thicknessOf = (w: PartAssemblyWeld) => w.thicknessMm ?? inp.thickness.mm;
  const weldOp = (w: PartAssemblyWeld, sec = 0): FeatureOp => ({ name: w.label, featureType: 'PartAssemblyWeld', timeSec: sec, count: w.count ?? 1 });
  const gapLine = (process: string, reason: string, ops: FeatureOp[]) =>
    lines.push({ ...gap(process, PART_ASSEMBLY_PROCESS_GROUP, PART_ASSEMBLY_PROCESS_CLASS[process] ?? 'part_assembly', reason), featureBreakdown: ops });
  const add = (s: CostedStep, ops: FeatureOp[]) => {
    warnings.push(...s.warnings);
    lines.push({ ...s.line, featureBreakdown: ops });
  };
  const machineSeed = (m: SandMachine, column: string, label: string): CalcSeed | undefined => {
    const value = machineValue(m, column);
    return value == null ? undefined : {
      value, source: `machine ${m.name}: ${column} (${label})`,
      ref: { kind: 'machine', machineId: m.id, machineName: m.name, machineClass: m.machineClass, location: m.location, column },
    };
  };

  // ── Welding: one line per weld process, the components loaded by the first ─────────────────────────────────────────────────────────
  let loadedBefore = false;
  for (const kind of WELD_PROCESSES) {
    const rows = welds.filter((w) => w.process === kind);
    if (rows.length === 0) continue;
    const process = WELDER[kind][route.key];
    // A weld whose measures are missing is its own named line; the rest are this step's.
    const timeable: Timeable[] = [];
    for (const w of rows) {
      const t = timeableOf(kind, w, thicknessOf(w), inp.material);
      if ('missing' in t) {
        gapLine(process, `${w.label}: ${t.missing}`, [weldOp(w)]);
        results.push({ weldId: w.id, process, cycleSec: null, wireKg: null, reason: t.missing });
      } else timeable.push(t);
    }
    if (timeable.length === 0) continue;

    // An arc or spot welding step's load and unload, by weight, given to its first weld's run; a weight or band that is missing is a gap line.
    const tables = HANDLING_TABLES[process];
    let load: CalcSeed = seed(0, 'nothing loaded by this step');
    let unload: { field: string; seed: CalcSeed } | null = null;
    if (tables) {
      const parts: Loaded[] = loadedBefore
        ? [{ name: 'the weldment', massKg: inp.weldment.massKg, quantity: 1 }]
        : inp.components.map((c) => ({ name: c.name, massKg: c.massKg, quantity: c.quantity }));
      const l = loadTimeOf(ref, tables.load, parts);
      if ('missing' in l) gapLine(process, l.missing, []);
      load = 'missing' in l ? seed(0, 'not known: named on its own line') : seed(l.sec, l.basis);
      const mass = inp.weldment.massKg;
      const u = mass == null ? undefined : lookupSeed(tables.unload, weightRow(ref, tables.unload, mass), 'Allowance (s)', ['Weight (kg)']);
      if (mass == null) gapLine(process, 'the unload time of the weldment: a component has no weight', []);
      else if (!u) gapLine(process, `the unload time: ${tables.unload} has no band for the ${r3(mass)} kg weldment`, []);
      unload = {
        field: `${tables.unload}.Allowance (s)`,
        seed: u && mass != null ? { ...u, source: `${u.source}, for the ${r3(mass)} kg weldment` } : seed(0, 'not known: named on its own line'),
      };
      loadedBefore = true;
    }

    /** A weld's calculator inputs on machine `m`: its measures, and the step's load and unload when it is the step's first weld. */
    const inputsOf = (t: Timeable, m: SandMachine, first: boolean): CalcInputs => {
      const loadOnce = first ? load : seed(0, 'loaded with the first weld of this step');
      const unloadOnce = unload ? { [unload.field]: first ? unload.seed : seed(0, 'unloaded after the last weld of this step') } : {};
      switch (t.kind) {
        case 'MIG Welding': {
          const metal = weldMetal(t.w, t.thicknessMm, machineValue(m, 'tack_length_mm'));
          if ('missing' in metal) return { reasons: [`${t.w.label}: ${metal.missing}`] };
          return {
            engine: {
              weld_length_mm: seed(metal.lengthMm, metal.lengthBasis), weld_area_mm2: seed(metal.areaMm2, metal.areaBasis),
              weld_count: seed(metal.welds, `${metal.welds} weld(s), one arc each`),
              tacked: seed(metal.tacked ? 1 : 0, metal.tacked ? 'a seam, tacked before it is welded' : 'a plug or a tack weld: not tacked'),
              load_time_s: loadOnce,
            },
            lookups: unloadOnce,
          };
        }
        case 'Spot Welding':
          return { engine: { spot_count: seed(t.spots, t.basis), load_time_s: loadOnce }, lookups: unloadOnce };
        case 'Laser Seam Welding': {
          const power = machineValue(m, 'power_w');
          if (power == null) return { reasons: [`machine ${m.name}: no laser power (power_w)`] };
          const row = laserRow(ref, t.family, power, t.depthMm);
          if (!row) return { reasons: [`${t.w.label}: ${LASER_TABLE} has no ${power} W row for family ${t.family} at ${t.depthMm} mm`] };
          const once = (column: string) => (first ? machineSeed(m, column, 'once per weldment') : seed(0, 'loaded, unloaded and indexed with the first seam'));
          return {
            engine: { weld_length_mm: seed(t.seamMm, t.basis), load_time_s: once('load_time_s'), unload_time_s: once('unload_time_s'), index_time_s: once('index_time_s') },
            lookups: { [`${LASER_TABLE}.Travel Speed`]: lookupSeed(LASER_TABLE, row, 'Travel Speed', ['Material Cut Code Family', 'Power', 'Weld Depth']) },
          };
        }
      }
    };

    // Per machine: every weld of the step run by its calculator, summed into the step's run; the MIG wire is the line's material cost.
    const perMachine = new Map<string, { sec: number; wireKg: number }[]>();
    const evaluate = (m: SandMachine): StepOutcome => {
      const runs: { label: string; run: ReferenceCalcRun }[] = [];
      const each: { sec: number; wireKg: number }[] = [];
      for (const [i, t] of timeable.entries()) {
        const inputs = inputsOf(t, m, i === 0);
        if ('reasons' in inputs) return fail(...inputs.reasons);
        const r = run(calcOf(process), m, inputs.engine, inputs.lookups);
        if ('reasons' in r) return fail(...r.reasons);
        runs.push({ label: t.w.label, run: r.run });
        each.push({ sec: r.sec, wireKg: r.run.outputs['Wire Mass'] ?? 0 });
      }
      perMachine.set(m.id, each);
      const sec = each.reduce((s, e) => s + e.sec, 0);
      const wireKg = each.reduce((s, e) => s + e.wireKg, 0);
      const wireCost = wireKg * (machineValue(m, 'wire_cost_usd_per_kg') ?? 0);
      return {
        ok: true, sec, run: { ...sumRuns(runs, `${process} cycle time`), sec, value: sec, outputs: { 'Wire Mass': wireKg } }, energyCostUsd: 0, notes: [],
        ...(wireCost > 0 ? { materialCostUsd: wireCost } : {}),
      };
    };
    const robot = route.key === 'robotic' ? ', programming and weld heads' : '';
    const criteria = kind === 'MIG Welding' ? [`A MIG welder (wire feed and diameter, arc time standard, tacks, gun times${robot}) and its wire cost`]
      : kind === 'Spot Welding' ? [`A spot welder (spot weld time and gun placement${robot})`]
        : ['A laser seam welder (power, load, unload and index times)'];
    const s = step(process, evaluate, criteria);
    const each = s.machine ? perMachine.get(s.machine.id) ?? [] : [];
    add(s, timeable.map((t, i) => weldOp(t.w, r2(each.at(i)?.sec ?? 0))));
    wireUsd += s.outcome?.materialCostUsd ?? 0;
    timeable.forEach((t, i) => {
      const e = each.at(i);
      results.push({ weldId: t.w.id, process, cycleSec: e ? r2(e.sec) : null, wireKg: e && kind === 'MIG Welding' ? r3(e.wireKg) : null, reason: gapReason(s.line) });
    });
  }

  // ── Prep and finishing along the flagged welds ────────────────────────────────────────────────────────────────────────────────────
  /** The welds a flag marks, each with the seam it runs along; a spot weld, or a row with no length, has no seam to work along. */
  const seamsOf = (flag: (w: PartAssemblyWeld) => boolean) => welds.flatMap((w) =>
    (flag(w) && w.process !== 'Spot Welding' && w.lengthMm != null ? [{ w, lengthMm: w.lengthMm, count: w.count ?? 1 }] : []));
  const bevelled = seamsOf((w) => w.bevel);
  if (bevelled.length) {
    const family = inp.material.cutCodeFamily;
    const why = family == null ? `the weldment's material cut code family (${inp.material.name ?? 'no material set'})`
      : !BEVEL_FAMILIES.has(family) ? `${BEVEL_TABLE} is oxy-fuel cutting data for carbon steel; ${inp.material.name ?? 'the material'} (cut code family ${family}) has none` : null;
    // The bevel's depth is the plate's.
    const deep = bevelled.flatMap((b) => { const depthMm = thicknessOf(b.w); return depthMm == null ? [] : [{ ...b, depthMm }]; });
    const noDepth = bevelled.filter((b) => thicknessOf(b.w) == null);
    if (why) gapLine('Bevel Cutting', why, bevelled.map((b) => weldOp(b.w)));
    else if (noDepth.length) gapLine('Bevel Cutting', `the plate thickness (the bevel's depth) of ${noDepth.map((b) => b.w.label).join(', ')}`, noDepth.map((b) => weldOp(b.w)));
    const cut = why ? [] : deep;
    if (cut.length) {
      const s = step('Bevel Cutting', (m) => {
        const runs: { label: string; run: ReferenceCalcRun }[] = [];
        let sec = 0;
        for (const b of cut) {
          const row = bevelRow(ref, b.depthMm);
          if (!row) return fail(`${b.w.label}: ${BEVEL_TABLE} has no row for a ${b.depthMm} mm cut`);
          // A V or U groove bevels both plates: twice the seam's length, and a pierce for each edge.
          const edges = bevelledEdges(b.w.operation);
          const cuts = b.count * edges;
          const r = run(calcOf('Bevel Cutting'), m, {
            bevel_length_mm: seed(b.lengthMm * cuts, `${b.count} x ${b.lengthMm} mm bevelled${edges > 1 ? `, ${edges} edges each (${b.w.operation})` : ''}`),
            bevel_count: seed(cuts, `${cuts} bevelled edge(s), one pierce each`),
          }, {
            [`${BEVEL_TABLE}.Cut Speed (mm / min)`]: lookupSeed(BEVEL_TABLE, row, 'Cut Speed (mm / min)', ['Depth of Cut (mm)']),
            [`${BEVEL_TABLE}.Pierce Time (s)`]: lookupSeed(BEVEL_TABLE, row, 'Pierce Time (s)', ['Depth of Cut (mm)']),
          });
          if ('reasons' in r) return fail(...r.reasons);
          runs.push({ label: b.w.label, run: r.run });
          sec += r.sec;
        }
        return { ok: true, sec, run: { ...sumRuns(runs, 'Bevel cutting cycle time'), sec, value: sec, outputs: {} }, energyCostUsd: 0, notes: [] };
      }, ['A bevel cutting station (oxy-fuel)']);
      add(s, cut.map((b) => ({ ...weldOp(b.w), name: `${b.w.label}: bevelled` })));
    }
  }
  for (const f of FINISHING) {
    const flagged = seamsOf(f.flag);
    if (!flagged.length) continue;
    const length = flagged.reduce((s, x) => s + x.lengthMm * x.count, 0);
    const s = step(f.process, (m) => kit.timed(f.process, m, {
      [f.field]: seed(length, `${flagged.map((x) => `${x.w.label} ${x.count} x ${x.lengthMm} mm`).join(', ')} ${f.what}`),
    }), [f.criteria]);
    add(s, flagged.map((x) => ({ ...weldOp(x.w), name: `${x.w.label}: ${f.what}` })));
  }

  // A machine used for several lines is set up once per batch: its setup is on its first line only.
  const setUp = new Set<string>();
  const shared = lines.map((l) => {
    const id = l.mhrId ?? null;
    if (!id || isGap(l) || !(l.setupCost > 0)) return l;
    if (!setUp.has(id)) { setUp.add(id); return l; }
    return { ...l, setupCost: 0, totalCost: l.runCost, setupTimeMin: 0 };
  });
  if (shared.some((l, i) => l !== lines[i])) warnings.push('A machine used for several lines is set up once per batch: its setup is on its first line only.');
  const complete = !shared.some(isGap);
  return {
    key: route.key, label: route.label, lines: shared, welds: results, wireUsd: r3(wireUsd),
    totalUsd: complete ? r2(shared.reduce((s, l) => s + l.totalCost, 0)) : null, complete, warnings,
  };
}

/** The route to quote: the one set in the Cost Guide when it is a route for the weldment, else the cheapest complete one; and a note saying which and why. */
export function choosePartAssemblyRoute(routes: readonly PartAssemblyRoute[], gaps: readonly PartAssemblyRouteGap[], chosen: PartAssemblyRouteKey | null): { route: PartAssemblyRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (v: number) => `${v.toFixed(2)} USD`;
  const perWeldment = (r: PartAssemblyRoute) => (r.totalUsd != null ? ` (${money(r.totalUsd)} per weldment)` : '');
  if (chosen) {
    const set = routes.find((r) => r.key === chosen);
    if (set) return { route: set, note: `Route set in the Cost Guide: ${set.label}${perWeldment(set)}.` };
    const g = gaps.find((x) => x.key === chosen);
    const fallback = cheapest(routes);
    return { route: fallback, note: `${PART_ASSEMBLY_ROUTES.find((r) => r.key === chosen)?.label ?? chosen} is not a route for this weldment${g ? ` (${g.reason})` : ''}: quoted on ${fallback.label}.` };
  }
  const best = cheapest(routes);
  const others = routes.flatMap((r) => (r !== best && r.totalUsd != null ? [`${r.label} ${money(r.totalUsd)}`] : []));
  return { route: best, note: `Cheapest route: ${best.label}${perWeldment(best)}${others.length ? `; ${others.join(', ')}` : ''}.` };
}

/** The cheapest complete route; the first one when none is complete (its gap lines say why). */
function cheapest(routes: readonly PartAssemblyRoute[]): PartAssemblyRoute {
  const priced = routes.flatMap((r) => (r.complete && r.totalUsd != null ? [{ r, usd: r.totalUsd }] : [])).sort((a, b) => a.usd - b.usd);
  return priced.at(0)?.r ?? routes[0];
}
