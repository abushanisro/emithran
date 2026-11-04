// The sand-casting route steps after the metal is poured: shakeout, degating, cleaning, grinding and inspection. Same method as the
// moulding-side steps (sand-steps.ts): each seeds its calculator from the declared source of every input, checks the machine against what
// the step needs, and names every reason it cannot be done. Ported from the retired petrus-demo prototype (its design records, D-numbers, are archived outside the repo) (D122, D128-D130, D146).
import { machineText, machineValue, type SandMachine } from './sand-machines';
import { runStep, type SandRouteContext, type StepOutcome } from './sand-steps';
import type { SandReference } from './sand-reference';
import { valuesProvider } from './sand-seeds';

export const SHAKEOUT = 'Sand Casting - Shakeout';
export const SHAKEOUT_MANUAL = 'Sand Casting - Shakeout (manual)';
export const DEGATING = 'Sand Casting - Degating';
export const CLEANING_LOADS = 'Sand Casting - Cleaning (shot blast loads)';
export const CLEANING_ROOM = 'Sand Casting - Cleaning (blast room)';
export const FINISHING = 'Sand Casting - Finishing (grinding)';
export const INSPECTION = 'Sand Casting - Visual inspection';

/** What the steps after pouring need beyond the moulding-side context. */
export interface SandFinishContext extends SandRouteContext {
  /** The part's outer surface (mm²): blast-room cleaning and inspection are by surface. */
  surfaceAreaMm2: number;
  /** The designed ingates and risers of one casting (sand-gating.ts), which are cut off and ground. */
  gates: { ingateAreaMm2: number; ingateWidthMm: number; riserContactMm2: number; riserDiameterMm: number };
  /** The parting line to grind (mm) and where its length came from. */
  partingLine: { value: number; source: string };
  /** Core sand in the mould, kg (0 without cores): it goes through the shakeout with the metal. */
  coreSandKgPerMould: number;
  /** Cores made of sand in each casting. */
  coresCount: number;
}

const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });
const done = (r: { run: import('../../shared/calculators/reference-calculator').ReferenceCalcRun } | { reasons: string[] }): StepOutcome =>
  'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);

/** Linear interpolation in an ascending table of (x, y), held flat beyond its ends; null for an empty table. */
export function interpolate(points: ReadonlyArray<readonly [number, number]>, x: number): number | null {
  const t = [...points].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((p, q) => p[0] - q[0]);
  if (t.length === 0) return null;
  if (x <= t[0]![0]) return t[0]![1];
  if (x >= t[t.length - 1]![0]) return t[t.length - 1]![1];
  const i = t.findIndex((p) => p[0] >= x);
  const [a, b] = [t[i - 1]!, t[i]!];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

/** The first row of a weight-banded table whose Max Weight is at or above the weight, else the last row (rows ascending by Max Weight). */
function weightBand(ref: SandReference, table: string, weightKg: number): Readonly<Record<string, unknown>> | null {
  const rows = [...ref.table(table)].sort((a, b) => Number(a['Max Weight (kg)']) - Number(b['Max Weight (kg)']));
  return rows.find((r) => Number(r['Max Weight (kg)']) >= weightKg) ?? rows[rows.length - 1] ?? null;
}

const points = (ref: SandReference, table: string, x: string, y: string) => ref.table(table).map((r) => [Number(r[x]), Number(r[y])] as const);

/** Shakeout: the machine must take one mould's metal and core sand; the time is read from the table for the mould's rough mass (the part's mass by hand). */
export function shakeoutStep(ctx: SandFinishContext, m: SandMachine): StepOutcome {
  const capacity = machineValue(m, 'weight_capacity_kg');
  if (capacity == null) return fail(`machine ${m.name}: weight_capacity_kg`);
  const rough = ctx.poured.perMouldKg + ctx.coreSandKgPerMould;
  if (capacity < rough) return fail(`takes ${capacity.toFixed(0)} kg, one mould holds ${rough.toFixed(1)} kg of metal and cores`);
  if (machineText(m, 'shakeout_type') === 'manual') {
    const minutes = interpolate(points(ctx.ref, 'tblManualShakeoutTime', 'Part Mass (kg)', 'Shakeout Time (min)'), ctx.part.netKg);
    if (minutes == null) return fail('tblManualShakeoutTime is not staged');
    return done(runStep(ctx, SHAKEOUT_MANUAL, m, {}, {
      lookup: valuesProvider({ 'tblManualShakeoutTime.Shakeout Time (min)': { value: minutes, source: `tblManualShakeoutTime for a ${ctx.part.netKg.toFixed(2)} kg part` } }),
    }));
  }
  // An automatic shakeout takes parts only up to the plant's maximum length (maxAutoShakeoutLength); longer ones are shaken out by hand.
  const maxLength = ctx.ref.number('maxAutoShakeoutLength');
  if (maxLength == null) return fail('sand variable maxAutoShakeoutLength');
  const longest = Math.max(...ctx.part.dimsMm);
  if (longest > maxLength) return fail(`shakes out parts up to ${maxLength} mm automatically (maxAutoShakeoutLength), the part is ${longest.toFixed(0)} mm long`);
  const minutes = interpolate(points(ctx.ref, 'tblShakeoutTime', 'Rough Mass (kg)', 'Shakeout Time (min)'), rough);
  if (minutes == null) return fail('tblShakeoutTime is not staged');
  return done(runStep(ctx, SHAKEOUT, m, { cavities: { value: ctx.cavities, source: 'cavities that fit the flask (layoutNumCav, sand borders)' } }, {
    lookup: valuesProvider({ 'tblShakeoutTime.Shakeout Time (min)': { value: minutes, source: `tblShakeoutTime for ${rough.toFixed(1)} kg of metal and cores per mould` } }),
  }));
}

/** The designed gates and risers of one casting, as the engine inputs degating and grinding cut and grind. */
const gateInputs = (ctx: SandFinishContext) => ({
  ingate_area_mm2: { value: ctx.gates.ingateAreaMm2, source: 'Sand Casting - Gating system: ingate area' },
  riser_contact_mm2: { value: ctx.gates.riserContactMm2, source: 'Sand Casting - Risers: riser diameter' },
});

/** Degating: a machine that cuts (it has a feed rate), takes the part, and cuts across the widest ingate or riser. */
export function degateStep(ctx: SandFinishContext, m: SandMachine): StepOutcome {
  if ((machineValue(m, 'feed_rate_mm2_per_s') ?? 0) <= 0) return fail('breaks gates off (no feed rate): not modelled');
  const maxWeight = machineValue(m, 'max_weight_kg');
  const maxCut = machineValue(m, 'max_cut_diameter_mm');
  if (maxWeight == null) return fail(`machine ${m.name}: max_weight_kg`);
  if (maxCut == null) return fail(`machine ${m.name}: max_cut_diameter_mm`);
  if (maxWeight < ctx.part.netKg) return fail(`takes parts up to ${maxWeight} kg`);
  const widest = Math.max(ctx.gates.ingateWidthMm, ctx.gates.riserDiameterMm);
  if (maxCut < widest) return fail(`cuts up to ${maxCut} mm, a gate or riser is ${widest.toFixed(0)} mm wide`);
  return done(runStep(ctx, DEGATING, m, gateInputs(ctx)));
}

/** Shot blasting: by loads (a time per load, parts per load by weight capacity and batch size) or, in a blast room, by the outer surface. */
export function cleanStep(ctx: SandFinishContext, m: SandMachine): StepOutcome {
  const capacity = machineValue(m, 'weight_capacity_kg');
  if (capacity == null) return fail(`machine ${m.name}: weight_capacity_kg`);
  if (capacity < ctx.part.netKg) return fail(`takes ${capacity} kg a load`);
  const [, width, height] = ctx.part.dimsMm;
  for (const [key, side] of [['max_height_mm', height], ['max_width_mm', width]] as const) {
    const max = machineValue(m, key);
    if (max != null && max > 0 && max < side) return fail(`${key} ${max.toFixed(0)} mm is less than the part's ${side.toFixed(0)} mm`);
  }
  const area = { cad: valuesProvider({ area_mm2: { value: ctx.surfaceAreaMm2, source: 'part surface area (mm²)' } }) };
  if ((machineValue(m, 'time_per_load_min') ?? 0) <= 0) {
    if (!((machineValue(m, 'external_surface_blast_rate_m2_per_min') ?? 0) > 0)) return fail('no time per load and no blast rate');
    return done(runStep(ctx, CLEANING_ROOM, m, {}, area));
  }
  let perLoad = Math.max(1, Math.floor(capacity / ctx.part.netKg));
  const most = machineValue(m, 'max_batch_size');
  if (most != null && most > 0) perLoad = Math.min(perLoad, most);
  return done(runStep(ctx, CLEANING_LOADS, m, { parts_per_load: { value: perLoad, source: 'weight capacity / part weight, at most max batch size' } }));
}

/** Grinding: the machine must take the part; stub and flash sizes by the part's weight (tblGrindingDimensions), the speed factor by the material's cut code. */
export function finishStep(ctx: SandFinishContext, m: SandMachine): StepOutcome {
  const maxWeight = machineValue(m, 'max_weight_kg');
  if (maxWeight == null) return fail(`machine ${m.name}: max_weight_kg`);
  if (maxWeight < ctx.part.netKg) return fail(`takes parts up to ${maxWeight} kg`);
  const dims = weightBand(ctx.ref, 'tblGrindingDimensions', ctx.part.netKg);
  if (!dims) return fail('tblGrindingDimensions is not staged');
  const cutCode = ctx.material.columns['cut_code'];
  if (cutCode == null) return fail(`${ctx.material.name}: cut_code (which keys the grinding speed factor)`);
  const factorRow = ctx.ref.table('tblGrindingSpeedMaterialFactor').find((r) => Math.abs(Number(r['Material Cut Code']) - cutCode) < 1e-9);
  if (!factorRow) return fail(`tblGrindingSpeedMaterialFactor has no row for cut code ${cutCode}`);
  const row = `tblGrindingDimensions, parts up to ${dims['Max Weight (kg)']} kg`;
  const v = (col: string) => ({ value: Number(dims[col]), source: row, lookup: true });
  return done(runStep(
    ctx, FINISHING, m,
    { ...gateInputs(ctx), parting_line_mm: ctx.partingLine },
    {
      lookup: (key) => ({
        'tblGrindingDimensions.Ingate Height (mm)': v('Ingate Height (mm)'),
        'tblGrindingDimensions.Riser Height (mm)': v('Riser Height (mm)'),
        'tblGrindingDimensions.Parting Line Thickness (mm)': v('Parting Line Thickness (mm)'),
        'tblGrindingDimensions.Parting Line Height (mm)': v('Parting Line Height (mm)'),
        'tblGrindingSpeedMaterialFactor.Grinding Speed Material Factor': { value: Number(factorRow['Grinding Speed Material Factor']), source: `tblGrindingSpeedMaterialFactor, cut code ${cutCode}`, lookup: true },
      }[key] ?? null),
      cad: valuesProvider({}),
    },
  ));
}

/** Visual inspection: the external rate for the part's weight; the cores raise the time (single, double and multi-core factors). */
export function inspectStep(ctx: SandFinishContext, m: SandMachine): StepOutcome {
  const band = weightBand(ctx.ref, 'tblVisualInspection', ctx.part.netKg);
  if (!band) return fail('tblVisualInspection is not staged');
  return done(runStep(
    ctx, INSPECTION, m,
    { cores: { value: ctx.coresCount, source: 'cores made of sand' } },
    {
      lookup: (key) => (key === 'tblVisualInspection.External Inspection Rate (min / m^2)'
        ? { value: Number(band['External Inspection Rate (min / m^2)']), source: `tblVisualInspection, parts up to ${band['Max Weight (kg)']} kg`, lookup: true }
        : null),
      cad: valuesProvider({ area_mm2: { value: ctx.surfaceAreaMm2, source: 'part surface area (mm²)' } }),
    },
  ));
}
