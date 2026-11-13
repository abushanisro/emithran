// The refractory coating of the mould and of the cores, its drying, and the gluing of the cores into an assembly: route steps the plant data defines
// (memory/Sand casting: the coating methods' application rate and output, the coating densities, the preparation times, the oven beds, the crew sizes and
// singleCoreAssemblyTime) and the calculators "Refractory coat", "Refractory drying" and "Core assembly" compute. Coating is the user's choice (most
// castings are not coated), and the drying time and the coating price are the plant's own settings: none is assumed, so a coating chosen without a drying time
// is a named gap, and a coating without a price is costed for time only and says so.
import type { CostContext } from '../casting-finishing';
import type { CostedStep, SandRouteContext, StepOutcome } from './sand-steps';
import { runStep, selectAndCost } from './sand-steps';
import type { SandFinishContext } from './sand-finishing-steps';
import { machineValue, type SandMachine } from './sand-machines';
import { valuesProvider } from './sand-seeds';
import type { CoreRegion } from './sand-cores';

export const REFRACTORY_COAT = 'Sand Casting - Refractory coat';
export const REFRACTORY_DRYING = 'Sand Casting - Refractory drying';
export const CORE_ASSEMBLY = 'Sand Casting - Core assembly';

export const COAT_CHOICES = ['none', 'mould', 'cores', 'both'] as const;
export type RefractoryChoice = (typeof COAT_CHOICES)[number];
export const DRY_METHODS = ['oven', 'air'] as const;
export type DryMethod = (typeof DRY_METHODS)[number];

/** What the user chose for the coating (Cost Guide). Nothing is coated unless chosen; the drying and the price are null until set. */
export interface RefractorySettings {
  coat: RefractoryChoice;
  dryMethod: DryMethod | null;
  /** The plant's time for a load in the oven, or on the air-dry area (minutes). */
  dryMinutes: number | null;
  /** USD per kg of coating; unset: the coating is not charged and the line says so. */
  pricePerKg: number | null;
}

export const NO_REFRACTORY: RefractorySettings = { coat: 'none', dryMethod: null, dryMinutes: null, pricePerKg: null };

// The dryers are the machines of the two refractory drying classes (seeded by migration 851). The people who coat, and who glue cores, are the work centre
// the data names "Default" for the refractory processes: the air-dry file holds it (labour 30.49 and indirect overhead 14.09 USD/h, no machine), and the two
// coat files (machines_default_2.csv and _3.csv, "placeholders" in 851) carry the identical row. Migrations no longer write reference rows (REFERENCE_DATA.json,
// from 936), so the coating and the gluing are costed on that seeded Default work centre rather than on rows only a data package could add.
const CLASSES = {
  oven: 'sand_casting_refractory_coat_oven_dry',
  air: 'sand_casting_refractory_coat_air_dry',
} as const;
const WORK_CENTRE = CLASSES.air;
/** The machine classes the refractory steps read (the cost service loads them with the rest of the route's). */
export const REFRACTORY_CLASSES: readonly string[] = Object.values(CLASSES);

const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });

/** What is needed of the settings once something is coated: the drying method and time. */
export function refractorySettingsProblems(s: RefractorySettings): string[] {
  if (s.coat === 'none') return [];
  const problems: string[] = [];
  if (s.dryMethod == null) problems.push('the drying method (oven or air) is not set in the Cost Guide');
  if (s.dryMinutes == null) problems.push("the plant's drying time is not set in the Cost Guide");
  return problems;
}

/** The coating the plant's defaults name: its method's row of tblRefractoryCoating and its density in processConsumables. */
function coating(ctx: SandRouteContext): { rate: number; output: number; density: number; method: string; liquid: string } | { missing: string[] } {
  const method = ctx.ref.text('defaultMoldRefractoryCoatingMethod');
  const liquid = ctx.ref.text('defaultRefractoryBaseLiquid');
  if (!method || !liquid) return { missing: ['sand variable defaultMoldRefractoryCoatingMethod and defaultRefractoryBaseLiquid'] };
  const row = ctx.ref.table('tblRefractoryCoating').find((r) => String(r['Application Method']) === method);
  if (!row) return { missing: [`tblRefractoryCoating has no row for the method ${method}`] };
  const consumable = `${liquid} Refractory Coating`;
  const dens = ctx.ref.table('processConsumables').find((r) => String(r['Consumable Name']) === consumable);
  if (!dens) return { missing: [`processConsumables has no row for ${consumable}`] };
  const rate = Number(row['Application Rate (m^2 / min)']);
  const output = Number(row['Average Output Volume (L / min)']);
  const density = Number(dens['Density (kg / m^3)']);
  if (![rate, output, density].every((v) => Number.isFinite(v) && v > 0)) return { missing: [`the ${method} / ${consumable} rows have no usable rate, output and density`] };
  return { rate, output, density, method, liquid };
}

/** A machine with the plant's crew for the step: the data's own rows give the work centre no operators, the plant's variable gives them. */
function crewed(machines: readonly SandMachine[], crew: number): SandMachine[] {
  return machines.map((m) => ({ ...m, operators: crew }));
}

/** Coating the surface of the mould's cavity, or of the casting's cores. The coating used is charged at the user's price when set. */
export function coatStep(ctx: SandFinishContext, m: SandMachine, what: 'mould' | 'cores', areaMm2: number, price: number | null): StepOutcome {
  const c = coating(ctx);
  if ('missing' in c) return fail(...c.missing);
  const prepVariable = what === 'mould' ? 'defaultRefractoryCoatingMoldPreparationTime' : 'defaultRefractoryCoatingCorePreparationTime';
  const absent = ctx.ref.absent({ numbers: ['defaultNumMoldRefractoryCoatingApplications', prepVariable] });
  if (absent.length) return fail(...absent);
  const r = runStep(
    ctx, REFRACTORY_COAT, m,
    {
      coat_area_mm2: { value: areaMm2, source: what === 'mould' ? "the part's surface (the mould's cavity; the gating channels are not counted)" : "the cores' surface, exact from their bodies (casting analysis)" },
      prep_hr: { value: ctx.ref.number(prepVariable)!, source: `Sand casting variable ${prepVariable}` },
      batch_size: { value: ctx.batchSize, source: 'batch size of the scenario' },
    },
    {
      lookup: valuesProvider({
        'tblRefractoryCoating.Application Rate (m^2 / min)': { value: c.rate, source: `tblRefractoryCoating: ${c.method}` },
        'tblRefractoryCoating.Average Output Volume (L / min)': { value: c.output, source: `tblRefractoryCoating: ${c.method}` },
        'processConsumables.Density (kg / m^3)': { value: c.density, source: `processConsumables: ${c.liquid} Refractory Coating` },
      }),
    },
  );
  if (!('run' in r)) return fail(...r.reasons);
  const mass = r.run.outputs['Coating Mass'];
  const notes = [
    `${what === 'mould' ? 'Mould' : 'Core'} coating: ${c.method}, ${c.liquid} coating (the plant's defaults); ${mass != null ? `${mass.toFixed(3)} kg of coating per casting` : ''}.`,
    ...(what === 'cores' ? ['The number of coats of a core is the plant default for the mould (defaultNumMoldRefractoryCoatingApplications): the data names none for cores.'] : []),
  ];
  let materialCostUsd = 0;
  if (mass != null && price != null) materialCostUsd = mass * price;
  else if (mass != null) notes.push(`The coating (${mass.toFixed(3)} kg per casting) is not charged: its price is not set in the Cost Guide.`);
  return { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, materialCostUsd, notes };
}

/**
 * Drying the coated mould or cores. One load is what the bed less racking holds of the item (the flask, or the casting's cores together); the drying time is
 * the plant's own. The oven's energy is its power over the drying time, shared by the castings a load makes, priced with the energy price when set.
 */
export function dryStep(ctx: SandFinishContext, m: SandMachine, method: DryMethod, minutes: number, itemVolumeMm3: number, itemsPerCasting: number): StepOutcome {
  const oven = method === 'oven';
  const prepVariable = oven ? 'defaultRefractoryCoatingOvenDryPreparationTime' : 'defaultRefractoryCoatingAirDryPreparationTime';
  const absent = ctx.ref.absent({ numbers: [prepVariable, ...(oven ? ['defaultRefractoryCoatOvenAvailableFactor'] : [])] });
  if (absent.length) return fail(...absent);
  const bed = ['bed_length_mm', 'bed_width_mm', 'bed_height_mm'].map((k) => machineValue(m, k));
  if (bed.some((v) => v == null || !(v > 0))) return fail(`machine ${m.name}: bed length, width and height`);
  const factor = oven ? ctx.ref.number('defaultRefractoryCoatOvenAvailableFactor')! : 1;
  const priced = ctx.energyPricePerKwh != null;
  const r = runStep(
    ctx, REFRACTORY_DRYING, m,
    {
      item_volume_mm3: { value: itemVolumeMm3, source: itemsPerCasting < 1 ? "a flask (the mould's two halves)" : "the casting's cores together (their boxes)" },
      items_per_casting: { value: itemsPerCasting, source: itemsPerCasting < 1 ? 'one flask makes one casting per cavity' : 'one set of cores per casting' },
      available_factor: { value: factor, source: oven ? 'Sand casting variable defaultRefractoryCoatOvenAvailableFactor (racking space)' : 'an air-dry area has no racking factor in the data' },
      prep_hr: { value: ctx.ref.number(prepVariable)!, source: `Sand casting variable ${prepVariable}` },
      batch_size: { value: ctx.batchSize, source: 'batch size of the scenario' },
    },
    { scenario: valuesProvider({ refractory_dry_minutes: { value: minutes, source: "the plant's drying time for a load, set in the Cost Guide (min)" } }) },
  );
  if (!('run' in r)) return fail(...r.reasons);
  const perLoad = r.run.outputs['Items per Load'];
  if (perLoad == null || perLoad < 1) return fail(`one item (${(itemVolumeMm3 / 1e9).toFixed(3)} m³) does not fit the bed less racking`);
  const kwh = r.run.outputs['Energy'] ?? 0;
  const notes = kwh > 0 && !priced ? [`The drying energy (${kwh.toFixed(3)} kWh per casting) is not charged: no energy price for the location or in the Cost Guide.`] : [];
  return { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: priced ? kwh * ctx.energyPricePerKwh! : 0, notes };
}

/** Gluing the cores of a casting into an assembly: one glue for each core after the first. */
export function coreAssemblyStep(ctx: SandFinishContext, m: SandMachine, cores: number): StepOutcome {
  const absent = ctx.ref.absent({ numbers: ['singleCoreAssemblyTime'] });
  if (absent.length) return fail(...absent);
  const r = runStep(ctx, CORE_ASSEMBLY, m, { cores_per_casting: { value: cores, source: 'cores made of sand in each casting' } });
  if (!('run' in r)) return fail(...r.reasons);
  return { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: ['Core gluing is costed at the plant\'s work-centre rate with one operator; the time per glue (singleCoreAssemblyTime) is read in seconds.'] };
}

interface Common {
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  batchSize: number;
  costContext: CostContext;
  ref: SandRouteContext['ref'];
}

/**
 * The lines of the cores' side: the cores coated and dried, and glued together. Nothing when nothing is chosen. `cores` are the sand cores of one casting.
 */
export function coreRefractoryLines(ctx: SandFinishContext, settings: RefractorySettings, cores: readonly CoreRegion[], common: Common): CostedStep[] {
  const out: CostedStep[] = [];
  const machines = (c: string) => common.machinesByClass[c] ?? [];
  const step = (process: string, cls: string, crew: number | null, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({ process, machineClass: cls, machines: crew == null ? machines(cls) : crewed(machines(cls), crew), evaluate, criteria, ...common });
  const operators = ctx.ref.number('defaultMoldRefractoryCoatingNumOperators');
  const coats = settings.coat === 'cores' || settings.coat === 'both';
  if (coats && cores.length > 0) {
    const areas = cores.map((c) => c.areaMm2);
    const area = areas.every((a): a is number => a != null) ? areas.reduce((s, a) => s + a, 0) : null;
    out.push(step('Core Refractory Coat', WORK_CENTRE, operators ?? 1, (m) => (area == null ? fail('a core has no measured surface (no core body): re-run the casting analysis') : coatStep(ctx, m, 'cores', area, settings.pricePerKg)), ['A work-centre rate on file', "The cores' surface is measured (casting analysis)"]));
    out.push(dryLine(ctx, settings, step, 'cores', cores.reduce((s, c) => s + c.sizeMm[0] * c.sizeMm[1] * c.sizeMm[2], 0), 1));
  }
  if (cores.length > 1) {
    out.push(step('Core assembly', WORK_CENTRE, 1, (m) => coreAssemblyStep(ctx, m, cores.length), ['A work-centre rate on file', 'singleCoreAssemblyTime in the data']));
  }
  return out;
}

/** The lines of the mould's side: the cavity coated and the mould dried. Nothing when the mould is not to be coated. */
export function mouldRefractoryLines(ctx: SandFinishContext, settings: RefractorySettings, flaskVolumeMm3: number, common: Common): CostedStep[] {
  if (!(settings.coat === 'mould' || settings.coat === 'both')) return [];
  const machines = (c: string) => common.machinesByClass[c] ?? [];
  const step = (process: string, cls: string, crew: number | null, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({ process, machineClass: cls, machines: crew == null ? machines(cls) : crewed(machines(cls), crew), evaluate, criteria, ...common });
  const operators = ctx.ref.number('defaultMoldRefractoryCoatingNumOperators');
  return [
    step('Mold Refractory Coat', WORK_CENTRE, operators ?? 1, (m) => coatStep(ctx, m, 'mould', ctx.surfaceAreaMm2, settings.pricePerKg), ['A work-centre rate on file', "The part's surface is measured"]),
    dryLine(ctx, settings, step, 'mould', flaskVolumeMm3, 1 / ctx.cavities),
  ];
}

type StepFn = (process: string, cls: string, crew: number | null, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]) => CostedStep;

/** The drying line of an item: a named gap until the drying method and time are set. */
function dryLine(ctx: SandFinishContext, settings: RefractorySettings, step: StepFn, what: 'mould' | 'cores', itemVolumeMm3: number, itemsPerCasting: number): CostedStep {
  const oven = settings.dryMethod !== 'air';
  const cls = oven ? CLASSES.oven : CLASSES.air;
  const crewVariable = oven ? 'defaultRefractoryOvenDryNumberLaborers' : 'defaultRefractoryAirDryNumberLaborers';
  const process = `Refractory Coat ${oven ? 'Oven' : 'Air'} Dry (${what === 'mould' ? 'mould' : 'cores'})`;
  const problems = refractorySettingsProblems(settings);
  return step(process, cls, ctx.ref.number(crewVariable) ?? 1, (m) =>
    problems.length > 0 || settings.dryMethod == null || settings.dryMinutes == null
      ? fail(...problems)
      : dryStep(ctx, m, settings.dryMethod, settings.dryMinutes, itemVolumeMm3, itemsPerCasting),
  ['A work-centre rate on file', 'The item fits the bed less racking', "The plant's drying time is set"]);
}
