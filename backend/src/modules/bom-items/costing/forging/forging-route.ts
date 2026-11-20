// The routes of a hot forging, built from memory/Forging, each priced in full so the cheapest complete one is quoted (or the one the engineer
// chose in the Cost Guide):
//
//   closed die, screw press      bar sawn into mults, heated, forged on the press (upset, block, finish blows), flash trimmed
//   closed die, die hammer       the same, forged on a hammer that delivers the blow energy
//   closed die, mechanical press the same, on a multi-station mechanical press with a transfer system (every station strikes each stroke)
//   open die                     a flashless shape upset between flat dies on an open die press; no part-specific dies
//   ring rolling                 a ring: the mult upset, punched and pierced into a preform on the open die press, then rolled out
//
// A mult is heated in a conveyor induction coil when it suits one, else in a gas furnace. Pure: the caller loads the reference data, the
// calculators, the machines and the part's measurements (cad-engine forging/feature_extractor.py). Every number is computed by a calculator
// of calculators/forging-calculators.json. Nothing is substituted: what the data or the measurements lack is named, and a step no machine
// can do is a named gap line, which makes its route incomplete.
import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import { gap, type CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, valuesProvider, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type SandMaterial, type StepOutcome } from '../casting/sand/sand-steps';
import { cutCodeFamilyOf } from '../shared/core/cut-code';

export const FORGING_DOMAIN = 'forging';
export const FORGING_PROCESS_GROUP = 'Forging';

/** The HR Rates machine classes of the routes' steps (migration 823). */
export const FORGING_CLASS = {
  bandSaw: 'forging_band_saw',
  induction: 'forging_conveyor_induction_heat',
  furnace: 'forging_oven_furnace',
  press: 'forging_press',
  hammer: 'forging_hammer',
  mechanicalPress: 'forging_mechanical_press',
  openDie: 'forging_open_die_press',
  ringRolling: 'forging_ring_rolling',
  trim: 'forging_trim',
} as const;
export const FORGING_ROUTE_CLASSES: readonly string[] = Object.values(FORGING_CLASS);

export const FORGING_ROUTES = [
  { key: 'closed_die_press', label: 'Closed-die forging · screw press' },
  { key: 'closed_die_hammer', label: 'Closed-die forging · die hammer' },
  { key: 'closed_die_mechanical_press', label: 'Closed-die forging · mechanical press' },
  { key: 'open_die', label: 'Open-die forging' },
  { key: 'ring_rolling', label: 'Ring rolling' },
] as const;
export type ForgingRouteKey = (typeof FORGING_ROUTES)[number]['key'];
const labelOf = (key: ForgingRouteKey) => FORGING_ROUTES.find((r) => r.key === key)!.label;

/** The steps that form the part's shape (the others saw, heat or trim it). */
const FORMING_PROCESSES: ReadonlySet<string> = new Set(['Press', 'Hammer', 'Mechanical Press', 'Open Die Press', 'Ring Rolling']);

const CALC = (name: string) => `Forging - ${name}`;
export const FORGED_VOLUME = CALC('Forged volume');
export const FLASH_LAND = CALC('Flash land');
export const STOCK = CALC('Bar stock');
export const PRESS_FORCE = CALC('Press force');
export const TRIM_FORCE = CALC('Trim force');
export const DIES = CALC('Dies');
export const HAMMER_ENERGY = CALC('Hammer energy');
export const OPEN_DIE_FORCE = CALC('Open die force');
export const RING_PREFORM = CALC('Ring preform');

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface ForgingHole {
  diameterMm: number;
  depthMm: number | null;
  /** The angle between the hole's axis and the die direction (deg). */
  angleToDieDeg: number | null;
  /** 'through' or 'blind'. */
  variant: string;
}

export interface ForgingPart {
  volumeMm3: number;
  /** The part's outline on the parting plane (mm²) and its length, the parting line (mm): measured along the die direction. */
  projectedAreaMm2: number;
  partingPerimeterMm: number;
  /** The part's extent along the die direction (mm); null when not measured (open die and ring rolling need it). */
  dieDepthMm: number | null;
  /** The part's long and cross extents in the parting plane (mm); null when not measured (the die block cannot be sized). */
  planLengthMm: number | null;
  planWidthMm: number | null;
  holes: readonly ForgingHole[];
}

export interface ForgingScenario {
  batchSize: number;
  /** The part complexity score (1 to 12) the flash and the press force are read by; null: the data's least 3D score (min3DComplexityScore), said so. */
  complexity: number | null;
  /** The route the engineer chose; null: the cheapest complete one. */
  route: ForgingRouteKey | null;
  /** Parts made over the dies' life; null: the dies are not costed (and said so), never spread over an assumed volume. */
  lifetimeVolume: number | null;
  /** What the engineer set in the Cost Guide in place of the engine's choice; absent or null: the engine decides. */
  overrides?: ForgingOverrides;
}

/** The forging settings an engineer can set over the engine's (Cost Guide). Each null is the engine's own. */
export interface ForgingOverrides {
  /** The round bar the mults are sawn from (mm); the mult length follows. */
  barDiameterMm?: number | null;
  heating?: 'induction' | 'furnace' | null;
  /** Blows of the screw press and the hammer (the mechanical press strikes once per station). */
  hits?: number | null;
  /** The flash land (mm): its width adds to the area the press force acts on, its thickness is what the trim shears. */
  flashThicknessMm?: number | null;
  flashWidthMm?: number | null;
}

export interface ForgingRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  /** The forging material: raw_materials columns and raw_material_properties (round_bar_unit_cost, strength_coefficient, ...). */
  material: SandMaterial;
  part: ForgingPart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  /** The tool shop's machining rate (USD/hr), which the finishing die's cavity is machined at; null when not on file (dies not costed). */
  toolShopMachiningUsdPerHr: number | null;
  scenario: ForgingScenario;
  costContext: CostContext;
}

export interface ForgingRoute {
  key: ForgingRouteKey;
  label: string;
  complexity: number;
  barDiameterMm: number;
  multLengthMm: number;
  /** How the mult is heated. */
  heating: 'induction' | 'furnace';
  hits: number;
  /** The force (kN) or, on a hammer, the blow energy (J) the forming step needs. */
  forming: { quantity: 'force_kn' | 'energy_j'; value: number };
  trimForceKn: number | null;
  flash: { thicknessMm: number; widthMm: number; volumeMm3: number } | null;
  /** Route lines in order, costs per part in USD. */
  lines: ProcessLineCost[];
  /** The bar bought for one part: its cost (USD, unrounded: a cents-rounded USD cost loses ~1% once converted) and its price per kg. */
  material: { netKg: number; forgedKg: number; boughtKg: number; yieldPct: number; costUsd: number; costPerKgUsd: number; runs: Record<string, ReferenceCalcRun> };
  tooling: { dieSets: number; finishDieUsd: number; trimDieUsd: number; toolingCostUsd: number; perPartUsd: number; run: ReferenceCalcRun } | null;
  /** Material + process lines + tooling per part (USD); null while a line is a gap. */
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

/** A route that could not be built, and why. */
export interface ForgingRouteGap { key: ForgingRouteKey; label: string; reason: string }

type Row = Readonly<Record<string, unknown>>;
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });

/** The first row whose `column` is at or above `value` (rows ascending by it), else the last row: the heaviest band covers anything heavier. */
function bandRow(rows: readonly Row[], column: string, value: number): Row | undefined {
  const sorted = [...rows].sort((a, b) => Number(a[column]) - Number(b[column]));
  return sorted.find((r) => Number(r[column]) >= value) ?? sorted[sorted.length - 1];
}

/**
 * A ring: round in plan (its two plan extents within 10 % of each other) with a through hole along the die direction, of at least the least
 * forgeable hole diameter, as its bore. Returns the ring's outside and bore diameters; null when the part is not one.
 */
export function ringOf(part: ForgingPart, minHoleMm: number): { outsideMm: number; boreMm: number; heightMm: number } | null {
  const { planLengthMm: l, planWidthMm: w, dieDepthMm: h } = part;
  if (l == null || w == null || h == null || l <= 0 || w <= 0 || Math.abs(l - w) / Math.max(l, w) > 0.1) return null;
  const bores = part.holes.filter((x) => x.variant === 'through' && x.angleToDieDeg != null && x.angleToDieDeg <= 5 && x.diameterMm >= minHoleMm && x.diameterMm < Math.min(l, w));
  const bore = bores.sort((a, b) => b.diameterMm - a.diameterMm)[0];
  return bore ? { outsideMm: Math.max(l, w), boreMm: bore.diameterMm, heightMm: h } : null;
}

/** The routes of the part (each complete or with its gaps), the routes that could not be built and why, and what keeps every route from being built. */
export function buildForgingRoutes(input: ForgingRouteInput): { routes: ForgingRoute[]; gaps: ForgingRouteGap[]; missing: string[] } {
  const { ref, part, scenario, material } = input;
  const overrides: ForgingOverrides = scenario.overrides ?? {};
  const none = (...missing: string[]) => ({ routes: [], gaps: [], missing });
  const num = (name: string) => ref.number(name);
  const table = (name: string) => ref.table(`forging_${name}`);
  const enabled = (name: string) => ref.text(name) === 'true';
  const density = material.columns['density_kg_m3'];
  if (density == null || !(density > 0)) return none(`${material.name}: density_kg_m3`);

  // ── Calculator runs: every input seeded from its declared source ───────────────────────────────────────────────────────────────────
  const variable: SeedProvider = (name) => {
    const value = num(name);
    return value == null ? null : { value, source: `Forging variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: FORGING_DOMAIN, name } };
  };
  /** A value of a reference table's row, with the row it is (its identifying columns) for the trace and the table viewer. */
  const rowSeed = (tableName: string, row: Row, column: string, identity: readonly string[]): CalcSeed | undefined => {
    const value = Number(row[column]);
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    const label = identity.map((c) => `${c} ${row[c]}`).join(', ');
    return row[column] == null || !Number.isFinite(value) ? undefined : {
      value, source: `${tableName} (${label}): ${column}`, lookup: true, match: { table: `forging_${tableName}`, row: id },
      ref: { kind: 'lookup', domain: FORGING_DOMAIN, table: `forging_${tableName}`, column, row: id },
    };
  };
  const cad: Record<string, CalcSeed | undefined> = {
    // Each with the faces it was measured on (feature_graph_v2.measurements), for the calculator dialog's eye.
    volume_mm3: { value: part.volumeMm3, source: 'part volume (mm³)', ref: { kind: 'cad', evidence: 'part_volume' } },
    projected_area_mm2: { value: part.projectedAreaMm2, source: 'outline on the parting plane, along the die direction (mm²)', ref: { kind: 'cad', evidence: 'projected_area' } },
    parting_perimeter_mm: { value: part.partingPerimeterMm, source: 'parting line: the length of that outline (mm)', ref: { kind: 'cad', evidence: 'parting_perimeter' } },
    die_depth_mm: part.dieDepthMm != null ? { value: part.dieDepthMm, source: "the part's extent along the die direction (mm)", ref: { kind: 'cad', evidence: 'die_depth' } } : undefined,
  };
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, output = 'Cycle Time', lookups: Record<string, CalcSeed | undefined> = {}, cadOverrides: Record<string, CalcSeed | undefined> = {}): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, cad: valuesProvider({ ...cad, ...cadOverrides }), engine: valuesProvider(engine), lookup: valuesProvider(lookups),
      scenario: valuesProvider({ lifetime_volume: scenario.lifetimeVolume != null ? { value: scenario.lifetimeVolume, source: 'annual volume x production life' } : undefined }),
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
  const step = (process: string, machineClass: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[], machines?: readonly SandMachine[]): CostedStep =>
    selectAndCost({
      process, machineClass, machines: machines ?? input.machinesByClass[machineClass] ?? [], evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, partName: 'forging', processGroup: FORGING_PROCESS_GROUP,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): StepOutcome => {
    const r = run(calculator, m, engine, 'Cycle Time', lookups);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
  };
  const handling = (tableName: string, kg: number, column: 'Load Time (s)' | 'Unload Time (s)'): CalcSeed | undefined => {
    const row = bandRow(table(tableName), 'Weight (kg)', kg);
    return row ? rowSeed(tableName, row, column, ['Weight (kg)']) : undefined;
  };

  // ── What every route shares: the complexity, the bar sizes, the heating limits ──────────────────────────────────────────────────────
  const minComplex = num('min3DComplexityScore');
  const complexity = scenario.complexity ?? minComplex;
  if (complexity == null) return none('forging variable min3DComplexityScore');
  const complexityRow = table('partComplexityBasedData').find((r) => Number(r['Part Complexity']) === Math.round(complexity));
  if (!complexityRow) return none(`forging lookup partComplexityBasedData has no row for complexity ${complexity}`);
  const flashPct = Number(complexityRow['Hot Forging - Flash Percentage Volume']);
  const [minRatio, maxRatio, maxInductionWidth, minInductionRatio, scaleInduction, scaleFurnace, minHole] = [
    'minBilletRatio', 'maxBilletRatio', 'inductionHeatMaxStockWidth', 'inductionHeatMinMultRatio',
    'scaleLossAllowancePercentageInductionHeating', 'scaleLossAllowancePercentage', 'minForgeableHoleDiameter',
  ].map(num);
  if ([minRatio, maxRatio, maxInductionWidth, minInductionRatio, scaleInduction, scaleFurnace, minHole].some((v) => v == null)) {
    return none('forging variables minBilletRatio, maxBilletRatio, inductionHeatMaxStockWidth, inductionHeatMinMultRatio, scaleLossAllowancePercentage(InductionHeating), minForgeableHoleDiameter');
  }
  const bars = table('roundBarSizes').map((r) => Number(r['Size (mm)'])).filter((d) => d > 0).sort((a, b) => a - b);
  if (bars.length === 0) return none('forging lookup roundBarSizes (not staged, migration 823)');
  const sawRows = table('bandSawCutting');
  const cutCode = material.columns['cut_code'];
  const family = cutCodeFamilyOf(new Set(sawRows.map((r) => String(r['Material Cut Code Family']))), cutCode);
  const flashLookup = rowSeed('partComplexityBasedData', complexityRow, 'Hot Forging - Flash Percentage Volume', ['Part Complexity']);
  const spmLookup = rowSeed('partComplexityBasedData', complexityRow, 'SPM-Mechanical Press with Transfer System-High Production Volume', ['Part Complexity']);
  const complexityNote = scenario.complexity == null
    ? `Part complexity ${complexity} is the forging data's least score for a 3D part (min3DComplexityScore): set it in the Cost Guide (1 to 12) when the part is simpler or more complex.`
    : null;

  /**
   * The mult of a route: the metal it forges (as the scale of its heating adds), the bar it is sawn from, the heating that suits it, and the
   * steps that make it: the band saw and the heating. `metal(scale)` is the mult volume for a scale loss percentage, with the run behind it.
   */
  const multOf = (metal: (scale: number) => { volumeMm3: number; run: ReferenceCalcRun } | { reasons: string[] }) => {
    // The thinnest bar that keeps the mult within the billet ratio range; induction heating when that bar and mult suit a coil.
    // The engineer's bar and heating (Cost Guide) stand in for these choices; the machines still have to take them.
    const pickBar = (v: number) => overrides.barDiameterMm ?? bars.find((d) => { const ratio = (4 * v) / (Math.PI * d ** 3); return ratio <= maxRatio! && ratio >= minRatio!; });
    const forced = overrides.heating ?? null;
    let m = metal(forced === 'furnace' ? scaleFurnace! : scaleInduction!);
    if ('reasons' in m) return m;
    let bar = pickBar(m.volumeMm3);
    const induction = forced != null ? forced === 'induction'
      : bar != null && bar <= maxInductionWidth! && (4 * m.volumeMm3) / (Math.PI * bar ** 3) >= minInductionRatio!;
    if (!induction && forced == null) {
      m = metal(scaleFurnace!);
      if ('reasons' in m) return m;
      bar = pickBar(m.volumeMm3);
    }
    if (bar == null) return { reasons: [`no round bar of roundBarSizes gives a mult between ${minRatio} and ${maxRatio} times its diameter long (minBilletRatio, maxBilletRatio)`] };
    const ratio = (4 * m.volumeMm3) / (Math.PI * bar ** 3);
    const barSeed: CalcSeed = overrides.barDiameterMm != null
      ? { value: bar, source: `round bar ${bar} mm, set in the Cost Guide` }
      : { value: bar, source: `round bar ${bar} mm (roundBarSizes: the thinnest that keeps the mult within the billet ratio range)` };
    const setNotes = [
      ...(overrides.barDiameterMm != null ? [`The bar is ${bar} mm as set in the Cost Guide${ratio > maxRatio! || ratio < minRatio! ? `: its mult is ${r2(ratio)} diameters long, outside the billet ratio range ${minRatio} to ${maxRatio} (minBilletRatio, maxBilletRatio)` : ''}.`] : []),
      ...(forced != null ? [`The mult is heated ${forced === 'induction' ? 'by induction' : 'in a gas furnace'}, as set in the Cost Guide.`] : []),
    ];
    const stock = run(STOCK, null, { mult_volume_mm3: { value: m.volumeMm3, source: 'mult volume' }, bar_diameter_mm: barSeed }, 'Material Cost');
    if ('reasons' in stock) return stock;
    const multLength = stock.run.outputs['Mult Length']!;
    const multKg = m.volumeMm3 * 1e-9 * density;
    const barKg = (Math.PI * bar ** 2 / 4) * (num('standardStockLength') ?? 0) * 1e-9 * density;
    const sawRow = family != null ? bandRow(sawRows.filter((r) => String(r['Material Cut Code Family']) === family), 'Material Width (mm)', bar) : undefined;
    const saw = step('Band Saw', FORGING_CLASS.bandSaw, (mc) => {
      if (!sawRow) return fail(`bandSawCutting has no row for cut code ${cutCode ?? '(none)'} of ${material.name}`);
      const takes = machineValue(mc, 'max_stock_diameter_mm');
      if (takes != null && bar! > takes) return fail(`takes bar up to ${takes} mm, the bar is ${bar} mm`);
      const unload = handling('bandSawHandling', multKg, 'Unload Time (s)');
      const load = handling('bandSawHandling', barKg, 'Load Time (s)');
      if (!unload || !load) return fail('forging lookup bandSawHandling (not staged)');
      return timed(CALC('Band saw'), mc, {
        bar_diameter_mm: barSeed, mult_unload_s: unload, bar_load_s: load,
        mults_per_bar: { value: stock.run.outputs['Mults per Bar']!, source: 'mults a standard bar gives (Bar stock)' },
      }, { 'forging_bandSawCutting.Cutting Rate (mm^2 / min)': rowSeed('bandSawCutting', sawRow, 'Cutting Rate (mm^2 / min)', ['Material Cut Code Family', 'Material Width (mm)']) });
    }, ['It takes the bar diameter', "A cutting rate for the material's cut code family"]);

    const coilRow = table('inductionHeating').find((r) => String(r['Material Type Name']) === material.materialType);
    const heat = induction
      ? step('Conveyor Induction Heat', FORGING_CLASS.induction, (mc) => {
        if (!coilRow) return fail(`inductionHeating has no row for material type ${material.materialType ?? '(none)'}`);
        const coil = machineValue(mc, 'maximum_coil_diameter_mm');
        if (coil != null && bar! > coil) return fail(`coil takes ${coil} mm, the bar is ${bar} mm`);
        return timed(CALC('Induction heating'), mc, { bar_diameter_mm: barSeed, mult_length_mm: { value: multLength, source: 'mult length (Bar stock)' } },
          { 'forging_inductionHeating.Heat Time Coefficient (s / mm^2)': rowSeed('inductionHeating', coilRow, 'Heat Time Coefficient (s / mm^2)', ['Material Type Name']) });
      }, ['The coil takes the bar diameter', 'A heat time coefficient for the material type'])
      : step('Preheat', FORGING_CLASS.furnace, (mc) => {
        // The furnace must run hotter than the forging temperature by ovenTemperatureOffset; its floor holds the mults standing on end,
        // each with the spacing ovenPartSpacingFactor of its diameter around it.
        const forgeC = material.columns['forging_temperature'];
        const [offset, spacing] = [num('ovenTemperatureOffset'), num('ovenPartSpacingFactor')];
        const [maxC, ovenL, ovenW, ovenH] = ['max_operating_temperature_c', 'oven_length_mm', 'oven_width_mm', 'oven_height_mm'].map((k) => machineValue(mc, k));
        if (forgeC == null) return fail(`${material.name}: forging_temperature`);
        if (offset == null || spacing == null) return fail('forging variables ovenTemperatureOffset and ovenPartSpacingFactor');
        if (maxC == null || ovenL == null || ovenW == null || ovenH == null) return fail(`machine ${mc.name}: operating temperature and oven size`);
        if (maxC < forgeC + offset) return fail(`reaches ${maxC} °C, the mult needs ${forgeC + offset} °C (forging temperature + ovenTemperatureOffset)`);
        if (multLength > ovenH) return fail(`the mult is ${r2(multLength)} mm long, the oven ${ovenH} mm high`);
        const pitch = bar! * (1 + spacing);
        const perLoad = Math.floor(ovenL / pitch) * Math.floor(ovenW / pitch);
        if (perLoad < 1) return fail(`the oven floor holds no ${bar} mm mult with its spacing`);
        return timed(CALC('Furnace heating'), mc, {
          mult_kg: { value: multKg, source: 'mult mass: mult volume x density' },
          mults_per_load: { value: Math.min(perLoad, scenario.batchSize), source: `mults standing on the oven floor at ${r2(pitch)} mm pitch (ovenPartSpacingFactor), at most the batch` },
        });
      }, ['It reaches the forging temperature plus ovenTemperatureOffset', 'The oven takes the mult standing'], input.machinesByClass[FORGING_CLASS.furnace] ?? []);
    const notes = [...setNotes, ...(induction || forced != null ? [] : ['The mult is heated in a gas furnace (too thick or short for an induction coil): its time is the heat the load takes at the furnace\'s rated power, a lower bound, as the reference gives no furnace efficiency.'])];
    return { bar, barSeed, multLength, multKg, induction, volumeMm3: m.volumeMm3, metalRun: m.run, stock, saw, heat, notes };
  };

  const netKg = part.volumeMm3 * 1e-9 * density;
  const toolLife = num('pressToolLifeNumberOfParts');
  const routes: ForgingRoute[] = [];
  const gaps: ForgingRouteGap[] = [];

  /** A route from its steps: its total, completeness and dies, as every route states them. */
  const finish = (args: {
    key: ForgingRouteKey; mult: Exclude<ReturnType<typeof multOf>, { reasons: string[] }>; forgedKg: number; steps: CostedStep[];
    hits: number; forming: ForgingRoute['forming']; trimForceKn: number | null; flash: ForgingRoute['flash'];
    runs: Record<string, ReferenceCalcRun>; dies: { forgedVolumeMm3: number; toolLifeVariable: string } | null; warnings: string[];
  }) => {
    const warnings = [...(complexityNote ? [complexityNote] : []), ...args.mult.notes, ...args.steps.flatMap((s) => s.warnings), ...args.warnings];
    let tooling: ForgingRoute['tooling'] = null;
    if (args.dies) {
      // The die cost calculator spreads the dies over pressToolLifeNumberOfParts: a route whose own tool life differs says so.
      const ownLife = num(args.dies.toolLifeVariable);
      if (ownLife != null && toolLife != null && ownLife !== toolLife) warnings.push(`The dies are spread over pressToolLifeNumberOfParts (${toolLife}); this route's own ${args.dies.toolLifeVariable} is ${ownLife}.`);
      if (scenario.lifetimeVolume == null) warnings.push('The forging dies are not costed: they are amortised over annual volume x production life, and one of them is not set.');
      else if (input.toolShopMachiningUsdPerHr == null) warnings.push('The forging dies are not costed: the tool shop machining rate is not on file.');
      else {
        const t = run(DIES, null, {
          forged_volume_mm3: { value: args.dies.forgedVolumeMm3, source: 'forged volume: the cavity of the finishing die (Forged volume)' },
          tool_shop_machining_usd_per_hr: { value: input.toolShopMachiningUsdPerHr, source: 'tool shop machining rate (digital factory settings, USA)' },
        }, 'Cost per Part');
        if ('run' in t) {
          const o = t.run.outputs;
          tooling = { dieSets: o['Die Sets']!, finishDieUsd: r2(o['Finish Die Cost']!), trimDieUsd: r2(num('minTrimDieCostWithOutMaterial') ?? 0), toolingCostUsd: r2(o['Tooling Cost']!), perPartUsd: r4(t.run.value!), run: t.run };
          if (o['Machined Die Cost']! !== o['Finish Die Cost']!) {
            warnings.push(`The finishing die machines to ${r2(o['Machined Die Cost']!)} USD, outside the range the forging data holds valid (minFinishDieCost to maxFinishDieCost): it is priced at ${r2(o['Finish Die Cost']!)} USD.`);
          }
          warnings.push('The trim die is priced at the least cost the forging data holds valid (minTrimDieCostWithOutMaterial): the data gives no trim die formula.');
        } else warnings.push(`The forging dies are not costed: ${t.reasons.join('; ')}`);
      }
    } else warnings.push('No part-specific dies: the route forges between the press\'s flat dies and tools.');
    // The process tree: the forming steps list the part's features, the others (saw, heat, trim) act on the whole part.
    const lines = args.steps.map((s) => (FORMING_PROCESSES.has(s.line.process) ? { ...s.line, formsPartFeatures: true } : { ...s.line, actsOnWholePart: true }));
    const toolingPerPart = tooling && ref.text('disableInvestmentAmortization') !== 'true' ? tooling.perPartUsd : 0;
    const materialCost = args.mult.stock.run.value!;
    const complete = !lines.some(isGap);
    const boughtKg = args.mult.stock.run.outputs['Bought Mass']!;
    routes.push({
      key: args.key, label: labelOf(args.key), complexity, barDiameterMm: args.mult.bar, multLengthMm: r2(args.mult.multLength),
      heating: args.mult.induction ? 'induction' : 'furnace', hits: args.hits, forming: { ...args.forming, value: r2(args.forming.value) },
      trimForceKn: args.trimForceKn != null ? r2(args.trimForceKn) : null, flash: args.flash, lines,
      material: { netKg: r4(netKg), forgedKg: r4(args.forgedKg), boughtKg: r4(boughtKg), yieldPct: r2((100 * netKg) / boughtKg), costUsd: materialCost, costPerKgUsd: materialCost / boughtKg, runs: { ...args.runs, stock: args.mult.stock.run } },
      tooling, totalUsd: complete ? r2(materialCost + lines.reduce((s, l) => s + l.totalCost, 0) + toolingPerPart) : null, complete, warnings,
    });
  };

  // ── Closed die: the forged volume with its flash, the flash land, the trim; then one forming step per machine kind ──────────────────────
  const closedMult = multOf((scale) => {
    const r = run(FORGED_VOLUME, null, { scale_loss_pct: { value: scale, source: `scale loss of the heating (${scale === scaleInduction ? 'scaleLossAllowancePercentageInductionHeating' : 'scaleLossAllowancePercentage'})` } }, 'Mult Volume',
      { 'forging_partComplexityBasedData.Hot Forging - Flash Percentage Volume': flashLookup });
    return 'run' in r ? { volumeMm3: r.run.value!, run: r.run } : r;
  });
  if ('reasons' in closedMult) return none(...closedMult.reasons);
  const forgedVolume = closedMult.metalRun.outputs['Forged Volume']!;
  const forgedKg = forgedVolume * 1e-9 * density;
  const flash = run(FLASH_LAND, null, { forged_kg: { value: forgedKg, source: 'forged mass: forged volume x density' } }, 'Flash Thickness');
  if ('reasons' in flash) return none(...flash.reasons);
  // Vieregge's flash land, unless the engineer set it (Cost Guide): the width spreads the press force, the thickness is what the trim shears.
  const flashThickness = overrides.flashThicknessMm ?? flash.run.value!;
  const flashWidth = overrides.flashWidthMm ?? flash.run.outputs['Flash Width']!;
  const flashSource = (what: 'thickness' | 'width') => ((what === 'thickness' ? overrides.flashThicknessMm : overrides.flashWidthMm) != null
    ? `flash land ${what}, set in the Cost Guide` : `flash land ${what} (Flash land)`);
  const factorName = flashPct === 0 ? 'forgingPressureFactorNoFlash' : minComplex != null && complexity >= minComplex ? 'forgingPressureFactorComplex' : 'forgingPressureFactorFlash';
  const pressureFactor = num(factorName);
  if (pressureFactor == null) return none(`forging variable ${factorName}`);
  const pressForce = run(PRESS_FORCE, null, {
    pressure_factor: { value: pressureFactor, source: `Forging variable ${factorName} (complexity ${complexity})`, ref: { kind: 'variable', domain: FORGING_DOMAIN, name: factorName } },
    flash_width_mm: { value: flashWidth, source: flashSource('width') },
  }, 'Required Force');
  if ('reasons' in pressForce) return none(...pressForce.reasons);
  const trimForce = run(TRIM_FORCE, null, { flash_thickness_mm: { value: flashThickness, source: flashSource('thickness') } }, 'Required Force');
  if ('reasons' in trimForce) return none(...trimForce.reasons);
  const pressKn = pressForce.run.value!;
  const trimKn = trimForce.run.value!;
  const flashFacts = { thicknessMm: r2(flashThickness), widthMm: r2(flashWidth), volumeMm3: r2(closedMult.metalRun.outputs['Flash Volume']!) };
  const baseHits = num('baseNumberOfHits');
  const dataHits = baseHits == null ? 1 : Math.max(1, baseHits - (enabled('enableUpset') ? 0 : 1) - (enabled('enableBlock') ? 0 : 1));
  const hits = overrides.hits ?? dataHits;
  const hitsSeed: CalcSeed = overrides.hits != null
    ? { value: hits, source: 'blows, set in the Cost Guide' }
    : { value: hits, source: `baseNumberOfHits ${baseHits}, less the upset or blocking blow the plant disables (enableUpset, enableBlock)` };
  const load = handling('materialHandling', forgedKg, 'Load Time (s)');
  const unload = handling('materialHandling', forgedKg, 'Unload Time (s)');
  const trim = step('Trim', FORGING_CLASS.trim, (m) => {
    const capacity = machineValue(m, 'press_force_kn');
    if (capacity == null) return fail(`machine ${m.name}: press_force_kn`);
    if (capacity < trimKn) return fail(`delivers ${capacity} kN, trimming needs ${r2(trimKn)} kN`);
    if (!load || !unload) return fail('forging lookup materialHandling (not staged)');
    return timed(CALC('Trim'), m, { load_s: load, unload_s: unload });
  }, ['It delivers the force to shear the flash']);
  const trimSteps = flashPct > 0 ? [trim] : [];
  const closedRuns = { forgedVolume: closedMult.metalRun, flashLand: flash.run, pressForce: pressForce.run, trimForce: trimForce.run };
  const closedNotes = [
    ...(overrides.flashThicknessMm != null || overrides.flashWidthMm != null ? [`The flash land is ${r2(flashThickness)} x ${r2(flashWidth)} mm as set in the Cost Guide (Vieregge's rule gives ${r2(flash.run.value!)} x ${r2(flash.run.outputs['Flash Width']!)} mm).`] : []),
    ...(overrides.hits != null ? [`The screw press and the hammer strike ${hits} blow${hits === 1 ? '' : 's'}, as set in the Cost Guide (the data gives ${dataHits}).`] : []),
    `The finishing blow needs ${r2(pressKn)} kN: the hot flow stress (strength coefficient x strain rate ^ sensitivity) over the part and its flash land, times the pressure-multiplying factor of complexity ${complexity}.`,
    ...(flashPct === 0 ? [`Complexity ${complexity} forges without flash (partComplexityBasedData): no trim step.`] : []),
  ];
  // The die block: the part with its flash land and the die wall the forming force spreads through (forceDistributionAngle) over its depth.
  const angle = num('forceDistributionAngle');
  const block = part.planLengthMm != null && part.planWidthMm != null && part.dieDepthMm != null && angle != null
    ? (() => {
      const wall = 2 * flashWidth + 2 * part.dieDepthMm! * Math.tan((angle * Math.PI) / 180);
      return { lengthMm: part.planLengthMm! + wall, widthMm: part.planWidthMm! + wall };
    })()
    : null;

  // Screw press: the cheapest that delivers the finishing blow; its crew by the forged weight (numberOperatorsPress).
  const crewRow = bandRow(table('numberOperatorsPress'), 'Weight (kg)', forgedKg);
  const crew = crewRow ? Number(crewRow['Num Operators']) : null;
  const press = step('Press', FORGING_CLASS.press, (m) => {
    const capacity = machineValue(m, 'press_force_kn');
    if (capacity == null) return fail(`machine ${m.name}: press_force_kn`);
    if (capacity < pressKn) return fail(`delivers ${capacity} kN, the finishing blow needs ${r2(pressKn)} kN`);
    if (!load || !unload) return fail('forging lookup materialHandling (not staged)');
    return timed(CALC('Press'), m, { hits: hitsSeed, load_s: load, unload_s: unload });
  }, ['It delivers the force of the finishing blow'], (input.machinesByClass[FORGING_CLASS.press] ?? []).map((m) => (crew != null ? { ...m, operators: crew } : m)));
  finish({
    key: 'closed_die_press', mult: closedMult, forgedKg, steps: [closedMult.saw, closedMult.heat, press, ...trimSteps], hits,
    forming: { quantity: 'force_kn', value: pressKn }, trimForceKn: flashPct > 0 ? trimKn : null, flash: flashFacts, runs: closedRuns,
    dies: { forgedVolumeMm3: forgedVolume, toolLifeVariable: 'pressToolLifeNumberOfParts' },
    warnings: [...closedNotes, ...(crew != null ? [`The press is crewed by ${crew} operator${crew === 1 ? '' : 's'} for a ${r2(forgedKg)} kg forging (numberOperatorsPress).`] : [])],
  });

  // Die hammer: the blow energy of deforming the forged volume from the mult's length to the part's depth, at the material's own flow stress.
  const strain = part.dieDepthMm != null && part.dieDepthMm > 0 ? Math.abs(Math.log(closedMult.multLength / part.dieDepthMm)) : null;
  const energy = strain != null
    ? run(HAMMER_ENERGY, null, {
      forged_volume_mm3: { value: forgedVolume, source: 'forged volume (Forged volume)' },
      upset_strain: { value: strain, source: `ln(mult length ${r2(closedMult.multLength)} mm / part depth ${part.dieDepthMm} mm)` },
    }, 'Required Energy')
    : { reasons: ["the part's depth along the die direction is not measured"] };
  if ('run' in energy) {
    const needJ = energy.run.value!;
    const hammer = step('Hammer', FORGING_CLASS.hammer, (m) => {
      const capacity = machineValue(m, 'impact_energy_j');
      if (capacity == null) return fail(`machine ${m.name}: impact_energy_j`);
      if (capacity < needJ) return fail(`delivers ${capacity} J, the blow needs ${Math.round(needJ)} J`);
      const [tl, tw] = [machineValue(m, 'table_length_mm'), machineValue(m, 'table_width_mm')];
      if (block && tl != null && tw != null && (Math.max(block.lengthMm, block.widthMm) > Math.max(tl, tw) || Math.min(block.lengthMm, block.widthMm) > Math.min(tl, tw))) {
        return fail(`the die block is ${Math.round(block.lengthMm)} x ${Math.round(block.widthMm)} mm, the table ${tl} x ${tw} mm`);
      }
      return timed(CALC('Hammer'), m, {
        hits: hitsSeed,
        upset_enabled: { value: enabled('enableUpset') ? 1 : 0, source: 'enableUpset' },
        block_enabled: { value: enabled('enableBlock') ? 1 : 0, source: 'enableBlock' },
      });
    }, ['It delivers the blow energy', 'Its table takes the die block']);
    finish({
      key: 'closed_die_hammer', mult: closedMult, forgedKg, steps: [closedMult.saw, closedMult.heat, hammer, ...trimSteps], hits,
      forming: { quantity: 'energy_j', value: needJ }, trimForceKn: flashPct > 0 ? trimKn : null, flash: flashFacts, runs: { ...closedRuns, hammerEnergy: energy.run },
      dies: { forgedVolumeMm3: forgedVolume, toolLifeVariable: 'hammerToolLifeNumberOfParts' },
      warnings: [`The hammer blow needs ${Math.round(needJ)} J: the material's flow stress at the hammer's strain rate over the forged volume and its upset strain (the deformation work).`, ...(block ? [] : ['The die block could not be sized (the part\'s plan or depth is not measured): the hammer table is not checked.'])],
    });
  } else gaps.push({ key: 'closed_die_hammer', label: labelOf('closed_die_hammer'), reason: energy.reasons.join('; ') });

  // Mechanical press with a transfer system: each station's die block side by side on the table, at the press's multi-station force.
  const [stations, interDie, addendum, reduction] = ['mechanicalPressNumberOfStations', 'mechanicalPressInterDieBlockSpacing', 'mechanicalPressBolsterPlateAddendumThickness', 'mechanicalPressForceReductionFactorMultiStation'].map(num);
  const mech = step('Mechanical Press', FORGING_CLASS.mechanicalPress, (m) => {
    if (stations == null || interDie == null || addendum == null || reduction == null) return fail('forging variables mechanicalPressNumberOfStations, InterDieBlockSpacing, BolsterPlateAddendumThickness, ForceReductionFactorMultiStation');
    const maxKn = machineValue(m, 'max_press_force_kn');
    if (maxKn == null) return fail(`machine ${m.name}: max_press_force_kn`);
    if (maxKn * reduction < pressKn) return fail(`delivers ${Math.round(maxKn * reduction)} kN over ${stations} stations (x ${reduction}), the finishing blow needs ${r2(pressKn)} kN`);
    if (!block) return fail("the die block could not be sized: the part's plan or depth is not measured");
    const [tl, tw] = [machineValue(m, 'press_table_length_mm'), machineValue(m, 'press_table_width_mm')];
    if (tl == null || tw == null) return fail(`machine ${m.name}: press table size`);
    const needL = stations * block.lengthMm + (stations - 1) * interDie + 2 * addendum;
    if (needL > tl || block.widthMm + 2 * addendum > tw) return fail(`${stations} die blocks need ${Math.round(needL)} x ${Math.round(block.widthMm + 2 * addendum)} mm, the table is ${tl} x ${tw} mm`);
    return timed(CALC('Mechanical press'), m, {}, { 'forging_partComplexityBasedData.SPM-Mechanical Press with Transfer System-High Production Volume': spmLookup });
  }, ['It delivers the finishing blow at its multi-station force', 'Its table takes a die block per station']);
  finish({
    key: 'closed_die_mechanical_press', mult: closedMult, forgedKg, steps: [closedMult.saw, closedMult.heat, mech, ...trimSteps], hits: stations ?? hits,
    forming: { quantity: 'force_kn', value: pressKn }, trimForceKn: flashPct > 0 ? trimKn : null, flash: flashFacts, runs: closedRuns,
    dies: { forgedVolumeMm3: forgedVolume, toolLifeVariable: 'mechanicalPressToolLifeNumberOfParts' },
    warnings: [...closedNotes, `Every station strikes on each stroke: the stroke rate is the reference's for complexity ${complexity} (partComplexityBasedData), the press's own rate at most.`],
  });

  // ── Open die: a flashless shape upset between flat dies ────────────────────────────────────────────────────────────────────────────
  // The upset to `heightMm` over `areaMm2` (the part's own for open die; the preform's for a ring), with the tool changes of its operations.
  // The force depends on the press (its ram speed sets the strain rate), so the route reports the force on the press it was given.
  const openDie = (key: 'open_die' | 'ring_rolling', mult: Exclude<ReturnType<typeof multOf>, { reasons: string[] }>, heightMm: number, areaMm2: number, toolChangeKeys: string[]) => {
    const forceOn = new Map<string, number>();
    const costed = step('Open Die Press', FORGING_CLASS.openDie, (m) => {
    const capacity = machineValue(m, 'press_force_kn');
    if (capacity == null) return fail(`machine ${m.name}: press_force_kn (the press's rating, migration 1055)`);
    const shape = key === 'ring_rolling'
      ? { die_depth_mm: { value: heightMm, source: 'preform height (Ring preform)' }, projected_area_mm2: { value: areaMm2, source: 'preform outline: pi x preform outside diameter² / 4 (Ring preform)' } }
      : {};
    const force = run(OPEN_DIE_FORCE, m, {}, 'Required Force', {}, shape);
    if ('reasons' in force) return fail(...force.reasons);
    forceOn.set(m.name, force.run.value!);
    if (capacity < force.run.value!) return fail(`delivers ${Math.round(capacity)} kN, the upset needs ${Math.round(force.run.value!)} kN`);
    const toolChange = toolChangeKeys.reduce((s, k) => s + (machineValue(m, k) ?? 0), 0);
    const kg = mult.multKg;
    return timed(CALC('Open die press'), m, {
      mult_length_mm: { value: mult.multLength, source: 'mult length (Bar stock)' },
      upset_height_mm: { value: heightMm, source: key === 'ring_rolling' ? 'preform height (Ring preform)' : "the part's depth along the die direction" },
      tool_change_s: { value: toolChange, source: `machine ${m.name}: ${toolChangeKeys.join(' + ')}` },
      load_s: handling('materialHandling', kg, 'Load Time (s)'), unload_s: handling('materialHandling', kg, 'Unload Time (s)'),
    });
  }, ['It delivers the upset force']);
    return { step: costed, forceKn: (costed.machine ? forceOn.get(costed.machine.name) : undefined) ?? 0 };
  };

  // A flashless part's mult is the closed-die one (its forged volume carries no flash).
  if (flashPct === 0 && part.dieDepthMm != null) {
    const upset = openDie('open_die', closedMult, part.dieDepthMm, part.projectedAreaMm2, ['upset_tool_change_time_s']);
    finish({
      key: 'open_die', mult: closedMult, forgedKg, steps: [closedMult.saw, closedMult.heat, upset.step], hits: 1,
      forming: { quantity: 'force_kn', value: upset.forceKn }, trimForceKn: null, flash: null, runs: { forgedVolume: closedMult.metalRun }, dies: null,
      warnings: ['Open-die forging upsets the mult to the part\'s height between flat dies: features the flat dies cannot form are left to machining.'],
    });
  } else gaps.push({ key: 'open_die', label: labelOf('open_die'), reason: flashPct > 0 ? `complexity ${complexity} carries flash (partComplexityBasedData): open-die forging makes only the flashless shapes (complexity 1 to 3)` : "the part's depth along the die direction is not measured" });

  // ── Ring rolling: a ring rolled out from an upset, punched and pierced preform ─────────────────────────────────────────────────────────
  const ring = ringOf(part, minHole!);
  if (!ring) gaps.push({ key: 'ring_rolling', label: labelOf('ring_rolling'), reason: 'the part is not a ring: round in plan with a through bore along the die direction of at least minForgeableHoleDiameter' });
  else {
    const preform = run(RING_PREFORM, null, {}, 'Preform Wall');
    if ('reasons' in preform) gaps.push({ key: 'ring_rolling', label: labelOf('ring_rolling'), reason: preform.reasons.join('; ') });
    else {
      const slug = preform.run.outputs['Slug Volume']!;
      const preformHeight = preform.run.outputs['Preform Height']!;
      const mult = multOf((scale) => ({ volumeMm3: (part.volumeMm3 + slug) * (1 + scale / 100), run: preform.run }));
      if ('reasons' in mult) gaps.push({ key: 'ring_rolling', label: labelOf('ring_rolling'), reason: mult.reasons.join('; ') });
      else {
        const ringKg = netKg;
        const velocityRow = bandRow(table('tblMandrelVelocity'), 'Ring Weight (kg)', ringKg);
        const preformOd = preform.run.outputs['Preform Outside Diameter']!;
        const upset = openDie('ring_rolling', mult, preformHeight, (Math.PI * preformOd ** 2) / 4, ['upset_tool_change_time_s', 'punch_tool_change_time_s', 'pierce_tool_change_time_s']);
        const rolling = step('Ring Rolling', FORGING_CLASS.ringRolling, (m) => {
          const [minOd, maxOd, maxH] = ['min_outside_diameter_mm', 'max_outside_diameter_mm', 'max_preform_height_mm'].map((k) => machineValue(m, k));
          if (minOd == null || maxOd == null || maxH == null) return fail(`machine ${m.name}: outside diameter range and preform height`);
          if (ring.outsideMm < minOd || ring.outsideMm > maxOd) return fail(`rolls ${minOd} to ${maxOd} mm outside diameter, the ring is ${Math.round(ring.outsideMm)} mm`);
          if (preformHeight > maxH) return fail(`takes a preform up to ${maxH} mm high, the preform is ${Math.round(preformHeight)} mm`);
          if (!velocityRow) return fail('forging lookup tblMandrelVelocity (not staged)');
          return timed(CALC('Ring rolling'), m, {
            preform_wall_mm: { value: preform.run.value!, source: 'preform wall (Ring preform)' },
            ring_wall_mm: { value: (ring.outsideMm - ring.boreMm) / 2, source: `ring wall: (outside ${Math.round(ring.outsideMm)} - bore ${ring.boreMm} mm) / 2` },
            load_s: handling('materialHandling', ringKg, 'Load Time (s)'), unload_s: handling('materialHandling', ringKg, 'Unload Time (s)'),
          }, { 'forging_tblMandrelVelocity.Mandrel Velocity (mm / s)': rowSeed('tblMandrelVelocity', velocityRow, 'Mandrel Velocity (mm / s)', ['Ring Weight (kg)']) });
        }, ['It rolls the ring\'s outside diameter', 'It takes the preform height']);
        finish({
          key: 'ring_rolling', mult, forgedKg: (part.volumeMm3 + slug) * 1e-9 * density, steps: [mult.saw, mult.heat, upset.step, rolling], hits: 1,
          forming: { quantity: 'force_kn', value: upset.forceKn }, trimForceKn: null, flash: null, runs: { ringPreform: preform.run }, dies: null,
          warnings: [`A ring ${Math.round(ring.outsideMm)} mm outside, ${ring.boreMm} mm bore, ${ring.heightMm} mm high: the mult is upset to ${r2(preformHeight)} mm, punched ${r2(preform.run.outputs['Punch Diameter']!)} mm and pierced (a ${Math.round(slug)} mm³ slug), then rolled out.`],
        });
      }
    }
  }
  return { routes, gaps, missing: [] };
}

/**
 * The route to quote: the engineer's when it was built, else the cheapest complete one (material + process + dies per part), else the one with the
 * fewest gaps. The note says how it was chosen and what each of the others came to.
 */
export function chooseForgingRoute(routes: readonly ForgingRoute[], gaps: readonly ForgingRouteGap[], chosen: ForgingRouteKey | null): { route: ForgingRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  // Route totals are USD per part (material, process and dies), the currency the routes are built in: said so, since this note is shown
  // as it is beside a quote in any currency.
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: ForgingRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${r.lines.filter(isGap).map((l) => l.process).join(', ')})`);
  const others = (pick: ForgingRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Forging: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const pick = complete[0] ?? [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0]!;
  const why = complete[0] ? 'the cheapest complete forging route (material, process and dies per part)' : 'no forging route is complete: the one with the fewest gaps';
  const pre = chosen && !user ? `The Cost Guide's ${labelOf(chosen)} is not a route for this part. ` : '';
  const own = pick.complete ? ` (${money(pick.totalUsd!)} per part)` : '';
  return { route: pick, note: `${pre}Forging: ${pick.label} is quoted${own}, ${why}. ${others(pick)}.` };
}
