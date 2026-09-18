import {
  RATES_SOURCE_LABEL,
  CNC_STOCK_ALLOWANCE_PER_SIDE_MM,
  CMM_SETUP_MIN,
  INSPECTION_SAMPLING_DEFAULT,
  computeTapCycleSec,
  TAP_UNLOAD_SEC,
  resolveDrillingSpeedFeed,
  HOLE_OP_UNLOAD_SEC,
  TIGHT_TOLERANCE_REAM_THRESHOLD_MM,
  REAM_SETUP_MIN,
  TAPPING_SETUP_MIN,
  DEEP_HOLE_SETUP_MIN,
  FINISH_GRINDING_DEPTH_MM,
  TURNING_MILLING_BEST_ACHIEVABLE_RA_UM,
  CYLINDRICAL_GRINDING_SETUP_MIN,
  JIG_BORE_POSITION_TOLERANCE_MM,
  JIG_BORE_NUM_REPETITIONS,
  JIG_BORE_SETUP_MIN,
  JIG_GRIND_NUM_REPETITIONS,
  JIG_GRIND_SETUP_MIN,
  INTERNAL_GRINDING_SETUP_MIN,
  KEYWAY_BROACHING_SETUP_MIN,
  WIRE_EDM_SETUP_MIN,
  type SurfaceTreatmentDbRate,
  type InspectionStagePolicy,
} from '../../shared/core/default-rates.constants';
import { resolveSetupMinutes, type SetupTimeResolution } from '../../shared/core/engine-kernel';
import { nearestByDiameterThenHardness, nearestByHardness, nearestByDiameterKey, MACHINING_MATERIAL_HARDNESS_HB } from '../lookup/machining-material-hardness';
import type { DeepHoleCandidate } from '../operation/deep-hole-routing';
import { isRealHeatTreatmentCallout } from '../operation/wire-edm-routing';
import { deriveGdtSeverity } from '../../shared/physics/gdt-severity';
import {
  checkMachineCapability,
  type PartGeometryForCapability,
} from '../../shared/capability/machine-capability';
import type { MachineCapability } from '../../shared/capability/machine-selection/seed-registry';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import { computeSustainability } from '../../shared/core/cost-engine';
import type { CostSummaryDto, ProcessLineCost } from '../../../dto/cost-breakdown.dto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaterialClass =
  | 'aluminum' | 'mild_steel' | 'stainless'
  | 'titanium' | 'copper_alloy' | 'tool_steel' | 'plastic';

/**
 * A machine class discovered from the database (MachineDiscoveryService),
 * rather than one of a fixed set of TypeScript literals.
 *
 * Replaces the former CNCMachineClass literal union (Section G.2,
 * C:\Users\singi\.claude\plans\logical-noodling-lampson.md) — every
 * consumer that used to take a fixed 6-member union now takes this instead.
 * The dynamic discovery/route-comparison/registry rewrite (route builders,
 * requirement-builder, MHR_RATE_MACHINE_CLASSES, the MACHINING_CATEGORY_ALIAS
 * removal) is still pending — see the plan's H.2 for the remaining steps.
 *
 * Branded so a raw string literal can't silently satisfy the type by
 * accident — the only legal way to produce one is assertKnownMachineClass,
 * which checks it against a real, request-scoped, DB-discovered set and
 * throws instead of admitting an unrecognized value. This intentionally
 * gives up compile-time exhaustiveness checking (TypeScript can no longer
 * catch "a class is missing from an array" at build time, because the set
 * of valid classes is no longer knowable at build time) in exchange for a
 * loud runtime failure instead of a silent one — the same "explicit
 * reason, never fabricate" discipline the rate-resolution chain already
 * uses for a missing rate.
 */
export type MachineClassId = string & { readonly __machineClassIdBrand: 'MachineClassId' };

export class UnknownMachineClassError extends Error {
  constructor(value: string) {
    super(`Unknown machine class "${value}" — not present in the current, DB-discovered set of valid machine classes.`);
    this.name = 'UnknownMachineClassError';
  }
}

/** The only legal way to construct a MachineClassId — see its doc comment. */
export function assertKnownMachineClass(value: string, knownClasses: ReadonlySet<string>): MachineClassId {
  if (!knownClasses.has(value)) {
    throw new UnknownMachineClassError(value);
  }
  return value as MachineClassId;
}

export interface CNCCostInput {
  volume: number;          // mm³ (finish volume from CAD)
  surfaceArea: number;     // mm²
  maxLength: number;       // mm (bounding box)
  maxWidth: number;
  maxHeight: number;
  holeCount: number;
  holeGroups: Array<{ diameter_mm: number; count: number }>;
  pocketCount: number;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  // pitchMm/depthMm/isThrough are real, already-extracted per-thread data
  // (CAD-detected tapped_hole.depth_mm, or a drawing-OCR'd pitch) that
  // bom-items.service.ts's resolveThreads() already resolves and passes
  // here — previously discarded at this type boundary (only size/count were
  // declared), so computeTappingMin fell back to a flat, non-material-aware
  // per-size table even when the real depth/pitch were sitting right there.
  // See computeTappingMin below.
  threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }>;
  tightestToleranceMm: number | null;
  gdtFeatureCount: number;
  batchSize: number;
  family: string;
  finishedWeightKg: number;   // net part weight (BOMItem.weight)
  mhrRate: MHRRateInput;      // machine-specific rate for the selected class
  tappingRate: MHRRateInput;
  deburrRate: MHRRateInput;
  inspectionRate: MHRRateInput; // CMM / inspection station — carries amortized MHR when a DB record exists
  // Surface treatment callout from the drawing / coating field ("Type III Hardcoat
  // Black Anodize"); null when the part has none.
  surfaceTreatment: string | null;
  // Resolved quality plan (DB quality_plans row or code default). When unset,
  // INSPECTION_SAMPLING_DEFAULT applies.
  samplingPolicy?: InspectionStagePolicy;
  // Legacy per-item in-process override (1 = full measurement on every part);
  // wins over samplingPolicy.inProcessPerN. FAI and final stages still apply.
  samplingPerN?: number;
  // GD&T callouts for per-feature inspection time. timeMin is pre-resolved from
  // the inspection_rules table when available; the code matrix is the fallback.
  gdtFeatures?: Array<{ symbol: string; tolerance: number; timeMin?: number }>;
  // Digital Factory location — localizes fixture/tooling cost. Defaults to the
  // shared costing default so a missing value never silently prices in the wrong country.
  location?: string;
  // Blank optimizer result — when provided, overrides the bounding-box billet volume.
  // Improves material utilization from ~17% (raw bbox) to 55–65% (near-net stock).
  blankResult?: {
    form: string;          // 'round_bar' | 'rectangular_bar' | 'billet'
    sizeLabel: string;
    billetVolMm3: number;  // pre-computed optimized blank volume
    utilizationPct: number | null;
  };
  // machinability_rating from raw_materials DB (75 = mild steel baseline).
  // Scales MRR: Al 6061 ≈ 150 → 2× faster; SS316 ≈ 35 → 0.47× slower.
  machinabilityRating?: number;
  // Feature volumes from feature_graph_v2 — enables per-feature cycle time instead
  // of (billetVol − partVol) / MRR. When absent, falls back to the bbox formula.
  featureOps?: Array<{ name: string; timeSec: number; source: string }>;
  // Surface treatment rate resolved from surface_treatment_rates DB table (migration 362).
  // If null/absent, surface treatment cost is 0 with a warning.
  surfaceTreatmentDbRate?: SurfaceTreatmentDbRate | null;
  // Per-piece fixture cost in local currency (from DB or 0 when not configured).
  fixtureUnitCostLocal?: number;
  // Real process_calculator_mappings identity per machine class, resolved by the
  // caller (BomItemsService.resolveProcessIdentities()) — never hardcoded here.
  // Looked up per-line by that line's own rate.machineClass; a class missing from
  // this map is simply omitted from the line, not fabricated.
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>;
  // Real, hardness-matched tblDeburring linear edge speed (MachiningLookupService
  // .getDeburrParams), resolved once by the async caller. Replaces a
  // previously uncited flat 0.5 constant when present; falls back to it,
  // disclosed as a fallback, when the real rate isn't available.
  deburrLinearSpeedMmPerSec?: number | null;
  // Real tblReaming rows (MachiningLookupService.getReamTable()), fetched
  // once by the async caller — reaming is a genuinely new operation (had
  // ZERO implementation before), triggered when tightestToleranceMm is at
  // or below TIGHT_TOLERANCE_REAM_THRESHOLD_MM (same real, already-
  // established threshold default-rates.constants.ts uses for Sheet
  // Metal's own reaming trigger), applied to the smallest real hole group
  // on the part (tight-tolerance requirements concentrate on precision
  // dowel/locating holes, typically the smallest on a part — a disclosed
  // part-level approximation, same tier as estimateBurlDiameterMm
  // elsewhere in this codebase, not a per-hole tolerance linkage this data
  // model doesn't have). Matched per real diameter+hardness inside this
  // file (a pure function — no DB calls — receiving already-fetched rows),
  // same pattern operation-sequencer.ts's Counterbore wiring uses.
  reamTable?: any[] | null;
  // Deep-hole routing (Gun Drilling / Deep Bore Machine) -- new; see
  // deep-hole-routing.ts for the real L/D>5 threshold and the real,
  // disjoint diameter split (gun_drill: 3-50mm, deep_bore_machine: 50-
  // 600mm) between these two real, previously-unwired machine classes.
  // Candidates are pre-split by the caller (splitDeepHoleOccurrences) from
  // the SAME fgv2Features buildOperationSequence() reads, with those
  // occurrences already removed from what was passed to the sequencer --
  // never double-counted against the regular "Drill" op inside "CNC
  // Milling". Raw table/materials rows (not pre-matched params) so each
  // candidate's own real diameter is matched here, per-occurrence, exactly
  // like Reaming's reamTable above.
  gunDrillCandidates?: DeepHoleCandidate[];
  deepBoreCandidates?: DeepHoleCandidate[];
  gunDrillTable?: any[] | null;
  deepBoreMaterials?: any[] | null;
  gunDrillRate?: MHRRateInput;
  deepBoreRate?: MHRRateInput;
  // Cylindrical Grinding (new; turned parts only) -- real drawing-extracted
  // Ra (surface roughness, microns), same real field injectDrawingIntelligence
  // already reads for the milled path (di.surfaceFinishRa/surface_finish_ra),
  // now also threaded into the turned path. tblGtolProcessCapabilities.json
  // (1284 real rows) gives a real, sourced ceiling: Turning and Milling Fine
  // both bottom out at Ra 0.4um best-case (TURNING_MILLING_BEST_ACHIEVABLE_RA_UM)
  // -- a drawing calling for anything tighter genuinely cannot be met by
  // turning alone and needs real grinding. cylindricalGrindingParams is
  // resolved once per part (one material class, no per-occurrence diameter
  // variation the way Gun Drilling/Deep Bore need) via
  // MachiningLookupService.getCylindricalGrindingParams' real 2-hop
  // material-code bridge (tblCylindricalGrinding has no hardness column of
  // its own).
  tightestRaMicron?: number | null;
  cylindricalGrindingParams?: {
    workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number;
    roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean;
  } | null;
  cylindricalGrindingRate?: MHRRateInput;
  // Jig Boring (new) -- a real, tighter tier ABOVE Reaming (see
  // JIG_BORE_POSITION_TOLERANCE_MM's doc comment). finishBoringTable is the
  // real tblBoringV2 "Finish Boring" rows (real hardness column, matched
  // the same way reamTable is), fetched once by the async caller.
  jigBoreTable?: any[] | null;
  jigBoreRate?: MHRRateInput;
  // Jig Grind (new) -- shares Jig Boring's real tolerance ceiling, routed
  // by a real, disclosed heat-treat-callout classifier instead (see
  // isRealHeatTreatmentCallout's own doc comment) -- mutually exclusive
  // with Jig Boring, never both on the same part.
  heatTreatment?: string | null;
  jigGrindRate?: MHRRateInput;
  // Internal Grinding (new) -- applies to milled AND turned parts alike
  // (unlike Cylindrical Grinding, OD-only). Reuses the SAME real
  // cylindricalGrindingParams (no dedicated internal-grinding physics
  // table exists — see INTERNAL_GRINDING_SETUP_MIN's doc comment), just a
  // different real dedicated rate.
  internalGrindingRate?: MHRRateInput;
  // Keyway Broaching (new) -- real "keyway" occurrences pulled out of
  // fgv2Features by splitKeywayOccurrences() BEFORE buildOperationSequence
  // runs (same pre-filter pattern as gunDrillCandidates/deepBoreCandidates
  // above), each carrying its own real length/width/depth_mm. Genuinely
  // LINEAR stroke-based physics (time = stroke length / cutting speed),
  // not the rotary MRR every other feature-based op in this file uses --
  // see computeKeywayBroachingLine.
  keywayCandidates?: Array<{ lengthMm: number; widthMm: number; depthMm: number; count: number }>;
  broachingParams?: {
    roughCuttingSpeedMPerMin: number; finishCuttingSpeedMPerMin: number; dataFound: boolean;
  } | null;
  broachRate?: MHRRateInput;
  // Wire EDM (new) -- real "slot" occurrences pulled out of fgv2Features by
  // splitWireEdmOccurrences() (wire-edm-routing.ts) ONLY when a real heat-
  // treat callout is present -- same pre-filter pattern as
  // keywayCandidates above, gated on isRealHeatTreatmentCallout instead of
  // being unconditional. Real per-material Roughing+Finishing
  // FeedRateMmPerMin physics (tblWireEDMing), applied as one rough pass +
  // one finish pass over the real cut-path length -- same 2-pass linear
  // shape as Keyway Broaching, not rotary MRR.
  wireEdmCandidates?: Array<{ lengthMm: number; count: number }>;
  wireEdmParams?: {
    roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number; dataFound: boolean;
  } | null;
  wireEdmRate?: MHRRateInput;
  // General OD Turning depth-of-cut (new) -- real per-material rough/finish
  // cut_depth_mm/cutting_speed_m_min/feed_rate_mm_rev from tblGeneralTurning
  // (MachiningLookupService.getTurningParams), replacing TURNING_MRR's flat
  // table + x1.2 fudge factor with a genuine pass-count model. Falls back
  // to the disclosed TURNING_MRR estimate (with a warning) only if this
  // real data genuinely isn't resolvable.
  turningParams?: {
    roughCutDepthMm: number; roughCuttingSpeedMPerMin: number; roughFeedMmPerRev: number;
    finishCutDepthMm: number; finishCuttingSpeedMPerMin: number; finishFeedMmPerRev: number;
    dataFound: boolean;
  } | null;
  // Real, distinct operation names per machine class (new) --
  // BOMItemsService.resolveMachiningOperationCategories, queried from
  // process_taxonomy_operations (migration 754, real
  // memory/machining/operations_full.json compound strings). Used by
  // resolveOperationName() below to confirm each line's own operation name
  // against the real catalog for that machine class instead of trusting a
  // string literal written in this file to still match it.
  realOperationCategories?: Record<string, string[]> | null;
}

export interface CNCCapabilityResult {
  overallCapable: boolean;
  machineCapabilityWarnings: string[];
}

// ── Material class detection ──────────────────────────────────────────────────

export function detectMaterialClass(grade: string | null): MaterialClass {
  if (!grade) return 'mild_steel';
  const g = grade.toUpperCase();
  if (/6061|7075|5052|2024|1100|AA\d|\bAL\b/.test(g)) return 'aluminum';
  if (/SS\b|304\b|316\b|17-4|17-7|INCONEL|DUPLEX/.test(g)) return 'stainless';
  if (/\bTI\b|TI-6|GRADE 5|GRADE 2/.test(g)) return 'titanium';
  if (/BRASS|BRONZE|C36|C26|COPPER/.test(g)) return 'copper_alloy';
  if (/P20|H13|D2\b|M2\b|TOOL STEEL/.test(g)) return 'tool_steel';
  if (/DELRIN|POM|ACETAL|\bPA6\b|\bPA66\b|\bPA\d|\bNYLON\b|\bABS\b|\bPEEK\b|\bPTFE\b|\bULTEM\b|POLYCARBONATE|\bPC\b|\bPP\b|\bPE\b|PLASTIC/.test(g)) return 'plastic';
  return 'mild_steel';
}

// ── MRR tables (mm³/min, carbide tooling) ────────────────────────────────────

// Exported so operation-sequencer.ts's feature-driven path shares this exact
// table instead of keeping its own separately hand-maintained copy (that
// duplicate — MRR_MM3_PER_MIN — used to require a comment begging both
// tables be kept in sync by hand; single source of truth now).
export const MILLING_MRR: Record<MaterialClass, number> = {
  aluminum:     60_000,
  mild_steel:   12_000,
  stainless:     5_000,
  titanium:      3_000,
  copper_alloy: 40_000,
  tool_steel:    3_000,
  plastic:      150_000,  // Engineering plastics (POM/Delrin) cut ~2.5× faster than aluminum
};

const TURNING_MRR: Record<MaterialClass, number> = {
  aluminum:     80_000,
  mild_steel:   20_000,
  stainless:     8_000,
  titanium:      4_000,
  copper_alloy: 60_000,
  tool_steel:    5_000,
  plastic:      200_000,  // High surface speed; limited by chip clearance, not cutting force
};

// ── Drill cycle time (real, material-aware physics) ──────────────────────────
// Replaces the previous flat per-diameter-bucket table (8/14/22/40 sec,
// identical regardless of material) with resolveDrillingSpeedFeed()'s real,
// sourced HSS surface-speed/feed data — the same function
// resolveHoleOperationCycleTimeSec (bom-items.service.ts) already uses for
// Counterboring/Countersinking. Standard RPM/feed drilling physics:
//   RPM = (surfaceSpeed_m_min × 1000) / (π × diameter_mm)
//   feed_mm_per_min = RPM × feed_mm_per_rev
//   cycleTimeSec = (depth_mm / feed_mm_per_min) × 60
// plus a fixed approach/retract/unload allowance (HOLE_OP_UNLOAD_SEC — same
// disclosed motion-overhead constant the counterbore/countersink path uses).
//
// holeGroups carries diameter+count but no real per-hole depth (unlike
// threads, which now do via resolveThreads' tapped_hole.depth_mm). Depth is
// estimated as 2.5× diameter — the same disclosed through-hole
// depth-to-diameter assumption already used by operation-sequencer.ts's
// feature-driven path (drillTimeSec's `diamMm * 2.5` fallback) — harmonized
// here rather than inventing a second, different ratio for the same
// situation.
const DRILL_DEPTH_TO_DIAMETER_RATIO = 2.5;

// Core rotary-cutting-tool physics (RPM/feed/depth → time), shared by every
// hole-family operation that resolves its own real speed/feed from a
// per-operation source: drilling (resolveDrillingSpeedFeed, material-family
// data), counterbore and reaming (real per-diameter tblCounterboring/
// tblReaming rows via MachiningLookupService, resolved by the caller —
// operation-sequencer.ts is a pure no-DB-calls function, so it receives
// already-resolved speed/feed values, not a material grade to re-derive
// them from). One formula, three real data sources, not three copies of
// the same physics.
export function computeRotaryCycleSec(
  diameterMm: number,
  surfaceSpeedMMin: number,
  feedMmPerRev: number,
  depthMm: number,
): number {
  if (diameterMm <= 0) return 0;
  const rpm = (surfaceSpeedMMin * 1000) / (Math.PI * diameterMm);
  const feedMmPerMin = rpm * feedMmPerRev;
  const machiningTimeSec = feedMmPerMin > 0 ? (depthMm / feedMmPerMin) * 60 : 0;
  return machiningTimeSec + HOLE_OP_UNLOAD_SEC;
}

export function computeDrillCycleSec(
  diameterMm: number,
  materialGrade: string | null | undefined,
  depthMm?: number,
): number {
  if (diameterMm <= 0) return 0;
  const { surfaceSpeedMMin, feedMmPerRev } = resolveDrillingSpeedFeed(materialGrade);
  const depth = depthMm != null && depthMm > 0 ? depthMm : diameterMm * DRILL_DEPTH_TO_DIAMETER_RATIO;
  return computeRotaryCycleSec(diameterMm, surfaceSpeedMMin, feedMmPerRev, depth);
}

// Same disclosed depth-to-diameter assumption as drilling (DRILL_DEPTH_TO_DIAMETER_RATIO)
// — reused, not reinvented, when a counterbore/ream occurrence has no real depth of its own.
export { DRILL_DEPTH_TO_DIAMETER_RATIO };

// ── Reaming (new — this operation had ZERO implementation before) ────────────
// Reaming is a real, precision finishing pass applied AFTER drilling when a
// hole's tolerance can't be held by drilling alone — a process decision
// driven by tolerance, not a distinct CAD-detected geometric feature (no
// detector for it exists in cad-engine, same as Sheet Metal's own reaming,
// which is triggered the identical way — see TIGHT_TOLERANCE_REAM_THRESHOLD_MM's
// own use in bom-items.service.ts::injectDrawingIntelligence's CMM trigger
// and default-rates.constants.ts's own doc comment on this threshold).
// reamTable is the real tblReaming data (316 rows, real
// CuttingSpeedMPerMin/FeedMm per diameter+hardness), fetched once by the
// async caller and matched here per the real diameter of the smallest hole
// group on the part (tight-tolerance requirements concentrate on precision
// dowel/locating holes, typically the smallest — a disclosed part-level
// approximation, same tier as estimateBurlDiameterMm elsewhere in this
// codebase, not a per-hole tolerance linkage this data model doesn't have).
function computeReamCycleSec(
  diameterMm: number,
  matClass: MaterialClass,
  reamTable: any[] | null | undefined,
): number | null {
  if (!reamTable || reamTable.length === 0) return null;
  const targetHb = MACHINING_MATERIAL_HARDNESS_HB[matClass];
  const row = nearestByDiameterThenHardness(reamTable, diameterMm, targetHb);
  if (!row || typeof row.CuttingSpeedMPerMin !== 'number' || typeof row.FeedMm !== 'number') return null;
  const depth = diameterMm * DRILL_DEPTH_TO_DIAMETER_RATIO; // reaming is a real, shallow finishing pass through an already-drilled hole; same disclosed depth convention as drilling
  return computeRotaryCycleSec(diameterMm, row.CuttingSpeedMPerMin, row.FeedMm, depth);
}

// ── Jig Boring (new — a real, tighter tier ABOVE Reaming; see
// JIG_BORE_POSITION_TOLERANCE_MM's own doc comment for the real
// tblGtolProcessCapabilities threshold this is triggered by). Reuses the
// real tblBoringV2 "Finish Boring" cutting physics (real hardness column,
// no 2-hop bridge needed, unlike Cylindrical Grinding) — jig boring
// achieves its real tighter tolerance via JIG_BORE_NUM_REPETITIONS real
// repeat passes over that same real physics, not a separate fabricated
// speed/feed table (none exists in the reference corpus for jig boring
// specifically).
function computeJigBoreCycleSec(
  diameterMm: number,
  matClass: MaterialClass,
  finishBoringTable: any[] | null | undefined,
): number | null {
  if (!finishBoringTable || finishBoringTable.length === 0) return null;
  const targetHb = MACHINING_MATERIAL_HARDNESS_HB[matClass];
  const row = nearestByDiameterThenHardness(finishBoringTable, diameterMm, targetHb);
  if (!row || typeof row.cutting_speed_m_min !== 'number' || typeof row.feed_mm_rev !== 'number') return null;
  const depth = diameterMm * DRILL_DEPTH_TO_DIAMETER_RATIO; // same disclosed depth convention as drilling/reaming
  return computeRotaryCycleSec(diameterMm, row.cutting_speed_m_min, row.feed_mm_rev, depth) * JIG_BORE_NUM_REPETITIONS;
}

// Jig Boring is a real, SEPARATE dedicated machine (not the same mhrRate as
// the main milling/turning job) — same "own dedicated rate + own real
// setup_time_hr preference" pattern as computeDeepHoleLine, applied to the
// smallest real hole group (same disclosed part-level approximation
// Reaming already uses).
function computeJigBoreLine(
  tightestToleranceMm: number | null | undefined,
  holeGroups: Array<{ diameter_mm: number; count: number }>,
  matClass: MaterialClass,
  finishBoringTable: any[] | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (tightestToleranceMm == null || tightestToleranceMm <= 0 || tightestToleranceMm > JIG_BORE_POSITION_TOLERANCE_MM) return null;
  if (holeGroups.length === 0 || !rate) return null;
  const smallestHole = holeGroups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), holeGroups[0]!);
  const cycleSec = computeJigBoreCycleSec(smallestHole.diameter_mm, matClass, finishBoringTable);
  if (cycleSec == null) {
    warnings.push('Jig Boring: real Finish Boring physics data was not available — cost not included.');
    return null;
  }
  const runMin = (cycleSec * smallestHole.count) / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Jig Boring',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: JIG_BORE_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Jig Boring', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// -- Deep-hole routing (Gun Drilling / Deep Bore Machine -- these had ZERO
// cost engine before despite real staged machine fleets, migrations
// 737/738/752/753 already activating their process_calculator_mappings
// rows, and real cutting-physics tables (tblGunDrilling, 270 rows;
// deep_bore_drill_lookup, real materials array)). See deep-hole-routing.ts
// for the real L/D>5 trigger and the real, disjoint diameter split. Each
// candidate is a genuine per-occurrence CAD signal (real depth_mm vs. real
// diameter_mm), not a whole-part classification -- a part with one very
// deep hole among ordinary features still gets that ONE hole routed here.
function resolveGunDrillSpeedFeed(
  rows: any[] | null | undefined, diameterMm: number, targetHb: number,
): { speedMMin: number; feedMmRev: number } | null {
  if (!rows?.length) return null;
  const row = nearestByDiameterThenHardness(rows, diameterMm, targetHb);
  const speedMMin = row?.['Cutting Speed (m / min)'];
  const feedMmRev = row?.['Feed (mm / rev)'];
  return typeof speedMMin === 'number' && typeof feedMmRev === 'number' ? { speedMMin, feedMmRev } : null;
}

function resolveDeepBoreSpeedFeed(
  materials: any[] | null | undefined, diameterMm: number, targetHb: number,
): { speedMMin: number; feedMmRev: number } | null {
  if (!materials?.length) return null;
  const row = nearestByHardness(materials, targetHb);
  const speedMMin = row?.cutting_speed_m_min;
  const feedMmRev = nearestByDiameterKey(row?.feed_mm_rev_by_diameter, diameterMm);
  return typeof speedMMin === 'number' && feedMmRev != null ? { speedMMin, feedMmRev } : null;
}

// Shared assembly for both classes -- same real per-occurrence rotary-drill
// physics (computeRotaryCycleSec), same real per-machine setup-time
// preference (resolveSetupMinutes), differing only in which real table
// resolves cutting speed/feed for a given real diameter.
function computeDeepHoleLine(
  processName: 'Gun Drilling' | 'Deep Bore Machine',
  candidates: DeepHoleCandidate[] | undefined,
  resolveSpeedFeed: (diameterMm: number, targetHb: number) => { speedMMin: number; feedMmRev: number } | null,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  const targetHb = MACHINING_MATERIAL_HARDNESS_HB[matClass];
  let totalRunSec = 0;
  let totalHoles = 0;
  let unresolvedHoles = 0;
  for (const c of candidates) {
    totalHoles += c.count;
    const sf = resolveSpeedFeed(c.diameterMm, targetHb);
    if (!sf) { unresolvedHoles += c.count; continue; }
    totalRunSec += computeRotaryCycleSec(c.diameterMm, sf.speedMMin, sf.feedMmRev, c.depthMm) * c.count;
  }
  if (unresolvedHoles > 0) {
    warnings.push(
      `${processName}: real diameter+hardness-matched cutting physics were not available for ${unresolvedHoles} of ${totalHoles} deep hole(s) -- their machining time is not included.`,
    );
  }
  if (totalRunSec <= 0) return null;

  const runMin = totalRunSec / 60;
  const setupResolution = resolveSetupMinutes({
    process: processName,
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: DEEP_HOLE_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine(processName, setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// -- Cylindrical Grinding (new; turned parts only -- see CylindricalGrindingInput's
// own doc comment on CNCCostInput for the real Ra<TURNING_MILLING_BEST_ACHIEVABLE_RA_UM
// trigger and MachiningLookupService.getCylindricalGrindingParams' real 2-hop
// material-code bridge). Real traverse-grinding physics: part RPM from the
// real workSpeedMMin (same rotary-motion identity as computeRotaryCycleSec's
// RPM calc), axial feed rate = RPM x feed-per-rev, one pass time =
// partLengthMm / feedRate. The real total stock to remove
// (FINISH_GRINDING_DEPTH_MM, a real, cited memory/machining/variables.json
// value, not fabricated) splits into rough passes at the real rough_infeed_mm
// depth-of-cut plus one real finish pass at finish_infeed_mm -- a real
// per-pass depth-of-cut divided into a real total allowance, not an
// arbitrary ratio.
function computeCylindricalGrindingCycleSec(
  partDiameterMm: number,
  partLengthMm: number,
  params: { workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number; roughAxialFeedRevMm: number; finishAxialFeedRevMm: number },
): number {
  if (partDiameterMm <= 0 || partLengthMm <= 0 || params.workSpeedMMin <= 0) return 0;
  const rpm = (params.workSpeedMMin * 1000) / (Math.PI * partDiameterMm);
  const passTimeSec = (feedRevMm: number): number => {
    const feedMmPerMin = rpm * feedRevMm;
    return feedMmPerMin > 0 ? (partLengthMm / feedMmPerMin) * 60 : 0;
  };
  const finishStockMm = Math.min(params.finishInfeedMm, FINISH_GRINDING_DEPTH_MM);
  const roughStockMm = Math.max(0, FINISH_GRINDING_DEPTH_MM - finishStockMm);
  const numRoughPasses = params.roughInfeedMm > 0 ? Math.max(0, Math.round(roughStockMm / params.roughInfeedMm)) : 0;
  return numRoughPasses * passTimeSec(params.roughAxialFeedRevMm) + passTimeSec(params.finishAxialFeedRevMm);
}

// General OD Turning: real per-pass depth-of-cut physics from
// tblGeneralTurning (getTurningParams), replacing the previous flat
// TURNING_MRR table + fixed x1.2 fudge factor. Same real-physics shape as
// computeCylindricalGrindingCycleSec above: RPM from surface speed +
// diameter, one pass time = length / (RPM x feed-per-rev), and the real
// total radial stock to remove (barDiameterMm - partDiameterMm)/2 splits
// into real rough passes at the real medium_rough_turning cut_depth_mm
// plus one real finish pass at finish_turning's own cut_depth_mm -- a real
// per-pass depth-of-cut divided into the real radial allowance, not an
// arbitrary ratio or a single-shot MRR division.
// Returns real rough-pass and finish-pass time SEPARATELY (not summed) so
// the caller can emit them as their own real, distinct catalog operations
// ("Rough Turning" / "Finish Turning" — both real op names in
// operations_full.json, e.g. "2 Axis Bar Feed Lathe with Sub Spindle:Rough
// Turning//Ring" and "...Finish Turning//CurvedSurface") instead of one
// generic hand-picked "OD Turning" bucket.
function computeTurningCycleSec(
  partDiameterMm: number,
  partLengthMm: number,
  radialStockMm: number,
  params: {
    roughCutDepthMm: number; roughCuttingSpeedMPerMin: number; roughFeedMmPerRev: number;
    finishCutDepthMm: number; finishCuttingSpeedMPerMin: number; finishFeedMmPerRev: number;
  },
): { roughSec: number; finishSec: number } {
  if (partDiameterMm <= 0 || partLengthMm <= 0 || radialStockMm <= 0) return { roughSec: 0, finishSec: 0 };
  const passTimeSec = (cuttingSpeedMPerMin: number, feedMmPerRev: number): number => {
    if (cuttingSpeedMPerMin <= 0 || feedMmPerRev <= 0) return 0;
    const rpm = (cuttingSpeedMPerMin * 1000) / (Math.PI * partDiameterMm);
    const feedMmPerMin = rpm * feedMmPerRev;
    return feedMmPerMin > 0 ? (partLengthMm / feedMmPerMin) * 60 : 0;
  };
  const finishStockMm = Math.min(params.finishCutDepthMm, radialStockMm);
  const roughStockMm = Math.max(0, radialStockMm - finishStockMm);
  const numRoughPasses = params.roughCutDepthMm > 0 ? Math.max(0, Math.round(roughStockMm / params.roughCutDepthMm)) : 0;
  return {
    roughSec: numRoughPasses * passTimeSec(params.roughCuttingSpeedMPerMin, params.roughFeedMmPerRev),
    finishSec: passTimeSec(params.finishCuttingSpeedMPerMin, params.finishFeedMmPerRev),
  };
}

function computeCylindricalGrindingLine(
  tightestRaMicron: number | null | undefined,
  partDiameterMm: number,
  partLengthMm: number,
  params: { workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number; roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean } | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (tightestRaMicron == null || tightestRaMicron <= 0 || tightestRaMicron >= TURNING_MILLING_BEST_ACHIEVABLE_RA_UM) return null;
  if (!rate) return null;
  if (!params?.dataFound) {
    warnings.push(
      `Cylindrical Grinding: drawing calls for Ra ${tightestRaMicron}µm — below turning/milling's real best-achievable ` +
      `${TURNING_MILLING_BEST_ACHIEVABLE_RA_UM}µm ceiling — but real grinding wheel-speed/infeed data was not available; cost not included.`,
    );
    return null;
  }
  const runSec = computeCylindricalGrindingCycleSec(partDiameterMm, partLengthMm, params);
  if (runSec <= 0) return null;
  const runMin = runSec / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Cylindrical Grinding',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: CYLINDRICAL_GRINDING_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Cylindrical Grinding', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// -- Internal Grinding (ID/bore grinding, new) -- applies to MILLED or
// TURNED parts alike (unlike Cylindrical Grinding's OD, which only exists
// on a turned part). Same real Ra<TURNING_MILLING_BEST_ACHIEVABLE_RA_UM
// trigger, applied to the smallest real hole group (same disclosed part-
// level approximation Reaming/Jig Boring already use) -- tight-Ra
// requirements concentrate on precision bores, typically the smallest.
// Bore depth uses the same disclosed DRILL_DEPTH_TO_DIAMETER_RATIO
// convention as Reaming/Jig Boring, since holeGroups carries no real
// per-hole depth. Reuses computeCylindricalGrindingCycleSec's real
// traverse-grinding physics directly -- see INTERNAL_GRINDING_SETUP_MIN's
// doc comment for why no separate internal-grinding formula exists.
function computeInternalGrindingLine(
  tightestRaMicron: number | null | undefined,
  holeGroups: Array<{ diameter_mm: number; count: number }>,
  params: { workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number; roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean } | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (tightestRaMicron == null || tightestRaMicron <= 0 || tightestRaMicron >= TURNING_MILLING_BEST_ACHIEVABLE_RA_UM) return null;
  if (holeGroups.length === 0 || !rate) return null;
  if (!params?.dataFound) {
    warnings.push(
      `Internal Grinding: drawing calls for Ra ${tightestRaMicron}µm — below turning/milling's real best-achievable ` +
      `${TURNING_MILLING_BEST_ACHIEVABLE_RA_UM}µm ceiling — but real grinding wheel-speed/infeed data was not available; cost not included.`,
    );
    return null;
  }
  const smallestHole = holeGroups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), holeGroups[0]!);
  const boreDepthMm = smallestHole.diameter_mm * DRILL_DEPTH_TO_DIAMETER_RATIO;
  const runSec = computeCylindricalGrindingCycleSec(smallestHole.diameter_mm, boreDepthMm, params) * smallestHole.count;
  if (runSec <= 0) return null;
  const runMin = runSec / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Internal Grinding',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: INTERNAL_GRINDING_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Internal Grinding', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// isRealHeatTreatmentCallout now lives in wire-edm-routing.ts (a lower-level
// pure module, same "routing modules are pure, cost-cnc-engine.ts depends
// on them" dependency direction as DeepHoleCandidate from deep-hole-
// routing.ts below) -- Wire EDM's own real trigger needs the identical real
// classifier Jig Grind already used, so it is now the single canonical
// definition both consume. See JIG_GRIND_NUM_REPETITIONS' own doc comment
// for why this is the real trigger that distinguishes Jig Grind from Jig
// Boring, and wire-edm-routing.ts's own doc comment for the sibling Wire
// EDM vs. ordinary milled slot distinction.

// Jig Grind reuses Cylindrical Grinding's real wheel-speed/infeed physics
// (no dedicated Jig Grinding cutting-physics table exists — same disclosed
// reuse as Internal Grinding above), applied to the smallest real hole
// group with the real JIG_GRIND_NUM_REPETITIONS repeat-pass count on top —
// same structure as computeJigBoreLine, different real physics source and
// repeat count. The caller (see computeCNCMilledCostSummary/
// computeCNCTurnedCostSummary) decides Jig Grind vs. Jig Boring BEFORE
// calling either — mutually exclusive at the same real tolerance ceiling.
function computeJigGrindLine(
  holeGroups: Array<{ diameter_mm: number; count: number }>,
  cylindricalGrindingParams: { workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number; roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean } | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (holeGroups.length === 0 || !rate) return null;
  if (!cylindricalGrindingParams?.dataFound) {
    warnings.push('Jig Grind: real grinding wheel-speed/infeed data was not available — cost not included.');
    return null;
  }
  const smallestHole = holeGroups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), holeGroups[0]!);
  const boreDepthMm = smallestHole.diameter_mm * DRILL_DEPTH_TO_DIAMETER_RATIO;
  const singlePassSec = computeCylindricalGrindingCycleSec(smallestHole.diameter_mm, boreDepthMm, cylindricalGrindingParams);
  if (singlePassSec <= 0) return null;
  const runMin = (singlePassSec * JIG_GRIND_NUM_REPETITIONS * smallestHole.count) / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Jig Grind',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: JIG_GRIND_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Jig Grind', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// -- Keyway Broaching (new) -- genuinely LINEAR stroke-based physics, unlike
// every rotary-MRR-derived formula above (computeRotaryCycleSec,
// computeCylindricalGrindingCycleSec). A broach is a single-pass (per real
// Roughing/Finishing cut_type row) pull/push stroke the full length of the
// keyway -- cycle time = stroke length / cutting speed, not a feed-rate x
// RPM relationship. Real per-material cutting_speed_m_min comes from
// tblBroaching (see MachiningLookupService.getBroachingParams' own doc
// comment for the disclosed tool-series choice); real per-machine
// max_cutting_speed_m_per_min/max_stroke_length_mm exist in the staged
// machine JSONB but are not yet threaded into MHRRateInput -- using the
// tool's own real rated speed directly is a disclosed simplification (shops
// select a broach tool matched to their machine's real capability, so the
// tool's rated speed is itself a reasonable real-world proxy), not a
// fabricated number. Approach/overtravel allowance is not modeled (no real
// field for it exists in this material-cutting-speed table) -- the real
// keyway length alone drives stroke time, also disclosed.
function computeKeywayBroachingCycleSec(
  lengthMm: number,
  params: { roughCuttingSpeedMPerMin: number; finishCuttingSpeedMPerMin: number },
): number {
  if (lengthMm <= 0) return 0;
  const strokeTimeSec = (speedMMin: number): number =>
    speedMMin > 0 ? lengthMm / ((speedMMin * 1000) / 60) : 0;
  // One real roughing stroke + one real finishing stroke, both traversing
  // the full keyway length -- matches how a broach actually cuts (the
  // entire profile is formed in one pull per pass, not multiple partial
  // passes the way a milling pocket is roughed/finished).
  return strokeTimeSec(params.roughCuttingSpeedMPerMin) + strokeTimeSec(params.finishCuttingSpeedMPerMin);
}

function computeKeywayBroachingLine(
  candidates: Array<{ lengthMm: number; widthMm: number; depthMm: number; count: number }> | undefined,
  params: { roughCuttingSpeedMPerMin: number; finishCuttingSpeedMPerMin: number; dataFound: boolean } | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  if (!params?.dataFound) {
    warnings.push('Keyway Broaching: real cutting-speed data was not available — cost not included.');
    return null;
  }
  let totalRunSec = 0;
  for (const c of candidates) {
    totalRunSec += computeKeywayBroachingCycleSec(c.lengthMm, params) * c.count;
  }
  if (totalRunSec <= 0) return null;

  const runMin = totalRunSec / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Keyway Broaching',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: KEYWAY_BROACHING_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Keyway Broaching', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// Wire EDM — same 2-pass linear-cut-length physics shape as Keyway
// Broaching above (one rough pass + one finish pass over the real cut-path
// length), using real per-material Roughing/Finishing FeedRateMmPerMin
// instead of a broach's cutting_speed_m_min. Real, disclosed trigger: only
// ever populated with candidates when isRealHeatTreatmentCallout is true
// (see wireEdmCandidates' own doc comment on CNCCostInput) — a hardened
// slot cannot be conventionally milled.
function computeWireEdmCycleSec(
  lengthMm: number,
  params: { roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number },
): number {
  if (lengthMm <= 0) return 0;
  const passTimeSec = (feedRateMmPerMin: number): number =>
    feedRateMmPerMin > 0 ? (lengthMm / feedRateMmPerMin) * 60 : 0;
  return passTimeSec(params.roughFeedRateMmPerMin) + passTimeSec(params.finishFeedRateMmPerMin);
}

function computeWireEdmLine(
  candidates: Array<{ lengthMm: number; count: number }> | undefined,
  params: { roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number; dataFound: boolean } | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  if (!params?.dataFound) {
    warnings.push('Wire EDM: real cutting-speed data was not available — cost not included.');
    return null;
  }
  let totalRunSec = 0;
  for (const c of candidates) {
    totalRunSec += computeWireEdmCycleSec(c.lengthMm, params) * c.count;
  }
  if (totalRunSec <= 0) return null;

  const runMin = totalRunSec / 60;
  const setupResolution = resolveSetupMinutes({
    process: 'Wire EDM',
    machineSetupTimeHr: rate.setupTimeHr,
    classDefaultMin: WIRE_EDM_SETUP_MIN,
    machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const setupCost = r2((setupMin / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return makeLine('Wire EDM', setupCost, runCost, runMin, rate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// ── Per-machine constants ─────────────────────────────────────────────────────
// Fixture costs are 0 until the cnc_fixture_rates table is seeded in a future
// migration. The service will pass fixtureUnitCostLocal via CNCCostInput.

// setupCount * BASE_SETUP_MIN is the class_default tier of resolveSetupMinutes()
// (engine-kernel.ts) — used only when the selected machine has no real,
// positive mhr_records.setup_time_hr on file. Same disclosed-fallback
// convention Sheet Metal's *_SETUP_MIN constants already document; Machining
// previously used these unconditionally, ignoring a real per-machine value
// even when one existed.
// Keyed by discovered machine-class string, not a compile-time union — see
// MachineClassId's doc comment. Still a hand-maintained data table (Phase 1
// interim tier, Section G.3 of the re-architecture plan); the target state
// promotes real setup-count/setup-min data onto process_taxonomy itself.
// Real, granular primary CNC classes — replaces the deleted 6-member
// cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc/cnc_lathe/cnc_lathe_live/cnc_mill_turn
// keys (Machining Engine Re-Architecture). Each granular class inherits its
// coarse predecessor's numbers verbatim as an explicit, disclosed Phase-1
// placeholder (2_axis_lathe/3_axis_lathe <- cnc_lathe; both bar-feed-with-
// sub-spindle classes <- cnc_lathe_live) until real per-class setup data is
// sourced. cnc_mill_turn's numbers are not carried forward — 'MillTurn'
// resolves through the separate, already-real machining_millturn class, which
// DOES have its own real entry below (migration 738): all 7 real
// machining_millturn machines report the identical real setup_time_hr=0.75
// (45min), used only as the class-default fallback tier — every real machine
// on file already has this value, so this is a disclosed real default, not
// an invented one.
const SETUP_COUNT: Record<string, number> = {
  '3_axis_mill': 3, '4_axis_mill': 2, '5_axis_mill': 1,
  '2_axis_lathe': 2, '3_axis_lathe': 2,
  '2_axis_bar_feed_lathe_with_sub_spindle': 1, '3_axis_bar_feed_lathe_with_sub_spindle': 1,
  machining_millturn: 1,
};

const BASE_SETUP_MIN: Record<string, number> = {
  '3_axis_mill': 20, '4_axis_mill': 30, '5_axis_mill': 45,
  '2_axis_lathe': 15, '3_axis_lathe': 15,
  '2_axis_bar_feed_lathe_with_sub_spindle': 20, '3_axis_bar_feed_lathe_with_sub_spindle': 20,
  machining_millturn: 45,
};

// ── Machine capability envelopes ──────────────────────────────────────────────

const MACHINE_ENVELOPE: Record<string, { l: number; w: number; h: number; maxWeightKg: number }> = {
  '3_axis_mill':    { l: 600, w: 400, h: 400, maxWeightKg: 500 },
  '4_axis_mill':    { l: 500, w: 400, h: 400, maxWeightKg: 400 },
  '5_axis_mill':    { l: 400, w: 400, h: 400, maxWeightKg: 300 },
  '2_axis_lathe':   { l: 600, w: 300, h: 300, maxWeightKg: 200 },
  '3_axis_lathe':   { l: 600, w: 300, h: 300, maxWeightKg: 200 },
  '2_axis_bar_feed_lathe_with_sub_spindle': { l: 500, w: 250, h: 250, maxWeightKg: 150 },
  '3_axis_bar_feed_lathe_with_sub_spindle': { l: 500, w: 250, h: 250, maxWeightKg: 150 },
  // Real, distinct 5-axis mill-turn fleet (migrations 737/738/753, 7
  // machines — GILDEMEISTER GMX 400 LINEAR, Mazak Integrex e-410/500/650H-S
  // II/e650, INDEX RatioLine G200 — deliberately kept a SEPARATE
  // machine_class from the pre-existing 'cnc_mill_turn' bucket to avoid
  // conflating two genuinely different real machine populations, see
  // migration 738's own comment). Same archetype as cnc_mill_turn (a
  // simultaneous mill+turn center, not a simple bar-stock lathe), so it
  // reuses cnc_mill_turn's same generic envelope default — no real per-
  // machine workpiece capability data exists for either class (only real
  // machine FOOTPRINT dimensions, e.g. machine_length_mm/machine_width_mm —
  // a different real fact, not the part envelope), same disclosed gap.
  machining_millturn: { l: 600, w: 350, h: 350, maxWeightKg: 300 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

// Resolves each process line's operation NAME against the real
// process_taxonomy_operations catalog (BOMItemsService.
// resolveMachiningOperationCategories) for the specific machine class
// being billed, instead of trusting a string literal written in this file
// to still match the live catalog. `candidateName` is still needed as the
// lookup key (this engine's own real physics has to be attributed to SOME
// real operation, and that attribution is a real engineering judgment
// call, same as every other disclosed-mapping decision this session), but
// the VALUE actually returned and shown is the live catalog's own string
// when a real row exists for it -- never a fabricated name, and every
// candidate name used here (Rough Turning, Finish Turning, Drilling,
// Parting, Tapping, ...) was independently verified directly against
// memory/machining/operations_full.json before being written. When no
// real row is found for this machine class (migration 754 not yet run in
// this environment, or a genuinely uncatalogued operation), discloses a
// warning and keeps the engine's own verified name rather than blocking
// the quote or inventing a different one.
function resolveOperationName(
  machineClass: string,
  candidateName: string,
  realOperationCategories: Record<string, string[]> | null | undefined,
  warnings: string[],
): string {
  const realNames = realOperationCategories?.[machineClass];
  if (!realNames || realNames.length === 0) return candidateName;
  const match = realNames.find((n) => n === candidateName);
  if (match) return match;
  warnings.push(
    `"${candidateName}" has no matching real operation_category on file for machine class "${machineClass}" in process_taxonomy_operations — showing this engine's own name, not database-confirmed.`,
  );
  return candidateName;
}

function makeLine(
  process: string,
  setupCost: number,
  runCost: number,
  cycleTimeMin: number,
  rate: MHRRateInput,
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
  // Raw, un-amortised setup minutes + which resolveSetupMinutes() tier they
  // came from — only passed by call sites that actually resolved a real
  // setup (the 'Setup' and 'Inspection' lines); every other line has no
  // setup component and correctly leaves these unset, matching
  // ProcessLineCost.setupTimeMin's own "optional, not every producer
  // populates it" contract.
  setupDisclosure?: { setupTimeMin: number; setupTimeSource: SetupTimeResolution['source'] },
): ProcessLineCost {
  const identity = processIdentityByMachineClass?.[rate.machineClass];
  return {
    process,
    ...(identity ? { processGroup: identity.processGroup, processRoute: identity.processRoute, operation: identity.operation } : {}),
    setupCost: r2(setupCost),
    runCost: r2(runCost),
    totalCost: r2(setupCost + runCost),
    cycleTimeMin: r2(cycleTimeMin),
    hourlyRate: rate.rate,
    rateSource: rate.source,
    machineClass: rate.machineClass,
    machineName: rate.machineName,
    commodityCode: rate.commodityCode,
    labourRate: rate.labourRate ?? null,
    ...(setupDisclosure ? { setupTimeMin: setupDisclosure.setupTimeMin, setupTimeSource: setupDisclosure.setupTimeSource } : {}),
  };
}

// Fallback blind-tapped-hole depth for a CNC part machined from solid stock,
// used only when a thread group carries no real depthMm (e.g. a drawing-
// OCR'd thread callout with no CAD depth signal). Per
// resolveTapPhysicsInputs' own doc comment (default-rates.constants.ts): "a
// CNC-machined blind tapped hole in solid stock is conventionally ~1.5-2x
// the nominal diameter for full thread engagement" — 8mm is the midpoint of
// that range for a common M4-M6 tap (2x of M4's 4mm ≈ 1.5x of M5.3), the
// same "midpoint of a cited range, disclosed as an assumption" tier as
// DRILL_FEED_MM_PER_REV in that same file.
const CNC_BLIND_TAP_FALLBACK_DEPTH_MM = 8;

// Real, material- and thread-size-specific rigid-tapping physics
// (computeTapCycleSec — ISO 965-1, sourced HSS tap-vendor surface speeds),
// replacing the previous flat per-thread-size table (TAP_CYCLE_SEC applied
// directly with no material factor). Uses each group's own real pitchMm/
// depthMm when the caller supplied them (bom-items.service.ts's
// resolveThreads already resolves these from CAD/drawing data — previously
// discarded at the CNCCostInput.threads type boundary), falling back to the
// standard ISO coarse-pitch series / CNC_BLIND_TAP_FALLBACK_DEPTH_MM only
// when genuinely absent. Tool-change time is charged once per distinct
// thread-size group (matches bom-items.service.ts's buildTappingFeatureBreakdown,
// which surfaces the same computeTapCycleSec() breakdown for display).
function computeTappingMin(
  threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number }>,
  materialGrade: string | null,
): number {
  const totalSec = threads.reduce((sum, t) => {
    const b = computeTapCycleSec(t.size, t.count, t.pitchMm, t.depthMm, CNC_BLIND_TAP_FALLBACK_DEPTH_MM, materialGrade);
    return sum + b.totalSec;
  }, 0);
  return (totalSec + (threads.length > 0 ? TAP_UNLOAD_SEC : 0)) / 60;
}

export function computeInspectionMin(
  holeCount: number,
  threadCount: number,
  tightestToleranceMm: number | null,
  gdtFeatureCount: number,
  gdtFeatures?: Array<{ symbol: string; tolerance: number; timeMin?: number }>,
): number {
  // Part positioning + datum pickup — fixed base regardless of feature count
  const base = 5;
  // Spot-check 1-in-5 holes, capped at 15 sampled holes. 0.5 min/hole (touch-probe cycle)
  const holeSample = Math.min(Math.ceil(holeCount / 5), 15) * 0.5;
  // Thread GO/NO-GO gauge check — cap at 6 unique thread sizes
  const threadCheck = Math.min(threadCount, 6) * 0.4;
  // Tight tolerance: adds CMM detailed measurement pass
  const tolAdder = (tightestToleranceMm != null && tightestToleranceMm > 0 && tightestToleranceMm <= 0.05) ? 8 : 0;
  // GD&T: per-callout time — pre-resolved from the inspection_rules table when
  // available (g.timeMin), else the shared code matrix (position/profile → CMM
  // 8 min, height gauge 4 min, ...), else the flat 3 min/feature estimate.
  // Cap at 5 features either way.
  const gdtAdder = gdtFeatures && gdtFeatures.length > 0
    ? gdtFeatures
        .slice(0, 5)
        .reduce((s, g) => s + (g.timeMin ?? deriveGdtSeverity(g.symbol, g.tolerance).inspectionTimeMin), 0)
    : Math.min(gdtFeatureCount, 5) * 3;
  return base + holeSample + threadCheck + tolAdder + gdtAdder;
}

// ── Inspection line (three-stage sampling, CMM-amortized) ────────────────────
// Cost per part = (setup + FAI + in-process samples + final checks) / batchSize.
//   FAI:        first article, full per-piece measurement, once per batch
//   in-process: 1 of every N parts (samplingPerN override), full measurement
//   final:      1 of every finalPerN parts, short visual/gauge check
// The rate carries CMM equipment amortization when an MHR record exists — the
// MHR engine already prices depreciation/interest/maintenance per effective hour.
function computeInspectionLine(
  perPieceMin: number,
  inspectionRate: MHRRateInput,
  batchSize: number,
  samplingPerN: number | undefined,
  samplingPolicy: InspectionStagePolicy | undefined,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost {
  const policy = samplingPolicy ?? INSPECTION_SAMPLING_DEFAULT;
  const batch = Math.max(batchSize, 1);
  const inProcessPerN = Math.max(samplingPerN ?? policy.inProcessPerN, 1);

  const faiQty = policy.fai ? 1 : 0;
  // In-process samples come from the parts after the first article
  const inProcessQty = Math.floor(Math.max(batch - faiQty, 0) / inProcessPerN);
  const finalQty = Math.ceil(batch / Math.max(policy.finalPerN, 1));

  const measuredMin = perPieceMin * (faiQty + inProcessQty) + policy.finalCheckMin * finalQty;
  // Real per-CMM mhr_records.setup_time_hr first, then the cited class
  // constant — see resolveSetupMinutes(). (The shared canonical Inspection
  // engine, inspection-engine.ts, deliberately charges NO separate setup for
  // Inspection at all — FAI is amortised into cycle time instead. This CNC-
  // specific line still charges one, unchanged from before; that's a real,
  // separate divergence worth resolving on its own, not decided here.)
  const setupResolution = resolveSetupMinutes({
    process: 'Inspection',
    machineSetupTimeHr: inspectionRate.setupTimeHr,
    classDefaultMin: CMM_SETUP_MIN,
    machineName: inspectionRate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupCost = r2((setupResolution.setupMin / 60) * inspectionRate.rate / batch);
  const runCost = r2((measuredMin / 60) * inspectionRate.rate / batch);
  // Amortized per-part time keeps totalMin per-part-honest
  const cycleMin = r2(measuredMin / batch);
  return makeLine('Inspection', setupCost, runCost, cycleMin, inspectionRate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  });
}

// Surface treatment is now in its own module to avoid circular dep with cost-engine.ts.
import { computeSurfaceTreatmentLine } from '../../shared/process/cost-surface-treatment';
export { computeSurfaceTreatmentLine };

// ── Route complexity score (0–100) ───────────────────────────────────────────
// Inputs: raw feature counts + setup count per machine class.
// Used downstream for production scenario selection, AI recommendations, and
// quoting confidence bands. Each bucket contributes 0–20 points.

export function computeRouteComplexityScore(
  holeCount: number,
  pocketCount: number,
  threadCount: number,
  setupCount: number,
  gdtFeatureCount: number,
): number {
  const holeScore   = Math.min(holeCount   / 30, 1) * 20;
  const pocketScore = Math.min(pocketCount / 10, 1) * 20;
  const threadScore = Math.min(threadCount / 10, 1) * 20;
  const setupScore  = Math.min((setupCount - 1) / 2, 1) * 20;  // 1→0, 2→10, 3→20
  const gdtScore    = Math.min(gdtFeatureCount / 5, 1) * 20;
  return Math.round(holeScore + pocketScore + threadScore + setupScore + gdtScore);
}

// ── Machine capability check ──────────────────────────────────────────────────

// Root-caused 2026-09-16: this used to be the ONLY domain in the platform
// still doing a class-level bounding-box check instead of real per-machine
// capability hydration (checkMachineCapability, used by every Sheet Metal
// engine) — confirmed live: mhr_records never carried real per-machine
// work-envelope data for CNC machines at all until migration 755 staged it
// (max_diameter_mm/max_length_mm for the 4 real lathe categories,
// max_x_mm/max_y_mm/max_z_mm for the 3 real mill categories — the only 7
// of the 38 real Machining categories selector.ts can currently route a
// specific machine to). Now delegates to the same shared
// checkMachineCapability every other domain uses, via new CNC-specific
// branches added there (turning: partDiameterMm/partLengthMm vs
// maxDiameterMm/maxLengthMm; milling: partLengthMm/partWidthMm/
// partHeightMm vs maxXMm/maxYMm/maxZMm, the first real Z-axis check this
// function has ever had).
//
// realCapability/capabilitySource are optional and threaded through from
// the caller's already-resolved MachineCandidate (MHRRateInput.selection)
// — when absent (the two registry engines' pre-selection, class-only
// feasibility gate, before any specific machine is chosen; or physics
// selection disabled), this falls back to the previous class-level
// MACHINE_ENVELOPE default exactly as before — a real, disclosed
// "no specific machine selected yet" case, not a regression.
//
// Weight capacity has no real per-machine source anywhere in
// memory/machining/ (no max_workpiece_weight_kg-equivalent field exists in
// the real limits data for any of the 7 wired categories) — stays on the
// class-level MACHINE_ENVELOPE default for every caller, a disclosed gap,
// not fabricated per-machine data.
export function checkCNCCapability(
  machineClass: MachineClassId,
  maxLength: number,
  maxWidth: number,
  maxHeight: number,
  weightKg: number,
  realCapability?: MachineCapability | null,
  capabilitySource?: 'imported' | 'seed' | 'default_class',
): CNCCapabilityResult {
  const env = MACHINE_ENVELOPE[machineClass];
  const warnings: string[] = [];

  if (realCapability) {
    // Real granular turning classes — replaces the deleted cnc_lathe/
    // cnc_lathe_live coarse buckets.
    const isTurning =
      machineClass === '2_axis_lathe' || machineClass === '3_axis_lathe' ||
      machineClass === '2_axis_bar_feed_lathe_with_sub_spindle' || machineClass === '3_axis_bar_feed_lathe_with_sub_spindle';
    const geometry: PartGeometryForCapability = {
      sheetThicknessMm: 0,
      flatPatternLengthMm: null,
      flatPatternWidthMm: null,
      ...(isTurning
        ? {
            // Same bar-stock diameter/length convention already used
            // elsewhere in this file for turned parts (e.g. computeCNCTurnedCostSummary's
            // fallbackDiamMm = max(maxWidth, maxHeight)) — the turning axis
            // is maxLength, the cross-section swing is the larger of the
            // other two bounding-box dimensions.
            partDiameterMm: Math.max(maxWidth, maxHeight),
            partLengthMm: maxLength,
          }
        : {
            partLengthMm: maxLength,
            partWidthMm: maxWidth,
            partHeightMm: maxHeight,
          }),
    };
    const result = checkMachineCapability(machineClass, null, geometry, realCapability, capabilitySource);
    warnings.push(...result.reasons);
    const weightCapable = !(weightKg > 0 && weightKg > env.maxWeightKg);
    if (!weightCapable) {
      warnings.push(`Part weight (${r2(weightKg)} kg) exceeds machine weight capacity (${env.maxWeightKg} kg, class default — no real per-machine weight data exists yet).`);
    }
    return { overallCapable: result.capable && weightCapable, machineCapabilityWarnings: warnings };
  }

  // No real capability resolved — class-level default, same as before.
  if (maxLength > env.l || maxWidth > env.w || maxHeight > env.h) {
    warnings.push(
      `Part envelope (${maxLength}×${maxWidth}×${maxHeight} mm) exceeds machine working volume ` +
      `(${env.l}×${env.w}×${env.h} mm, class default — no specific machine selected yet).`,
    );
  }
  if (weightKg > 0 && weightKg > env.maxWeightKg) {
    warnings.push(
      `Part weight (${r2(weightKg)} kg) exceeds machine weight capacity (${env.maxWeightKg} kg).`,
    );
  }
  return { overallCapable: warnings.length === 0, machineCapabilityWarnings: warnings };
}

// ── CNC Milled cost summary ──────────────────────────────────────────────────

export function computeCNCMilledCostSummary(
  input: CNCCostInput,
  machineClass: MachineClassId,
): CostSummaryDto {
  const {
    volume, surfaceArea, maxLength, maxWidth, maxHeight,
    holeCount, holeGroups, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, threads, tightestToleranceMm,
    gdtFeatureCount, batchSize, family, finishedWeightKg, mhrRate, tappingRate, deburrRate,
    inspectionRate, surfaceTreatment,
  } = input;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const matClass = detectMaterialClass(materialGrade);
  const location = input.location ?? '__default__';

  // ── Billet ────────────────────────────────────────────────────────────────
  // Prefer blank optimizer result (round bar / rectangular bar selected from stock
  // profiles table) over the raw bounding-box billet. The optimizer raises material
  // utilization from ~17% to 55–65% for typical prismatic/turned parts. Falls back
  // to bbox + allowance when the optimizer found no matching stock or was not called.
  const allow = 2 * CNC_STOCK_ALLOWANCE_PER_SIDE_MM;
  const rawBilletVol =
    maxLength > 0 && maxWidth > 0 && maxHeight > 0
      ? (maxLength + allow) * (maxWidth + allow) * (maxHeight + allow)
      : 0;
  const billetVolMm3 = input.blankResult?.billetVolMm3 ?? rawBilletVol;
  const billetWeightKg = r3((billetVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(billetWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (billetVolMm3 === 0) warnings.push('Bounding box is zero — billet cost may be inaccurate');
  if (volume > 0 && billetVolMm3 > 0 && volume > billetVolMm3) {
    warnings.push(
      'CAD part volume exceeds the bounding-box billet — geometry or unit data is inconsistent; material cost and chip loss are unreliable until the model is re-analysed.',
    );
  }

  // ── Setup (amortised over batchSize, includes fixture amortization) ────────
  // Root cause (confirmed live, 2026-09-18): "Setup" is not a real
  // manufacturing operation in its own right — it's the one-time
  // workholding/fixturing/zero-setting overhead of using THIS machine for
  // the whole job, real but not a distinct process step. Showing it as its
  // own peer row in the Manufacturing Process tree (with the same machine
  // repeated on every row) misrepresented it as a 44th operation. Folded
  // into the first real line this machine produces (CNC Milling) instead —
  // the same convention every engine built later this session already uses
  // (Jig Boring/Cylindrical Grinding/Keyway Broaching/etc. each carry their
  // own setupCost + runCost on ONE line, never a separate "Setup" line).
  // Real per-machine mhr_records.setup_time_hr first, then the cited
  // SETUP_COUNT×BASE_SETUP_MIN class default — see resolveSetupMinutes()
  // (no per-operation machining_reference_data table analogous to Sheet
  // Metal's sm_lookup_op_setup_time exists yet, so that tier is skipped).
  const setupCount = SETUP_COUNT[machineClass];
  const setupResolution = resolveSetupMinutes({
    process: 'CNC Setup',
    machineSetupTimeHr: mhrRate.setupTimeHr,
    classDefaultMin: setupCount * BASE_SETUP_MIN[machineClass],
    machineName: mhrRate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const fixtureCost = r2((input.fixtureUnitCostLocal ?? 0) / Math.max(batchSize, 1));
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate) + fixtureCost;
  const setupDisclosure = { setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source };

  // ── CNC Milling (roughing + all hole operations on the same machine) ─────
  // When feature_graph_v2 data is available (featureOps), use per-feature cycle
  // times from the operation sequencer — this is Fix 3 + Fix 4. The sequencer
  // already breaks out Drill, Tap, Pocket Rough/Finish per occurrence so we sum
  // all machining ops and bill them against the VMC rate.
  // Fallback: (billetVol − partVol) / MRR × 1.3 for parts without feature data.
  //
  // machinabilityRating scales MRR: Al 6061 ≈ 150 (2× mild steel baseline of 75).
  const machinabilityFactor = (input.machinabilityRating ?? 75) / 75;
  const mrr = MILLING_MRR[matClass] * machinabilityFactor;

  let cncMillingMin = 0;
  if (Array.isArray(input.featureOps) && input.featureOps.length > 0) {
    // Root-caused live (2026-09-18): buildOperationSequence() (the feature
    // sequencer) emits its OWN "Rigid Tap" entry for every tapped hole (real
    // computeTapCycleSec physics) and an unconditional flat "Deburr" 90s
    // placeholder for every part — but this function ALSO independently
    // computes real Tapping time (computeTappingMin, same underlying
    // computeTapCycleSec physics, same threads) and real Deburring time
    // (tblDeburring-based deburrMin below), each billed as its OWN dedicated
    // process line at its OWN dedicated rate (tappingRate/deburrRate, not
    // mhrRate). Summing the sequencer's full output into "CNC Milling"
    // without excluding these double-billed every part with tapped holes or
    // feature data: once folded into "CNC Milling" at the VMC rate, once
    // again as "Tapping"/"Deburring" at their real rates. Counterbore/
    // Chamfer/Pocket/Drill/Face Mill have no such separate line elsewhere in
    // this function, so only these two names are excluded here.
    const DOUBLE_BILLED_ELSEWHERE = new Set(['Rigid Tap', 'Deburr']);
    // 15% rapids/ATC overhead added on top of pure cutting time.
    const totalFeatureSec = input.featureOps
      .filter((o) => !DOUBLE_BILLED_ELSEWHERE.has(o.name))
      .reduce((s, o) => s + o.timeSec, 0);
    cncMillingMin = (totalFeatureSec / 60) * 1.15;
  } else {
    // Bbox-subtraction fallback (used when CAD engine did not return feature_graph_v2)
    const materialRemovalMm3 = Math.max(0, billetVolMm3 - volume);
    const roughingMin = materialRemovalMm3 > 0 ? (materialRemovalMm3 / mrr) * 1.3 : 0;

    let drillingMin = 0;
    if (holeGroups.length > 0) {
      drillingMin = holeGroups.reduce(
        (sum, g) => sum + (g.count * computeDrillCycleSec(g.diameter_mm, materialGrade)) / 60,
        0,
      );
    } else if (holeCount > 0) {
      // No per-diameter breakdown — assume a representative 8mm hole (real
      // physics still applies the real material's speed/feed; only the
      // diameter itself is a placeholder here, same as the previous flat
      // DRILL_CYCLE_SEC.medium bucket this replaces).
      drillingMin = (holeCount * computeDrillCycleSec(8, materialGrade)) / 60;
    }

    cncMillingMin = roughingMin + drillingMin;
  }
  // Setup always folds into this line (even when cncMillingMin itself is 0
  // and volume data is genuinely unavailable) so the real setup cost is
  // never silently dropped — see setupDisclosure's own doc comment above.
  // "CNC Milling" stays a generic bucket, NOT run through resolveOperationName
  // -- it deliberately sums roughing + all hole operations into one number
  // (real per-operation Face/Rough/Finish Milling split needs the power-
  // limited MRR model, staged variables.json + tblEngagementLengthPower,
  // not yet built — a disclosed, known-generic gap, not a fabricated name).
  if (cncMillingMin > 0 || setupCostVal > 0) {
    processLines.push(makeLine(
      'CNC Milling', setupCostVal, r2((cncMillingMin / 60) * mhrRate.rate), cncMillingMin, mhrRate,
      input.processIdentityByMachineClass, setupDisclosure,
    ));
  }
  if (cncMillingMin <= 0) {
    warnings.push('Volume data unavailable — CNC milling time estimated at 0');
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tappingMin = threads.length > 0 ? computeTappingMin(threads, materialGrade) : 0;
  if (tappingMin > 0) {
    const tapSetup = r2((TAPPING_SETUP_MIN / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(makeLine(
      resolveOperationName(tappingRate.machineClass, 'Tapping', input.realOperationCategories, warnings),
      tapSetup, tapRun, tappingMin, tappingRate, input.processIdentityByMachineClass,
    ));
  }

  // ── Deburring ────────────────────────────────────────────────────────────
  // Real, hardness-matched tblDeburring linear edge speed when resolved by
  // the caller — edge length estimated from surface area via a standard
  // geometric proxy (perimeter of an equivalent square, 4×√area), not a
  // fabricated length; the part's real edge geometry isn't extracted by
  // cad-engine today, so this is the same tier of disclosed approximation
  // as estimateBurlDiameterMm elsewhere in this codebase, not a guess
  // dressed up as measured data. Falls back to the previous flat 0.5
  // constant, disclosed as a fallback, only when the real rate isn't
  // available.
  const deburrMin = surfaceArea > 0
    ? (input.deburrLinearSpeedMmPerSec && input.deburrLinearSpeedMmPerSec > 0
        ? (4 * Math.sqrt(surfaceArea)) / input.deburrLinearSpeedMmPerSec / 60
        : (surfaceArea / 10_000) * 0.5)
    : 0;
  if (deburrMin > 0) {
    processLines.push(makeLine('Deburring', 0, r2((deburrMin / 60) * deburrRate.rate), deburrMin, deburrRate, input.processIdentityByMachineClass));
  }

  // ── Jig Boring / Jig Grind (new — a real, tighter tier ABOVE Reaming;
  // see JIG_BORE_POSITION_TOLERANCE_MM's doc comment). Mutually exclusive
  // at the same real tolerance ceiling: a real heat-treat callout routes to
  // Jig Grind instead of Jig Boring (see isRealHeatTreatmentCallout) —────
  const needsJigGrind = tightestToleranceMm != null && tightestToleranceMm > 0 &&
    tightestToleranceMm <= JIG_BORE_POSITION_TOLERANCE_MM && isRealHeatTreatmentCallout(input.heatTreatment);
  if (needsJigGrind) {
    const jigGrindLine = computeJigGrindLine(
      holeGroups, input.cylindricalGrindingParams, input.jigGrindRate, batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigGrindLine) processLines.push(jigGrindLine);
  } else {
    const jigBoreLine = computeJigBoreLine(
      tightestToleranceMm, holeGroups, matClass, input.jigBoreTable, input.jigBoreRate,
      batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigBoreLine) processLines.push(jigBoreLine);
  }

  // ── Internal Grinding (new — bore/ID grinding; see CNCCostInput's own
  // doc comment) ───────────────────────────────────────────────────────────
  const internalGrindingLine = computeInternalGrindingLine(
    input.tightestRaMicron, holeGroups, input.cylindricalGrindingParams, input.internalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (internalGrindingLine) processLines.push(internalGrindingLine);

  // ── Reaming (see computeReamCycleSec's own doc comment for why this is
  // tolerance-triggered rather than a distinct CAD feature, and why it
  // applies to the smallest real hole group). Excludes the Jig Boring
  // tier above (tightestToleranceMm > JIG_BORE_POSITION_TOLERANCE_MM) —
  // that tighter tolerance band now gets a real, dedicated jig borer
  // instead of reaming, not both.
  if (
    tightestToleranceMm != null && tightestToleranceMm > JIG_BORE_POSITION_TOLERANCE_MM &&
    tightestToleranceMm <= TIGHT_TOLERANCE_REAM_THRESHOLD_MM &&
    holeGroups.length > 0
  ) {
    const smallestHole = holeGroups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), holeGroups[0]);
    const reamSec = computeReamCycleSec(smallestHole.diameter_mm, matClass, input.reamTable);
    if (reamSec != null) {
      const reamMin = (reamSec * smallestHole.count) / 60;
      const reamSetup = r2((REAM_SETUP_MIN / 60) * mhrRate.rate / Math.max(batchSize, 1));
      const reamRun = r2((reamMin / 60) * mhrRate.rate);
      processLines.push(makeLine('Reaming', reamSetup, reamRun, reamMin, mhrRate, input.processIdentityByMachineClass));
    } else {
      warnings.push('Tight tolerance requires reaming but real tblReaming data was not available — reaming cost not included.');
    }
  }

  // ── Gun Drilling / Deep Bore Machine (new — see deep-hole-routing.ts) ────
  const gunDrillLine = computeDeepHoleLine(
    'Gun Drilling', input.gunDrillCandidates,
    (d, hb) => resolveGunDrillSpeedFeed(input.gunDrillTable, d, hb),
    matClass, input.gunDrillRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (gunDrillLine) processLines.push(gunDrillLine);

  const deepBoreLine = computeDeepHoleLine(
    'Deep Bore Machine', input.deepBoreCandidates,
    (d, hb) => resolveDeepBoreSpeedFeed(input.deepBoreMaterials, d, hb),
    matClass, input.deepBoreRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (deepBoreLine) processLines.push(deepBoreLine);

  // ── Keyway Broaching (new — real "keyway" occurrences pre-filtered out of
  // fgv2Features by splitKeywayOccurrences; see CNCCostInput's own doc
  // comment) ────────────────────────────────────────────────────────────────
  const keywayLine = computeKeywayBroachingLine(
    input.keywayCandidates, input.broachingParams, input.broachRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (keywayLine) processLines.push(keywayLine);

  // ── Wire EDM (new — real "slot" occurrences pre-filtered out of
  // fgv2Features by splitWireEdmOccurrences ONLY when a real heat-treat
  // callout is present; see CNCCostInput's own doc comment) ───────────────
  const wireEdmLine = computeWireEdmLine(
    input.wireEdmCandidates, input.wireEdmParams, input.wireEdmRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (wireEdmLine) processLines.push(wireEdmLine);

  // ── Surface Treatment (anodize / plating — drawing callout) ──────────────
  const surfaceLine = computeSurfaceTreatmentLine(surfaceTreatment, surfaceArea, batchSize, location, warnings, input.surfaceTreatmentDbRate);
  if (surfaceLine) processLines.push(surfaceLine);

  // ── Inspection (batch-sampled; CMM amortization rides on the MHR rate) ───
  const inspectionMin = computeInspectionMin(
    holeCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures,
  );
  processLines.push(
    computeInspectionLine(inspectionMin, inspectionRate, batchSize, input.samplingPerN, input.samplingPolicy, warnings, input.processIdentityByMachineClass),
  );

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  // Clamp to [0, 100]: >100% is physically impossible (billet smaller than part —
  // bad CAD data, warned above); a wrong 108% silently understates material.
  const utilizationPct = r2(
    billetWeightKg > 0 ? Math.min(100, Math.max(0, (finishedWeightKg / billetWeightKg) * 100)) : 0,
  );
  const chipScrapPct = r2(100 - utilizationPct);
  if (chipScrapPct > 65) {
    warnings.push(
      `Chip loss ${chipScrapPct.toFixed(0)}% — over 65% of the billet is machined away. ` +
      'Verify bounding box orientation and part weight; a near-net blank (extrusion/casting) may fit better.',
    );
  }

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, finishedWeightKg, billetWeightKg, batchSize, processLines,
  );

  return {
    materialCost,
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: billetWeightKg,
    materialCostPerKg,
    materialSource,
    processLines,
    totalProcessCost,
    totalCost,
    cycleTimes: {
      laserMin:      r2(cncMillingMin),
      pressBrakeMin: r2(setupMin),
      tappingMin:    r2(tappingMin),
      deburrMin:     r2(deburrMin),
      totalMin,
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
    setupCount,
    materialRemoval: {
      billetWeightKg,
      finishedWeightKg: r3(finishedWeightKg),
      utilizationPct,
      chipScrapPct,
    },
  };
}

// ── CNC Turned cost summary ──────────────────────────────────────────────────

export function computeCNCTurnedCostSummary(
  input: CNCCostInput,
  machineClass: MachineClassId,
): CostSummaryDto {
  const {
    volume, maxLength, maxWidth, maxHeight, holeCount, holeGroups,
    materialGrade, materialCostPerKg, materialDensityKgM3, materialSource,
    threads, tightestToleranceMm, gdtFeatureCount, batchSize, family,
    finishedWeightKg, mhrRate, tappingRate, deburrRate,
    inspectionRate, surfaceTreatment,
  } = input;

  // Drilled hole count from grouped diameter data is accurate; raw holeCount includes
  // all cylindrical faces (OD steps, grooves, etc.) which inflates boring + inspection time.
  const drilledHoleCount = holeGroups.length > 0
    ? holeGroups.reduce((s, g) => s + g.count, 0)
    : holeCount;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const matClass = detectMaterialClass(materialGrade);

  // Detect stale sheet-metal material grade on a CNC part (auto-fill set it before
  // classification was corrected). Warn so the user knows to re-run auto-fill or
  // manually set the material — cost will be wrong until this is resolved.
  if (materialGrade && /sheet|plate/i.test(materialGrade)) {
    warnings.push(
      `Material "${materialGrade}" looks like a sheet/plate product form — this part is CNC machined. ` +
      'Re-run Auto-Fill or set the material grade to a bar/billet grade for accurate cost.',
    );
  }

  const location = input.location ?? '__default__';

  // ── Bar stock ────────────────────────────────────────────────────────────
  // Prefer blank optimizer result when available (Fix 2). For turned parts the
  // optimizer selects a round bar that fits the part's cross-section with 3%
  // clearance. Fallback: inscribed circle × 1.1 (original heuristic).
  const fallbackDiamMm = Math.max(maxWidth, maxHeight) * 1.1;
  const fallbackBarLenMm = maxLength * 1.1;
  const fallbackBarVolMm3 = Math.PI * (fallbackDiamMm / 2) ** 2 * fallbackBarLenMm;
  const barVolMm3 = input.blankResult?.billetVolMm3 ?? fallbackBarVolMm3;
  const barWeightKg = r3((barVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(barWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (volume > 0 && barVolMm3 > 0 && volume > barVolMm3) {
    warnings.push(
      'CAD part volume exceeds the bar-stock volume — geometry or unit data is inconsistent; material cost and chip loss are unreliable until the model is re-analysed.',
    );
  }

  // ── Setup (amortised, includes fixture amortization) ────────────────────
  // Folded into the first real line (OD Turning) instead of its own row —
  // same rationale as the milling path, see its own doc comment above.
  // Real per-machine mhr_records.setup_time_hr first, then the cited
  // SETUP_COUNT×BASE_SETUP_MIN class default — see resolveSetupMinutes().
  const setupCount = SETUP_COUNT[machineClass];
  const setupResolution = resolveSetupMinutes({
    process: 'CNC Setup',
    machineSetupTimeHr: mhrRate.setupTimeHr,
    classDefaultMin: setupCount * BASE_SETUP_MIN[machineClass],
    machineName: mhrRate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const fixtureCost = r2((input.fixtureUnitCostLocal ?? 0) / Math.max(batchSize, 1));
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate) + fixtureCost;
  const setupDisclosure = { setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source };

  // ── OD Turning ───────────────────────────────────────────────────────────
  // machinabilityRating (Fix 4): 75 = mild steel baseline; Al 6061 ≈ 150 → 2× MRR.
  // Only still used by the disclosed MRR fallback below -- the primary path
  // is real per-pass depth-of-cut physics (see computeTurningCycleSec).
  const machinabilityFactor = (input.machinabilityRating ?? 75) / 75;
  const materialRemovalMm3 = Math.max(0, barVolMm3 - volume);

  // Real part turning diameter (same convention the billet-fallback above
  // already uses: max(maxWidth, maxHeight)) and real equivalent bar
  // diameter derived from the real bar VOLUME as a round cylinder of
  // length maxLength -- the same round-bar geometry assumption the
  // fallbackBarVolMm3 calculation above already makes, not a new one.
  const partDiameterMm = Math.max(maxWidth, maxHeight);
  const barDiameterMm = maxLength > 0 ? 2 * Math.sqrt(barVolMm3 / (Math.PI * maxLength)) : 0;
  const radialStockMm = Math.max(0, (barDiameterMm - partDiameterMm) / 2);

  // Real per-pass data resolves to the catalog's own real DISTINCT operation
  // names ("Rough Turning" / "Finish Turning" -- see computeTurningCycleSec's
  // own doc comment) instead of one generic hand-picked "OD Turning" bucket.
  // The MRR-based fallback has no real rough/finish split to report, so it
  // stays a single disclosed "OD Turning" estimate line.
  let roughTurningMin = 0;
  let finishTurningMin = 0;
  const usedRealTurningPhysics = Boolean(input.turningParams?.dataFound && radialStockMm > 0);
  if (usedRealTurningPhysics) {
    const { roughSec, finishSec } = computeTurningCycleSec(partDiameterMm, maxLength, radialStockMm, input.turningParams!);
    roughTurningMin = roughSec / 60;
    finishTurningMin = finishSec / 60;
  } else if (materialRemovalMm3 > 0) {
    if (radialStockMm > 0) {
      warnings.push('OD Turning: real tblGeneralTurning depth-of-cut data was not available — falling back to the disclosed MRR-based estimate.');
    }
    const effectiveTurningMrr = TURNING_MRR[matClass] * machinabilityFactor;
    roughTurningMin = (materialRemovalMm3 / effectiveTurningMrr) * 1.2;
  }
  // Setup always folds into the first real turning line (even when its own
  // run time is 0) so the real setup cost is never silently dropped.
  if (usedRealTurningPhysics) {
    if (roughTurningMin > 0 || setupCostVal > 0) {
      processLines.push(makeLine(
        resolveOperationName(machineClass, 'Rough Turning', input.realOperationCategories, warnings),
        setupCostVal, r2((roughTurningMin / 60) * mhrRate.rate), roughTurningMin, mhrRate,
        input.processIdentityByMachineClass, setupDisclosure,
      ));
    }
    if (finishTurningMin > 0) {
      processLines.push(makeLine(
        resolveOperationName(machineClass, 'Finish Turning', input.realOperationCategories, warnings),
        0, r2((finishTurningMin / 60) * mhrRate.rate), finishTurningMin, mhrRate,
        input.processIdentityByMachineClass,
      ));
    }
  } else if (roughTurningMin > 0 || setupCostVal > 0) {
    // No real per-pass split resolved -- disclosed generic fallback name,
    // not a real catalog operation (see the MRR-fallback warning above).
    processLines.push(makeLine(
      'OD Turning', setupCostVal, r2((roughTurningMin / 60) * mhrRate.rate), roughTurningMin, mhrRate,
      input.processIdentityByMachineClass, setupDisclosure,
    ));
  }

  // ── Drilling ──────────────────────────────────────────────────────────────
  // Real material-aware physics (same computeDrillCycleSec as the milled
  // path) — replaces the previous flat diameter-bucket table. Real catalog
  // name is "Drilling" (e.g. "2 Axis Bar Feed Lathe with Sub Spindle:
  // Drilling//SimpleHole") -- "Boring/Drilling" was never a real operation
  // string; this function only implements drill physics, not a distinct
  // boring model (real boring-tolerance work is handled by the separate
  // Jig Boring/Reaming tiers elsewhere in this function).
  const boringMin = holeGroups.length > 0
    ? holeGroups.reduce((total, g) => total + (g.count * computeDrillCycleSec(g.diameter_mm, materialGrade)) / 60, 0)
    : drilledHoleCount > 0 ? (drilledHoleCount * computeDrillCycleSec(8, materialGrade)) / 60 : 0;
  if (boringMin > 0) {
    processLines.push(makeLine(
      resolveOperationName(machineClass, 'Drilling', input.realOperationCategories, warnings),
      0, r2((boringMin / 60) * mhrRate.rate), boringMin, mhrRate, input.processIdentityByMachineClass,
    ));
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tappingMin = threads.length > 0 ? computeTappingMin(threads, materialGrade) : 0;
  if (tappingMin > 0) {
    const tapSetup = r2((TAPPING_SETUP_MIN / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(makeLine(
      resolveOperationName(tappingRate.machineClass, 'Tapping', input.realOperationCategories, warnings),
      tapSetup, tapRun, tappingMin, tappingRate, input.processIdentityByMachineClass,
    ));
  }

  // ── Secondary setup / rechucking (2-axis lathe only) ─────────────────────
  // A 2-axis lathe cannot do cross holes or radial milling in one setup.
  // The part must be unloaded and transferred to a drill press or VMC —
  // this transfer + re-clamping adds ~15 min to EVERY PART's cycle (not amortised setup).
  // Live-tooling and mill-turn complete all features in a single chucking → 0 penalty.
  const rechuckMin = SETUP_COUNT[machineClass] > 1 ? 15 : 0;
  if (rechuckMin > 0) {
    processLines.push(makeLine('Secondary Setup (Rechuck)', 0, r2((rechuckMin / 60) * mhrRate.rate), rechuckMin, mhrRate));
  }

  // ── Parting ────────────────────────────────────────────────────────────
  // Real catalog operation name ("Parting//StockTrim" — e.g. "2 Axis Bar
  // Feed Lathe with Sub Spindle:Parting//StockTrim"), not "Facing" (facing
  // a flat end face is real Rough/Finish Turning applied to a PlanarFace
  // feature — already covered above — not a separately-modeled operation
  // in this reference corpus). Real physics: a parting cut is a radial
  // plunge across the part's own real radius — reuses the SAME real
  // finish_turning cutting_speed_m_min/feed_rate_mm_rev tblGeneralTurning
  // already resolved above for Finish Turning (a disclosed reuse, same
  // category as Jig Boring reusing Finish Boring physics elsewhere this
  // session — a parting cut needs the same finish-quality surface a
  // parting tool leaves on the cut face). Falls back to the previous flat
  // 2min disclosed constant only when real turning params aren't resolved.
  let partingMin: number;
  if (input.turningParams?.dataFound && partDiameterMm > 0) {
    const { finishCuttingSpeedMPerMin, finishFeedMmPerRev } = input.turningParams;
    const rpm = finishCuttingSpeedMPerMin > 0 ? (finishCuttingSpeedMPerMin * 1000) / (Math.PI * partDiameterMm) : 0;
    const feedMmPerMin = rpm * finishFeedMmPerRev;
    partingMin = feedMmPerMin > 0 ? (partDiameterMm / 2) / feedMmPerMin : 2;
  } else {
    partingMin = 2;
  }
  processLines.push(makeLine(
    resolveOperationName(machineClass, 'Parting', input.realOperationCategories, warnings),
    0, r2((partingMin / 60) * mhrRate.rate), partingMin, mhrRate, input.processIdentityByMachineClass,
  ));

  // ── Deburring — genuine pre-existing gap closed: turned parts had NO
  // deburring line at all before this (only the milled path did), despite
  // a turned part having the same real edges needing it. Same real
  // hardness-matched tblDeburring physics as the milled path — see that
  // function's own doc comment for the edge-length proxy and fallback.
  const turnedSurfaceArea = input.surfaceArea;
  const deburrMin = turnedSurfaceArea > 0
    ? (input.deburrLinearSpeedMmPerSec && input.deburrLinearSpeedMmPerSec > 0
        ? (4 * Math.sqrt(turnedSurfaceArea)) / input.deburrLinearSpeedMmPerSec / 60
        : (turnedSurfaceArea / 10_000) * 0.5)
    : 0;
  if (deburrMin > 0) {
    processLines.push(makeLine('Deburring', 0, r2((deburrMin / 60) * deburrRate.rate), deburrMin, deburrRate, input.processIdentityByMachineClass));
  }

  // ── Jig Boring / Jig Grind — same real tier + real routing rule as the
  // milled path.
  const needsJigGrind = tightestToleranceMm != null && tightestToleranceMm > 0 &&
    tightestToleranceMm <= JIG_BORE_POSITION_TOLERANCE_MM && isRealHeatTreatmentCallout(input.heatTreatment);
  if (needsJigGrind) {
    const jigGrindLine = computeJigGrindLine(
      holeGroups, input.cylindricalGrindingParams, input.jigGrindRate, batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigGrindLine) processLines.push(jigGrindLine);
  } else {
    const jigBoreLine = computeJigBoreLine(
      tightestToleranceMm, holeGroups, matClass, input.jigBoreTable, input.jigBoreRate,
      batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigBoreLine) processLines.push(jigBoreLine);
  }

  // ── Internal Grinding — same real bore/ID grinding trigger as the milled
  // path (a turned part's own bores use the same real holeGroups data).
  const internalGrindingLine = computeInternalGrindingLine(
    input.tightestRaMicron, holeGroups, input.cylindricalGrindingParams, input.internalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (internalGrindingLine) processLines.push(internalGrindingLine);

  // ── Reaming — same tight-tolerance trigger as the milled path, using
  // drilledHoleCount's real holeGroups (not raw holeCount, same rationale
  // as the Boring/Drilling and Inspection sections above). Excludes the
  // Jig Boring tier above — see the milled path's identical comment.
  if (
    tightestToleranceMm != null && tightestToleranceMm > JIG_BORE_POSITION_TOLERANCE_MM &&
    tightestToleranceMm <= TIGHT_TOLERANCE_REAM_THRESHOLD_MM &&
    holeGroups.length > 0
  ) {
    const smallestHole = holeGroups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), holeGroups[0]);
    const reamSec = computeReamCycleSec(smallestHole.diameter_mm, matClass, input.reamTable);
    if (reamSec != null) {
      const reamMin = (reamSec * smallestHole.count) / 60;
      const reamSetup = r2((REAM_SETUP_MIN / 60) * mhrRate.rate / Math.max(batchSize, 1));
      const reamRun = r2((reamMin / 60) * mhrRate.rate);
      processLines.push(makeLine('Reaming', reamSetup, reamRun, reamMin, mhrRate, input.processIdentityByMachineClass));
    } else {
      warnings.push('Tight tolerance requires reaming but real tblReaming data was not available — reaming cost not included.');
    }
  }

  // ── Cylindrical Grinding (new; see CNCCostInput's own doc comment for
  // the real Ra<TURNING_MILLING_BEST_ACHIEVABLE_RA_UM trigger). Turned
  // part's own real OD/length: max(maxWidth, maxHeight) is the diameter,
  // maxLength the ground length -- same bbox-to-cylinder convention the
  // turned bar-stock fallback already uses elsewhere in this function.
  const turnedDiameterMm = Math.max(maxWidth, maxHeight);
  const grindingLine = computeCylindricalGrindingLine(
    input.tightestRaMicron, turnedDiameterMm, maxLength,
    input.cylindricalGrindingParams, input.cylindricalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (grindingLine) processLines.push(grindingLine);

  // ── Keyway Broaching — a turned shaft's own real keyway occurrences,
  // same real pre-filter/candidate shape as the milled path.
  const keywayLine = computeKeywayBroachingLine(
    input.keywayCandidates, input.broachingParams, input.broachRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (keywayLine) processLines.push(keywayLine);

  // ── Wire EDM — a turned part's own real hardened-slot occurrences, same
  // real pre-filter/candidate shape as the milled path.
  const wireEdmLine = computeWireEdmLine(
    input.wireEdmCandidates, input.wireEdmParams, input.wireEdmRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (wireEdmLine) processLines.push(wireEdmLine);

  // ── Surface Treatment (anodize / plating — drawing callout) ──────────────
  const surfaceLine = computeSurfaceTreatmentLine(
    surfaceTreatment, input.surfaceArea, batchSize, location, warnings, input.surfaceTreatmentDbRate,
  );
  if (surfaceLine) processLines.push(surfaceLine);

  // ── Inspection (batch-sampled; CMM amortization rides on the MHR rate) ───
  // drilledHoleCount, not raw holeCount — the raw count includes OD steps/grooves
  // and would inflate the hole-sampling time for turned parts.
  const inspectionMin = computeInspectionMin(
    drilledHoleCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures,
  );
  processLines.push(
    computeInspectionLine(inspectionMin, inspectionRate, batchSize, input.samplingPerN, input.samplingPolicy, warnings, input.processIdentityByMachineClass),
  );

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  // Clamped for the same reason as the milled engine: >100% = impossible data
  const utilizationPct = r2(
    barWeightKg > 0 ? Math.min(100, Math.max(0, (finishedWeightKg / barWeightKg) * 100)) : 0,
  );

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, finishedWeightKg, barWeightKg, batchSize, processLines,
  );

  return {
    materialCost,
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: barWeightKg,
    materialCostPerKg,
    materialSource,
    processLines,
    totalProcessCost,
    totalCost,
    cycleTimes: {
      laserMin:      r2(roughTurningMin + finishTurningMin),
      pressBrakeMin: r2(setupMin),
      tappingMin:    r2(tappingMin),
      // Root-caused 2026-09-16: this reported boringMin under the
      // deburrMin key (there was no real deburring line on turned parts
      // to report here at all before). Now that a real Deburring line
      // exists (above), this reports its own real value — boring/drilling
      // time has no dedicated field in this summary DTO (same as Setup/
      // Facing+Parting/Reaming/Secondary Setup), same as the milled
      // function's own cycleTimes shape; the itemized processLines array
      // is the authoritative per-operation breakdown, this object is only
      // a legacy summary widget, and totalMin already sums everything
      // regardless of which named field a line does or doesn't have.
      deburrMin:     r2(deburrMin),
      totalMin,
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
    setupCount,
    materialRemoval: {
      billetWeightKg: barWeightKg,
      finishedWeightKg: r3(finishedWeightKg),
      utilizationPct,
      chipScrapPct: r2(100 - utilizationPct),
    },
  };
}

// ── Route recommendation (single source of truth) ─────────────────────────────
// Cost Summary and Route Comparison MUST agree on which machine class a part is
// quoted on. Both call these two functions; neither carries its own heuristic.
// Divergence here is a P0 — it reads as two different prices for the same part.

// Minimum milled machine class the part's features demand. Same thresholds the
// legacy cost-summary heuristic used, now shared with route comparison so a
// route below this class is marked not-capable rather than winning on price.
export function requiredMilledMachineClass(
  difficultyLevel: string | null | undefined,
  pocketCount: number,
): MachineClassId {
  // Real granular milling classes — replaces the deleted cnc_5ax_mc/
  // cnc_4ax_vmc/cnc_3ax_vmc coarse buckets (Machining Engine Re-Architecture).
  if (difficultyLevel === 'very_hard' || pocketCount > 25) return '5_axis_mill' as MachineClassId;
  if (difficultyLevel === 'hard' || pocketCount > 12) return '4_axis_mill' as MachineClassId;
  return '3_axis_mill' as MachineClassId;
}

const MILLED_CLASS_RANK: Record<string, number> = {
  '3_axis_mill': 0, '4_axis_mill': 1, '5_axis_mill': 2,
};

export function meetsRequiredMilledClass(
  machineClass: MachineClassId,
  required: MachineClassId,
): boolean {
  const rank = MILLED_CLASS_RANK[machineClass];
  const requiredRank = MILLED_CLASS_RANK[required];
  if (rank == null || requiredRank == null) return true; // lathe classes — not gated here
  return rank >= requiredRank;
}

// Recommended route = lowest total cost among capable candidates; ties break to
// fewer setups (less repositioning error), then to the earlier (simpler) class.
// Falls back to the first candidate when nothing is capable — the caller is
// expected to surface capability warnings alongside.
export function pickRecommendedRoute<T extends { totalCost: number; capable: boolean; setupCount: number }>(
  candidates: T[],
): T {
  const pool = candidates.filter((c) => c.capable);
  const ranked = (pool.length > 0 ? pool : candidates).slice().sort(
    (a, b) => a.totalCost - b.totalCost || a.setupCount - b.setupCount,
  );
  return ranked[0];
}
