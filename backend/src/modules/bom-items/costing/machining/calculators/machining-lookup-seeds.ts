import type { MaterialClass } from '../process/cost-machining-engine';
import { resolveDrillingParams, type DrillingTable } from '../lookup/drilling-table';
import { resolvePartoffParams } from '../lookup/partoff-table';
import {
  MACHINING_MATERIAL_HARDNESS_HB,
  nearestByDiameterKey,
  nearestByDiameterThenHardness,
  nearestByHardness,
} from '../lookup/machining-material-hardness';
import type { MachiningCapabilityRules } from '../capability-rules';
import type { CalcSeed } from './machining-calculator';

/**
 * The lookup-table inputs of every machining calculator, resolved from the
 * real machining_reference_data rows for a material and the calculator's key
 * inputs (hole diameter, bar diameter, ...). ONE resolver per calculator,
 * used both by the cost engine (with the part's CAD keys) and by the Edit
 * Process Cost dialog (POST /bom-items/:id/machining-calculator-inputs, with
 * the keys the engineer is looking at) — so a calculator's lookup values in
 * the dialog are always the database's, never blank and never different from
 * what the quote would use for the same keys.
 */
export interface MachiningLookupContext {
  matClass: MaterialClass;
  drillingTable?: DrillingTable | null;
  reamTable?: any[] | null;
  /** tblTapping rows (migration 809). */
  tappingTable?: any[] | null;
  /** tblBoringV2 "Finish Boring" rows. */
  finishBoringTable?: any[] | null;
  gunDrillTable?: any[] | null;
  deepBoreMaterials?: any[] | null;
  partoffTable?: any[] | null;
  workholderTable?: any[] | null;
  turningParams?: {
    roughCutDepthMm: number; roughCuttingSpeedMPerMin: number; roughFeedMmPerRev: number;
    finishCutDepthMm: number; finishCuttingSpeedMPerMin: number; finishFeedMmPerRev: number;
    dataFound: boolean; materialCutCode?: string;
  } | null;
  grindingParams?: {
    workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number;
    roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean; materialCutCode?: string;
    match?: { table: string; row: Record<string, string | number> };
  } | null;
  /** Internal Grinding's own tblInternalGrinding values (same shape). */
  internalGrindingParams?: MachiningLookupContext['grindingParams'];
  /** tblRotaryBroaching rows (750) and the rotary-broach variables (639). */
  rotaryBroach?: RotaryBroachReference | null;
  /** tblShaving rows (810) and variables maxShavingWorkpieceSpeed. */
  shaving?: { rows: any[]; maxWorkpieceRpm: number | null } | null;
  /** tblHobbing (809) + tblAnsiHobbing (740) rows and variables defaultNumStarts. */
  hobbing?: HobbingReference | null;
  /** tblReciprocatingSurfaceGrinding row + wheel width for this material (migrations 749 / 809). */
  surfaceGrindingParams?: SurfaceGrindingParams | null;
  /** Keyway broach tables (migration 811) and positioning times (variables). */
  keywayBroach?: KeywayBroachReference | null;
  wireEdmParams?: {
    roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number; dataFound: boolean; materialCutCode?: string;
  } | null;
  deburrParams?: { linearSpeedMmPerSec: number; dataFound: boolean; materialCutCode?: string } | null;
  /** Finishing-process thresholds and pass counts (capability-rules.ts). */
  capabilityRules?: MachiningCapabilityRules | null;
}

export interface LookupSeeds {
  seeds: Record<string, CalcSeed>;
  /** Lookup inputs that could not be resolved, each with the reason. */
  missing: string[];
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Cutting speed / feed of one real per-diameter row, as the calculator's two lookup inputs. */
function speedFeed(
  speed: unknown, feed: unknown, source: string, match: CalcSeed['match'] | undefined,
): Record<string, CalcSeed> {
  const seeds: Record<string, CalcSeed> = {};
  const m = match ? { match } : {};
  if (positive(speed)) seeds['Cutting Speed'] = { value: speed, source, lookup: true, ...m };
  if (positive(feed)) seeds['Feed'] = { value: feed, source, lookup: true, ...m };
  return seeds;
}

function holeDiameterKey(keys: Record<string, number>, operation: string, out: LookupSeeds): number | null {
  const d = keys['Hole Diameter'];
  if (positive(d)) return d;
  out.missing.push(`${operation}: Hole Diameter (the table row is chosen by it)`);
  return null;
}

export function drillingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const d = holeDiameterKey(keys, 'Drilling', out);
  if (d == null) return out;
  const real = resolveDrillingParams(ctx.drillingTable, d, ctx.matClass);
  if (!real) {
    out.missing.push(ctx.drillingTable ? `tblDrilling row for ${ctx.matClass} at Ø${d} mm` : 'tblDrilling (machining_reference_data) could not be read');
    return out;
  }
  const match = { table: 'tblDrilling', row: { material_cut_code: real.materialCutCode, construction: real.construction } };
  out.seeds['Cutting Speed'] = {
    value: real.cuttingSpeedMPerMin, lookup: true, match,
    source: `tblDrilling: material code ${real.materialCutCode} (${real.hardnessHb} HB, nearest to ${ctx.matClass}), ${real.construction} drill`,
  };
  out.seeds['Feed'] = { value: real.feedMmPerRev, source: `tblDrilling: ${real.feedDerivation}`, lookup: true, match };
  return out;
}

export function reamingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const d = holeDiameterKey(keys, 'Reaming', out);
  if (d == null) return out;
  const row = ctx.reamTable?.length ? nearestByDiameterThenHardness(ctx.reamTable, d, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]) : null;
  if (!row) { out.missing.push(`tblReaming row for ${ctx.matClass} at Ø${d} mm`); return out; }
  out.seeds = speedFeed(row.CuttingSpeedMPerMin, row.FeedMm, `tblReaming: Ø${row.DiameterMm} mm, ${row.Hardness} HB`,
    { table: 'tblReaming', row: { DiameterMm: row.DiameterMm, Hardness: row.Hardness, MaterialCutCodeName: row.MaterialCutCodeName } });
  return out;
}

/**
 * Tapping cutting speed from tblTapping: the material code nearest this
 * material class's hardness, then that code's row at the tabulated pitch
 * nearest the thread's (the table gives a fine 0.5 / 1.0 mm and a coarse
 * 3.0 / 6.35 mm pitch band per code; a tie goes to the smaller pitch, as in
 * every nearest-row matcher here). Both are kept inside the table's own
 * range; outside it the speed is missing, never extrapolated.
 */
export function resolveTappingRow(rows: any[] | null | undefined, pitchMm: number, matClass: MaterialClass): any | null {
  if (!rows?.length) return null;
  const pitches = [...new Set(rows.map((r) => r.MetricPitchMm).filter(positive))].sort((a, b) => a - b);
  if (pitches.length === 0 || pitchMm < pitches[0]! || pitchMm > pitches[pitches.length - 1]!) return null;
  const material = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[matClass]);
  if (!material) return null;
  const atCode = rows.filter((r) => r.MaterialCutCodeName === material.MaterialCutCodeName && positive(r.MetricPitchMm) && positive(r.CuttingSpeedMPerMin));
  if (atCode.length === 0) return null;
  return atCode.reduce((best, r) => (Math.abs(r.MetricPitchMm - pitchMm) < Math.abs(best.MetricPitchMm - pitchMm) ? r : best), atCode[0]);
}

export function tappingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const pitch = keys['Thread Pitch'];
  if (!positive(pitch)) { out.missing.push('Tapping: Thread Pitch (the table row is chosen by it)'); return out; }
  const row = resolveTappingRow(ctx.tappingTable, pitch, ctx.matClass);
  if (!row) {
    out.missing.push(ctx.tappingTable?.length
      ? `tblTapping row for ${ctx.matClass} at pitch ${pitch} mm (outside the table's material / pitch range)`
      : 'tblTapping (machining_reference_data) could not be read');
    return out;
  }
  out.seeds['Cutting Speed'] = {
    value: row.CuttingSpeedMPerMin, lookup: true,
    source: `tblTapping: material code ${row.MaterialCutCodeName} (${row.Hardness} HB, nearest to ${ctx.matClass}), pitch ${row.MetricPitchMm} mm`,
    match: { table: 'tblTapping', row: { MaterialCutCodeName: row.MaterialCutCodeName, MetricPitchMm: row.MetricPitchMm } },
  };
  return out;
}

export function jigBoringLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  if (ctx.capabilityRules) {
    out.seeds['Repetitions'] = { value: ctx.capabilityRules.jigBoringRepetitions, source: 'tblGtolProcessCapabilities: Jig Boring positionTolerance Num Repetitions', lookup: true,
      match: { table: 'tblGtolProcessCapabilities', row: { Process: 'Jig Boring', GtolCategory: 'positionTolerance' } } };
  } else out.missing.push('tblGtolProcessCapabilities Jig Boring Num Repetitions');
  const d = holeDiameterKey(keys, 'Jig Boring', out);
  if (d == null) return out;
  const row = ctx.finishBoringTable?.length ? nearestByDiameterThenHardness(ctx.finishBoringTable, d, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]) : null;
  if (!row) { out.missing.push(`tblBoringV2 Finish Boring row for ${ctx.matClass} at Ø${d} mm`); return out; }
  Object.assign(out.seeds, speedFeed(row.cutting_speed_m_min, row.feed_mm_rev, `tblBoringV2 Finish Boring: Ø${row.diameter_mm} mm, ${row.hardness} HB`,
    { table: 'tblBoringV2', row: { cut_type: 'Finish Boring', diameter_mm: row.diameter_mm, hardness: row.hardness } }));
  return out;
}

export function gunDrillingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const d = holeDiameterKey(keys, 'Gun Drilling', out);
  if (d == null) return out;
  const row = ctx.gunDrillTable?.length ? nearestByDiameterThenHardness(ctx.gunDrillTable, d, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]) : null;
  const speed = row?.['Cutting Speed (m / min)'];
  const feed = row?.['Feed (mm / rev)'];
  if (!positive(speed) || !positive(feed)) { out.missing.push(`tblGunDrilling row for ${ctx.matClass} at Ø${d} mm`); return out; }
  out.seeds = speedFeed(speed, feed, `tblGunDrilling: Ø${row['Diameter (mm)']} mm, ${row.Hardness} HB`,
    { table: 'tblGunDrilling', row: { 'Diameter (mm)': row['Diameter (mm)'], Hardness: row.Hardness } });
  return out;
}

export function deepBoreLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const d = holeDiameterKey(keys, 'Deep Bore Machine', out);
  if (d == null) return out;
  const row = ctx.deepBoreMaterials?.length ? nearestByHardness(ctx.deepBoreMaterials, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]) : null;
  const speed = row?.cutting_speed_m_min;
  const feed = nearestByDiameterKey(row?.feed_mm_rev_by_diameter, d);
  if (!positive(speed) || feed == null) { out.missing.push(`deep_bore_drill_lookup row for ${ctx.matClass} at Ø${d} mm`); return out; }
  out.seeds = speedFeed(speed, feed, `deep_bore_drill_lookup: material code ${row.material_cut_code} (${row.hardness} HB), nearest diameter breakpoint`,
    { table: 'deep_bore_drill_lookup', row: { material_cut_code: row.material_cut_code } });
  return out;
}

export function partingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const bar = keys['Bar Diameter'];
  if (!positive(bar)) { out.missing.push('Parting: Bar Diameter (the insert is chosen by the cut depth, the bar radius)'); return out; }
  const cutDepthMm = bar / 2;
  const p = resolvePartoffParams(ctx.partoffTable, cutDepthMm, ctx.matClass);
  if (!p) {
    out.missing.push(ctx.partoffTable
      ? `tblVirtualPartoffInsertCutData insert for ${ctx.matClass} reaching ${Math.round(cutDepthMm * 100) / 100} mm`
      : 'tblVirtualPartoffInsertCutData (machining_reference_data) could not be read');
    return out;
  }
  const match = { table: 'tblVirtualPartoffInsertCutData', row: { MaterialCutCodeName: p.materialCutCode, LengthMm: p.insertWidthMm } };
  const src = `tblVirtualPartoffInsertCutData: material code ${p.materialCutCode} (${p.hardnessHb} HB), ${p.insertWidthMm} mm insert (reaches ${p.depthMaxMm} mm)`;
  out.seeds = {
    'Cutting Speed': { value: p.cuttingSpeedMPerMin, source: src, lookup: true, match },
    'Feed': { value: p.feedMmPerRev, source: src, lookup: true, match },
  };
  return out;
}

function turningRows(ctx: MachiningLookupContext) {
  const tp = ctx.turningParams?.dataFound ? ctx.turningParams : null;
  const row = (operation: string) => ({ table: 'tblGeneralTurning', row: { material_cut_code: tp?.materialCutCode ?? '', operation } });
  return { tp, src: `tblGeneralTurning: ${ctx.matClass}`, rough: row('medium_rough_turning'), finish: row('finish_turning') };
}

export function roughTurningLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const { tp, src, rough, finish } = turningRows(ctx);
  if (!tp) return { seeds: {}, missing: [`tblGeneralTurning cutting data for ${ctx.matClass}`] };
  return {
    missing: [],
    seeds: {
      'Finish Depth of Cut': { value: tp.finishCutDepthMm, source: `${src} finish_turning`, lookup: true, match: finish },
      'Rough Depth of Cut': { value: tp.roughCutDepthMm, source: `${src} medium_rough_turning`, lookup: true, match: rough },
      'Rough Cutting Speed': { value: tp.roughCuttingSpeedMPerMin, source: `${src} medium_rough_turning`, lookup: true, match: rough },
      'Rough Feed': { value: tp.roughFeedMmPerRev, source: `${src} medium_rough_turning`, lookup: true, match: rough },
    },
  };
}

export function finishTurningLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const { tp, src, finish } = turningRows(ctx);
  if (!tp) return { seeds: {}, missing: [`tblGeneralTurning cutting data for ${ctx.matClass}`] };
  return {
    missing: [],
    seeds: {
      'Finish Cutting Speed': { value: tp.finishCuttingSpeedMPerMin, source: `${src} finish_turning`, lookup: true, match: finish },
      'Finish Feed': { value: tp.finishFeedMmPerRev, source: `${src} finish_turning`, lookup: true, match: finish },
    },
  };
}

/**
 * Cylindrical / Internal Grinding (and Jig Grind, plus its repetitions).
 * Internal Grinding and Jig Grind (both grind a bore) read tblInternalGrinding
 * (ctx.internalGrindingParams); Cylindrical Grinding reads tblCylindricalGrinding.
 */
export function grindingLookupSeeds(
  ctx: MachiningLookupContext,
  repetitions?: 'jig_grind',
  table: 'tblCylindricalGrinding' | 'tblInternalGrinding' = 'tblCylindricalGrinding',
): LookupSeeds {
  const out: LookupSeeds = { missing: [], seeds: {} };
  const rules = ctx.capabilityRules;
  if (rules) {
    out.seeds['Grinding Allowance'] = { value: rules.finishGrindingDepthMm, source: 'variables: finishGrindingDepth', lookup: true, match: { table: 'variables', row: { key: 'finishGrindingDepth' } } };
  } else out.missing.push('variables: finishGrindingDepth');
  if (repetitions === 'jig_grind') {
    if (rules) {
      out.seeds['Repetitions'] = { value: rules.jigGrindRepetitions, source: 'tblGtolProcessCapabilities: Jig Grind positionTolerance Num Repetitions', lookup: true,
        match: { table: 'tblGtolProcessCapabilities', row: { Process: 'Jig Grind', GtolCategory: 'positionTolerance' } } };
    } else out.missing.push('tblGtolProcessCapabilities Jig Grind Num Repetitions');
  }
  const params = table === 'tblInternalGrinding' ? ctx.internalGrindingParams : ctx.grindingParams;
  const p = params?.dataFound ? params : null;
  if (!p) { out.missing.push(`${table} data for ${ctx.matClass}`); return out; }
  const src = `${table}: ${ctx.matClass}`;
  const m = p.match ? { match: p.match } : {};
  Object.assign(out.seeds, {
    'Work Speed': { value: p.workSpeedMMin, source: src, lookup: true, ...m },
    'Rough Infeed': { value: p.roughInfeedMm, source: src, lookup: true, ...m },
    'Finish Infeed': { value: p.finishInfeedMm, source: src, lookup: true, ...m },
    'Rough Axial Feed': { value: p.roughAxialFeedRevMm, source: src, lookup: true, ...m },
    'Finish Axial Feed': { value: p.finishAxialFeedRevMm, source: src, lookup: true, ...m },
  });
  return out;
}

/** One material code's tblReciprocatingSurfaceGrinding row plus the wheel width (tblGrinding). */
export interface SurfaceGrindingParams {
  materialCutCode: string;
  toolSeries: string;
  tableSpeedMPerMin: number;
  roughDownfeedMm: number;
  finishDownfeedMm: number;
  absoluteCrossfeedMm: number;
  maxFractionalCrossfeed: number;
  /** Null when tblGrinding does not give one width for this wheel series. */
  wheelWidthMm: number | null;
}

/**
 * Gear shaving: strokes, cutting speed and feed per workpiece revolution from
 * tblShaving for the material code nearest this material class's Brinell
 * hardness; the workpiece speed cap from variables maxShavingWorkpieceSpeed.
 */
export function shavingLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const ref = ctx.shaving;
  if (!ref?.rows.length) { out.missing.push('tblShaving (machining_reference_data) could not be read'); return out; }
  const rows = ref.rows.filter((r) => String(r['Hardness System'] ?? '').toLowerCase() === 'brinell');
  const row = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]);
  if (!row || !positive(row['Strokes']) || !positive(row['Cutting Speed (m / min)']) || !positive(row['Feed Per Rev (mm / rev)'])) {
    out.missing.push(`tblShaving row for ${ctx.matClass}`);
    return out;
  }
  const src = `tblShaving: material code ${row['Material Cut Code Name']} (${row['Hardness']} HB, nearest to ${ctx.matClass})`;
  const match = { table: 'tblShaving', row: { 'Material Cut Code Name': row['Material Cut Code Name'] } };
  out.seeds['Strokes'] = { value: row['Strokes'], source: src, lookup: true, match };
  out.seeds['Cutting Speed'] = { value: row['Cutting Speed (m / min)'], source: src, lookup: true, match };
  out.seeds['Feed'] = { value: row['Feed Per Rev (mm / rev)'], source: src, lookup: true, match };
  if (ref.maxWorkpieceRpm == null) out.missing.push('variables: maxShavingWorkpieceSpeed');
  else out.seeds['Max Workpiece Speed'] = { value: ref.maxWorkpieceRpm, source: 'variables: maxShavingWorkpieceSpeed', lookup: true, match: { table: 'variables', row: { key: 'maxShavingWorkpieceSpeed' } } };
  return out;
}

/** Rotary broaching: tblRotaryBroaching rows and the rotary-broach variables. */
export interface RotaryBroachReference {
  rows: any[];
  feedAdjustment: number | null;
  /** Pilot hole diameter / across flats, by side count (hex 6, square 4). */
  pilotDiameterRatio: Partial<Record<number, number>>;
  /** Pilot hole length / polygon depth. */
  pilotLengthRatio: number | null;
}

/**
 * Rotary broaching of a polygon socket: RPM and feed per revolution from
 * tblRotaryBroaching for the material code nearest this material class's
 * Brinell hardness; the broach's maximum depth at this width across flats,
 * interpolated between the table's two width breakpoints (0.1 / 20 mm); the
 * feed calibration variables rotaryBroachFeedAdjustment. A socket deeper than
 * the broach reaches, or wider than the table, is missing, not priced.
 */
export function rotaryBroachingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const af = keys['Across Flats'];
  const depth = keys['Polygon Depth'];
  if (!positive(af) || !positive(depth)) { out.missing.push('Rotary Broaching: Across Flats and Polygon Depth'); return out; }
  const ref = ctx.rotaryBroach;
  if (!ref?.rows.length) { out.missing.push('tblRotaryBroaching (machining_reference_data) could not be read'); return out; }
  const rows = ref.rows.filter((r) => String(r.HardnessSystem ?? '').toLowerCase() === 'brinell');
  const material = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]);
  if (!material) { out.missing.push(`tblRotaryBroaching row for ${ctx.matClass}`); return out; }
  const atCode = rows.filter((r) => r.MaterialCutCodeName === material.MaterialCutCodeName)
    .sort((a, b) => Number(a.WidthAcrossFlatsMm) - Number(b.WidthAcrossFlatsMm));
  const lo = [...atCode].reverse().find((r) => Number(r.WidthAcrossFlatsMm) <= af);
  const hi = atCode.find((r) => Number(r.WidthAcrossFlatsMm) >= af);
  if (!lo || !hi) {
    out.missing.push(`tblRotaryBroaching broach for ${af} mm across flats (table covers ${atCode[0]?.WidthAcrossFlatsMm}-${atCode[atCode.length - 1]?.WidthAcrossFlatsMm} mm)`);
    return out;
  }
  const w0 = Number(lo.WidthAcrossFlatsMm);
  const w1 = Number(hi.WidthAcrossFlatsMm);
  const maxDepth = w1 === w0 ? Number(lo.DepthMaxMm) : Number(lo.DepthMaxMm) + ((af - w0) * (Number(hi.DepthMaxMm) - Number(lo.DepthMaxMm))) / (w1 - w0);
  if (depth > maxDepth) {
    out.missing.push(`a rotary broach reaching ${depth} mm (tblRotaryBroaching: ${maxDepth.toFixed(2)} mm at ${af} mm across flats)`);
    return out;
  }
  if (!positive(Number(lo.RPM)) || !positive(Number(lo.FeedMmPerRev))) {
    out.missing.push(`tblRotaryBroaching RPM / feed for code ${lo.MaterialCutCodeName}`);
    return out;
  }
  const src = `tblRotaryBroaching: material code ${lo.MaterialCutCodeName} (${lo.Hardness} HB, nearest to ${ctx.matClass}); max depth ${maxDepth.toFixed(2)} mm at ${af} mm across flats`;
  const match = { table: 'tblRotaryBroaching', row: { MaterialCutCodeName: lo.MaterialCutCodeName, WidthAcrossFlatsMm: lo.WidthAcrossFlatsMm } };
  out.seeds['RPM'] = { value: Number(lo.RPM), source: src, lookup: true, match };
  out.seeds['Feed'] = { value: Number(lo.FeedMmPerRev), source: src, lookup: true, match };
  if (ref.feedAdjustment == null) out.missing.push('variables: rotaryBroachFeedAdjustment');
  else out.seeds['Feed Adjustment'] = { value: ref.feedAdjustment, source: 'variables: rotaryBroachFeedAdjustment', lookup: true, match: { table: 'variables', row: { key: 'rotaryBroachFeedAdjustment' } } };
  return out;
}

/** The hobbing reference: cutting data, ANSI hob sizes and the default number of starts. */
export interface HobbingReference {
  /** tblHobbing rows (cutting speed and axial feed by material and diametral pitch). */
  hobRows: any[];
  /** tblAnsiHobbing rows (hob diameter by module and number of starts). */
  ansiRows: any[];
  /** variables defaultNumStarts. */
  defaultNumStarts: number | null;
}

/**
 * Hobbing inputs for a gear of this module: the ANSI hob (tblAnsiHobbing) at
 * the tabulated module nearest the gear's, with the reference default number
 * of starts; the cutting speed and axial feed from tblHobbing for the material
 * code nearest this material class's Brinell hardness (its tensile-strength
 * rows are another scale and are left out) at the tabulated diametral pitch
 * (25.4 / module) nearest the gear's. Both axes stay inside the table's range.
 */
export function hobbingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const module = keys['Module'];
  if (!positive(module)) { out.missing.push('Hobbing: Module (the hob and cutting data are chosen by it)'); return out; }
  const ref = ctx.hobbing;
  if (!ref) { out.missing.push('the hobbing tables (machining_reference_data) could not be read'); return out; }
  if (ref.defaultNumStarts == null) { out.missing.push('variables: defaultNumStarts'); return out; }
  const starts = ref.defaultNumStarts;
  const ansi = ref.ansiRows.filter((r) => r.num_starts === starts && positive(r.module_mm) && positive(r.hob_diameter_mm));
  const modules = ansi.map((r) => r.module_mm as number);
  if (modules.length === 0 || module < Math.min(...modules) || module > Math.max(...modules)) {
    out.missing.push(`tblAnsiHobbing row for a ${starts}-start hob at module ${module.toFixed(3)} mm`);
  } else {
    const hob = ansi.reduce((best, r) => (Math.abs(r.module_mm - module) < Math.abs(best.module_mm - module) ? r : best), ansi[0]);
    const match = { table: 'tblAnsiHobbing', row: { module_mm: hob.module_mm, num_starts: hob.num_starts } };
    out.seeds['Hob Diameter'] = { value: hob.hob_diameter_mm, lookup: true, match, source: `tblAnsiHobbing: module ${hob.module_mm} mm, ${starts} start(s)` };
    out.seeds['Starts'] = { value: starts, lookup: true, match: { table: 'variables', row: { key: 'defaultNumStarts' } }, source: 'variables: defaultNumStarts' };
  }
  const dp = 25.4 / module;
  const rows = ref.hobRows.filter((r) => String(r['Hardness System'] ?? '').toLowerCase() === 'brinell');
  const pitches = [...new Set(rows.map((r) => r['Diametral Pitch']).filter(positive))].sort((a, b) => a - b);
  const material = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[ctx.matClass]);
  if (!material || pitches.length === 0 || dp < pitches[0]! || dp > pitches[pitches.length - 1]!) {
    out.missing.push(`tblHobbing row for ${ctx.matClass} at diametral pitch ${dp.toFixed(2)} (module ${module.toFixed(3)} mm)`);
    return out;
  }
  const atCode = rows.filter((r) => r['Material Cut Code Name'] === material['Material Cut Code Name'] && positive(r['Cutting Speed (m / min)']) && positive(r['Feed (mm / rev)']));
  if (atCode.length === 0) { out.missing.push(`tblHobbing cutting data for material code ${material['Material Cut Code Name']}`); return out; }
  const row = atCode.reduce((best, r) => (Math.abs(r['Diametral Pitch'] - dp) < Math.abs(best['Diametral Pitch'] - dp) ? r : best), atCode[0]);
  const src = `tblHobbing: material code ${row['Material Cut Code Name']} (${row['Hardness']} HB, nearest to ${ctx.matClass}), diametral pitch ${row['Diametral Pitch']}`;
  const match = { table: 'tblHobbing', row: { 'Material Cut Code Name': row['Material Cut Code Name'], 'Diametral Pitch': row['Diametral Pitch'] } };
  out.seeds['Cutting Speed'] = { value: row['Cutting Speed (m / min)'], source: src, lookup: true, match };
  out.seeds['Axial Feed'] = { value: row['Feed (mm / rev)'], source: src, lookup: true, match };
  return out;
}

/** The two reference keyway broach tables and their positioning times. */
export interface KeywayBroachReference {
  /** tblPullTypeKeywayBroach rows — "Single Pass Keyway Broaching" (1-3 passes). */
  pullRows: any[];
  /** tblShimTypeKeywayBroach rows — "Multipass Keyway Broaching" (one pass per shim, plus the first). */
  shimRows: any[];
  /** variables singlePassKeywayBroachingPositioningTime (s), between passes of a pull broach. */
  singlePassPositioningS: number | null;
  /** variables multipassKeywayBroachingPositioningTime (s), re-seating the broach and a shim. */
  multipassPositioningS: number | null;
}

interface KeywayBroachChoice {
  kind: 'pull' | 'shim';
  row: any;
  passes: number;
  positioningS: number;
}

const brinellRows = (rows: any[]) => rows.filter((r) => String(r['Hardness System'] ?? '').toLowerCase() === 'brinell');

/**
 * The broach for one keyway: the material code nearest this material class's
 * Brinell hardness (the shim table also lists Rockwell C and tensile-strength
 * rows, which are not on the same scale and are left out), then, at the
 * tabulated keyway width nearest the keyway's, the first broach in table order
 * whose Min / Max Keyway Length covers the keyway length. A pull-type broach
 * (single pass) is used whenever one fits; otherwise a shim-type (multipass)
 * broach. None fitting, or a positioning time not staged, is null.
 */
export function resolveKeywayBroach(ref: KeywayBroachReference | null | undefined, widthMm: number, lengthMm: number, matClass: MaterialClass): KeywayBroachChoice | null {
  if (!ref) return null;
  const pick = (all: any[]) => {
    const rows = brinellRows(all).filter((r) => positive(r['Keyway Width (mm)']));
    const material = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[matClass]);
    if (!material) return null;
    const atCode = rows.filter((r) => r['Material Cut Code Name'] === material['Material Cut Code Name']);
    const widths = [...new Set(atCode.map((r) => r['Keyway Width (mm)'] as number))].sort((a, b) => a - b);
    if (widths.length === 0 || widthMm < widths[0]! || widthMm > widths[widths.length - 1]!) return null;
    const width = widths.reduce((best, w) => (Math.abs(w - widthMm) < Math.abs(best - widthMm) ? w : best), widths[0]!);
    return atCode.find((r) => r['Keyway Width (mm)'] === width
      && lengthMm >= r['Min Keyway Length (mm)'] && lengthMm <= r['Max Keyway Length (mm)']
      && positive(r['Cutting Speed (m / min)']) && positive(r['Teeth']) && positive(r['Pitch (mm)'])) ?? null;
  };
  const pull = pick(ref.pullRows);
  if (pull && positive(pull['Passes']) && ref.singlePassPositioningS != null) {
    return { kind: 'pull', row: pull, passes: pull['Passes'], positioningS: ref.singlePassPositioningS };
  }
  const shim = pick(ref.shimRows);
  if (shim && ref.multipassPositioningS != null) {
    const shims = positive(shim['Shims']) ? shim['Shims'] : 0; // '-' = no shim
    return { kind: 'shim', row: shim, passes: shims + 1, positioningS: ref.multipassPositioningS };
  }
  return null;
}

/**
 * Reciprocating surface grinding: table speed and down-feeds from
 * tblReciprocatingSurfaceGrinding; crossfeed per stroke = AbsoluteCrossfeedMm,
 * capped at MaxFractionalCrossfeed x the wheel width (tblGrinding); grinding
 * allowance = variables finishGrindingDepth (as for the other grinding lines).
 */
export function surfaceGrindingLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const out: LookupSeeds = { missing: [], seeds: {} };
  const rules = ctx.capabilityRules;
  if (rules) {
    out.seeds['Grinding Allowance'] = { value: rules.finishGrindingDepthMm, source: 'variables: finishGrindingDepth', lookup: true, match: { table: 'variables', row: { key: 'finishGrindingDepth' } } };
  } else out.missing.push('variables: finishGrindingDepth');
  const p = ctx.surfaceGrindingParams;
  if (!p) { out.missing.push(`tblReciprocatingSurfaceGrinding data for ${ctx.matClass}`); return out; }
  const src = `tblReciprocatingSurfaceGrinding: material code ${p.materialCutCode} (${ctx.matClass})`;
  const match = { match: { table: 'tblReciprocatingSurfaceGrinding', row: { MaterialCutCodeName: p.materialCutCode } } };
  Object.assign(out.seeds, {
    'Table Speed': { value: p.tableSpeedMPerMin, source: src, lookup: true, ...match },
    'Rough Downfeed': { value: p.roughDownfeedMm, source: src, lookup: true, ...match },
    'Finish Downfeed': { value: p.finishDownfeedMm, source: src, lookup: true, ...match },
  });
  if (p.wheelWidthMm == null) {
    out.missing.push(`the ${p.toolSeries} wheel width (tblGrinding), needed to cap the crossfeed`);
  } else {
    const capped = p.maxFractionalCrossfeed * p.wheelWidthMm;
    const crossfeed = Math.min(p.absoluteCrossfeedMm, capped);
    out.seeds['Crossfeed'] = {
      value: crossfeed, lookup: true, ...match,
      source: `${src}: min(AbsoluteCrossfeedMm ${p.absoluteCrossfeedMm}, MaxFractionalCrossfeed ${p.maxFractionalCrossfeed} x ${p.wheelWidthMm} mm wheel (tblGrinding))`,
    };
  }
  return out;
}

export function keywayBroachingLookupSeeds(ctx: MachiningLookupContext, keys: Record<string, number>): LookupSeeds {
  const out: LookupSeeds = { seeds: {}, missing: [] };
  const w = keys['Keyway Width'];
  const l = keys['Keyway Length'];
  if (!positive(w) || !positive(l)) { out.missing.push('Keyway Broaching: Keyway Width and Length (the broach is chosen by them)'); return out; }
  const choice = resolveKeywayBroach(ctx.keywayBroach, w, l, ctx.matClass);
  if (!choice) {
    out.missing.push(ctx.keywayBroach
      ? `a keyway broach for ${ctx.matClass} at ${w} mm wide x ${l} mm long (tblPullTypeKeywayBroach / tblShimTypeKeywayBroach, or their positioning-time variables)`
      : 'the keyway broach tables (machining_reference_data) could not be read');
    return out;
  }
  const r = choice.row;
  const table = choice.kind === 'pull' ? 'tblPullTypeKeywayBroach' : 'tblShimTypeKeywayBroach';
  const src = `${table}: broach ${r['Id']}, material code ${r['Material Cut Code Name']} (${r['Hardness']} HB, nearest to ${ctx.matClass}), ${r['Keyway Width (mm)']} mm wide`;
  const match = { table, row: { Id: r['Id'], 'Material Cut Code Name': r['Material Cut Code Name'] } };
  const passesSource = choice.kind === 'pull'
    ? `${src} — Passes`
    : `${src} — ${choice.passes - 1} shim${choice.passes === 2 ? '' : 's'} + the first pass`;
  const positioningVar = choice.kind === 'pull' ? 'singlePassKeywayBroachingPositioningTime' : 'multipassKeywayBroachingPositioningTime';
  out.seeds = {
    'Broach Teeth': { value: r['Teeth'], source: src, lookup: true, match },
    'Broach Pitch': { value: r['Pitch (mm)'], source: src, lookup: true, match },
    'Cutting Speed': { value: r['Cutting Speed (m / min)'], source: src, lookup: true, match },
    'Passes': { value: choice.passes, source: passesSource, lookup: true, match },
    'Positioning Time': { value: choice.positioningS, source: `variables: ${positioningVar}`, lookup: true, match: { table: 'variables', row: { key: positioningVar } } },
  };
  return out;
}

export function wireEdmLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const p = ctx.wireEdmParams?.dataFound ? ctx.wireEdmParams : null;
  if (!p) return { seeds: {}, missing: [`tblWireEDMing data for ${ctx.matClass}`] };
  const row = (cut: string) => ({ table: 'tblWireEDMing', row: { CutType: cut, MaterialCutCodeName: p.materialCutCode ?? '' } });
  return {
    missing: [],
    seeds: {
      'Rough Feed Rate': { value: p.roughFeedRateMmPerMin, source: 'tblWireEDMing: Roughing', lookup: true, match: row('Roughing') },
      'Finish Feed Rate': { value: p.finishFeedRateMmPerMin, source: 'tblWireEDMing: Finishing', lookup: true, match: row('Finishing') },
    },
  };
}

export function deburringLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const p = ctx.deburrParams?.dataFound && positive(ctx.deburrParams.linearSpeedMmPerSec) ? ctx.deburrParams : null;
  if (!p) return { seeds: {}, missing: [`tblDeburring edge speed for ${ctx.matClass}`] };
  return {
    missing: [],
    seeds: {
      'Edge Speed': {
        value: p.linearSpeedMmPerSec, source: `tblDeburring: ${ctx.matClass}`, lookup: true,
        ...(p.materialCutCode ? { match: { table: 'tblDeburring', row: { material_cut_code_name: p.materialCutCode } } } : {}),
      },
    },
  };
}

export function rechuckLookupSeeds(ctx: MachiningLookupContext): LookupSeeds {
  const chuck = ctx.workholderTable?.find((r) => r.Name === '3 Jaw Chuck');
  const min = chuck?.['Install And Remove Time (min)'];
  if (!positive(min)) return { seeds: {}, missing: ['tblInstallingTurningWorkholders "3 Jaw Chuck" install-and-remove time'] };
  return {
    missing: [],
    seeds: {
      'Workholder Install and Remove Time': {
        value: min, lookup: true,
        source: 'Assumption: part re-held in a standard 3-jaw chuck — tblInstallingTurningWorkholders "3 Jaw Chuck" row',
        match: { table: 'tblInstallingTurningWorkholders', row: { Name: '3 Jaw Chuck' } },
      },
    },
  };
}

/**
 * Lookup inputs of the calculator for `operation` (its catalog operation
 * name, as in machining-calculators.json). null = the calculator has no
 * lookup-table inputs (Index Transfer reads the machine record, Inspection
 * the drawing and sampling policy).
 */
export function machiningLookupSeeds(
  operation: string,
  ctx: MachiningLookupContext,
  keys: Record<string, number>,
): LookupSeeds | null {
  switch (operation) {
    case 'Drilling': return drillingLookupSeeds(ctx, keys);
    case 'Reaming': return reamingLookupSeeds(ctx, keys);
    case 'Tapping': return tappingLookupSeeds(ctx, keys);
    case 'Jig Boring': return jigBoringLookupSeeds(ctx, keys);
    case 'Gun Drilling': return gunDrillingLookupSeeds(ctx, keys);
    case 'Deep Bore Machine': return deepBoreLookupSeeds(ctx, keys);
    case 'Parting': return partingLookupSeeds(ctx, keys);
    case 'Rough Turning': return roughTurningLookupSeeds(ctx);
    case 'Finish Turning': return finishTurningLookupSeeds(ctx);
    case 'Cylindrical Grinding': return grindingLookupSeeds(ctx);
    case 'Internal Grinding': return grindingLookupSeeds(ctx, undefined, 'tblInternalGrinding');
    case 'Jig Grind': return grindingLookupSeeds(ctx, 'jig_grind', 'tblInternalGrinding');
    case 'Surface Grinding': return surfaceGrindingLookupSeeds(ctx);
    case 'Hobbing': return hobbingLookupSeeds(ctx, keys);
    case 'Shaving': return shavingLookupSeeds(ctx);
    case 'Rotary Broaching': return rotaryBroachingLookupSeeds(ctx, keys);
    case 'Keyway Broaching': return keywayBroachingLookupSeeds(ctx, keys);
    case 'Wire EDM': return wireEdmLookupSeeds(ctx);
    case 'Deburring': return deburringLookupSeeds(ctx);
    case 'Secondary Setup (Rechuck)': return rechuckLookupSeeds(ctx);
    default: return null;
  }
}
