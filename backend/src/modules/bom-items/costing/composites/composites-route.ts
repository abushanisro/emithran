// A laid-up composite part's routes, priced on the staged memory/Composites data and the composites calculators (migration 1065). Pure.
//
// The laminate is measured by cad-engine composites/feature_extractor.py: the tool side, the bag side's thickness levels (each level's region
// at least that thick, its area and outline), the outline seen along the layup direction and the curvature. A STEP file carries no ply book,
// so the plies are read from that: the laminate at its thickest is as many plies as the material's cured ply thickness goes into it, and a
// ply that needs the laminate at least so thick covers that level's region (a ply drop-off). A level that rises over the one below it by at
// least the core stock's thickness is a honeycomb core, not plies.
//
// Every route: Tool Clean, Mold Preparation, Ultrasonic Cut (the ply kit), the layup (Hand Layup, Automated Tape Layup or Automated Fiber
// Placement), Final Vacuum Bag, Autoclave Cure and Bench Operation; each step on the cheapest capable machine of the location.
import type { FeatureOp, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import type { CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, valuesProvider, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type SandMaterial, type StepOutcome } from '../casting/sand/sand-steps';

export const COMPOSITES_DOMAIN = 'composites';
export const COMPOSITES_PROCESS_GROUP = 'Composites';

/** The HR Rates machine classes of the routes' steps (migration 796; Vacuum Bag on the layup cell, migration 1064). */
export const COMPOSITES_CLASS = {
  toolClean: 'tool_clean',
  moldPrep: 'mold_preparation',
  cut: 'composite_ultrasonic_cut',
  handLayup: 'hand_layup',
  tapeLayup: 'automated_tape_layup',
  fiberPlacement: 'automated_fiber_placement',
  autoclave: 'autoclave_cure',
  bench: 'composite_bench_operation',
} as const;
export const COMPOSITES_ROUTE_CLASSES: readonly string[] = Object.values(COMPOSITES_CLASS);

export const COMPOSITES_ROUTES = [
  { key: 'hand_layup', label: 'Hand layup · autoclave cure', process: 'Hand Layup', machineClass: COMPOSITES_CLASS.handLayup, weights: 'HLU' },
  { key: 'tape_layup', label: 'Automated tape layup · autoclave cure', process: 'Automated Tape Layup', machineClass: COMPOSITES_CLASS.tapeLayup, weights: 'ATL' },
  { key: 'fiber_placement', label: 'Automated fiber placement · autoclave cure', process: 'Automated Fiber Placement', machineClass: COMPOSITES_CLASS.fiberPlacement, weights: 'AFP' },
] as const;
export type CompositesRouteKey = (typeof COMPOSITES_ROUTES)[number]['key'];

const CALC = (name: string) => `Composites - ${name}`;
export const COMPOSITES_CALC = {
  complexity: CALC('Ply complexity'), handPly: CALC('Hand ply placement'), autoPly: CALC('Automated ply placement'), plyCut: CALC('Ply cutting'),
  core: CALC('Core placement'), plyMaterial: CALC('Ply material'), coreMaterial: CALC('Core material'), autoclaveLoad: CALC('Autoclave load'),
  toolClean: CALC('Tool clean'), moldPrep: CALC('Mold preparation'), cut: CALC('Ultrasonic cut'), handLayup: CALC('Hand layup'),
  autoLayup: CALC('Automated layup'), bag: CALC('Vacuum bag'), cure: CALC('Autoclave cure'), bench: CALC('Bench operation'),
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
type Row = Readonly<Record<string, unknown>>;

/** One thickness level of the bag side (cad-engine composites thickness.levels). */
export interface LaminateLevel { thicknessMm: number; regionAreaMm2: number; regionPerimeterMm: number; faceIds: readonly number[] }

/** The laminate as measured (cad-engine composites/feature_extractor.py, via auto-fill's compositeLaminate). */
export interface CompositePart {
  toolAreaMm2: number;
  bagAreaMm2: number;
  levels: readonly LaminateLevel[];
  outerAreaMm2: number;
  trimLengthMm: number;
  openingsAreaMm2: number;
  /** The outline's long and short extents (mm) and the part's height along the layup direction. */
  footprintMm: readonly [number, number];
  heightMm: number;
  /** Area-weighted average of the tool side's largest principal curvature (1/m). */
  curvaturePerM: number;
  holeCount: number;
}

/** A composites material: its price per square metre and its properties (raw_material_properties, migration 855). */
export interface CompositeMaterial extends SandMaterial {
  form: 'Ply' | 'Core' | null;
  can: { hlu: boolean; atl: boolean; afp: boolean };
}

export interface CompositeOverrides {
  /** The plies at the laminate's thickest; null: the laminate thickness over the material's cured ply thickness. */
  plyCount?: number | null;
  /** 'none' takes no core; null or 'auto': a level rising by the core stock's thickness is a core. */
  core?: 'auto' | 'none' | null;
}

export interface CompositesScenario {
  batchSize: number;
  route: CompositesRouteKey | null;
  overrides?: CompositeOverrides;
}

export interface CompositesRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: CompositeMaterial;
  /** The honeycomb of a core (the Cost Guide's or defaultCoreMaterial); null when Raw Materials has none (a core is then not costed). */
  coreMaterial: CompositeMaterial | null;
  part: CompositePart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: CompositesScenario;
  costContext: CostContext;
}

/** A ply of the stack: its place (1 = on the tool), the region it covers and its size. */
export interface CompositePly {
  index: number;
  areaMm2: number;
  perimeterMm: number;
  lengthMm: number;
  widthMm: number;
  cutoutAreaMm2: number;
  outerAreaMm2: number;
  /** The thickness level whose region the ply covers. */
  level: number;
}

export interface CompositeCore { areaMm2: number; perimeterMm: number; depthMm: number; level: number }

export interface CompositeStack {
  plies: CompositePly[];
  core: CompositeCore | null;
  /** The laminate's thickest (cores excluded) and the cured ply thickness it was divided by. */
  laminateMm: number;
  plyThicknessMm: number;
  plySource: 'geometry' | 'scenario';
  notes: string[];
}

/**
 * The ply stack of the part: the plies at the laminate's thickest (cores excluded), each covering the region of the first level at least as
 * thick as the ply's place in the stack calls for; and the core, a level that rises over the one below it by the core stock's thickness.
 */
export function plyStack(part: CompositePart, plyThicknessMm: number, coreStockMm: number | null, overrides: CompositeOverrides = {}): CompositeStack | { missing: string } {
  const levels = [...part.levels].sort((a, b) => a.thicknessMm - b.thicknessMm);
  if (levels.length === 0) return { missing: 'the laminate thickness (no bag-side face was measured): press Refresh analysis so the part is measured as a laminate' };
  if (!(plyThicknessMm > 0)) return { missing: 'the material\'s cured ply thickness (cured_thickness)' };
  const notes: string[] = [];
  let core: CompositeCore | null = null;
  if (overrides.core !== 'none' && coreStockMm != null && coreStockMm > 0) {
    for (let j = 1; j < levels.length; j++) {
      const rise = levels[j]!.thicknessMm - levels[j - 1]!.thicknessMm;
      if (rise >= coreStockMm) {
        core = { areaMm2: levels[j]!.regionAreaMm2, perimeterMm: levels[j]!.regionPerimeterMm, depthMm: rise, level: j };
        break;
      }
    }
  }
  // The laminate at each level, the core's depth taken out of the levels it is in.
  const laminate = levels.map((l, j) => l.thicknessMm - (core && j >= core.level ? core.depthMm : 0));
  const thickest = Math.max(...laminate);
  const geometric = Math.max(1, Math.round(thickest / plyThicknessMm));
  const count = overrides.plyCount != null && overrides.plyCount >= 1 ? Math.round(overrides.plyCount) : geometric;
  if (overrides.plyCount != null) notes.push(`${count} plies, set in the Cost Guide (the laminate's ${r3(thickest)} mm over a ${plyThicknessMm} mm cured ply gives ${geometric}).`);
  const [length, width] = part.footprintMm;
  const plies: CompositePly[] = [];
  for (let k = 1; k <= count; k++) {
    const needs = ((k - 0.5) / count) * thickest;
    const j = Math.max(0, laminate.findIndex((t) => t >= needs - 1e-6));
    const l = levels[j]!;
    const whole = j === 0;
    const side = Math.sqrt(l.regionAreaMm2);
    plies.push({
      index: k, areaMm2: l.regionAreaMm2, perimeterMm: l.regionPerimeterMm, level: j,
      lengthMm: whole ? length : side, widthMm: whole ? width : side,
      cutoutAreaMm2: whole ? part.openingsAreaMm2 : 0, outerAreaMm2: whole ? Math.max(part.outerAreaMm2, l.regionAreaMm2) : l.regionAreaMm2,
    });
  }
  const drops = new Set(plies.map((p) => p.level)).size - 1;
  notes.push(`${count} plies: the laminate is ${r3(thickest)} mm at its thickest, a ${plyThicknessMm} mm cured ply each${drops > 0 ? `; ${drops} ply drop-off level(s) where it is thinner` : ''}.`);
  if (core) notes.push(`A honeycomb core: the laminate rises ${r3(core.depthMm)} mm (at least the core stock's ${coreStockMm} mm) over ${r2(core.areaMm2)} mm².`);
  return { plies, core, laminateMm: thickest, plyThicknessMm, plySource: overrides.plyCount != null ? 'scenario' : 'geometry', notes };
}

export interface CompositesRoute {
  key: CompositesRouteKey;
  label: string;
  stack: CompositeStack;
  lines: ProcessLineCost[];
  material: { plyCostUsd: number; coreCostUsd: number; costUsd: number; boughtAreaM2: number; plyMassKg: number; costPerKgUsd: number | null; runs: Record<string, ReferenceCalcRun> };
  partsPerLoad: number | null;
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

export interface CompositesRouteGap { key: CompositesRouteKey; label: string; reason: string }

/** The first row whose `column` is at or above `value` (rows ascending by it), else the last. */
function bandRow(rows: readonly Row[], column: string, value: number): Row | undefined {
  const sorted = [...rows].sort((a, b) => Number(a[column]) - Number(b[column]));
  return sorted.find((r) => Number(r[column]) >= value) ?? sorted[sorted.length - 1];
}

/** Every route of the part (each complete or with its gaps), the routes it cannot take and why, and what keeps any route from being built. */
export function buildCompositesRoutes(input: CompositesRouteInput): { routes: CompositesRoute[]; gaps: CompositesRouteGap[]; missing: string[] } {
  const { ref, part, scenario, material } = input;
  const none = (...missing: string[]) => ({ routes: [], gaps: [], missing });
  const num = (name: string) => ref.number(name);
  if (material.form !== 'Ply') return none(`"${material.name}" is not a ply material (Material Form ${material.form ?? 'not set'}): choose a prepreg in Material Grade`);
  const plyT = material.columns['cured_thickness'];
  if (plyT == null) return none(`${material.name}: cured_thickness`);
  const coreStock = input.coreMaterial?.columns['cured_thickness'] ?? null;
  const stack = plyStack(part, plyT, coreStock, scenario.overrides);
  if ('missing' in stack) return none(stack.missing);

  // ── Seeding: every input from its declared source ─────────────────────────────────────────────────────────────────────────────────
  const variable: SeedProvider = (name) => {
    const value = num(name);
    return value == null ? null : { value, source: `Composites variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: COMPOSITES_DOMAIN, name } };
  };
  const [length, width] = part.footprintMm;
  const cad: Record<string, CalcSeed | undefined> = {
    // Each with the faces it was measured on (feature_graph_v2.measurements), for the calculator dialog's eye.
    tool_area_mm2: { value: part.toolAreaMm2, source: 'tool side of the laminate (mm²)', ref: { kind: 'cad', evidence: 'tool_area' } },
    trim_length_mm: { value: part.trimLengthMm, source: 'trimmed edge: the outline along the layup direction (mm)', ref: { kind: 'cad', evidence: 'trim_length' } },
    footprint_length_mm: { value: length, source: "the outline's long extent (mm)", ref: { kind: 'cad', evidence: 'footprint_length' } },
    footprint_width_mm: { value: width, source: "the outline's short extent (mm)", ref: { kind: 'cad', evidence: 'footprint_width' } },
    height_mm: { value: part.heightMm, source: "the part's height along the layup direction (mm)", ref: { kind: 'cad', evidence: 'layup_height' } },
    skin_area_mm2: { value: part.toolAreaMm2 + part.bagAreaMm2, source: 'both skins of the laminate (mm²)', ref: { kind: 'cad', evidence: 'skin_area' } },
  };
  const materialProvider = (m: CompositeMaterial): SeedProvider => (key) => {
    const value = m.columns[key];
    return value == null ? null : { value, source: `${m.name}: ${key}`, ref: { kind: 'material', materialId: m.id, materialName: m.name, column: key } };
  };
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, opts: { output?: string; lookups?: Record<string, CalcSeed | undefined>; material?: CompositeMaterial } = {}): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, cad: valuesProvider(cad), engine: valuesProvider(engine), lookup: valuesProvider(opts.lookups ?? {}), scenario: valuesProvider({}),
      material: materialProvider(opts.material ?? material),
      machine: (key) => {
        const value = machine ? machineValue(machine, key) : null;
        return value == null || !machine ? null : {
          value, source: `machine ${machine.name}: ${key}`,
          ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, machineClass: machine.machineClass, location: machine.location, column: key },
        };
      },
    };
    const { seeds, missing } = seedsFor(calc, providers);
    if (missing.length) return { reasons: missing.map((m) => `${calculator}: ${m}`) };
    const result = runReferenceCalculator(input.calculators, calculator, seeds, opts.output ?? calc.output ?? 'Cycle Time');
    return result.value == null ? { reasons: result.missing } : { run: result };
  };
  const lookupSeed = (table: string, row: Row | undefined, column: string, identity: readonly string[]): CalcSeed | undefined => {
    if (!row || row[column] == null || !Number.isFinite(Number(row[column]))) return undefined;
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    return {
      value: Number(row[column]), source: `${table} (${identity.map((c) => `${c} ${row[c]}`).join(', ')}): ${column}`, lookup: true, match: { table, row: id },
      ref: { kind: 'lookup', domain: COMPOSITES_DOMAIN, table, column, row: id },
    };
  };
  const seed = (value: number, source: string): CalcSeed => ({ value, source });
  // A cell whose file gives a labour rate but no crew (memory/Composites machines_hand_layup.csv has no Number of Operators column) is worked by
  // one operator: laying plies by hand is the cell's whole work, and a line charging no one for it would cost the layup as if it were free.
  const uncrewed = new Set<string>();
  const crewed = (ms: readonly SandMachine[]): SandMachine[] => ms.map((m) => {
    if (m.operators != null || !((m.labourRatePerHr ?? 0) > 0)) return m;
    uncrewed.add(m.machineClass);
    return { ...m, operators: 1 };
  });
  const step = (process: string, machineClass: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({
      process, machineClass, machines: crewed(input.machinesByClass[machineClass] ?? []), evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, partName: 'part', processGroup: COMPOSITES_PROCESS_GROUP,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): StepOutcome => {
    const r = run(calculator, m, engine, { lookups });
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
  };

  // The tool: the part with toolPerimeterAllowance all round. A cell, table or bench must take it.
  const allowance = num('toolPerimeterAllowance') ?? 0;
  const tool = [length + 2 * allowance, width + 2 * allowance] as const;
  const fits = (m: SandMachine, lengthKey: string, widthKey: string): string | null => {
    const [l, w] = [machineValue(m, lengthKey), machineValue(m, widthKey)];
    if (l == null || w == null) return null;
    const ok = (tool[0] <= l && tool[1] <= w) || (tool[0] <= w && tool[1] <= l);
    return ok ? null : `its ${l} x ${w} mm does not take the ${r2(tool[0])} x ${r2(tool[1])} mm tool (the part with toolPerimeterAllowance ${allowance} mm all round)`;
  };
  const fitsArea = (m: SandMachine) => fits(m, 'useable_length_mm', 'useable_width_mm');
  const fitsTable = (m: SandMachine) => fits(m, 'table_length_mm', 'table_width_mm');

  // ── Materials: the plies and the core ────────────────────────────────────────────────────────────────────────────────────────────
  const warnings = [...stack.notes];
  const plySeeds = (p: CompositePly) => ({
    ply_area_mm2: seed(p.areaMm2, `ply ${p.index}: the region at least its place in the stack thick (mm²)`),
    ply_perimeter_mm: seed(p.perimeterMm, `ply ${p.index}: the region's outline (mm)`),
    ply_length_mm: seed(p.lengthMm, `ply ${p.index}: its long extent (mm)`),
    ply_width_mm: seed(p.widthMm, `ply ${p.index}: its short extent (mm)`),
    ply_cutout_area_mm2: seed(p.cutoutAreaMm2, `ply ${p.index}: openings in its outline (mm²)`),
    ply_outer_area_mm2: seed(p.outerAreaMm2, `ply ${p.index}: its outline, openings filled (mm²)`),
    ply_curvature_per_m: seed(part.curvaturePerM, 'tool side curvature, area-weighted average (1/m)'),
  });
  const plyMaterialRuns = stack.plies.map((p) => run(COMPOSITES_CALC.plyMaterial, null, plySeeds(p)));
  const badMaterial = plyMaterialRuns.find((r) => 'reasons' in r);
  if (badMaterial && 'reasons' in badMaterial) return none(...badMaterial.reasons);
  const plyRuns = plyMaterialRuns.map((r) => (r as { run: ReferenceCalcRun }).run);
  const plyCost = plyRuns.reduce((s, r) => s + r.value!, 0);
  const plyMass = plyRuns.reduce((s, r) => s + (r.outputs['Ply Mass'] ?? 0), 0);
  const boughtArea = plyRuns.reduce((s, r) => s + (r.outputs['Bought Area'] ?? 0), 0);
  let coreCost = 0;
  const materialRuns: Record<string, ReferenceCalcRun> = { ...(plyRuns[0] ? { ply: plyRuns[0] } : {}) };
  const core = stack.core;
  const coreSeeds = core ? {
    core_area_mm2: seed(core.areaMm2, 'core: the region it rises over (mm²)'),
    core_perimeter_mm: seed(core.perimeterMm, 'core: that region\'s outline (mm)'),
    core_depth_mm: seed(core.depthMm, 'core: how far the laminate rises over it (mm)'),
  } : {};
  if (core) {
    if (!input.coreMaterial) warnings.push(`The core is not costed as material: Raw Materials has no core material "${ref.text('defaultCoreMaterial') ?? 'defaultCoreMaterial'}" (group Composites).`);
    else {
      const c = run(COMPOSITES_CALC.coreMaterial, null, coreSeeds, { material: input.coreMaterial });
      if ('reasons' in c) warnings.push(`The core material is not costed: ${c.reasons.join('; ')}`);
      else { coreCost = c.run.value!; materialRuns.core = c.run; }
    }
  }

  // ── The steps every route shares ──────────────────────────────────────────────────────────────────────────────────────────────────
  const toolArea = part.toolAreaMm2 + part.trimLengthMm * allowance + 4 * allowance ** 2;
  const manualRates = ref.table('tblManualToolCleanRates');
  const toolClean = step('Tool Clean', COMPOSITES_CLASS.toolClean, (m) => {
    const misfit = fitsArea(m);
    if (misfit) return fail(misfit);
    const own = machineValue(m, 'clean_rate_mm2_per_s');
    const method = String(m.specs['cleaning_method'] ?? '');
    const manual = bandRow(manualRates, 'Component Area (mm^2)', toolArea);
    const rate: CalcSeed | undefined = own != null && own > 0
      ? { value: own, source: `machine ${m.name}: clean_rate_mm2_per_s (${method || 'machine'} cleaning)` }
      : lookupSeed('tblManualToolCleanRates', manual, 'Manual Clean Rate (mm^2 / s)', ['Component Area (mm^2)']);
    if (!rate) return fail('no clean rate: the machine has none and tblManualToolCleanRates is not staged');
    return timed(COMPOSITES_CALC.toolClean, m, { clean_rate_mm2_s: rate });
  }, ['The cell takes the tool', 'A clean rate: the cell\'s own, or tblManualToolCleanRates for the tool\'s area']);
  const moldPrep = step('Mold Preparation', COMPOSITES_CLASS.moldPrep, (m) => fitsArea(m) ? fail(fitsArea(m)!) : timed(COMPOSITES_CALC.moldPrep, m, {}), ['The area takes the tool']);
  warnings.push('Mold Preparation: memory/Composites gives no cure time for the mold release, so its curing is not timed.');

  const longest = Math.max(...stack.plies.map((p) => p.lengthMm));
  const cut = step('Ultrasonic Cut', COMPOSITES_CLASS.cut, (m) => {
    const table = machineValue(m, 'table_length_mm');
    if (table != null && table < longest) return fail(`its ${table} mm table is shorter than the longest ply (${r2(longest)} mm)`);
    const per: Array<{ ply: CompositePly; sec: number }> = [];
    for (const p of stack.plies) {
      const r = run(COMPOSITES_CALC.plyCut, m, plySeeds(p));
      if ('reasons' in r) return fail(...r.reasons);
      per.push({ ply: p, sec: r.run.value! });
    }
    const sum = per.reduce((s, x) => s + x.sec, 0);
    const outcome = timed(COMPOSITES_CALC.cut, m, {
      ply_cut_s: seed(sum, `the plies cut, each by Composites - Ply cutting (${per.length} plies)`),
      material_rolls: seed(1, `one roll of ${material.name}`),
      batch_size: seed(scenario.batchSize, 'batch size'),
    });
    return outcome.ok ? { ...outcome, notes: [], perPly: per } as StepOutcome : outcome;
  }, ['Its table takes the longest ply']);

  const bag = step('Final Vacuum Bag', COMPOSITES_CLASS.handLayup, (m) => fitsArea(m) ? fail(fitsArea(m)!) : timed(COMPOSITES_CALC.bag, m, {}), ['The layup cell takes the tool (the part is bagged on it there)']);

  let partsPerLoad: number | null = null;
  const cure = step('Autoclave Cure', COMPOSITES_CLASS.autoclave, (m) => {
    const shared = ref.text('autoclavesIsShared') === 'true' ? 1 : 0;
    const load = run(COMPOSITES_CALC.autoclaveLoad, m, { autoclave_shared: seed(shared, `autoclavesIsShared ${shared === 1 ? 'true' : 'false'}`) });
    if ('reasons' in load) return fail(...load.reasons);
    const n = load.run.value!;
    if (!(n > 0)) return fail(`the tool (${r2(tool[0])} x ${r2(tool[1])} mm, ${r2(part.heightMm + (num('toolHeightAllowance') ?? 0))} mm high) does not fit within its usable ${machineValue(m, 'useable_diameter_mm')} mm diameter and ${machineValue(m, 'useable_length_mm')} mm length (autoclaveSizeCapacitySafetyFactor)`);
    const outcome = timed(COMPOSITES_CALC.cure, m, { parts_per_load: seed(n, `${r2(n)} parts per load (Composites - Autoclave load${shared ? ', shared autoclave' : ''})`) }, {});
    return outcome.ok ? { ...outcome, loadParts: n } as StepOutcome : outcome;
  }, ['The tool fits its usable diameter and length within the safety factor']);
  partsPerLoad = (cure.outcome as { loadParts?: number } | null)?.loadParts ?? null;

  const handlingRows = ref.table('tblHandlingTimes');
  const box = handlingRows.filter((r) => Number(r['Box Length (mm)']) >= length && Number(r['Box Width (mm)']) >= width)
    .sort((a, b) => Number(a['Box Length (mm)']) * Number(a['Box Width (mm)']) - Number(b['Box Length (mm)']) * Number(b['Box Width (mm)']))[0];
  const bench = step('Bench Operation', COMPOSITES_CLASS.bench, (m) => fitsArea(m) ? fail(fitsArea(m)!) : timed(COMPOSITES_CALC.bench, m, {}, {
    'tblHandlingTimes.Tool Handling Time (s)': lookupSeed('tblHandlingTimes', box, 'Tool Handling Time (s)', ['Box Length (mm)', 'Box Width (mm)']),
    'tblHandlingTimes.Part Handling Time (s)': lookupSeed('tblHandlingTimes', box, 'Part Handling Time (s)', ['Box Length (mm)', 'Box Width (mm)']),
  }), ['The bench takes the tool']);

  // ── Each route's layup ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const routes: CompositesRoute[] = [];
  const gaps: CompositesRouteGap[] = [];
  const layupTimes = ref.table('tblPlyHandLayupTimes');
  for (const r of COMPOSITES_ROUTES) {
    const can = r.weights === 'HLU' ? material.can.hlu : r.weights === 'ATL' ? material.can.atl : material.can.afp;
    if (!can) { gaps.push({ key: r.key, label: r.label, reason: `${material.name} cannot be laid by ${r.process} (Can ${r.weights} false)` }); continue; }
    if (core && r.weights !== 'HLU') { gaps.push({ key: r.key, label: r.label, reason: 'a honeycomb core is placed by hand: memory/Composites has core operations under Hand Layup only' }); continue; }
    const w = (name: string) => num(`weighting${r.weights}${name}`);
    const weights = {
      weight_flexibility: seed(w('MaterialFlexibility') ?? 0, `weighting${r.weights}MaterialFlexibility`),
      weight_cutout: seed(w('PlyCutout') ?? 0, `weighting${r.weights}PlyCutout`),
      weight_deformation: seed(w('PlyDeformation') ?? 0, `weighting${r.weights}PlyDeformation`),
      weight_aspect: seed(r.weights === 'HLU' ? 0 : (w('AngleVsAspect') ?? 0), r.weights === 'HLU' ? 'hand layup has no aspect weighting' : `weighting${r.weights}AngleVsAspect`),
    };
    const complexity = stack.plies.map((p) => run(COMPOSITES_CALC.complexity, null, { ...plySeeds(p), ...weights }));
    const badC = complexity.find((c) => 'reasons' in c);
    if (badC && 'reasons' in badC) { gaps.push({ key: r.key, label: r.label, reason: badC.reasons.join('; ') }); continue; }
    const cx = complexity.map((c) => (c as { run: ReferenceCalcRun }).run.value!);

    const layup = step(r.process, r.machineClass, (m) => {
      const misfit = r.weights === 'HLU' ? fitsArea(m) : fitsTable(m);
      if (misfit) return fail(misfit);
      const per: Array<{ ply: CompositePly; sec: number }> = [];
      for (const [i, p] of stack.plies.entries()) {
        const complexitySeed = seed(cx[i]!, `ply ${p.index}: Composites - Ply complexity (${r.weights} weightings)`);
        let pr: Run;
        if (r.weights === 'HLU') {
          const row = bandRow(layupTimes, 'Ply Layup Area (mm^2)', p.areaMm2);
          const laser = m.specs['has_laser_projection'] === true || m.specs['has_laser_projection'] === 'true';
          pr = run(COMPOSITES_CALC.handPly, m, {
            ...plySeeds(p), ply_complexity: complexitySeed,
            layup_guide_multiplier: laser ? seed(1, `${m.name} has laser projection: no layup guides`) : { value: num('manualLayupGuideMultiplier') ?? 1, source: 'Composites variable manualLayupGuideMultiplier (no laser projection)' },
          }, { lookups: {
            'tblPlyHandLayupTimes.Ply Layup Time Min (min)': lookupSeed('tblPlyHandLayupTimes', row, 'Ply Layup Time Min (min)', ['Ply Layup Area (mm^2)']),
            'tblPlyHandLayupTimes.Ply Layup Time Max (min)': lookupSeed('tblPlyHandLayupTimes', row, 'Ply Layup Time Max (min)', ['Ply Layup Area (mm^2)']),
          } });
        } else {
          const band = r.weights === 'AFP' ? machineValue(m, 'max_bandwidth_mm') : Math.min(material.columns['material_width'] ?? Infinity, machineValue(m, 'max_material_width_mm') ?? Infinity);
          if (band == null || !Number.isFinite(band) || !(band > 0)) return fail(`no band width: ${r.weights === 'AFP' ? 'the machine\'s max_bandwidth_mm' : 'the tape\'s material_width and the machine\'s max_material_width_mm'}`);
          if (r.weights === 'ATL' && (material.columns['material_width'] ?? 0) > (machineValue(m, 'max_material_width_mm') ?? Infinity)) {
            return fail(`it lays tape up to ${machineValue(m, 'max_material_width_mm')} mm wide, ${material.name} is ${material.columns['material_width']} mm`);
          }
          pr = run(COMPOSITES_CALC.autoPly, m, {
            ...plySeeds(p), ply_complexity: complexitySeed,
            band_width_mm: seed(band, r.weights === 'AFP' ? `machine ${m.name}: max_bandwidth_mm` : `tape width (${material.name} material_width, within the machine's max_material_width_mm)`),
            min_layup_rate_factor: { value: num(`minLayupRateFactor${r.weights}`) ?? 1, source: `Composites variable minLayupRateFactor${r.weights}` },
            rapid_traverse_s: { value: num(`average${r.weights}RapidTraverseTime`) ?? 0, source: `Composites variable average${r.weights}RapidTraverseTime` },
          });
        }
        if ('reasons' in pr) return fail(...pr.reasons);
        per.push({ ply: p, sec: pr.run.value! });
      }
      const placement = per.reduce((s, x) => s + x.sec, 0);
      let coreSec = 0;
      if (core && r.weights === 'HLU') {
        const c = run(COMPOSITES_CALC.core, m, {
          ...coreSeeds,
          core_splice_mm: { value: num('defaultCoreSpliceLength') ?? 0, source: 'Composites variable defaultCoreSpliceLength' },
          core_potted_holes: { value: num('defaultNumCorePottingRequired') ?? 0, source: 'Composites variable defaultNumCorePottingRequired' },
        });
        if ('reasons' in c) return fail(...c.reasons);
        coreSec = c.run.value!;
      }
      const engine = r.weights === 'HLU'
        ? { ply_placement_s: seed(placement, `the plies laid, each by Composites - Hand ply placement (${per.length} plies)`), core_placement_s: seed(coreSec, core ? 'the core placed (Composites - Core placement)' : 'no core'), ply_count: seed(stack.plies.length, 'plies in the stack') }
        : { ply_placement_s: seed(placement, `the plies laid, each by Composites - Automated ply placement (${per.length} plies)`) };
      const outcome = timed(r.weights === 'HLU' ? COMPOSITES_CALC.handLayup : COMPOSITES_CALC.autoLayup, m, engine);
      return outcome.ok ? { ...outcome, perPly: per, coreSec } as StepOutcome : outcome;
    }, r.weights === 'HLU' ? ['The clean room cell takes the tool'] : ['Its table takes the tool', 'A band width for the material']);

    const withPlies = (s: CostedStep, kind: 'cut' | 'layup'): ProcessLineCost => {
      const per = (s.outcome as { perPly?: Array<{ ply: CompositePly; sec: number }>; coreSec?: number } | null)?.perPly;
      if (!per) return s.line;
      const breakdown: FeatureOp[] = per.map(({ ply, sec }) => ({
        name: `Ply ${ply.index}${ply.level > 0 ? ` (drop-off level ${ply.level})` : ''}`, featureType: 'Ply', timeSec: r2(sec), count: 1,
        featureIds: ['laminate-zones'], occurrenceRefs: [{ featureId: 'laminate-zones', occurrenceIndex: ply.level }],
      }));
      const coreSec = (s.outcome as { coreSec?: number }).coreSec ?? 0;
      if (kind === 'layup' && core && coreSec > 0) breakdown.push({ name: 'Core', featureType: 'Core', timeSec: r2(coreSec), count: 1, featureIds: ['laminate-zones'], occurrenceRefs: [{ featureId: 'laminate-zones', occurrenceIndex: core.level }] });
      return { ...s.line, featureBreakdown: breakdown, formsPartFeatures: kind === 'layup' };
    };
    const steps = [toolClean, moldPrep, cut, layup, bag, cure, bench];
    const lines: ProcessLineCost[] = [
      { ...toolClean.line, actsOnWholePart: true }, { ...moldPrep.line, actsOnWholePart: true }, withPlies(cut, 'cut'), withPlies(layup, 'layup'),
      { ...bag.line, actsOnWholePart: true }, { ...cure.line, actsOnWholePart: true }, { ...bench.line, actsOnWholePart: true },
    ];
    const complete = !lines.some(isGap);
    const materialCost = plyCost + coreCost;
    routes.push({
      key: r.key, label: r.label, stack, lines,
      material: {
        plyCostUsd: plyCost, coreCostUsd: coreCost, costUsd: materialCost, boughtAreaM2: r4(boughtArea / 1e6), plyMassKg: r4(plyMass),
        costPerKgUsd: plyMass > 0 ? materialCost / plyMass : null, runs: materialRuns,
      },
      partsPerLoad: partsPerLoad != null ? r3(partsPerLoad) : null,
      totalUsd: complete ? r2(materialCost + lines.reduce((s, l) => s + l.totalCost, 0)) : null, complete,
      warnings: [
        ...warnings, ...steps.flatMap((s) => s.warnings),
        ...[...uncrewed].map((c) => `The ${c} machines give a labour rate but no number of operators: each is costed with one operator.`),
        'The layup tool is not costed: memory/Composites holds no tool cost or tool life.',
      ],
    });
  }
  return { routes, gaps, missing: [] };
}

/** The route to quote: the one set in the Cost Guide when it is a route for the part, else the cheapest complete one; and a note saying which and why. */
export function chooseCompositesRoute(routes: readonly CompositesRoute[], gaps: readonly CompositesRouteGap[], chosen: CompositesRouteKey | null): { route: CompositesRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: CompositesRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${r.lines.filter(isGap).map((l) => l.process).join(', ')})`);
  const others = (pick: CompositesRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Composites: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const pick = complete[0] ?? [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0]!;
  const why = complete[0] ? 'the cheapest complete layup route (material and process per part)' : 'no route is complete: the one with the fewest gaps';
  const own = pick.complete ? ` (${money(pick.totalUsd!)} per part)` : '';
  return { route: pick, note: `Composites: ${pick.label} is quoted${own}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
