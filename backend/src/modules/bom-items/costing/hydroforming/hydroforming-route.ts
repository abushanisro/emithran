// The Sheet Metal - Hydroforming routes of a part (memory/Sheetmetal Hydroforming): its blank cut by the Offline Blank press (blanking and
// piercing in one stroke), then formed by Hydroform Deep Draw or Hydroform Fluid Cell. Every time comes from a calculator (hydroforming-
// calculators.json) seeded from the reference data, the part's measurements (hydroforming-part.ts) and the machine; every machine from HR Rates
// (migrations 828, 1109). Pure: the caller loads the data, nests the blank and converts the currency.
import { cappingTools, hydroformTooling, isHighStrength, stepRow, type HydroformingTool, type HydroformToolShop } from './hydroforming-tooling';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import { fail, routeKit, type RouteKit } from '../shared/calculators/route-kit';
import { noCostFeatureLine } from '../shared/core/engine-kernel';
import { HYDROFORMING_PROCESS_GROUP } from '../shared/core/part-family-process-group';

import type { HydroformPart } from './hydroforming-part';
import type { FeatureOp, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';
import type { SeedProvider } from '../casting/sand/sand-seeds';
import type { StepOutcome } from '../casting/sand/sand-steps';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import type { CalcSeed, ReferenceCalcRun, ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';




export { HYDROFORMING_PROCESS_GROUP };
export const HYDROFORMING_DOMAIN = 'hydroforming';
export const HYDROFORMING_CLASS = { press: 'hydroform', blank: 'hydroform_offline_blank' } as const;
export const HYDROFORMING_ROUTE_CLASSES: readonly string[] = Object.values(HYDROFORMING_CLASS);
export const HYDROFORMING_ROUTES = [
  { key: 'deep-draw', label: 'Hydroform Deep Draw', formingType: 'deep draw', formingOp: 'Deep Draw Forming' },
  { key: 'fluid-cell', label: 'Hydroform Fluid Cell', formingType: 'fluid cell', formingOp: 'Fluid Cell Forming' },
] as const;
export type HydroformingRouteKey = (typeof HYDROFORMING_ROUTES)[number]['key'];
/** The label of a route, as the quote and the route comparison name it. */
export const HYDROFORMING_ROUTE_LABEL = Object.fromEntries(HYDROFORMING_ROUTES.map((r) => [r.key, r.label])) as Readonly<Record<HydroformingRouteKey, string>>;
/** The Cost Guide keys of a hydroformed part (scenario_overrides). */
export const HYDROFORMING_KEYS = { route: 'hydroformRoute', partsPerTray: 'hydroformPartsPerTray', intensifier: 'hydroformIntensifier' } as const;
export const HYDRO_CALC = {
  press: 'Hydroforming - Hydroform', blank: 'Hydroforming - Offline blank', clean: 'Hydroforming - Clean tooling', throwPad: 'Hydroforming - Throw pad',
  hand: 'Hydroforming - Hand adjusting', tray: 'Hydroforming - Parts per tray', force: 'Hydroforming - Blanking force', blankSize: 'Hydroforming - Blank',
  material: 'Hydroforming - Material',
} as const;

export interface HydroformingMaterial {
  id: string | null;
  name: string;
  materialType: string | null;
  densityKgM3: number | null;
  /** USD per kg. */
  costPerKgUsd: number | null;
  utsMpa: number | null;
  shearStrengthMpa: number | null;
}

/** The blank nested on its sheet (true-shape, defaultUtilizationMethod TRUE_PART), by the caller. */
export interface HydroformingNest {
  grossKgPerPart: number;
  partsPerSheet: number;
  utilizationPct: number;
  sheetLengthMm: number;
  sheetWidthMm: number;
  method: 'true_shape' | 'rectangle';
  /** Why the true-shape nest was not used, when it was not. */
  note: string | null;
}

export interface HydroformingScenario {
  batchSize: number;
  route: HydroformingRouteKey | null;
  /** The Cost Guide's parts per Fluid Cell tray; null: defaultNumPartPerFluidCellTray. */
  partsPerTray: number | null;
  intensifier: boolean;
  /** Parts the tooling is spread over (annual volume x production life); null when the scenario gives none. */
  amortizationParts: number | null;
}

export interface HydroformingRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: HydroformingMaterial;
  part: HydroformPart;
  thicknessMm: number;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: HydroformingScenario;
  costContext: CostContext;
  nest: HydroformingNest | null;
  toolShop: HydroformToolShop | null;
}

/** Which route memory's rule gives the part: depth over width at or above fluidCellFormingRatioThreshold is Deep Draw, below it Fluid Cell. */
export interface HydroformingRule {
  route: HydroformingRouteKey;
  ratio: number;
  depthMm: number;
  widthMm: number;
  threshold: number;
  /** What the ratio reads: the drawn form (when the part is mainly that form) or the whole part. */
  basis: 'drawn form' | 'part';
}

export interface HydroformingRoute {
  key: HydroformingRouteKey;
  label: string;
  lines: ProcessLineCost[];
  material: {
    costUsd: number; grossKg: number; blankKg: number; partKg: number; blankAreaMm2: number; addendumMm: number;
    run: ReferenceCalcRun | null; blankRun: ReferenceCalcRun | null;
  };
  draws: number;
  drawRatiosPct: number[];
  partsPerTray: number;
  partsThatFit: number | null;
  press: { name: string; formingCycleTimeS: number } | null;
  handAdjustingLengthMm: number;
  throwPadAreaMm2: number;
  cappingTools: number;
  tooling: HydroformingTool[];
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isGap = (l: ProcessLineCost) => l.physicsGap != null;

/**
 * The rule of the part (see HydroformingRule): the drawn form's depth over its opening when the part is mainly that form
 * (partSurfaceAreaMultiplier of its surface, partProjectedAreaMultiplier of its plan), else the part's depth over its narrowest plan width.
 */
export function hydroformingRule(ref: SandReference, part: HydroformPart): HydroformingRule {
  const threshold = ref.number('fluidCellFormingRatioThreshold') ?? 0.65;
  const surfaceShare = ref.number('partSurfaceAreaMultiplier') ?? 0.75;
  const projectedShare = ref.number('partProjectedAreaMultiplier') ?? 0.85;
  const d = part.drawn;
  const drawnForm = d != null && d.formDevelopedAreaMm2 >= surfaceShare * part.developedAreaMm2 && d.formProjectedAreaMm2 >= projectedShare * part.projectedAreaMm2;
  const [depthMm, widthMm] = drawnForm ? [d.depthMm, d.openingWidthMm] : [part.depthMm, part.minWidthMm];
  const ratio = widthMm > 0 ? depthMm / widthMm : 0;
  return { route: ratio >= threshold ? 'deep-draw' : 'fluid-cell', ratio, depthMm, widthMm, threshold, basis: drawnForm ? 'drawn form' : 'part' };
}

/**
 * The addendum around the blank: a drawn part is drawn from an oversize blank and trimmed (blankAddendumWidth at its drawn depth); a part
 * whose flanges are formed from a blank cut to its net shape has none.
 */
export function blankAddendum(ref: SandReference, part: HydroformPart): { mm: number; row: Readonly<Record<string, unknown>> | null; source: string } {
  if (!part.drawn) return { mm: 0, row: null, source: 'no drawn form: the blank is cut to its net shape' };
  const row = stepRow(ref.table('blankAddendumWidth'), 'Total Form Depth (mm)', part.drawn.depthMm);
  const mm = Number(row?.['Addendum Width (mm)']);
  return row && Number.isFinite(mm)
    ? { mm, row, source: `blankAddendumWidth at ${r2(part.drawn.depthMm)} mm drawn depth` }
    : { mm: 0, row: null, source: 'blankAddendumWidth has no row for the drawn depth' };
}

/**
 * Fewest draws from the blank's equal-area diameter down to the opening (drawReductionPercentage by thickness, each ratio the punch over the
 * blank or the previous draw, in %; derated for a high-strength material by highStrengthMatlDeratePercent); null when the table has no row
 * for the thickness or 20 draws do not reach it.
 */
export function drawCount(ref: SandReference, blankDiaMm: number, openingMm: number, thicknessMm: number, highStrength: boolean): { draws: number; ratiosPct: number[] } | null {
  const row = stepRow(ref.table('drawReductionPercentage'), 'Material Thickness (mm)', thicknessMm);
  if (!row) return null;
  const pct = ['Draw Punch Ratio00', 'Draw Punch Ratio01', 'Draw Punch Ratio02', 'Draw Punch Ratio03'].map((c) => Number(row[c])).filter((n) => Number.isFinite(n) && n > 0);
  if (pct.length === 0) return null;
  const derate = highStrength ? (ref.number('highStrengthMatlDeratePercent') ?? 0) / 100 : 0;
  const ratios = pct.map((p) => 100 - (100 - p) * (1 - derate));
  let dia = blankDiaMm;
  for (let n = 1; n <= 20; n++) {
    dia *= ratios[Math.min(n - 1, ratios.length - 1)] / 100;
    if (dia <= openingMm) return { draws: n, ratiosPct: ratios.map(r2) };
  }
  return null;
}

/**
 * The manual-form length of a part: its curved flanges turned beyond bendAngleFormingThreshold, or curved beyond excessiveCurvedFormThreshold
 * (height over edge radius), which a fluid cell press cannot form; straight flanges, and anything under flangeAngleThreshold, are not hand work.
 */
export function manualFormLength(ref: SandReference, part: HydroformPart): number {
  const beyond = ref.number('bendAngleFormingThreshold') ?? Infinity;
  const curvature = ref.number('excessiveCurvedFormThreshold') ?? Infinity;
  const minFlange = ref.number('flangeAngleThreshold') ?? 0;
  return part.flanges
    .filter((f) => f.kind === 'curved' && f.angleDeg >= minFlange
      && (f.angleDeg > beyond || (f.heightMm != null && f.edgeRadiusMm != null && f.edgeRadiusMm > 0 && f.heightMm / f.edgeRadiusMm > curvature)))
    .reduce((s, f) => s + f.lengthMm, 0);
}

/** One press's Hydroform timing for a route: the outcome, its operations per part, and the parts it forms a cycle. */
interface PressTiming { outcome: StepOutcome; ops: FeatureOp[]; parts: number; partsThatFit: number | null }

/** Every route of the part (each complete or with its gaps), and what keeps any route from being built. */
export function buildHydroformingRoutes(input: HydroformingRouteInput): { routes: HydroformingRoute[]; missing: string[] } {
  const { ref, part, material, scenario } = input;
  const none = (...missing: string[]) => ({ routes: [] as HydroformingRoute[], missing });
  if (material.densityKgM3 == null || !(material.densityKgM3 > 0)) return none(`${material.name}: its density`);
  if (material.costPerKgUsd == null || !(material.costPerKgUsd > 0)) return none(`${material.name}: its price per kg`);
  if (!(input.thicknessMm > 0)) return none('the sheet thickness: press Refresh analysis so the sheet is measured');
  if (!input.nest) return none('the blank could not be nested on a sheet');
  const nest = input.nest;

  const seed = (value: number, source: string): CalcSeed => ({ value, source });
  const handLength = manualFormLength(ref, part);
  const addendum = blankAddendum(ref, part);
  // The blank grows by its outline x the addendum. An outline the cad-engine declined (an unfolded blank) adds nothing when there is no
  // addendum to grow it by; with an addendum it is missing, and the Blank calculator says so.
  const perimeter = part.blank.perimeterMm != null ? seed(part.blank.perimeterMm, `the blank's outline (${part.blank.method}, mm)`)
    : addendum.mm === 0 ? seed(0, "the blank's outline was not measured; with no addendum it adds nothing to the blank") : undefined;
  const cad: Record<string, CalcSeed | undefined> = {
    tool_area_mm2: seed(part.developedAreaMm2, "the part's developed area (mm²)"),
    plan_length_mm: seed(part.planLengthMm, "the part's plan along the press axis, long side (mm)"),
    plan_width_mm: seed(part.planWidthMm, "the part's plan along the press axis, short side (mm)"),
    manual_form_length_mm: seed(handLength, 'the curved flanges the press cannot form (mm)'),
    blank_perimeter_mm: perimeter,
    pierced_hole_perimeter_mm: seed(part.blank.piercedHolePerimeterMm, 'the holes pierced in the flat (mm)'),
    thickness_mm: seed(input.thicknessMm, 'the sheet thickness (mm)'),
    blank_area_mm2: seed(part.blank.areaMm2, `the measured blank (${part.blank.method}, mm²)`),
  };
  const materialProvider: SeedProvider = (column) => {
    const v = column === 'density_kg_m3' ? material.densityKgM3 : column === 'cost' ? material.costPerKgUsd : column === 'shear_strength_mpa' ? material.shearStrengthMpa : null;
    if (v == null) return null;
    const label = column === 'cost' ? 'price (USD/kg)' : column === 'density_kg_m3' ? 'density (kg/m³)' : 'shear strength (MPa)';
    return { value: v, source: `${material.name}: ${label}`, ...(material.id ? { ref: { kind: 'material' as const, materialId: material.id, materialName: material.name, column } } : {}) };
  };
  const kit: RouteKit = routeKit({
    ref, spec: input.spec, calculators: input.calculators, machinesByClass: input.machinesByClass, batchSize: scenario.batchSize, costContext: input.costContext,
    domain: HYDROFORMING_DOMAIN, domainLabel: 'Hydroforming', processGroup: HYDROFORMING_PROCESS_GROUP,
    processClass: { Hydroform: HYDROFORMING_CLASS.press, 'Offline Blank': HYDROFORMING_CLASS.blank }, partName: 'part', cad, material: materialProvider,
  });

  // ── The blank and its material ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const blankRun = kit.run(HYDRO_CALC.blankSize, null, {
    addendum_mm: addendum.row ? kit.lookupSeed('blankAddendumWidth', addendum.row, 'Addendum Width (mm)', ['Total Form Depth (mm)']) : seed(0, addendum.source),
  });
  if (!('run' in blankRun)) return none(...blankRun.reasons);
  const blankKg = blankRun.sec;
  const blankAreaMm2 = blankRun.run.outputs['Blank Area'] ?? part.blank.areaMm2;
  const partKg = (part.developedAreaMm2 * input.thicknessMm * material.densityKgM3) / 1e9;
  const materialRun = kit.run(HYDRO_CALC.material, null, {
    gross_kg: seed(nest.grossKgPerPart, `${nest.method === 'true_shape' ? 'true-shape' : 'rectangular'} nest on ${nest.sheetLengthMm} x ${nest.sheetWidthMm} mm: ${nest.partsPerSheet} blanks a sheet, ${r2(nest.utilizationPct)} % used`),
  });
  if (!('run' in materialRun)) return none(...materialRun.reasons);
  const warnings: string[] = [];
  if (nest.note) warnings.push(nest.note);
  if (addendum.mm > 0) warnings.push(`The blank carries ${r2(addendum.mm)} mm of addendum on each side (${addendum.source}), trimmed after drawing.`);

  // ── Offline Blank: one stroke blanks and pierces, on a press with the force and the room for the strip ──────────────────────────────
  const shear = material.shearStrengthMpa;
  const force = shear != null && shear > 0 && part.blank.perimeterMm != null ? kit.run(HYDRO_CALC.force, null, {}) : null;
  const forceKn = force && 'run' in force ? force.sec : null;
  if (forceKn == null && !(shear != null && shear > 0)) warnings.push(`The blanking press's force is not checked: ${material.name} has no shear strength on file.`);
  const blankLong = Math.max(part.blank.lengthMm, part.blank.widthMm) + 2 * addendum.mm;
  const blankShort = Math.min(part.blank.lengthMm, part.blank.widthMm) + 2 * addendum.mm;
  const advance = stepRow(ref.table('pressMaterialAdvanceRate'), 'Part Length (mm)', blankLong);
  const blankStep = kit.step('Offline Blank', (m: SandMachine): StepOutcome => {
    const forceCap = machineValue(m, 'press_force_kn');
    const maxLength = machineValue(m, 'max_part_length_mm');
    const maxWidth = machineValue(m, 'max_part_width_mm');
    const pitch = blankLong + (machineValue(m, 'pitch_margin_mm') ?? 0);
    const strip = blankShort + 2 * (machineValue(m, 'side_margin_mm') ?? 0);
    if (forceKn != null && forceCap != null && forceKn > forceCap) return fail(`${r2(forceKn)} kN of blanking and piercing over its ${forceCap} kN`);
    if (maxLength != null && maxLength > 0 && pitch > maxLength) return fail(`a ${r2(pitch)} mm pitch over its ${maxLength} mm`);
    if (maxWidth != null && maxWidth > 0 && strip > maxWidth) return fail(`a ${r2(strip)} mm strip over its ${maxWidth} mm`);
    return kit.timed('Offline Blank', m, {
      strokes_per_minute: kit.lookupSeed('pressMaterialAdvanceRate', advance, 'Strokes Per Minute', ['Part Length (mm)']),
      blank_mass_kg: seed(blankKg, `${HYDRO_CALC.blankSize}: ${r2(blankKg)} kg`),
    });
  }, ['Its press force takes the blanking and piercing', 'The strip fits the press (pitch and width)']);

  // ── Hydroform, by route ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const handling = (kg: number) => stepRow(ref.table('tblMaterialHandling'), 'Weight (kg)', kg);
  const loadRow = handling(blankKg);
  const unloadRow = handling(partKg);
  const high = isHighStrength(ref, material.utsMpa);
  const cleanRow = stepRow(ref.table('tblCleanRate'), 'Component Area (mm^2)', part.developedAreaMm2);
  const clean = kit.run(HYDRO_CALC.clean, null, { clean_rate: kit.lookupSeed('tblCleanRate', cleanRow, 'Manual Clean Rate (mm^2 / s)', ['Component Area (mm^2)']) });
  const hand = kit.run(HYDRO_CALC.hand, null, {});
  const inspection = ref.number('defaultInspectionTime') ?? 0;
  const factor = ref.number('cycleTimeAdjustmentFactor') ?? 1;
  const holesOffFlat = part.holes.filter((h) => !h.inFlat);
  const requested = scenario.partsPerTray ?? ref.number('defaultNumPartPerFluidCellTray') ?? 1;
  const capping = cappingTools(ref, part);

  const routes = HYDROFORMING_ROUTES.map((def): HydroformingRoute => {
    const deep = def.key === 'deep-draw';
    const presses = (input.machinesByClass[HYDROFORMING_CLASS.press] ?? []).filter((m) => typeof m.specs.machine_forming_type === 'string' && m.specs.machine_forming_type.toLowerCase() === def.formingType);
    const opening = part.drawn?.openingWidthMm ?? part.minWidthMm;
    const blankDia = Math.sqrt((4 * blankAreaMm2) / Math.PI);
    const draws = deep ? drawCount(ref, blankDia, opening, input.thicknessMm, high) : { draws: 1, ratiosPct: [] };
    const pad = kit.run(HYDRO_CALC.throwPad, null, {
      throw_pad_used: seed(!deep && ref.flag('requiredThrowPadDefault') !== false ? 1 : 0, deep ? 'Deep Draw has no throw pad' : 'requiredThrowPadDefault'),
    });
    const timing = (m: SandMachine): PressTiming => {
      const none = (outcome: StepOutcome): PressTiming => ({ outcome, ops: [], parts: 1, partsThatFit: null });
      if (!draws) return none(fail(`drawReductionPercentage has no draw sequence from a ${r2(blankDia)} mm blank to the ${r2(opening)} mm opening at ${input.thicknessMm} mm`));
      const maxDepth = machineValue(m, 'max_draw_depth_mm');
      if (maxDepth != null && maxDepth > 0 && part.depthMm > maxDepth) return none(fail(`the part is ${r2(part.depthMm)} mm deep, over its ${maxDepth} mm`));
      let parts = 1;
      let partsThatFit: number | null = null;
      if (deep) {
        const dia = machineValue(m, 'forming_area_dia_mm');
        const tool = machineValue(m, 'max_tool_dia_mm');
        const blankSpan = part.blank.circumscribedDiameterMm + 2 * addendum.mm;
        if (dia == null || !(dia > 0)) return none(fail('no forming area diameter on file'));
        if (blankSpan > dia) return none(fail(`the ${r2(blankSpan)} mm blank over its ${dia} mm forming area`));
        if (tool != null && tool > 0 && opening > tool) return none(fail(`the ${r2(opening)} mm punch over its ${tool} mm tool diameter`));
      } else {
        const len = machineValue(m, 'forming_area_length_mm');
        const wid = machineValue(m, 'forming_area_width_mm');
        const dia = machineValue(m, 'forming_area_dia_mm');
        const round = !(len != null && len > 0 && wid != null && wid > 0);
        const side = dia != null && dia > 0 ? dia / Math.SQRT2 : 0;
        const tray = kit.run(HYDRO_CALC.tray, m, {
          tray_length_mm: seed(round ? side : len, round ? `the inscribed square of its ${dia ?? 0} mm forming area` : `its forming area length ${len} mm`),
          tray_width_mm: seed(round ? side : wid, round ? `the inscribed square of its ${dia ?? 0} mm forming area` : `its forming area width ${wid} mm`),
          requested_parts: seed(requested, scenario.partsPerTray != null ? `${requested} (Cost Guide)` : `${requested} (defaultNumPartPerFluidCellTray)`),
        });
        if (!('run' in tray)) return none(fail(...tray.reasons));
        partsThatFit = tray.run.outputs['Parts That Fit'] ?? null;
        if (!(tray.sec >= 1)) return none(fail('the part in its holder does not fit its forming area'));
        parts = tray.sec;
      }
      if (!('run' in clean)) return none(fail(...clean.reasons));
      if (!('run' in hand)) return none(fail(...hand.reasons));
      if (!('run' in pad)) return none(fail(...pad.reasons));
      const handSec = deep ? 0 : hand.sec;
      const outcome = kit.timed('Hydroform', m, {
        loading_time_s: kit.lookupSeed('tblMaterialHandling', loadRow, 'Load Time (s)', ['Weight (kg)']),
        unloading_time_s: kit.lookupSeed('tblMaterialHandling', unloadRow, 'Load Time (s)', ['Weight (kg)']),
        draws: seed(draws.draws, deep ? `drawReductionPercentage: ${draws.draws} draw(s) from the ${r2(blankDia)} mm blank to the ${r2(opening)} mm opening` : 'Fluid Cell forms in one press cycle'),
        parts_per_cycle: seed(parts, deep ? 'Deep Draw forms one part a cycle' : `${HYDRO_CALC.tray}: ${parts}`),
        clean_tooling_time_s: seed(clean.sec, `${HYDRO_CALC.clean}: ${r2(clean.sec)} s`),
        throw_pad_time_s: seed(pad.sec, `${HYDRO_CALC.throwPad}: ${r2(pad.sec)} s`),
        hand_adjusting_time_s: seed(handSec, deep ? 'Deep Draw forms the drawn shape whole' : `${HYDRO_CALC.hand}: ${r2(hand.sec)} s`),
      });
      if (!outcome.ok) return none(outcome);
      // Each operation of memory's route, per part (the calculator's own terms), for the line's breakdown.
      const perCycle = draws.draws / parts;
      const load = Number(loadRow?.['Load Time (s)'] ?? 0);
      const unload = Number(unloadRow?.['Load Time (s)'] ?? 0);
      const fct = machineValue(m, 'machine_forming_cycle_time_s') ?? 0;
      const op = (name: string, sec: number, featureType: string): FeatureOp => ({ name, timeSec: r2(sec * factor), featureType, count: 1 });
      const ops = [
        op('Loading', load * draws.draws, 'handling'),
        op(`${def.formingOp}${deep && draws.draws > 1 ? ` (${draws.draws} draws)` : ''}${!deep && parts > 1 ? ` (${parts} parts a cycle)` : ''}`, fct * perCycle, 'Form'),
        ...(deep ? [] : [op(`Hand Adjusting (${r2(handLength)} mm)`, handSec, 'StraightBend'), op('Throw pad', pad.sec * perCycle, 'handling')]),
        op('Clean Tooling', clean.sec * perCycle, 'cleaning'),
        op('Visual Inspection', inspection, 'inspection'),
        op('Unloading', unload * draws.draws, 'handling'),
      ];
      return { outcome, ops, parts, partsThatFit };
    };
    const criteria = deep
      ? ['The blank fits its forming area', 'The punch is within its tool diameter', 'The part is within its draw depth']
      : ['At least one part in its holder fits its forming area', 'The part is within its draw depth'];
    const step = kit.step('Hydroform', (m) => timing(m).outcome, criteria, { machines: presses, processRoute: def.label });
    const chosen = step.machine ? timing(step.machine) : null;
    const pressLine: ProcessLineCost = chosen && !isGap(step.line) ? { ...step.line, featureBreakdown: chosen.ops } : step.line;
    const noCost = holesOffFlat.length
      ? [noCostFeatureLine({
        reason: `${holesOffFlat.length} hole(s) through a formed wall: pierced after forming, which is not an operation of ${HYDROFORMING_PROCESS_GROUP}`,
        processGroup: HYDROFORMING_PROCESS_GROUP,
      })]
      : [];
    const lines = [blankStep.line, pressLine, ...noCost];
    const complete = lines.every((l) => !isGap(l));
    const partsPerTray = chosen?.parts ?? 1;
    const { tools, warnings: toolWarnings } = hydroformTooling({
      kit, ref, routeKey: def.key, part, thicknessMm: input.thicknessMm, material: { materialType: material.materialType, utsMpa: material.utsMpa },
      draws: draws?.draws ?? 1, partsPerTray, toolShop: input.toolShop, intensifier: scenario.intensifier,
      amortizationParts: scenario.amortizationParts, blankAreaMm2,
    });
    const materialUsd = materialRun.sec;
    return {
      key: def.key, label: def.label, lines,
      material: { costUsd: materialUsd, grossKg: nest.grossKgPerPart, blankKg, partKg, blankAreaMm2, addendumMm: addendum.mm, run: materialRun.run, blankRun: blankRun.run },
      draws: draws?.draws ?? 0, drawRatiosPct: draws?.ratiosPct ?? [], partsPerTray, partsThatFit: deep ? null : chosen?.partsThatFit ?? null,
      press: step.machine ? { name: step.machine.name, formingCycleTimeS: machineValue(step.machine, 'machine_forming_cycle_time_s') ?? 0 } : null,
      handAdjustingLengthMm: deep ? 0 : handLength, throwPadAreaMm2: !deep && 'run' in pad ? pad.run.outputs['Pad Area'] ?? 0 : 0,
      cappingTools: capping, tooling: tools,
      totalUsd: complete ? r2(materialUsd + lines.reduce((s, l) => s + l.totalCost, 0)) : null,
      complete, warnings: [...warnings, ...toolWarnings],
    };
  });
  return { routes, missing: [] };
}

/**
 * The route to quote: the one the Cost Guide sets; else the route memory's rule gives the part (when it is complete); else the other route
 * when it is complete; else the one with the fewest gaps. The note names the rule and the other route.
 */
export function chooseHydroformingRoute(routes: readonly HydroformingRoute[], rule: HydroformingRule, chosen: HydroformingRouteKey | null): { route: HydroformingRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const gapOf = (l: ProcessLineCost) => (l.physicsGap && 'reason' in l.physicsGap ? l.physicsGap.reason : l.process);
  const said = (r: HydroformingRoute) => (r.complete && r.totalUsd != null ? `${r.label} ${money(r.totalUsd)}` : `${r.label} incomplete (${r.lines.filter(isGap).map(gapOf).join('; ')})`);
  const ruleLabel = HYDROFORMING_ROUTE_LABEL[rule.route];
  const ruleText = `memory's rule: depth / width ${r2(rule.depthMm)} / ${r2(rule.widthMm)} = ${rule.ratio.toFixed(2)} (${rule.basis}), `
    + `${rule.ratio >= rule.threshold ? 'at or above' : 'below'} fluidCellFormingRatioThreshold ${rule.threshold}, gives ${ruleLabel}`;
  const other = (pick: HydroformingRoute) => routes.filter((r) => r !== pick).map(said).join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Sheet Metal - Hydroforming: ${user.label} is set in the Cost Guide (${ruleText}). ${other(user)}.` };
  const byRule = routes.find((r) => r.key === rule.route);
  if (byRule?.complete) return { route: byRule, note: `Sheet Metal - Hydroforming: ${byRule.label} is quoted, ${ruleText}. ${other(byRule)}.` };
  const complete = routes.find((r) => r.complete);
  if (complete) return { route: complete, note: `Sheet Metal - Hydroforming: ${complete.label} is quoted: ${ruleText}, but that route is incomplete. ${other(complete)}.` };
  const pick = [...routes].sort((a, b) => a.lines.filter(isGap).length - b.lines.filter(isGap).length)[0];
  return { route: pick, note: `Sheet Metal - Hydroforming: no route is complete (${ruleText}); ${pick.label} has the fewest gaps. ${other(pick)}.` };
}
