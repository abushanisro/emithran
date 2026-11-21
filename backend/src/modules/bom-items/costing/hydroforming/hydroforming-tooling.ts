// The tooling a hydroformed part needs (memory/Sheetmetal Hydroforming): the hydroform tool, costed by its calculator from the data's hours and
// the tool's steel, and spread over the job; the offline blanking die, listed and not costed (the data's die model is a transfer die's: the
// user's decision 2026-11-21 leaves it to a later change). Pure: the tool shop's rates and tool steel come in from the caller.
import { formAreaMm2, type HydroformPart } from './hydroforming-part';

import type { SandReference } from '../casting/sand/sand-reference';
import type { ToolShop } from '../casting/tool-shop';
import type { CalcSeed, ReferenceCalcRun } from '../shared/calculators/reference-calculator';
import type { KitRow, RouteKit } from '../shared/calculators/route-kit';

/** The tool shop the tool is built in (the Digital Factory USA Default shop, CastingReferenceService.getToolShop): its rates and tool steel. */
export type HydroformToolShop = ToolShop;

/** A tool the route needs: an investment kept out of the piece cost, spread over the job (null when it is not costed, with why in `detail`). */
export interface HydroformingTool {
  key: string;
  description: string;
  detail: string;
  /** One tool, USD; null when not costed. */
  costUsd: number | null;
  /** The tools the job wears out (one tool x copies x sets), USD; null when not costed or the job has no volume. */
  investmentUsd: number | null;
  /** The tools the job uses (copies x sets) spread over its parts, USD per part; null when not costed or the job has no volume. */
  perPartUsd: number | null;
  /** Parts the investment is spread over (annual volume x production life); null when not costed or the job has no volume. */
  amortizationParts: number | null;
  /** Tools one set holds (a deep draw tool per draw; a fluid cell form block per part on the tray). */
  copies: number;
  /** Sets the job wears out (its parts over the tool's life); null when not costed or the job has no volume. */
  sets: number | null;
  /** Parts one tool forms; null when not costed. */
  toolLife: number | null;
  run: ReferenceCalcRun | null;
}

export interface ToolingInput {
  kit: RouteKit;
  ref: SandReference;
  routeKey: 'deep-draw' | 'fluid-cell';
  part: HydroformPart;
  thicknessMm: number;
  material: { materialType: string | null; utsMpa: number | null };
  draws: number;
  partsPerTray: number;
  toolShop: HydroformToolShop | null;
  intensifier: boolean;
  /** Parts the tooling is spread over (annual volume x production life); null when the scenario has no volume. */
  amortizationParts: number | null;
  /** The blank's area with its addendum (mm²), from the Blank calculator. */
  blankAreaMm2: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().toLowerCase() : '');

/** tblToolLife's material types for a material type a raw material may be filed under with another spelling. */
const TOOL_LIFE_TYPE: Readonly<Record<string, string>> = { 'galv. steel': 'galvanized steel', 'heat resistant': 'heat resistant super alloys' };

/** The first row of a step table whose `key` column is at or above `value` (the data's breakpoint tables), sorted by that column. */
export function stepRow(rows: readonly KitRow[], key: string, value: number): KitRow | null {
  return [...rows].filter((r) => Number.isFinite(Number(r[key]))).sort((a, b) => Number(a[key]) - Number(b[key])).find((r) => Number(r[key]) >= value) ?? null;
}

/** A material above highStrengthMatlThreshold (its UTS): the data's high-strength rules (derated draws, coating, longer tryout) apply. */
export function isHighStrength(ref: SandReference, utsMpa: number | null): boolean {
  const threshold = ref.number('highStrengthMatlThreshold');
  return utsMpa != null && threshold != null && utsMpa > threshold;
}

/**
 * The tool's steel (kg, at steelDensity): a deep draw punch over the formed region to its depth, and the draw ring around the opening
 * (drawRingWidth wide, drawRingThickness thick); a fluid cell form block (the plan, to the part's depth) and the hydroform holder around it
 * (hydroformHolderGap and thicknessOfHydroformHolder on each side, hydroformHolderBaseDepth under it, hydroformHolderHeightAddendum over the
 * part's depth). The data gives these dimensions, not the tool's volume: the volume is this geometry, stated on the calculator's field.
 */
function steelKg(ref: SandReference, routeKey: ToolingInput['routeKey'], part: HydroformPart): { kg: number; basis: string } | null {
  const density = ref.number('steelDensity');
  if (density == null) return null;
  const v = (name: string) => ref.number(name) ?? 0;
  if (routeKey === 'deep-draw') {
    const formArea = formAreaMm2(part);
    const depth = part.drawn?.depthMm ?? part.depthMm;
    const opening = part.drawn?.openingWidthMm ?? part.minWidthMm;
    const ringWidth = v('drawRingWidth');
    const ring = (Math.PI * opening * ringWidth + Math.PI * ringWidth ** 2) * v('drawRingThickness');
    const punch = formArea * depth;
    return {
      kg: ((punch + ring) * density) / 1e9,
      basis: `punch ${Math.round(formArea)} mm² x ${r2(depth)} mm deep, draw ring ${ringWidth} mm wide and ${v('drawRingThickness')} mm thick around the ${r2(opening)} mm opening`,
    };
  }
  const [l, w, d] = [part.planLengthMm, part.planWidthMm, part.depthMm];
  const gap = v('hydroformHolderGap');
  const wall = v('thicknessOfHydroformHolder');
  const top = d + v('hydroformHolderHeightAddendum');
  const outer = (l + 2 * (gap + wall)) * (w + 2 * (gap + wall)) * (top + v('hydroformHolderBaseDepth'));
  const inner = (l + 2 * gap) * (w + 2 * gap) * top;
  const block = l * w * d;
  return {
    kg: ((block + outer - inner) * density) / 1e9,
    basis: `form block ${r2(l)} x ${r2(w)} x ${r2(d)} mm and its holder (${gap} mm gap, ${wall} mm walls, ${v('hydroformHolderBaseDepth')} mm base)`,
  };
}

/** The tools of a route: the hydroform tool (costed when the tool shop is on file) and the offline blanking die (listed, not costed). */
export function hydroformTooling(inp: ToolingInput): { tools: HydroformingTool[]; warnings: string[] } {
  const { kit, ref, part, material } = inp;
  const warnings: string[] = [];
  const die: HydroformingTool = {
    key: 'offline-blanking-die', description: 'Offline blanking die',
    detail: 'Not costed: memory/Sheetmetal Hydroforming models the blanking die as a transfer die (die set, parallels, punches); it is left to a later change.',
    costUsd: null, investmentUsd: null, perPartUsd: null, amortizationParts: null, copies: 1, sets: null, toolLife: null, run: null,
  };
  const copies = inp.routeKey === 'deep-draw' ? inp.draws : inp.partsPerTray;
  const description = inp.routeKey === 'deep-draw' ? 'Hydroform deep draw tool (punch and draw ring)' : 'Hydroform fluid cell tool (form block and holder)';
  const notCosted = (why: string): { tools: HydroformingTool[]; warnings: string[] } => ({
    tools: [{ key: `hydroform-${inp.routeKey}`, description, detail: `Not costed: ${why}`, costUsd: null, investmentUsd: null, perPartUsd: null, amortizationParts: null, copies, sets: null, toolLife: null, run: null }, die],
    warnings: [`The hydroform tool is not costed: ${why}.`],
  });
  const shop = inp.toolShop;
  if (!shop) return notCosted('the tool shop (Digital Factory USA Default: its rates and tool steel) is not on file');
  const steel = steelKg(ref, inp.routeKey, part);
  if (!steel) return notCosted('steelDensity is not in the reference data');

  const high = isHighStrength(ref, material.utsMpa);
  const formArea = formAreaMm2(part);
  const nonForm = Math.max(0, inp.blankAreaMm2 - formArea);
  const sqIn = ref.number('sqmmPerSqin') ?? 645.16;
  const loopsRow = (() => {
    const type = high ? 'high strength' : 'mild steel';
    const rows = ref.table('numQualityLoops').filter((r) => text(r['Raw Material Type']) === type);
    return stepRow(rows, 'Raw Material Thickness (mm)', inp.thicknessMm);
  })();
  const coatingType = (high ? ref.text('highStrengthMatlToolingCoatingType') : ref.text('defaultToolingCoatingType')) ?? 'None';
  const coating = ref.table('tblToolCoating').find((r) => text(r['Coating Type']) === text(coatingType)) ?? null;
  const tryoutPct = ref.number('highStrengthMaterialTryoutMultiplierPercentage') ?? 0;
  const seed = (value: number, source: string): CalcSeed => ({ value, source });
  const minLoops = ref.number('minNumQualityLoops');
  const loops = loopsRow
    ? kit.lookupSeed('numQualityLoops', loopsRow, 'Num Quality Loops', ['Raw Material Thickness (mm)', 'Raw Material Type'])
    : minLoops != null ? seed(minLoops, 'minNumQualityLoops (numQualityLoops has no row for this thickness and type)') : undefined;
  const milling = stepRow(ref.table('cncMillingRates'), 'Area (mm^2)', formArea);
  const finishing = stepRow(ref.table('tblFinishingRate'), 'Surface Area Finish (in^2)', formArea / sqIn);
  const tool = kit.run('Hydroforming - Hydroform tool', null, {
    design_rate: seed(shop.designUsdPerHr, `tool shop ${shop.name}: designRateUsdPerHr`),
    form_area_mm2: seed(formArea, part.drawn ? "the drawn form's plan (mm²)" : "the part's plan (mm²)"),
    non_form_area_mm2: seed(nonForm, 'the blank outside the formed region (mm²)'),
    assembly_rate: seed(shop.assemblyUsdPerHr, `tool shop ${shop.name}: assemblyRateUsdPerHr`),
    profiling_rate: kit.lookupSeed('cncMillingRates', milling, 'Profiling Rate (mm^2 / hr)', ['Area (mm^2)']),
    finishing_hours: kit.lookupSeed('tblFinishingRate', finishing, 'Hrs Per Sq Inch (hr)', ['Surface Area Finish (in^2)']),
    machining_rate: seed(shop.machiningUsdPerHr, `tool shop ${shop.name}: machiningRateUsdPerHr`),
    quality_loops: loops,
    tryout_multiplier: seed(high ? 1 + tryoutPct / 100 : 1, high ? `high-strength material: 1 + highStrengthMaterialTryoutMultiplierPercentage ${tryoutPct} %` : 'not a high-strength material'),
    tryout_rate: seed(shop.tryoutUsdPerHr, `tool shop ${shop.name}: tryoutRateUsdPerHr`),
    steel_kg: seed(steel.kg, `the tool's steel: ${steel.basis}, at steelDensity`),
    steel_price: seed(shop.toolSteel.usdPerKg, `${shop.toolSteel.name} (tool shop ${shop.name}'s default tool material)`),
    coating_cost: coating ? kit.lookupSeed('tblToolCoating', coating, 'Coating Cost Factor (USD / kg)', ['Coating Type']) : undefined,
    capping_tools: seed(cappingTools(ref, part), 'holes on the main surface at least holeToMainSurfaceEdgeProximityThreshold from its edge'),
    intensifier: seed(inp.intensifier ? 1 : 0, inp.intensifier ? 'the intensifier (Cost Guide)' : 'no intensifier (Cost Guide)'),
  });
  if (!('run' in tool)) return notCosted(tool.reasons.join('; '));

  const lifeRow = (() => {
    const type = text(material.materialType);
    const want = TOOL_LIFE_TYPE[type] ?? type;
    return ref.table('tblToolLife').find((r) => text(r['Material Type']) === want) ?? null;
  })();
  const defaultLife = ref.number('defaultToolLife');
  const life = kit.run('Hydroforming - Tool life', null, {
    parts_per_tool: lifeRow ? kit.lookupSeed('tblToolLife', lifeRow, 'Num Parts Per Tool', ['Material Type'])
      : defaultLife != null ? seed(defaultLife, `defaultToolLife (tblToolLife has no row for ${material.materialType ?? 'the material'})`) : undefined,
    coating_life_factor: coating ? kit.lookupSeed('tblToolCoating', coating, 'Tool Life Improvement Factor', ['Coating Type']) : undefined,
  });
  const toolLife = 'run' in life && life.sec > 0 ? life.sec : null;
  const cost = tool.sec;
  const parts = inp.amortizationParts;
  // Each tool forms every part that passes it: a deep draw tool per draw sees every part; a fluid cell form block forms its share of the tray.
  const perTool = parts != null && parts > 0 ? (inp.routeKey === 'deep-draw' ? parts : parts / Math.max(1, inp.partsPerTray)) : null;
  const sets = perTool != null && toolLife != null ? Math.max(1, Math.ceil(perTool / toolLife)) : null;
  const perPart = sets != null && parts != null ? (cost * copies * sets) / parts : null;
  if (parts == null || !(parts > 0)) warnings.push('The hydroform tool is not spread over the job: the scenario has no annual volume and production life.');
  if (toolLife == null) warnings.push('The hydroform tool life is not known (tblToolLife, defaultToolLife or tblToolCoating missing): the tool is not spread over the job.');
  return {
    tools: [{
      key: `hydroform-${inp.routeKey}`, description,
      detail: `${copies} tool(s) a set (${inp.routeKey === 'deep-draw' ? 'one per draw' : 'one per part on the tray'}), ${r2(steel.kg)} kg of ${shop.toolSteel.name}, ${coatingType} coated; ${sets ?? '?'} set(s) over ${parts ?? '?'} parts at ${toolLife != null ? Math.round(toolLife).toLocaleString('en-US') : '?'} parts a tool.`,
      costUsd: r2(cost), investmentUsd: sets != null ? r2(cost * copies * sets) : null,
      perPartUsd: perPart != null ? Math.round(perPart * 10000) / 10000 : null, amortizationParts: sets != null ? parts : null, copies, sets, toolLife, run: tool.run,
    }, die],
    warnings,
  };
}

/**
 * Capping tools: a hole the rubber or fluid must be kept out of, on the main surface, takes one when it lies at least
 * holeToMainSurfaceEdgeProximityThreshold from the main surface's edge (the variable's own note: the minimum distance for a capping tool).
 */
export function cappingTools(ref: SandReference, part: HydroformPart): number {
  const min = ref.number('holeToMainSurfaceEdgeProximityThreshold') ?? 0;
  return part.holes.filter((h) => h.inFlat && h.onMainSurface && h.edgeDistanceMm != null && h.edgeDistanceMm >= min).length;
}
