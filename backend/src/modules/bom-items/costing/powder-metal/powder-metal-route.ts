// The powder metal route, built from memory/Powder metal: the powder pressed to its green density in a die on a compaction press, then
// sintered on a mesh belt furnace. Each step on the cheapest capable machine.
//
//   compaction pressing  the press must deliver the compaction force (the powder's compaction curve at its green density, over the part's
//                        outline along the press direction) within its safety factor, take the fill (the part's height x the compression
//                        ratio) and fit the part under its upper punch; one part per stroke at the press's rated stroke rate
//   furnace sintering    the belt runs so a part soaks the soak time in the heat zone; the part must pass under the muffle; the time per
//                        part is the belt's throughput (parts across the belt, parts per metre within the belt load)
//
// Pure: the caller loads the reference data, the calculators, the machines and the part's measurements along the press direction (the
// cad-engine's die-direction measurements, forging/feature_extractor.py). Every number is computed by a calculator of
// calculators/powder-metal-calculators.json. Nothing is substituted: what the data or the measurements lack is named, and a step no machine
// can do is a named gap line, which makes the route incomplete.
import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import type { CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, valuesProvider, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type SandMaterial, type StepOutcome } from '../casting/sand/sand-steps';
import type { ForgingHole } from '../forging/forging-route';

export const POWDER_METAL_DOMAIN = 'powder_metal';
export const POWDER_METAL_PROCESS_GROUP = 'Powder Metal';

/** The HR Rates machine classes of the route's steps. */
export const POWDER_METAL_CLASS = {
  press: 'powder_metal_compaction_pressing',
  furnace: 'powder_metal_furnace_sintering',
} as const;
export const POWDER_METAL_ROUTE_CLASSES: readonly string[] = Object.values(POWDER_METAL_CLASS);

export const POWDER_METAL_ROUTE_LABEL = 'Press and sinter';

const CALC = (name: string) => `Powder Metal - ${name}`;
export const POWDER = CALC('Powder');
export const COMPACTION_PRESSURE = CALC('Compaction pressure');
export const PRESS_FORCE = CALC('Press force');
export const FILL_HEIGHT = CALC('Fill height');

/** A hole of the part, as the die-direction measurements report it (along or across the press direction): the forging measurement itself. */
export type PowderMetalHole = ForgingHole;

/** The part along its press direction (the die direction of the cad-engine's measurements). */
export interface PowderMetalPart {
  volumeMm3: number;
  /** Its outline along the press direction: the area the punches press. */
  projectedAreaMm2: number;
  /** Its height along the press direction. */
  heightMm: number;
  /** Its extents across the press direction (the plan), long side first. */
  planLengthMm: number;
  planWidthMm: number;
  holes: readonly PowderMetalHole[];
}

export interface PowderMetalScenario {
  batchSize: number;
  /** The green density the part is pressed to (kg/m³); null: the powder's own (Green Density). It must lie within the powder's range. */
  greenDensityKgM3: number | null;
}

export interface PowderMetalRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  /** The powder: its price (unit_cost_usd_per_kg) and the properties of raw_material_properties (green_density, apparent_density, ...). */
  material: SandMaterial;
  part: PowderMetalPart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: PowderMetalScenario;
  costContext: CostContext;
}

export interface PowderMetalRoute {
  label: string;
  /** The green density the part is pressed to (kg/m³), and whether it is the powder's own. */
  greenDensityKgM3: number;
  greenDensitySource: 'material' | 'scenario';
  compactionPressureMpa: number;
  pressForceKn: number;
  fillHeightMm: number;
  compressionRatio: number;
  /** The sintering belt: its speed (mm/min) and the parts it carries across and per metre. */
  belt: { speedMmPerMin: number; partsAcross: number; partsPerMetre: number } | null;
  /** Route lines in order, costs per part in USD. */
  lines: ProcessLineCost[];
  /** The powder bought for one part: its cost (USD, unrounded: a cents-rounded USD cost loses ~1% once converted) and its price per kg. */
  material: { partKg: number; powderKg: number; utilizationPct: number; costUsd: number; costPerKgUsd: number; runs: Record<string, ReferenceCalcRun> };
  /** Material + process lines per part (USD); null while a line is a gap. */
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });

/** The route of the part, or what keeps it from being built. */
export function buildPowderMetalRoute(input: PowderMetalRouteInput): { route: PowderMetalRoute | null; missing: string[] } {
  const { ref, part, scenario, material } = input;
  const none = (...missing: string[]) => ({ route: null, missing });
  const num = (name: string) => ref.number(name);

  // The green density: the engineer's, within the powder's range, else the powder's own.
  const [own, min, max] = ['green_density', 'min_green_density', 'max_green_density'].map((k) => material.columns[k] ?? null);
  if (own == null || !(own > 0)) return none(`${material.name}: green_density`);
  const asked = scenario.greenDensityKgM3;
  if (asked != null && ((min != null && asked < min) || (max != null && asked > max))) {
    return none(`a green density of ${asked} kg/m³ is outside ${material.name}'s range (${min ?? '?'} to ${max ?? '?'} kg/m³)`);
  }
  const greenDensity = asked ?? own;
  const greenSeed: CalcSeed = asked != null
    ? { value: greenDensity, source: 'green density, set in the Cost Guide' }
    : { value: greenDensity, source: `${material.name}: green_density`, ref: { kind: 'material', materialId: material.id, materialName: material.name, column: 'green_density' } };

  // ── Calculator runs: every input seeded from its declared source ───────────────────────────────────────────────────────────────────
  const variable: SeedProvider = (name) => {
    const value = num(name);
    return value == null ? null : { value, source: `Powder metal variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: POWDER_METAL_DOMAIN, name } };
  };
  const cad: Record<string, CalcSeed | undefined> = {
    // Each with the faces it was measured on (feature_graph_v2.measurements), for the calculator dialog's eye.
    volume_mm3: { value: part.volumeMm3, source: 'part volume (mm³)', ref: { kind: 'cad', evidence: 'part_volume' } },
    projected_area_mm2: { value: part.projectedAreaMm2, source: 'outline along the press direction (mm²)', ref: { kind: 'cad', evidence: 'projected_area' } },
    die_depth_mm: { value: part.heightMm, source: "the part's height along the press direction (mm)", ref: { kind: 'cad', evidence: 'die_depth' } },
  };
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, output = 'Cycle Time'): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, cad: valuesProvider(cad), engine: valuesProvider({ green_density_kg_m3: greenSeed, ...engine }), lookup: valuesProvider({}), scenario: valuesProvider({}),
      material: (key) => {
        const value = material.columns[key];
        return value == null ? null : { value, source: `${material.name}: ${key}`, ref: { kind: 'material', materialId: material.id, materialName: material.name, column: key } };
      },
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
    const result = runReferenceCalculator(input.calculators, calculator, seeds, output);
    return result.value == null ? { reasons: result.missing } : { run: result };
  };
  const step = (process: string, machineClass: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({
      process, machineClass, machines: input.machinesByClass[machineClass] ?? [], evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, processGroup: POWDER_METAL_PROCESS_GROUP,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined> = {}): StepOutcome => {
    const r = run(calculator, m, engine);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
  };

  // ── The powder, the pressure, the force and the fill ─────────────────────────────────────────────────────────────────────────────
  const powder = run(POWDER, null, {}, 'Material Cost');
  if ('reasons' in powder) return none(...powder.reasons);
  const pressure = run(COMPACTION_PRESSURE, null, {}, 'Compaction Pressure');
  if ('reasons' in pressure) return none(...pressure.reasons);
  const mpa = pressure.run.value!;
  if (!(mpa > 0)) return none(`${material.name}'s compaction curve gives no positive pressure at ${greenDensity} kg/m³`);
  const pressureSeed: CalcSeed = { value: mpa, source: `compaction pressure at ${greenDensity} kg/m³ (Compaction pressure)` };
  const force = run(PRESS_FORCE, null, { compaction_pressure_mpa: pressureSeed }, 'Required Force');
  if ('reasons' in force) return none(...force.reasons);
  const fill = run(FILL_HEIGHT, null, {}, 'Fill Height');
  if ('reasons' in fill) return none(...fill.reasons);
  const forceKn = force.run.value!;
  const fillMm = fill.run.value!;
  const partKg = powder.run.outputs['Part Mass']!;
  // The part's outline must sit within the upper punch: its diagonal across the press direction.
  const diagonal = Math.hypot(part.planLengthMm, part.planWidthMm);

  const press = step('Compaction Pressing', POWDER_METAL_CLASS.press, (m) => {
    const [rated, safety, maxFill, punch] = ['press_force_kn', 'press_force_safety_factor', 'max_fill_height_mm', 'upper_punch_diameter_mm'].map((k) => machineValue(m, k));
    if (rated == null || maxFill == null) return fail(`machine ${m.name}: press force and fill height`);
    const usable = rated * (safety ?? num('pressForceSaftyFactor') ?? 1);
    if (usable < forceKn) return fail(`delivers ${Math.round(usable)} kN within its safety factor, compaction needs ${Math.round(forceKn)} kN`);
    if (maxFill < fillMm) return fail(`fills ${maxFill} mm deep, the part needs ${r2(fillMm)} mm of powder`);
    if (punch != null && punch < diagonal) return fail(`its upper punch is ${punch} mm across, the part ${Math.round(diagonal)} mm`);
    return timed(CALC('Compaction'), m);
  }, ['It delivers the compaction force within its safety factor', 'It fills the powder depth', 'The part fits under its upper punch']);

  // Sintering: the part laid flat on the belt (its press direction up), its long side along the belt.
  const sinter = step('Furnace Sintering', POWDER_METAL_CLASS.furnace, (m) => {
    const muffle = machineValue(m, 'max_muffle');
    if (muffle != null && muffle < part.heightMm) return fail(`its muffle is ${muffle} mm high, the part ${r2(part.heightMm)} mm`);
    const outcome = timed(CALC('Sintering'), m, {
      part_length_mm: { value: part.planLengthMm, source: "the part's long side across the press direction, along the belt (mm)", ref: { kind: 'cad', evidence: 'plan_length' } },
      part_width_mm: { value: part.planWidthMm, source: "the part's short side across the press direction, across the belt (mm)", ref: { kind: 'cad', evidence: 'plan_width' } },
      part_kg: { value: partKg, source: 'part mass: volume x green density (Powder)' },
    });
    if (outcome.ok && !(outcome.run!.outputs['Parts Across']! >= 1)) return fail(`its belt is ${machineValue(m, 'belt_width_mm')} mm wide: no part fits between the edge offsets`);
    return outcome;
  }, ['The part passes under its muffle', 'The part fits across its belt']);
  // The belt of the furnace chosen.
  const beltRun = sinter.outcome?.run?.outputs;
  const belt: PowderMetalRoute['belt'] = beltRun
    ? { speedMmPerMin: r2(beltRun['Belt Speed']!), partsAcross: beltRun['Parts Across']!, partsPerMetre: r2(beltRun['Parts per Metre']!) }
    : null;

  // The process tree: compaction forms the part's features; sintering acts on the whole part.
  const lines = [{ ...press.line, formsPartFeatures: true }, { ...sinter.line, actsOnWholePart: true }];
  const complete = lines.every((l) => l.physicsGap == null);
  const materialCost = powder.run.value!;
  const utilization = num('defaultUtilization');
  const warnings = [
    ...press.warnings, ...sinter.warnings,
    `Compaction to ${greenDensity} kg/m³ takes ${r2(mpa)} MPa (${material.name}'s compaction curve): ${r2(forceKn)} kN over the part's ${r2(part.projectedAreaMm2)} mm² outline, from ${r2(fillMm)} mm of powder (compression ratio ${r2(fill.run.outputs['Compression Ratio']!)}).`,
    'The press runs at its rated stroke rate: the data gives no slower stroke for a deep fill.',
    ...(belt ? [`Sintering: the belt runs at ${belt.speedMmPerMin} mm/min (the heat zone over the soak time, within the belt's speed range read as inches per minute), carrying ${belt.partsAcross} across and ${belt.partsPerMetre} per metre.`] : []),
    `The powder is bought at the material utilization ${utilization ?? '?'} (defaultUtilization).`,
    'The compaction tooling (die, punches, core rods) is not costed: the data gives its life (toolLifeNumberOfParts) and the tool shop rate, but no tooling cost or hours.',
    'Whether the part can be pressed (no undercut across the press direction, walls and height a die can fill) is not checked: the data has no pressability rules.',
  ];
  return {
    route: {
      label: POWDER_METAL_ROUTE_LABEL, greenDensityKgM3: greenDensity, greenDensitySource: asked != null ? 'scenario' : 'material',
      compactionPressureMpa: r2(mpa), pressForceKn: r2(forceKn), fillHeightMm: r2(fillMm), compressionRatio: r2(fill.run.outputs['Compression Ratio']!),
      belt, lines,
      material: {
        partKg: r4(partKg), powderKg: r4(powder.run.outputs['Powder Mass']!), utilizationPct: r2(100 * (utilization ?? 1)), costUsd: materialCost, costPerKgUsd: materialCost / powder.run.outputs['Powder Mass']!,
        runs: { powder: powder.run, compactionPressure: pressure.run, pressForce: force.run, fillHeight: fill.run },
      },
      totalUsd: complete ? r2(materialCost + lines.reduce((s, l) => s + l.totalCost, 0)) : null, complete, warnings,
    },
    missing: [],
  };
}
