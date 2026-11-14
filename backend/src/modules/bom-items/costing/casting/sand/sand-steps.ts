// The sand-casting route steps that need the mould: moulding (cavities, flask), melting, pouring and cooling. Each step seeds its
// calculator from the declared source of every input (sand-seeds.ts), checks the machine against what the step needs, and returns the
// time and the calculator run, or the reasons it cannot be done. selectAndCost() picks the cheapest capable machine and costs the line
// with the shared casting line builder. Ported from the retired petrus-demo prototype (its design records, D-numbers, are archived outside the repo) (D122, D128-D130).
//
// Nothing is substituted: a missing input, an unstaged table or a machine without a rate is named in the reasons.
import type { MachineChoiceDto, SourceRef } from '../../../dto/cost-breakdown.dto';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';
import { gap, line, roundLineCost, roundSec, type CostContext } from '../casting-finishing';
import { machineChoice, roundPerPart, type ChoiceEval } from '../machine-choice';
import { asFinishingMachine, machineValue, type SandMachine } from './sand-machines';
import { pouringCoefficient } from './sand-gating';
import type { SandReference } from './sand-reference';
import { seedsFor, valuesProvider, variableProvider, type SeedProvider, type SeedProviders } from './sand-seeds';

export const SAND_PROCESS_GROUP = 'Sand Casting';
export const MOULDING_LINE = 'Sand Casting - Moulding (automatic line)';
export const MOULDING_MANUAL = 'Sand Casting - Moulding (manual flask)';
export const MELTING = 'Sand Casting - Melting';
export const POUR = 'Sand Casting - Pour';
export const COOLING = 'Sand Casting - Cooling';

const LB_PER_KG = 1 / 0.45359237;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The part's sand-casting material, as the raw_materials row (columns by name). */
export interface SandMaterial {
  /** raw_materials.id: the record the calculator dialog opens for a material input. */
  id: string;
  name: string;
  materialType: string | null;
  /** raw_materials columns the calculators read (density_kg_m3, heat_of_fusion_j_kg, ...). */
  columns: Readonly<Record<string, number | null>>;
}

export interface SandPart {
  netKg: number;
  /** The casting's modulus (volume / surface), mm. */
  modulusMm: number;
  /** Length, width and height of the casting in the mould: height along the draw direction (mm). */
  dimsMm: readonly [number, number, number];
  /** Nominal wall (mm), which section-based pouring coefficients are read by. */
  wallNominalMm: number | null;
}

/** The plant's hot box settings (Cost Guide): the core box temperature and the binder's cure temperature (°C), and the depth of core that must be cured before it is stripped (mm). Each is null until set. */
export interface HotBoxSettings {
  coreboxTempC: number | null;
  cureTempC: number | null;
  curedDepthMm: number | null;
}

export interface SandRouteContext {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: SandMaterial;
  part: SandPart;
  /** Cavities per mould (decided by cavitiesPerMould for the chosen moulding machine). */
  cavities: number;
  /** Cores in each casting; a mould has `cavities` times this many. */
  coresPerCasting: number;
  /** Metal poured: the casting with its risers and gating (kg), per casting and per mould, and the calculation behind it once it is run. */
  poured: { perCastingKg: number; perMouldKg: number; ref?: SourceRef };
  /** USD per kWh: the Cost Guide's, else the location's sourced electricity price; null when neither exists (energy not charged). */
  energyPricePerKwh: number | null;
  /** Where the energy price comes from, for the trace. */
  energyPriceSource?: string | null;
  hotBox: HotBoxSettings;
  /** The batch size of the scenario (the preparation of a coating or an oven is shared by it). */
  batchSize: number;
}

export type StepOutcome =
  | { ok: true; sec: number; run: ReferenceCalcRun; energyCostUsd: number; notes: string[]; /** Material used by the step (the refractory coating), USD per casting, added to the run cost. */ materialCostUsd?: number; /** The energy price the energy was charged at, and its source (energyBasisOf). */ energyBasis?: string }
  | { ok: false; reasons: string[] };

const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });

/** The metal poured, per casting or per mould, with the metal-per-casting calculation behind it (its ref) when it has been run. */
function pouredSeed(ctx: SandRouteContext, per: 'casting' | 'mould'): CalcSeed {
  return {
    value: per === 'casting' ? ctx.poured.perCastingKg : ctx.poured.perMouldKg,
    source: per === 'casting' ? 'metal per casting: net, risers and gating' : 'metal per casting x cavities',
    ...(ctx.poured.ref ? { ref: ctx.poured.ref } : {}),
  };
}

/** One calculator run: seed every input from its declared source, run it, or say what is missing. */
export function runStep(
  ctx: SandRouteContext,
  calculator: string,
  machine: SandMachine | null,
  engine: Record<string, CalcSeed>,
  extra: SeedProviders = {},
  output = 'Cycle Time',
): { run: ReferenceCalcRun } | { reasons: string[] } {
  const calc = ctx.spec.calculators.find((c) => c.name === calculator);
  if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
  const materialProvider: SeedProvider = (key) => {
    const value = ctx.material.columns[key];
    return value == null ? null : {
      value, source: `${ctx.material.name}: ${key}`,
      ref: { kind: 'material', materialId: ctx.material.id, materialName: ctx.material.name, column: key },
    };
  };
  const machineProvider: SeedProvider = (key) => {
    const value = machine ? machineValue(machine, key) : null;
    return value == null || !machine ? null : {
      value, source: `machine ${machine.name}: ${key}`,
      ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, machineClass: machine.machineClass, location: machine.location, column: key },
    };
  };
  const { seeds, missing } = seedsFor(calc, {
    variable: variableProvider(ctx.ref),
    material: materialProvider,
    machine: machineProvider,
    cad: valuesProvider({ modulus_mm: { value: ctx.part.modulusMm, source: 'casting modulus: volume / surface (mm)' } }),
    engine: valuesProvider(engine),
    ...extra,
  });
  if (missing.length) return { reasons: missing.map((m) => `${calculator}: ${m}`) };
  const run = runReferenceCalculator(ctx.calculators, calculator, seeds as Record<string, CalcSeed>, output);
  return run.value == null ? { reasons: run.missing } : { run };
}

const cavitiesSource = (ctx: SandRouteContext) => ({ value: ctx.cavities, source: 'cavities that fit the flask (layoutNumCav, sand borders)' });

/**
 * Cavities per mould: the chosen number; or on moulding lines the most of a layout in layoutNumCav that fits inside the flask's sand
 * borders; one on manual moulding, unless the user asks for more (without pattern costs more cavities would look free). Above
 * largePartThreshold only one fits.
 */
export function cavitiesPerMould(
  ref: SandReference,
  mould: SandMachine,
  [l, w, h]: readonly [number, number, number],
  netKg: number,
  chosen: number | null,
): { cavities: number } | { reasons: string[] } {
  const miss = ref.absent({ numbers: ['largePartThreshold'], tables: ['layoutNumCav'] });
  const [fl, fw, fh] = [machineValue(mould, 'flask_length_mm'), machineValue(mould, 'flask_width_mm'), machineValue(mould, 'flask_height_mm')];
  if (fl == null || fw == null || fh == null) miss.push(`machine ${mould.name}: flask length, width and height`);
  if (miss.length) return { reasons: miss };
  const edge = machineValue(mould, 'sand_border_flask_edge_mm') ?? 0;
  const bottom = machineValue(mould, 'sand_border_flask_bottom_mm') ?? 0;
  const between = machineValue(mould, 'sand_border_between_impressions_mm') ?? 0;
  if (h + 2 * bottom > fh!) return { reasons: [`part height ${h.toFixed(0)} mm with sand borders exceeds the flask height ${fh!.toFixed(0)} mm`] };
  const [ul, uw] = [fl! - 2 * edge, fw! - 2 * edge];
  const row = (n: number, side: number) => n * side + (n - 1) * between;
  const fits = (nl: number, nw: number) => (row(nl, l) <= ul && row(nw, w) <= uw) || (row(nl, l) <= uw && row(nw, w) <= ul);
  const large = netKg > ref.number('largePartThreshold')!;
  const layouts = ref.table('layoutNumCav').map((r) => [Number(r['Cavities Length Wise']), Number(r['Cavities Width Wise']), Number(r['Number of Cavities'])] as const);
  const possible = (n: number) => (n === 1 || !large) && layouts.some(([nl, nw, k]) => k === n && fits(nl, nw));
  const doesNotFit = `part ${l.toFixed(0)} x ${w.toFixed(0)} mm does not fit the flask ${fl!.toFixed(0)} x ${fw!.toFixed(0)} mm`;
  if (chosen != null) return possible(chosen) ? { cavities: chosen } : { reasons: [`${chosen} cavities do not fit the flask ${fl!.toFixed(0)} x ${fw!.toFixed(0)} mm`] };
  const isLine = (machineValue(mould, 'mold_rate_no_core_cycles_per_hr') ?? 0) > 0;
  if (!isLine) return possible(1) ? { cavities: 1 } : { reasons: [doesNotFit] };
  const most = Math.max(0, ...layouts.map(([, , k]) => k).filter(possible));
  return most > 0 ? { cavities: most } : { reasons: [doesNotFit] };
}

const isPit = (m: SandMachine) => m.machineClass === 'sand_casting_manual_pit_moldmaking';

/** Moulding: an automatic line (slowed per core) or a manual flask (with the cure time of the process's sand). */
export function mouldStep(ctx: SandRouteContext, mould: SandMachine): StepOutcome {
  if ((machineValue(mould, 'mold_rate_no_core_cycles_per_hr') ?? 0) > 0) {
    const r = runStep(ctx, MOULDING_LINE, mould, {
      cavities: cavitiesSource(ctx),
      cores_per_mould: { value: ctx.coresPerCasting * ctx.cavities, source: 'cores per casting x cavities' },
    });
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
  }
  const cure = { sand_casting_manual_floor_moldmaking: 'sandCureTimeManualFloor', sand_casting_manual_pit_moldmaking: 'sandCureTimeManualPit' }[mould.machineClass] ?? 'sandCureTimeManualStd';
  const cureMin = ctx.ref.number(cure);
  if (cureMin == null) return fail(`sand variable ${cure}`);
  const r = runStep(ctx, MOULDING_MANUAL, mould, {
    cavities: cavitiesSource(ctx),
    poured_per_mould_kg: pouredSeed(ctx, 'mould'),
    sand_cure_min: { value: cureMin, source: `Sand casting variable ${cure}` },
  });
  return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
}

/**
 * Melting: the furnace must reach the pouring temperature (the material's injection temperature) and hold one mould's metal
 * (furnaceCapacitySafetyFactor). The energy price is the user's: unset, the energy is not charged and the line says so.
 */
export function meltStep(ctx: SandRouteContext, furnace: SandMachine): StepOutcome {
  const pourTemp = ctx.material.columns['injection_temp_c'];
  const density = ctx.material.columns['density_kg_m3'];
  const safety = ctx.ref.number('furnaceCapacitySafetyFactor');
  const reasons: string[] = [];
  if (pourTemp == null) reasons.push(`${ctx.material.name}: injection_temp_c (the pouring temperature)`);
  if (density == null || !(density > 0)) reasons.push(`${ctx.material.name}: density_kg_m3`);
  if (safety == null) reasons.push('sand variable furnaceCapacitySafetyFactor');
  const maxTemp = machineValue(furnace, 'max_temperature_c');
  const capacity = machineValue(furnace, 'furnace_capacity_m3');
  if (maxTemp == null) reasons.push(`machine ${furnace.name}: max_temperature_c`);
  if (capacity == null) reasons.push(`machine ${furnace.name}: furnace_capacity_m3`);
  if (reasons.length) return fail(...reasons);
  if (maxTemp! < pourTemp!) return fail(`reaches ${maxTemp!.toFixed(0)} °C, the metal is poured at ${pourTemp!.toFixed(0)} °C`);
  const needM3 = (safety! * ctx.poured.perMouldKg) / density!;
  if (capacity! < needM3) return fail(`holds ${capacity} m³, one mould needs ${needM3.toFixed(3)} m³`);
  const priced = ctx.energyPricePerKwh != null;
  const r = runStep(
    ctx, MELTING, furnace,
    { poured_kg: pouredSeed(ctx, 'casting') },
    { scenario: valuesProvider({ energy_price: { value: priced ? ctx.energyPricePerKwh! : 0, source: priced ? ctx.energyPriceSource ?? 'energy price (USD/kWh)' : 'no energy price: none set in the Cost Guide and none for the location' } }) },
  );
  if (!('run' in r)) return fail(...r.reasons);
  const energy = r.run.outputs['Energy Cost'];
  if (energy == null) return fail(`${MELTING} has no Energy Cost`);
  return {
    ok: true, sec: r.run.value!, run: r.run, energyCostUsd: priced ? energy : 0, ...(priced ? { energyBasis: energyBasisOf(ctx) } : {}),
    notes: priced ? [] : ['Melting energy is not charged: the location has no electricity price (location_electricity_prices) and none is set in the Cost Guide.'],
  };
}

/** Pouring: the ladle must hold one mould; the coefficient is the material's row of tblPouringCoefficients for the poured weight or the section. */
export function pourStep(ctx: SandRouteContext, ladle: SandMachine): StepOutcome {
  const capacity = machineValue(ladle, 'ladle_weight_capacity_kg');
  if (capacity == null) return fail(`machine ${ladle.name}: ladle_weight_capacity_kg`);
  if (capacity < ctx.poured.perMouldKg) return fail(`ladle holds ${capacity} kg, one mould needs ${ctx.poured.perMouldKg.toFixed(1)} kg`);
  const coefficient = pouringCoefficient(ctx.ref, ctx.material.materialType, ctx.poured.perMouldKg * LB_PER_KG, ctx.part.wallNominalMm != null ? ctx.part.wallNominalMm / 25.4 : null);
  if ('missing' in coefficient) return fail(coefficient.missing);
  const r = runStep(
    ctx, POUR, ladle,
    { poured_per_mould_kg: pouredSeed(ctx, 'mould'), cavities: cavitiesSource(ctx) },
    { lookup: (key) => (key === 'tblPouringCoefficients.Coefficient' ? { value: coefficient.value, source: coefficient.source, lookup: true } : null) },
  );
  return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
}

/** Cooling in the mould (Chvorinov's rule), with the exponent for pit moulds or the others. */
export function coolStep(ctx: SandRouteContext, machine: SandMachine, pit: boolean): StepOutcome {
  const name = pit ? 'modulusConstantManualPitMoldmaking' : 'modulusConstant';
  const exponent = ctx.ref.number(name);
  if (exponent == null) return fail(`sand variable ${name}`);
  const r = runStep(ctx, COOLING, machine, {
    cavities: cavitiesSource(ctx),
    modulus_exponent: { value: exponent, source: `Sand casting variable ${name}` },
  });
  return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
}

export interface CostedStep {
  line: ProcessLineCost;
  machine: SandMachine | null;
  outcome: Extract<StepOutcome, { ok: true }> | null;
  warnings: string[];
}

/** The energy price a step's energy is charged at, with where it comes from, for the line (the trace has it too). */
export function energyBasisOf(ctx: Pick<SandRouteContext, 'energyPricePerKwh' | 'energyPriceSource'>): string | undefined {
  return ctx.energyPricePerKwh != null ? `${ctx.energyPricePerKwh} USD/kWh (${ctx.energyPriceSource ?? 'energy price'})` : undefined;
}

/**
 * The cheapest capable machine for a step, costed as a casting line. Preferred machines come first when the data's
 * usePreferredMachines says so. With no capable machine the line is a named gap carrying every machine's reason.
 */
export function selectAndCost(input: {
  process: string;
  machineClass: string;
  machines: readonly SandMachine[];
  evaluate: (machine: SandMachine) => StepOutcome;
  batchSize: number;
  costContext: CostContext;
  ref: SandReference;
  criteria: string[];
}): CostedStep {
  const warnings: string[] = [];
  const evaluated = input.machines.map((m) => {
    if (m.machineRatePerHr == null) return { m, outcome: fail('no machine hour rate on file, and the HR Rates engine could not price it') as StepOutcome, costed: null as ProcessLineCost | null };
    const outcome = input.evaluate(m);
    if (!outcome.ok) return { m, outcome, costed: null };
    const base = line({
      process: input.process, processGroup: SAND_PROCESS_GROUP, processRoute: input.process, machineClass: input.machineClass,
      machine: asFinishingMachine(m), sec: outcome.sec, batchSize: input.batchSize, costContext: input.costContext, warnings: [], run: outcome.run,
      breakdown: `${input.process}: ${roundSec(outcome.sec)} s per casting${m.rateSource === 'engine' ? ' (machine hour rate from the HR Rates engine)' : ''}`,
    });
    // Charged beyond time: the step's energy and material, its own figure on the line (stored and shown), kept below a cent.
    const material = outcome.materialCostUsd ?? 0;
    const other = outcome.energyCostUsd + material;
    const detail = [outcome.energyCostUsd ? `energy ${roundPerPart(outcome.energyCostUsd)}` : '', material ? `material ${roundPerPart(material)}` : ''].filter(Boolean).join(' + ');
    const costed: ProcessLineCost = other
      ? { ...base, runCost: roundLineCost(base.runCost + other), totalCost: roundLineCost(base.totalCost + other), otherCostPerPartUsd: roundPerPart(other), otherCostDetail: `${detail} USD per casting${outcome.energyBasis ? ` at ${outcome.energyBasis}` : ''}` }
      : base;
    return { m, outcome, costed };
  });
  const capable = evaluated.filter((e) => e.costed);
  const preferOnly = input.ref.number('usePreferredMachines') === 1 && capable.some((e) => e.m.preferred);
  const pool = preferOnly ? capable.filter((e) => e.m.preferred) : capable;
  const best = [...pool].sort((a, b) => a.costed!.totalCost - b.costed!.totalCost || a.m.name.localeCompare(b.m.name))[0];
  const evals: ChoiceEval[] = evaluated.map((e) => ({
    name: e.m.name,
    reasons: e.outcome.ok ? (preferOnly && !e.m.preferred ? ['not a preferred machine (usePreferredMachines)'] : []) : e.outcome.reasons,
    cost: e.costed?.totalCost ?? null,
  }));
  const choice: MachineChoiceDto = machineChoice({
    rule: 'Cheapest cost per part among the capable machines (machine rate, crew, setup and energy)',
    criteria: input.criteria,
    evals,
    chosen: best?.m.name ?? null,
  });
  if (!best) {
    const first = evaluated.find((e) => !e.outcome.ok);
    const why = first && !first.outcome.ok ? `${first.m.name}: ${first.outcome.reasons.join('; ')}` : `no machines of class ${input.machineClass}`;
    return { line: { ...gap(input.process, SAND_PROCESS_GROUP, input.machineClass, `no ${input.process} machine fits (${why})`), machineChoice: choice }, machine: null, outcome: null, warnings };
  }
  const outcome = best.outcome as Extract<StepOutcome, { ok: true }>;
  warnings.push(...outcome.notes);
  if (best.m.rateSource === 'engine' && best.m.assumedDefaults.length) {
    warnings.push(`${best.m.name}: the machine hour rate comes from the HR Rates engine, which assumed its defaults for ${best.m.assumedDefaults.join(', ')}.`);
  }
  return { line: { ...best.costed!, machineChoice: choice }, machine: best.m, outcome, warnings };
}
