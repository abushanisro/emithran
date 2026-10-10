// Die-casting reference data the casting engines read, resolved from the
// staged rows of memory/Die Casting (machining_reference_data, source_version
// from the manifest's die_casting entry, migration 846). Pure: the caller
// loads the rows (CastingReferenceService); nothing here holds a value.
//
//   variables  clampForceSafetyFactor    margin on required clamp force
//              partSurfaceQuality        default tblPercentSolids index
//              solidificationConstantHPDC, ladleFillTime, ladleRate,
//              lubeTimeConstant, lubeTimeCoefficient, ejectTimeHPDC,
//              cycleTimeAdjustmentFactor, defaultToolLife
//   tblPercentSolids                     quality index -> percent solids
//   tblLatentHeatConstant                material type -> latent heat constant
//   tblToolLife                          material type -> shots per die
//   tblWallThickness                     material type x process -> wall limits
//   tblOverflowDim                       wall thickness -> overflow volume ratio (High/Low)
//   tblMinHoleDiameter                   material type x process -> smallest castable hole
//   tblMaxHoleDepth                      hole diameter x material type x process -> deepest
//   tblHighPressureDieCastingProximity   hole diameter -> minimum wall to the next hole (HPDC)
//   layoutNumCav                         die layouts: cavities lengthwise x widthwise = count
//   tblGrindingDimensions                part weight -> parting-line flash thickness and height (mm)
//   tblGrindingSpeedMaterialFactor       alloy Cut Code -> grinding speed factor
//   variables  defaultNumCavities, largePartThreshold (kg: one cavity above it)
//   alloy (Raw Material/materials_master.csv), promoted by migration 855 to
//   raw_materials (material_group 'Die Casting') + raw_material_properties
//
// Any missing value is named in `missing`; the engines then decide nothing
// that depends on it rather than substitute a number.

import MANIFEST from '../../../processes/memory-reference-domains.json';

export const CASTING_REFERENCE_SOURCE_VERSION: string =
  MANIFEST.domains.find((d) => d.key === 'die_casting')!.sourceVersion;

export const CASTING_VARIABLE_KEYS = [
  'clampForceSafetyFactor', 'partSurfaceQuality', 'solidificationConstantHPDC',
  'ladleFillTime', 'ladleRate', 'lubeTimeConstant', 'lubeTimeCoefficient', 'ejectTimeHPDC',
  'cycleTimeAdjustmentFactor', 'defaultToolLife', 'defaultNumberOfTrimmedParts',
  'defaultNumCavities', 'largePartThreshold',
  'ladleFillTimeGravityDieCasting', 'moldFillRateGravityDieCasting', 'coolTimeConstantGravityDieCasting',
  'gravityDropTime', 'coreLoadTimeGravityDieCasting', 'defaultNumCavitiesGravityDieCasting',
  'materialYieldGravityDieCasting', 'numCavitiesMaterialYieldAdd', 'cavityCeiling',
  'regionConvFactor', 'furnaceCapacitySafetyFactor',
  'additionalRunnerThickness', 'runnerAspectRatio', 'ingateAreaToRunnerArea', 'ingateGap',
] as const;

export const CASTING_LOOKUP_KEYS = [
  'tblPercentSolids', 'tblLatentHeatConstant', 'tblToolLife', 'tblWallThickness', 'tblOverflowDim',
  'tblMinHoleDiameter', 'tblMaxHoleDepth', 'tblHighPressureDieCastingProximity', 'tblVisualInspection',
  'layoutNumCav', 'tblGrindingDimensions', 'tblGrindingSpeedMaterialFactor',
] as const;

/**
 * Chamber type, from materials_master "Chamber Type". The codes are read off
 * the data itself: every Aluminum, Copper and Brass row (alloys that attack
 * a submerged hot-chamber gooseneck, so are always cold-chamber cast) is 2;
 * every Zinc, Lead and Zinc-Aluminum row is 1.
 */
type ChamberType = 'hot' | 'cold';
const CHAMBER_BY_CODE: Record<number, ChamberType> = { 1: 'hot', 2: 'cold' };

export interface CastingMaterial {
  name: string;
  materialType: string | null;
  densityKgM3: number | null;
  /** Cavity pressure the die must hold closed against (MPa). */
  clampingPressureMpa: number | null;
  /** Solidification time per mm of wall (s/mm). */
  coolingFactorSPerMm: number | null;
  injectionTempC: number | null;
  liquidusTempC: number | null;
  solidusTempC: number | null;
  moldTempC: number | null;
  chamber: ChamberType | null;
  dieLifeCycles: number | null;
  unitCostUsdPerKg: number | null;
  yieldLossFactor: number | null;
  /** materials_master Cut Code (raw_materials.cut_code): keys tblGrindingSpeedMaterialFactor. */
  cutCode: number | null;
  /** materials_master Shear Strength (MPa): the trim press force. */
  shearStrengthMpa: number | null;
}

export interface CastingReference {
  clampForceSafetyFactor: number;
  /** variables partSurfaceQuality -> tblPercentSolids row. */
  defaultSurfaceQuality: { index: number; label: string; percentSolids: number } | null;
  percentSolids: Array<{ index: number; label: string; percentSolids: number }>;
  latentHeatConstantByType: Map<string, number>;
  toolLifeShotsByType: Map<string, number>;
  defaultToolLifeShots: number;
  wallLimits: Array<{ materialType: string; process: string; maxMm: number; minMm: number }>;
  /** Overflow volume / part volume by wall thickness breakpoint, ascending. */
  overflow: Array<{ wallMm: number; high: number; low: number }>;
  minHoleDiameter: Array<{ materialType: string; process: string; diameterMm: number }>;
  maxHoleDepth: Array<{ diameterMm: number; depthMm: number; materialType: string; process: string }>;
  holeProximity: Array<{ process: string; diameterMm: number; minDistanceMm: number }>;
  /** tblVisualInspection: inspection rate (min/m2) by part weight band. */
  visualInspection: Array<{ maxWeightKg: number; internalMinPerM2: number; externalMinPerM2: number }>;
  /** tblGrindingDimensions: flash to grind, by part weight band (ascending Max Weight). */
  grindingDimensions: Array<{ maxWeightKg: number; partingLineThicknessMm: number; partingLineHeightMm: number; ingateHeightMm: number }>;
  /** tblGrindingSpeedMaterialFactor: grinding speed factor by alloy Cut Code. */
  grindingSpeedFactorByCutCode: Map<number, number>;
  /** layoutNumCav: the die layouts a cavity count may take, ascending by count. */
  cavityLayouts: Array<{ lengthWise: number; widthWise: number; count: number }>;
  /** Raw variable values for the cycle-time model (named, unit as staged). */
  variables: Readonly<Record<(typeof CASTING_VARIABLE_KEYS)[number], number>>;
}

export interface CastingReferenceRows {
  variables: ReadonlyArray<{ key: string; value: string | number | null }>;
  lookups: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function resolveCastingReference(rows: CastingReferenceRows): { reference: CastingReference | null; missing: string[] } {
  const missing: string[] = [];
  const vars = new Map(rows.variables.map((v) => [v.key, num(v.value)]));
  const variables = {} as Record<(typeof CASTING_VARIABLE_KEYS)[number], number>;
  for (const k of CASTING_VARIABLE_KEYS) {
    const v = vars.get(k);
    if (v == null) { missing.push(`variables: ${k}`); variables[k] = NaN; } else variables[k] = v;
  }
  const table = (k: string) => {
    const t = rows.lookups[k];
    if (!t || t.length === 0) missing.push(`${k} (not staged)`);
    return t ?? [];
  };

  const percentSolids = table('tblPercentSolids').map((r) => ({
    index: num(r['Index']) ?? NaN, label: String(r['Quality Requirement'] ?? ''), percentSolids: num(r['Percent Solids']) ?? NaN,
  }));
  const defaultSurfaceQuality = percentSolids.find((p) => p.index === variables.partSurfaceQuality) ?? null;
  if (!defaultSurfaceQuality) missing.push(`tblPercentSolids: no row for partSurfaceQuality=${variables.partSurfaceQuality}`);

  const latentHeatConstantByType = new Map<string, number>();
  for (const r of table('tblLatentHeatConstant')) {
    const v = num(r['Latent Heat Constant (°C)']);
    if (v != null) latentHeatConstantByType.set(String(r['Material Name']), v);
  }
  const toolLifeShotsByType = new Map<string, number>();
  for (const r of table('tblToolLife')) {
    const v = num(r['Num Shots Per Tool']);
    if (v != null) toolLifeShotsByType.set(String(r['Material Type']), v);
  }
  const wallLimits = table('tblWallThickness').map((r) => ({
    materialType: String(r['Material Type']), process: String(r['Process Name']),
    maxMm: num(r['Maximum Wall Thickness (mm)']) ?? NaN, minMm: num(r['Minimum Wall Thickness (mm)']) ?? NaN,
  }));

  const overflow = table('tblOverflowDim').map((r) => ({
    wallMm: num(r['Wall Thickness (mm)']) ?? NaN,
    high: num(r['Overflow Volume Ratio High']) ?? NaN,
    low: num(r['Overflow Volume Ratio Low']) ?? NaN,
  })).sort((a, b) => a.wallMm - b.wallMm);

  const minHoleDiameter = table('tblMinHoleDiameter').map((r) => ({
    materialType: String(r['Material Type']), process: String(r['Process Name']), diameterMm: num(r['Min Hole Diameter (mm)']) ?? NaN,
  }));
  const maxHoleDepth = table('tblMaxHoleDepth').map((r) => ({
    diameterMm: num(r['Hole Diameter (mm)']) ?? NaN, depthMm: num(r['Hole Max Depth (mm)']) ?? NaN,
    materialType: String(r['Material Type']), process: String(r['Process Name']),
  }));
  const holeProximity = table('tblHighPressureDieCastingProximity').map((r) => ({
    process: String(r['Process Name']), diameterMm: num(r['Hole Diameter (mm)']) ?? NaN, minDistanceMm: num(r['Minimum Distance (mm)']) ?? NaN,
  }));
  const visualInspection = table('tblVisualInspection').map((r) => ({
    maxWeightKg: num(r['Max Weight (kg)']) ?? NaN,
    internalMinPerM2: num(r['Internal Inspection Rate (min / m^2)']) ?? NaN,
    externalMinPerM2: num(r['External Inspection Rate (min / m^2)']) ?? NaN,
  }));
  const grindingDimensions = table('tblGrindingDimensions').map((r) => ({
    maxWeightKg: num(r['Max Weight (kg)']) ?? NaN,
    partingLineThicknessMm: num(r['Parting Line Thickness (mm)']) ?? NaN,
    partingLineHeightMm: num(r['Parting Line Height (mm)']) ?? NaN,
    ingateHeightMm: num(r['Ingate Height (mm)']) ?? NaN,
  })).sort((a, b) => a.maxWeightKg - b.maxWeightKg);
  const grindingSpeedFactorByCutCode = new Map<number, number>();
  for (const r of table('tblGrindingSpeedMaterialFactor')) {
    const code = num(r['Material Cut Code']);
    const f = num(r['Grinding Speed Material Factor']);
    if (code != null && f != null) grindingSpeedFactorByCutCode.set(code, f);
  }

  const cavityLayouts = table('layoutNumCav').map((r) => ({
    lengthWise: num(r['Cavities Length Wise']) ?? NaN,
    widthWise: num(r['Cavities Width Wise']) ?? NaN,
    count: num(r['Number of Cavities']) ?? NaN,
  })).sort((a, b) => a.count - b.count);

  const reference: CastingReference = {
    clampForceSafetyFactor: variables.clampForceSafetyFactor,
    defaultSurfaceQuality,
    percentSolids,
    latentHeatConstantByType,
    toolLifeShotsByType,
    defaultToolLifeShots: variables.defaultToolLife,
    wallLimits,
    overflow,
    minHoleDiameter,
    maxHoleDepth,
    holeProximity,
    visualInspection,
    grindingDimensions,
    grindingSpeedFactorByCutCode,
    cavityLayouts,
    variables,
  };
  return { reference: missing.length ? null : reference, missing };
}

/**
 * One die-casting alloy as promoted by migration 855: its raw_materials row
 * (name, material_type, density_kg_m3, cost_usa) and its raw_material_properties
 * values keyed by property_key. The property keys are the materials_master
 * headers normalized; "Chamber Type" is chamber_type. ("Chamber Type [ID]",
 * promoted as chamber_type_id, is a different column: it reads 2 for the Zinc
 * and Zinc-Aluminum rows that Chamber Type marks 1, so it is not used.)
 */
interface CastingMaterialRows {
  row: { name: string | null; material_type: string | null; density_kg_m3: unknown; cost_usa: unknown; cut_code: unknown };
  properties: Readonly<Record<string, number | null>>;
}

export function resolveCastingMaterial({ row, properties: p }: CastingMaterialRows): CastingMaterial {
  const chamberCode = p['chamber_type'] ?? null;
  return {
    name: String(row.name ?? ''),
    materialType: row.material_type || null,
    densityKgM3: num(row.density_kg_m3),
    clampingPressureMpa: p['clamping_pressure'] ?? null,
    coolingFactorSPerMm: p['cooling_factor'] ?? null,
    injectionTempC: p['injection_temp'] ?? null,
    liquidusTempC: p['liquidus_temp'] ?? null,
    solidusTempC: p['solidus_temp'] ?? null,
    moldTempC: p['mold_temp'] ?? null,
    chamber: chamberCode != null ? CHAMBER_BY_CODE[chamberCode] ?? null : null,
    dieLifeCycles: p['die_life'] ?? null,
    unitCostUsdPerKg: num(row.cost_usa),
    yieldLossFactor: p['yield_loss_factor'] ?? null,
    cutCode: num(row.cut_code),
    shearStrengthMpa: p['shear_strength'] ?? null,
  };
}

/** The raw_material_properties keys resolveCastingMaterial reads. */
export const CASTING_MATERIAL_PROPERTY_KEYS = [
  'chamber_type', 'clamping_pressure', 'cooling_factor', 'injection_temp', 'liquidus_temp',
  'solidus_temp', 'mold_temp', 'die_life', 'yield_loss_factor', 'shear_strength',
] as const;

/**
 * Can `process` cast this part's walls in this material type? The part's
 * nominal wall must be at least, and its thickest wall at most, the process
 * tblWallThickness row. null when there is no row (or no measurement).
 */
export function wallFeasibility(
  ref: CastingReference, process: string, materialType: string | null, wallNominalMm: number | null, wallMaxMm: number | null,
): { feasible: boolean | null; detail: string } {
  if (!materialType) return { feasible: null, detail: 'material has no Material Type' };
  const row = ref.wallLimits.find((w) => w.materialType === materialType && w.process === process);
  if (!row) return { feasible: null, detail: `tblWallThickness has no ${materialType} / ${process} row` };
  if (wallNominalMm == null || wallMaxMm == null) return { feasible: null, detail: 'wall thickness not measured' };
  if (wallNominalMm < row.minMm) return { feasible: false, detail: `nominal wall ${wallNominalMm} mm < ${process} minimum ${row.minMm} mm for ${materialType} (tblWallThickness)` };
  if (wallMaxMm > row.maxMm) return { feasible: false, detail: `thickest wall ${wallMaxMm} mm > ${process} maximum ${row.maxMm} mm for ${materialType} (tblWallThickness)` };
  return { feasible: true, detail: `walls ${wallNominalMm}-${wallMaxMm} mm within ${row.minMm}-${row.maxMm} mm (tblWallThickness)` };
}

export type HoleCastability =
  | { castable: true; detail: string }
  | { castable: false; detail: string }
  | { castable: null; detail: string };

/**
 * Can `process` cast a hole of this diameter and depth in this material type?
 *   below tblMinHoleDiameter            not castable (drilled from solid)
 *   deeper than tblMaxHoleDepth         not castable: the limit for diameter d
 *                                       is d x (depth / diameter) of the table
 *                                       row at or below d (the table is a
 *                                       depth-to-diameter ratio by size band;
 *                                       a hole larger than its last row uses
 *                                       that row ratio)
 * null when the table has no row for the material type and process.
 */
export function holeCastability(
  ref: CastingReference, process: string, materialType: string | null, diameterMm: number, depthMm: number | null,
): HoleCastability {
  if (!materialType) return { castable: null, detail: 'material has no Material Type' };
  const min = ref.minHoleDiameter.find((r) => r.materialType === materialType && r.process === process);
  if (!min) return { castable: null, detail: `tblMinHoleDiameter has no ${materialType} / ${process} row` };
  if (diameterMm < min.diameterMm) {
    return { castable: false, detail: `Ø${diameterMm} mm < ${process} minimum Ø${min.diameterMm} mm for ${materialType} (tblMinHoleDiameter)` };
  }
  if (depthMm == null || !(depthMm > 0)) return { castable: true, detail: `Ø${diameterMm} mm ≥ minimum Ø${min.diameterMm} mm; depth not measured` };
  const rows = ref.maxHoleDepth.filter((r) => r.materialType === materialType && r.process === process).sort((a, b) => a.diameterMm - b.diameterMm);
  const band = [...rows].reverse().find((r) => r.diameterMm <= diameterMm);
  if (!band) return { castable: null, detail: `tblMaxHoleDepth has no ${materialType} / ${process} row at or below Ø${diameterMm} mm` };
  const maxDepth = diameterMm * (band.depthMm / band.diameterMm);
  return depthMm > maxDepth
    ? { castable: false, detail: `depth ${depthMm} mm > ${process} max ${maxDepth.toFixed(2)} mm for Ø${diameterMm} mm (tblMaxHoleDepth Ø${band.diameterMm}: ${band.depthMm} mm)` }
    : { castable: true, detail: `depth ${depthMm} mm ≤ max ${maxDepth.toFixed(2)} mm for Ø${diameterMm} mm` };
}

/**
 * Can `process` core a hole this close to its neighbour? The wall between two
 * parallel holes (axis-to-axis distance minus both radii) must be at least the
 * tblHighPressureDieCastingProximity minimum for the hole's diameter: the row
 * at or below it, the last row beyond the table. Holes whose axes are not
 * parallel, and distances to the part's outer walls, are not measured here.
 * null when the process has no proximity rows (the table is HPDC only).
 */
export function holeProximityCastability(
  ref: CastingReference,
  process: string,
  hole: { diameterMm: number; centroidMm: [number, number, number]; axis: [number, number, number] },
  others: ReadonlyArray<{ label: string; diameterMm: number; centroidMm: [number, number, number]; axis: [number, number, number] }>,
): HoleCastability {
  const rows = ref.holeProximity.filter((r) => r.process === process).sort((a, b) => a.diameterMm - b.diameterMm);
  if (rows.length === 0) return { castable: null, detail: `no hole proximity limit for ${process}` };
  const band = [...rows].reverse().find((r) => r.diameterMm <= hole.diameterMm) ?? null;
  if (!band) return { castable: null, detail: `Ø${hole.diameterMm} mm is below the smallest tblHighPressureDieCastingProximity row` };
  const a = hole.axis;
  let nearest: { label: string; wall: number } | null = null;
  for (const o of others) {
    const dot = Math.abs(a[0] * o.axis[0] + a[1] * o.axis[1] + a[2] * o.axis[2]);
    if (dot < 0.9999) continue; // not parallel: wall not measured
    const d = [o.centroidMm[0] - hole.centroidMm[0], o.centroidMm[1] - hole.centroidMm[1], o.centroidMm[2] - hole.centroidMm[2]];
    const cx = d[1]! * a[2] - d[2]! * a[1], cy = d[2]! * a[0] - d[0]! * a[2], cz = d[0]! * a[1] - d[1]! * a[0];
    const axisDistance = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (axisDistance < 1e-6) continue; // coaxial: the same hole line, not a neighbour
    const wall = axisDistance - hole.diameterMm / 2 - o.diameterMm / 2;
    if (!nearest || wall < nearest.wall) nearest = { label: o.label, wall };
  }
  if (!nearest) return { castable: true, detail: 'no parallel neighbouring hole' };
  return nearest.wall < band.minDistanceMm
    ? { castable: false, detail: `wall to ${nearest.label} ${nearest.wall.toFixed(2)} mm < ${process} minimum ${band.minDistanceMm} mm for Ø${hole.diameterMm} mm (tblHighPressureDieCastingProximity Ø${band.diameterMm})` }
    : { castable: true, detail: `wall to ${nearest.label} ${nearest.wall.toFixed(2)} mm ≥ minimum ${band.minDistanceMm} mm` };
}
