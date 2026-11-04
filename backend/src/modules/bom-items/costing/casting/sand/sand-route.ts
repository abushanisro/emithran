// The route of a sand casting, built from the steps: melting, one line per core, moulding, pouring, cooling, shakeout, degating, cleaning,
// grinding and inspection, each on the cheapest capable machine, then the metal bought and the core-box tooling. Pure: the caller loads the
// reference data, the machines and the part's measurements. Port of petrus-demo's domain::casting::route (D122, D127, D143, D146).
//
// For every moulding machine that can hold the part a whole route is built; the cheapest complete one is the route (the moulding process
// follows from it, unless the user chose one). Nothing is substituted: what the data or the measurements lack is named, and a step no machine
// can do is a named gap line, which makes the route incomplete.
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalcRun, ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';
import type { CostContext } from '../casting-finishing';
import { coreboxTooling, coreLine, sandCores, type CoreboxTooling, type CoreRegion } from './sand-cores';
import { cleanStep, degateStep, finishStep, inspectStep, shakeoutStep, type SandFinishContext } from './sand-finishing-steps';
import { referenceYieldNote } from './sand-yield';
import { designGating, type GatingSystem, type SandFlask } from './sand-gating';
import { ingateVelocityNote, RISER_EFFICIENCY_NOTE } from './sand-velocity';
import { machineValue, type SandMachine } from './sand-machines';
import type { SandReference } from './sand-reference';
import { valuesProvider } from './sand-seeds';
import { cavitiesPerMould, coolStep, meltStep, mouldStep, pourStep, runStep, selectAndCost, type CostedStep, type HotBoxSettings, type SandMaterial, type SandRouteContext } from './sand-steps';

export const METAL_PER_CASTING = 'Sand Casting - Metal per casting';
export const MATERIAL_COST = 'Sand Casting - Material cost';

/** The moulding processes and their HR Rates machine classes. */
export const MOULDING_PROCESSES = [
  { process: 'Horizontal Automatic', machineClass: 'sand_casting_horizontal_automatic' },
  { process: 'Vertical Automatic', machineClass: 'sand_casting_vertical_automatic' },
  { process: 'Manual Std Moldmaking', machineClass: 'sand_casting_manual_std_moldmaking' },
  { process: 'Manual Floor Moldmaking', machineClass: 'sand_casting_manual_floor_moldmaking' },
  { process: 'Manual Pit Moldmaking', machineClass: 'sand_casting_manual_pit_moldmaking' },
] as const;

const PIT_CLASS = 'sand_casting_manual_pit_moldmaking';
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface SandPartInput {
  volumeMm3: number;
  surfaceAreaMm2: number;
  /** Length and width across the draw direction, then the height along it (mm). */
  dimsMm: readonly [number, number, number];
  wallNominalMm: number | null;
  /** The measured parting line (mm); null when not measured: the box perimeter is used and said to be an estimate. */
  partingLineMm: number | null;
  /** The casting's height above the parting plane (mm); null when not measured: half the draw depth is assumed and said so. */
  abovePartingMm: number | null;
  cores: readonly CoreRegion[];
}

export interface SandScenario {
  batchSize: number;
  /** Cavities per mould instead of the most that fit. */
  cavities: number | null;
  /** A moulding machine class (one of MOULDING_PROCESSES) instead of the cheapest process. */
  mouldingClass: string | null;
  /** A coremaking process the user chose. */
  chosenCoreProcess: string | null;
  /** USD per kWh for melting: the user's, no default. */
  energyPricePerKwh: number | null;
  /** The plant's hot box settings; each null until the user sets it (no default is assumed). */
  hotBox: HotBoxSettings;
  /** Parts made over the tooling's life: core boxes are shared by these. Null: the tooling is not costed (and said so), never spread over an assumed volume. */
  lifetimeVolume: number | null;
}

export interface SandRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: SandMaterial;
  part: SandPartInput;
  /** Every sand machine class the route may use, with its machines. */
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: SandScenario;
  costContext: CostContext;
}

export interface SandRoute {
  mouldingProcess: string;
  mouldingMachine: string;
  cavities: number;
  /** Route lines in order, costs per good part in USD (scrap paid for by the good ones). */
  lines: ProcessLineCost[];
  gating: GatingSystem;
  /** The flask of the moulding machine (from the machine's specs), to draw the mould around the part. */
  flask: SandFlask;
  coresMade: number;
  coresLeftSolid: number;
  material: { netKg: number; pouredKg: number; yieldPct: number; costUsd: number | null; runs: ReferenceCalcRun[] };
  tooling: { perPartUsd: number; items: CoreboxTooling[] };
  /** The core sand calculator run of each core (the sand of the core and its prints), for the trace. */
  coreSandRuns: ReferenceCalcRun[];
  /** Material + process lines + tooling per part (USD); null while a line is a gap. */
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
  /** Every moulding machine the route was tried on: the chosen one first, then the others by cost, then those that could not do it. */
  alternatives: SandAlternative[];
}

/** One moulding machine's whole route, compared with the chosen one. */
export interface SandAlternative {
  mouldingProcess: string;
  mouldingMachine: string;
  chosen: boolean;
  /** Null when the machine could not make a route at all (see `reason`). */
  cavities: number | null;
  totalUsd: number | null;
  /** True when every step has a machine and the total is whole. */
  complete: boolean;
  /** Steps no machine could do, or why the machine could not be used. */
  reason: string | null;
}

/** A route before it is compared with the others. */
type BuiltRoute = Omit<SandRoute, 'alternatives'>;

interface Attempt {
  route: BuiltRoute | null;
  missing: string[];
}

const isGap = (l: ProcessLineCost) => l.physicsGap != null;

/**
 * Everything of a route that depends on the moulding machine only through its flask height, the cavities it takes and whether it is a pit
 * mould: the gating, the metal, the cores and every step but moulding. Built once per such combination and reused by the machines that share it.
 */
interface Shared {
  ctx: SandFinishContext;
  gating: GatingSystem;
  metal: ReferenceCalcRun;
  coresMade: number;
  coresLeftSolid: number;
  netKg: number;
  pouredKg: number;
  notes: string[];
  /** The steps before moulding (melting, the cores) and after it (pour to inspection). */
  before: CostedStep[];
  after: CostedStep[];
  cores: ReturnType<typeof sandCores>['cores'];
}

function sharedFor(input: SandRouteInput, mould: SandMachine, cavities: number): { shared: Shared | null; missing: string[] } {
  const { ref, part, scenario } = input;
  const fail = (...missing: string[]) => ({ shared: null, missing });
  const density = input.material.columns['density_kg_m3'];
  if (density == null || !(density > 0)) return fail(`${input.material.name}: density_kg_m3`);
  const [l, w, h] = part.dimsMm;
  const netKg = part.volumeMm3 * 1e-9 * density;

  const missingVars = ref.absent({ numbers: ['ingateGap'] });
  const flaskHeight = machineValue(mould, 'flask_height_mm');
  if (flaskHeight == null) missingVars.push(`machine ${mould.name}: flask_height_mm`);
  if (!(part.surfaceAreaMm2 > 0)) missingVars.push('the part surface area');
  if (missingVars.length) return fail(...missingVars);
  const modulus = part.volumeMm3 / part.surfaceAreaMm2;
  const thickness = part.wallNominalMm ?? 2 * modulus;
  const notes: string[] = [];
  if (part.wallNominalMm == null) notes.push('Wall thickness not measured: the section is estimated as 2 x volume / surface.');
  const ingates = Math.max(1, Math.ceil(l / ref.number('ingateGap')!));
  const above = part.abovePartingMm ?? h / 2;
  if (part.abovePartingMm == null) notes.push('Height above the parting line not measured: half the draw depth is assumed.');

  const base: SandRouteContext = {
    ref, spec: input.spec, calculators: input.calculators, material: input.material,
    part: { netKg, modulusMm: modulus, dimsMm: part.dimsMm, wallNominalMm: thickness },
    cavities, coresPerCasting: 0, poured: { perCastingKg: netKg, perMouldKg: netKg * cavities }, energyPricePerKwh: scenario.energyPricePerKwh, hotBox: scenario.hotBox,
  };
  const { system: gating, missing: gatingMissing } = designGating({
    netKg, volumeMm3: part.volumeMm3, modulusMm: modulus, densityKgM3: density, materialName: input.material.name,
    materialType: input.material.materialType, cutCode: input.material.columns['cut_code'] ?? null, wallNominalMm: thickness,
    mould: {
      cavities, ingates,
      partLengthMm: { value: l, source: 'longest side across the draw direction' },
      copeHeightMm: { value: flaskHeight! / 2, source: `half the flask height of ${mould.name}` },
      abovePartingMm: { value: above, source: part.abovePartingMm != null ? 'measured: casting top above the parting line' : 'estimate: half the draw depth' },
    },
    ref, spec: input.spec, calculators: input.calculators,
  });
  if (!gating) return fail(...gatingMissing);
  notes.push(ingateVelocityNote(input.material.materialType, gating.ingateVelocityMs, gating.chokeVelocityMs), RISER_EFFICIENCY_NOTE);

  const metal = runStep(
    base, METAL_PER_CASTING, null,
    { gating_kg: { value: gating.gatingKg, source: 'Sand Casting - Gating system' }, risers_kg: { value: gating.risersKg, source: 'Sand Casting - Risers' } },
    { cad: valuesProvider({ volume_mm3: { value: part.volumeMm3, source: 'part volume (mm³)' } }) },
    'Poured Weight',
  );
  if (!('run' in metal)) return fail(...metal.reasons);
  const pouredKg = metal.run.value!;
  const yieldNote = referenceYieldNote(ref, input.material.materialType, (100 * netKg) / pouredKg);
  if (yieldNote) notes.push(yieldNote);
  const poured = { perCastingKg: pouredKg, perMouldKg: pouredKg * cavities };

  const cored = sandCores({ ...base, poured }, part.cores);
  if (cored.missing.length) return fail(...cored.missing);
  const coreSandKgPerMould = cored.cores.reduce((s, c) => s + c.kg, 0) * cavities;
  const ctx: SandFinishContext = {
    ...base, poured, coresPerCasting: cored.cores.length,
    surfaceAreaMm2: part.surfaceAreaMm2,
    gates: { ingateAreaMm2: gating.ingateAreaMm2, ingateWidthMm: gating.ingateWidthMm, riserContactMm2: gating.riserContactMm2, riserDiameterMm: gating.riserDiameterMm },
    partingLine: part.partingLineMm != null
      ? { value: part.partingLineMm, source: 'measured silhouette along the draw direction' }
      : { value: 2 * (l + w), source: 'estimate: box perimeter' },
    coreSandKgPerMould, coresCount: cored.cores.length,
  };
  if (part.partingLineMm == null) notes.push('Parting line not measured: the box perimeter is used.');

  const common = { batchSize: scenario.batchSize, costContext: input.costContext, ref };
  const machines = (c: string) => input.machinesByClass[c] ?? [];
  const step = (process: string, machineClass: string, evaluate: Parameters<typeof selectAndCost>[0]['evaluate'], criteria: string[]): CostedStep =>
    selectAndCost({ process, machineClass, machines: machines(machineClass), evaluate, criteria, ...common });

  const before: CostedStep[] = [];
  const melt = step('Melting', 'sand_casting_melting', (m) => meltStep(ctx, m), ['The furnace reaches the pouring temperature', "The furnace holds one mould's metal (furnaceCapacitySafetyFactor)", 'A machine hour rate on file or from the HR Rates engine']);
  before.push(melt);
  for (const core of cored.cores) {
    before.push(coreLine({ ctx, core, machinesByClass: input.machinesByClass, batchSize: scenario.batchSize, costContext: input.costContext, chosenProcess: scenario.chosenCoreProcess }).step);
  }
  const after: CostedStep[] = [
    step('Pour', 'sand_casting_pour', (m) => pourStep(ctx, m), ['The ladle holds one mould', 'A pouring coefficient for the material']),
    step('Cooling', 'sand_casting_cooling', (m) => coolStep(ctx, m, mould.machineClass === PIT_CLASS), ["Chvorinov's rule on the casting's modulus"]),
    step('Shakeout', 'sand_casting_shakeout', (m) => shakeoutStep(ctx, m), ["The machine takes one mould's metal and core sand"]),
    step('Degating', 'sand_casting_degating', (m) => degateStep(ctx, m), ['A machine that cuts (a feed rate)', 'It takes the part and cuts across the widest gate or riser']),
    step('Cleaning', 'sand_casting_cleaning', (m) => cleanStep(ctx, m), ["It takes the part's weight, height and width"]),
    step('Finishing', 'sand_casting_finishing', (m) => finishStep(ctx, m), ['It takes the part', "A grinding speed factor for the material's cut code"]),
    step('Visual Inspection', 'sand_casting_visual_inspection', (m) => inspectStep(ctx, m), ['A machine hour rate on file']),
  ];
  return { missing: [], shared: { ctx, gating, metal: metal.run, coresMade: cored.cores.length, coresLeftSolid: cored.thin, netKg, pouredKg, notes, before, after, cores: cored.cores } };
}

/** One whole route on one moulding machine. */
function routeOn(input: SandRouteInput, mould: SandMachine, mouldingProcess: string, cache: Map<string, ReturnType<typeof sharedFor>>): Attempt {
  const { ref, part, scenario } = input;
  const fail = (...missing: string[]): Attempt => ({ route: null, missing: missing.map((m) => `${mould.name}: ${m}`) });
  const density = input.material.columns['density_kg_m3'];
  if (density == null || !(density > 0)) return fail(`${input.material.name}: density_kg_m3`);
  const cav = cavitiesPerMould(ref, mould, part.dimsMm, part.volumeMm3 * 1e-9 * density, scenario.cavities);
  if ('reasons' in cav) return fail(...cav.reasons);
  const cavities = cav.cavities;
  const key = `${machineValue(mould, 'flask_height_mm')}|${cavities}|${mould.machineClass === PIT_CLASS}`;
  let built = cache.get(key);
  if (!built) {
    built = sharedFor(input, mould, cavities);
    cache.set(key, built);
  }
  if (!built.shared) return fail(...built.missing);
  const { ctx, gating, netKg, pouredKg, notes, before, after, cores, coresLeftSolid, metal: metalRun } = built.shared;
  const cored = { cores, thin: coresLeftSolid };
  const mouldStepResult = selectAndCost({
    process: mouldingProcess, machineClass: mould.machineClass, machines: [mould], evaluate: (m) => mouldStep(ctx, m),
    criteria: ['The flask holds the part with its sand borders'], batchSize: scenario.batchSize, costContext: input.costContext, ref,
  });
  const steps: CostedStep[] = [...before, mouldStepResult, ...after];
  const lines = steps.map((s) => s.line);
  const gaps = lines.filter(isGap);
  // Scrapped parts are paid for by the good ones: the lines are divided by the product of the machines' good-part yields.
  const finalYield = steps.reduce((y, s) => y * (s.machine ? machineValue(s.machine, 'good_part_yield') ?? 1 : 1), 1) || 1;
  const perGood = (l: ProcessLineCost): ProcessLineCost => (isGap(l) ? l : { ...l, setupCost: r2(l.setupCost / finalYield), runCost: r2(l.runCost / finalYield), totalCost: r2(l.totalCost / finalYield) });
  const scaled = lines.map(perGood);
  const warnings = [...notes, ...steps.flatMap((s) => s.warnings)];
  if (cored.thin > 0) warnings.push(`${cored.thin} core${cored.thin > 1 ? 's' : ''} thinner than minSandCastableHoleDia: left solid and machined later.`);
  warnings.push(
    'Patterns, core coating and core gluing are not costed; sand is not priced (no sand price in the reference data).',
    'Risers are sized by the standard modulus rule (riser modulus 1.2 x the casting\'s, height 1.5 x diameter, one per ingate); their places on the casting are not chosen.',
    'Furnace Factor is read as energy used / theoretical heat of the melt.',
  );

  // Metal bought: melt loss in the chosen furnace, gates and risers back to the furnace (remelt allowance), scrap paid by the good parts.
  let materialCost: number | null = null;
  const runs: ReferenceCalcRun[] = [metalRun];
  const furnace = before[0]!.machine; // melting is the first step
  if (furnace) {
    const yieldLoss = machineValue(furnace, 'yield_loss_factor');
    if (yieldLoss == null) warnings.push(`machine ${furnace.name}: yield_loss_factor is missing: the metal is not costed.`);
    else {
      const m = runStep(
        ctx, MATERIAL_COST, null,
        {
          net_kg: { value: netKg, source: 'metal per casting' }, poured_kg: { value: pouredKg, source: 'metal per casting' },
          furnace_yield_loss_factor: { value: yieldLoss, source: `machine ${furnace.name}` }, final_yield: { value: finalYield, source: 'good-part yields of the machines' },
        },
        {},
        'Material Cost',
      );
      if ('run' in m) {
        materialCost = m.run.value!;
        runs.push(m.run);
      } else warnings.push(...m.reasons);
    }
  }

  // Tooling: per core the box material that costs least per part, over the lifetime volume; off when the data disables amortization.
  const amortized = ref.text('disableInvestmentAmortization') !== 'true';
  const items: CoreboxTooling[] = [];
  if (cored.cores.length > 0 && scenario.lifetimeVolume == null) {
    warnings.push('Core box tooling is not costed: it is amortised over annual volume x production life, and one of them is not set.');
  } else {
    for (let i = 0; i < cored.cores.length; i += 1) {
      const t = coreboxTooling(ctx, scenario.lifetimeVolume!);
      if (t.tooling) items.push(t.tooling);
      else warnings.push(...t.missing);
    }
  }
  const toolingPerPart = amortized ? items.reduce((s, t) => s + t.perPartUsd, 0) : 0;

  const complete = gaps.length === 0 && materialCost != null;
  const processUsd = scaled.reduce((s, l) => s + l.totalCost, 0);
  const totalUsd = complete ? r2(materialCost! + processUsd + toolingPerPart) : null;
  return {
    missing: [],
    route: {
      mouldingProcess, mouldingMachine: mould.name, cavities, lines: scaled, gating, flask: flaskOf(mould),
      coresMade: cored.cores.length, coresLeftSolid: cored.thin,
      material: { netKg: r4(netKg), pouredKg: r4(pouredKg), yieldPct: r2((100 * netKg) / pouredKg), costUsd: materialCost != null ? r2(materialCost) : null, runs },
      tooling: { perPartUsd: r4(toolingPerPart), items },
      coreSandRuns: cored.cores.map((c) => c.run),
      totalUsd, complete, warnings,
    },
  };
}

/**
 * The route of the part: a whole route for every moulding machine that can hold it (or only the user's chosen class), the cheapest complete one
 * wins. With none complete, the one with the fewest gaps is returned (incomplete, no total); with none at all, what each machine lacked.
 */
export function buildSandRoute(input: SandRouteInput): { route: SandRoute | null; missing: string[] } {
  const classes = MOULDING_PROCESSES.filter((p) => !input.scenario.mouldingClass || p.machineClass === input.scenario.mouldingClass);
  const attempts: Attempt[] = [];
  const cache = new Map<string, ReturnType<typeof sharedFor>>();
  const tried: Array<{ process: string; machine: string; attempt: Attempt }> = [];
  for (const p of classes) {
    for (const mould of input.machinesByClass[p.machineClass] ?? []) {
      const attempt = routeOn(input, mould, p.process, cache);
      attempts.push(attempt);
      tried.push({ process: p.process, machine: mould.name, attempt });
    }
  }
  const routes = attempts.flatMap((a) => (a.route ? [a.route] : []));
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd! || a.mouldingMachine.localeCompare(b.mouldingMachine));
  const fewest = [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0];
  const best = complete[0] ?? fewest;
  if (best) return { route: { ...best, alternatives: alternativesOf(tried, best) }, missing: [] };
  const reasons = [...new Set(attempts.flatMap((a) => a.missing))];
  return { route: null, missing: reasons.length ? reasons.slice(0, 8) : ['no moulding machines of the sand process classes'] };
}


/** Every machine tried, the chosen one first, then the others by total (complete before incomplete), then the machines that could not make a route. */
function alternativesOf(tried: ReadonlyArray<{ process: string; machine: string; attempt: Attempt }>, chosen: BuiltRoute): SandAlternative[] {
  const rows = tried.map(({ process, machine, attempt }): SandAlternative => {
    const r = attempt.route;
    if (!r) return { mouldingProcess: process, mouldingMachine: machine, chosen: false, cavities: null, totalUsd: null, complete: false, reason: attempt.missing[0] ?? 'could not make a route' };
    const gaps = r.lines.filter(isGap).map((l) => l.process);
    return {
      mouldingProcess: r.mouldingProcess, mouldingMachine: r.mouldingMachine, chosen: r.mouldingMachine === chosen.mouldingMachine && r.mouldingProcess === chosen.mouldingProcess,
      cavities: r.cavities, totalUsd: r.totalUsd, complete: r.complete, reason: gaps.length ? `no machine for: ${gaps.join(', ')}` : null,
    };
  });
  const rank = (a: SandAlternative) => (a.chosen ? 0 : a.cavities == null ? 3 : a.complete ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.totalUsd ?? Infinity) - (b.totalUsd ?? Infinity) || a.mouldingMachine.localeCompare(b.mouldingMachine));
}

/** The flask of a moulding machine; every machine that reached a route has one (cavitiesPerMould refuses a machine without flask length, width and height). */
function flaskOf(mould: SandMachine): SandFlask {
  return {
    lengthMm: machineValue(mould, 'flask_length_mm') ?? 0,
    widthMm: machineValue(mould, 'flask_width_mm') ?? 0,
    heightMm: machineValue(mould, 'flask_height_mm') ?? 0,
  };
}
