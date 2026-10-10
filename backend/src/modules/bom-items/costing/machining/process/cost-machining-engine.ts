import { RATES_SOURCE_LABEL, INSPECTION_SAMPLING_DEFAULT, isoCoarsePitchMm, HOLE_OP_UNLOAD_SEC, TIGHT_TOLERANCE_REAM_THRESHOLD_MM, MACHINE_REGISTRY, type SurfaceTreatmentDbRate, type InspectionStagePolicy } from '../../shared/core/default-rates.constants';
import { resolveSetupMinutes, type SetupTimeResolution } from '../../shared/core/engine-kernel';
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
import type { CalculationTraceStep, CostSummaryDto, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { DrillingTable } from '../lookup/drilling-table';
import type { MachiningCapabilityRules } from '../capability-rules';
import { prefixTrace, traceCalc, traceHasAssumption, traceInput } from './machining-trace';
import type { GearRoute } from '../operation/gear-routing';
import { runMachiningCalculator, type CalcRun, type CalcSeed, type MachiningCalculators } from '../calculators/machining-calculator';
import {
  keywayBroachingLookupSeeds, deburringLookupSeeds, deepBoreLookupSeeds, drillingLookupSeeds, finishTurningLookupSeeds, tappingLookupSeeds,
  grindingLookupSeeds, gunDrillingLookupSeeds, surfaceGrindingLookupSeeds, hobbingLookupSeeds, shavingLookupSeeds, rotaryBroachingLookupSeeds, jigBoringLookupSeeds, partingLookupSeeds, reamingLookupSeeds,
  rechuckLookupSeeds, roughTurningLookupSeeds, wireEdmLookupSeeds, type LookupSeeds, type KeywayBroachReference, type SurfaceGrindingParams, type HobbingReference, type RotaryBroachReference,
} from '../calculators/machining-lookup-seeds';

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

class UnknownMachineClassError extends Error {
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

export interface MachiningCostInput {
  volume: number;          // mm³ (finish volume from CAD)
  surfaceArea: number;     // mm²
  maxLength: number;       // mm (bounding box)
  maxWidth: number;
  maxHeight: number;
  holeCount: number;
  // depth_mm: the group's real CAD hole depth (the deepest occurrence), when
  // the part's machining features carry one; absent for parts analysed
  // without it, where drilling discloses its depth assumption instead.
  holeGroups: Array<{ diameter_mm: number; count: number; depth_mm?: number }>;
  pocketCount: number;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  // pitchMm/depthMm/isThrough are real, already-extracted per-thread data
  // (CAD-detected tapped_hole.depth_mm, or a drawing-OCR'd pitch) that
  // bom-items.service.ts's resolveThreads() already resolves and passes
  // here. See tapThreadGroups below.
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
  // Turned part geometry from CAD (BOMItemsService.resolveTurnedGeometry):
  // the turned outer diameter and the length along the turning axis, each
  // with the CAD source it came from. Absent for non-turned families.
  turnedGeometry?: {
    diameterMm: number;
    lengthMm: number;
    diameterSource: string;
    lengthSource: string;
  } | null;
  // Real tblVirtualPartoffInsertCutData rows (MachiningLookupService.getPartoffTable()).
  partoffTable?: any[] | null;
  blankResult?: {
    form: string;          // 'round_bar' | 'rectangular_bar' | 'billet'
    sizeLabel: string;
    billetVolMm3: number;  // pre-computed optimized blank volume
    utilizationPct: number | null;
    barDiameterMm?: number; // real stock_profiles round-bar diameter
  };
  // Per-side machining stock allowance from the reference rule
  // (costing/machining/stock-allowance.ts, via BlankOptimizerService
  // .stockAllowanceFor). Used only for the bounding-box billet when no
  // blankResult is supplied; null = rule not staged (no allowance added).
  stockAllowancePerSideMm?: number | null;
  // machinability_rating from raw_materials DB (75 = mild steel baseline).
  // Scales MRR: Al 6061 ≈ 150 → 2× faster; SS316 ≈ 35 → 0.47× slower.
  machinabilityRating?: number;
  // Feature volumes from feature_graph_v2 — enables per-feature cycle time instead
  // of (billetVol − partVol) / MRR. When absent, falls back to the bbox formula.
  featureOps?: Array<{ name: string; timeSec: number; source: string }>;
  // The drawing callout costed by the reference surface-treatment engine
  // (BomItemsService.resolveSurfaceTreatmentDbRate). Null = the callout names no
  // reference process: no line, a warning.
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
  // Material cut code of the tblDeburring row that speed came from.
  deburrMaterialCutCode?: string | null;
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
  // Gear/spline teeth the cad-engine recognised (machining_features AxiGroove):
  // tooth count, tip/root diameter and face width, all measured from the B-Rep.
  toothForms?: Array<{ tooth_count: number; tip_diameter_mm: number; root_diameter_mm?: number; face_width_mm: number }>;
  // Hob Machine rate (mhr_records 'hob_machine') for the Hobbing line.
  hobRate?: MHRRateInput;
  // tblHobbing / tblAnsiHobbing / defaultNumStarts — see hobbingLookupSeeds.
  hobbing?: HobbingReference | null;
  // How each gear is cut and finished (gear-routing.ts: tblGearQuality + the
  // drawing's gear callouts), the shaving reference and the Shaver rate.
  gearRoute?: GearRoute | null;
  shaving?: { rows: any[]; maxWorkpieceRpm: number | null } | null;
  shaverRate?: MHRRateInput;
  // Polygons (CAD polygon rings, kept only when the drawing carries a polygon
  // callout — bom-items.service.ts resolvePolygons). A socket is rotary
  // broached on the part's own machine after its pilot hole is drilled; a
  // boss (polygon turning) is reported, not priced.
  polygons?: Array<{ kind: 'socket' | 'boss'; sides: number; acrossFlatsMm: number; depthMm: number; count: number }>;
  rotaryBroach?: RotaryBroachReference | null;
  // Real sharp-edge length of the part, measured by the cad-engine from the
  // B-Rep (machining_features.edges.sharp_edge_length_mm, shared/edge_length.py).
  // Absent for parts analysed before that measurement existed.
  sharpEdgeLengthMm?: number | null;
  // The machining calculators (calculators / calculator_fields, mapped per
  // operation in process_calculator_mappings), keyed by operation name. Every
  // machining cycle time is evaluated from these stored formulas; the engine
  // only supplies their inputs. See ../calculators/machining-calculator.ts.
  machiningCalculators?: MachiningCalculators | null;
  // Real tblInstallingTurningWorkholders rows (MachiningLookupService.getWorkholderTable()).
  workholderTable?: Array<{ Name?: string; 'Install And Remove Time (min)'?: number }> | null;
  // Real tblDrilling (MachiningLookupService.getDrillingTable()) — speed/feed
  // for every drilled hole, matched per real diameter inside this pure file.
  drillingTable?: DrillingTable | null;
  // tblTapping rows (migration 809) — the Tapping calculator's cutting speed.
  tappingTable?: any[] | null;
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
  // both bottom out at Ra 0.4um best-case (capability-rules.ts grindingRaTriggerUm)
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
    roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean; materialCutCode?: string; toolType?: string;
  } | null;
  cylindricalGrindingRate?: MHRRateInput;
  // Jig Boring (new) -- a real, tighter tier ABOVE Reaming (see
  // capability-rules.ts). finishBoringTable is the
  // real tblBoringV2 "Finish Boring" rows (real hardness column, matched
  // the same way reamTable is), fetched once by the async caller.
  jigBoreTable?: any[] | null;
  jigBoreRate?: MHRRateInput;
  // Finishing-process thresholds and pass counts from the staged reference
  // data (capability-rules.ts: variables + tblGtolProcessCapabilities). Null
  // = not staged: no grinding / jig line is added and capabilityRulesMissing
  // names what is absent.
  capabilityRules?: MachiningCapabilityRules | null;
  capabilityRulesMissing?: string[];
  // Jig Grind (new) -- shares Jig Boring's real tolerance ceiling, routed
  // by a real, disclosed heat-treat-callout classifier instead (see
  // isRealHeatTreatmentCallout's own doc comment) -- mutually exclusive
  // with Jig Boring, never both on the same part.
  heatTreatment?: string | null;
  jigGrindRate?: MHRRateInput;
  // Internal Grinding -- applies to milled AND turned parts alike (unlike
  // Cylindrical Grinding, OD-only). Its own tblInternalGrinding values
  // (MachiningLookupService.getInternalGrindingParams, same material-code
  // bridge), and its own rate.
  internalGrindingParams?: GrindingParams | null;
  internalGrindingRate?: MHRRateInput;
  // Surface Grinding — every CAD planar face (a title-block Ra applies to
  // every surface), same Ra trigger as the other grinding lines. Faces are
  // grouped by size; lengthMm is the face's longest extent, widthMm its area
  // divided by that length.
  planarFaces?: Array<{ lengthMm: number; widthMm: number; count: number }>;
  surfaceGrindingParams?: SurfaceGrindingParams | null;
  surfaceGrindingRate?: MHRRateInput;
  // Keyway Broaching (new) -- real "keyway" occurrences pulled out of
  // fgv2Features by splitKeywayOccurrences() BEFORE buildOperationSequence
  // runs (same pre-filter pattern as gunDrillCandidates/deepBoreCandidates
  // above), each carrying its own real length/width/depth_mm. Genuinely
  // LINEAR stroke-based physics (time = stroke length / cutting speed),
  // not the rotary MRR every other feature-based op in this file uses --
  // see computeKeywayBroachingLine.
  keywayCandidates?: Array<{ lengthMm: number; widthMm: number; depthMm: number; count: number }>;
  // The reference keyway broaches (pull type / shim type) and positioning
  // times — see keywayBroachingLookupSeeds.
  keywayBroach?: KeywayBroachReference | null;
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
    roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number; dataFound: boolean; materialCutCode?: string; toolType?: string;
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
    dataFound: boolean; materialCutCode?: string; toolType?: string;
  } | null;
  // Real, distinct operation names per machine class (new) --
  // BOMItemsService.resolveMachiningOperationCategories, queried from
  // process_taxonomy_operations (migration 754, real
  // memory/machining/operations_full.json compound strings). Used by
  // resolveOperationName() below to confirm each line's own operation name
  // against the real catalog for that machine class instead of trusting a
  // string literal written in this file to still match it.
  realOperationCategories?: Record<string, string[]> | null;
  // Real, spindle-count-resolved multi-station splitting for Rough Turning
  // on a Simultaneous Turning machine (MachiningLookupService.
  // getMultiSpindleOpSplit('Ring', 'Rough Turning', mhrRate.numberSpindles),
  // migration 785 — tblMultiSpindleOpSplitting/Thresholds). null/absent for
  // every other machine class, or when the resolved machine has no real
  // spindle count on file. Only Rough Turning is covered — no real per-hole
  // depth is tracked for turned parts in this function (holeGroups here
  // carries diameter only), so the SimpleHole/Drilling|Pecking threshold
  // from the same real table is a disclosed gap, not silently applied.
  roughTurningOpSplit?: { shouldSplit: boolean; numberOfOperations: number; thresholdRatio: number | null; dataFound: boolean } | null;
}

export interface MachiningCapabilityResult {
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

// Real ops that buildOperationSequence() emits into the milling bucket's own
// featureOps array but that are billed as their OWN dedicated process line at
// their OWN dedicated rate elsewhere (Tapping at tappingRate, Deburring at
// deburrRate — see computeMillingCostSummary's own doc comment on this
// exact set, just below). Exported (not a local const) so
// bom-items.service.ts's buildMachiningFeatureBreakdown — which builds the
// UI-visible per-operation list for this SAME milling line — filters by
// the exact same real set instead of an independently hand-kept copy that can
// (and did) drift from this one.
export const MILLING_DOUBLE_BILLED_ELSEWHERE = new Set(['Tapping', 'Deburr']);

// The real process name for a machine class, per memory/machining/
// processes.csv's own 43-process catalog (e.g. "3 Axis Mill", "5 Axis Mill",
// "2 Axis Bar Feed Lathe with Sub Spindle") — MACHINE_REGISTRY's
// machineClassKeywords[0] for every Machining class is already exactly that
// real name (used elsewhere for MHR machine-name matching). Replaces the
// generic, class-blind "CNC Milling"/"CNC Setup" literals that used to name
// this line and its setup-fallback warning regardless of which real class
// was actually selected and costed — a 5-axis-mill part previously showed
// "CNC Milling", identical to a 3-axis-mill part, with no real process
// distinction. Falls back to the raw class id only if a class is somehow
// missing from the registry (never crashes on an unrecognized class).
function realProcessName(machineClass: MachineClassId): string {
  const entry = (MACHINE_REGISTRY as Record<string, { machineClassKeywords: readonly string[] }>)[machineClass as unknown as string];
  return entry?.machineClassKeywords?.[0] ?? (machineClass as unknown as string);
}

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

interface DrillCycle {
  /** Seconds for the holes; null when a real input or the calculator is missing. */
  sec: number | null;
  trace: CalculationTraceStep[];
  missing: string[];
  calculatorId: string | null;
  calculatorVersion: number | null;
  lookups: CalcRun['lookups'];
}

/**
 * Drilling time for `holes` holes of one diameter, evaluated by the
 * "Drilling" machining calculator: CAD diameter and depth, cutting speed and
 * feed from the real tblDrilling row (resolveDrillingParams). Missing CAD
 * depth or table row → no time, the missing input named.
 */
export function computeDrillCycle(
  diameterMm: number,
  materialGrade: string | null | undefined,
  depthMm: number | null | undefined,
  drillingTable: DrillingTable | null | undefined,
  calculators: MachiningCalculators | null | undefined,
  holes = 1,
): DrillCycle {
  const matClass = detectMaterialClass(materialGrade ?? null);
  const lookup = drillingLookupSeeds({ matClass, drillingTable }, { 'Hole Diameter': diameterMm });
  const run = runMachiningCalculator(calculators, 'Drilling', { ...holeSeeds(diameterMm, depthMm, holes), ...lookup.seeds });
  const missing = run.missing.length > 0 ? [...lookup.missing, ...run.missing] : run.missing;
  return { sec: run.sec, trace: run.trace, missing, calculatorId: run.calculatorId, calculatorVersion: run.calculatorVersion, lookups: run.lookups };
}

/**
 * Drilling time for every hole on the part: one "Drilling" calculator run per
 * hole-diameter group. Groups without real inputs are left unpriced and named.
 */
function drillHoleGroups(
  holeGroups: Array<{ diameter_mm: number; count: number; depth_mm?: number }>,
  holeCount: number,
  materialGrade: string | null | undefined,
  drillingTable: DrillingTable | null | undefined,
  calculators: MachiningCalculators | null | undefined,
): { min: number; trace: CalculationTraceStep[]; missing: string[]; calculatorId: string | null; calculatorVersion: number | null; lookups: CalcRun['lookups'] } {
  const trace: CalculationTraceStep[] = [];
  const missing: string[] = [];
  const lookups: CalcRun['lookups'] = {};
  let totalSec = 0;
  let calculatorId: string | null = null;
  let calculatorVersion: number | null = null;
  if (holeGroups.length === 0) {
    if (holeCount > 0) missing.push(`per-diameter CAD hole data (${holeCount} hole${holeCount === 1 ? '' : 's'} counted, no diameters/depths)`);
    return { min: 0, trace, missing, calculatorId, calculatorVersion, lookups };
  }
  const multi = holeGroups.length > 1;
  for (const g of holeGroups) {
    const cycle = computeDrillCycle(g.diameter_mm, materialGrade, g.depth_mm, drillingTable, calculators, g.count);
    calculatorId = cycle.calculatorId ?? calculatorId;
    calculatorVersion = cycle.calculatorVersion ?? calculatorVersion;
    Object.assign(lookups, cycle.lookups);
    if (cycle.sec == null) {
      missing.push(...cycle.missing.map((m) => `${m} (Ø${g.diameter_mm} mm × ${g.count})`));
      continue;
    }
    totalSec += cycle.sec;
    trace.push(...(multi ? prefixTrace(`Ø${g.diameter_mm} mm ·`, cycle.trace) : cycle.trace));
  }
  if (multi && trace.length > 0) trace.push(traceCalc('Drilling cycle time', totalSec, 's', 'Sum of every hole-diameter group Cycle Time'));
  return { min: totalSec / 60, trace, missing, calculatorId, calculatorVersion, lookups };
}

// Same disclosed depth-to-diameter assumption as drilling (DRILL_DEPTH_TO_DIAMETER_RATIO)
// — reused, not reinvented, when a counterbore/ream occurrence has no real depth of its own.
export { DRILL_DEPTH_TO_DIAMETER_RATIO };

type Identity = Record<string, { processGroup: string; processRoute: string; operation: string }> | undefined;
type HoleGroup = { diameter_mm: number; count: number; depth_mm?: number };
type GrindingParams = { workSpeedMMin: number; roughInfeedMm: number; finishInfeedMm: number; roughAxialFeedRevMm: number; finishAxialFeedRevMm: number; dataFound: boolean; materialCutCode?: string; match?: { table: string; row: Record<string, string | number> } };

const smallestGroup = (groups: HoleGroup[]): HoleGroup =>
  groups.reduce((a, b) => (b.diameter_mm < a.diameter_mm ? b : a), groups[0]!);

/**
 * A secondary operation on its own machine (or the main machine): its
 * calculator run plus the machine's real per-machine setup_time_hr (not costed
 * when the machine has none), as one line.
 */
function secondaryLine(
  process: string,
  run: CalcRun,
  rate: MHRRateInput,
  batchSize: number,
  warnings: string[],
  identity: Identity,
  extraMissing: string[] = [],
): ProcessLineCost {
  const gap = [...extraMissing, ...run.missing];
  if (gap.length > 0) warnings.push(`${process} not priced — missing real input: ${gap.join('; ')}.`);
  const runMin = (run.sec ?? 0) / 60;
  const setupResolution = resolveSetupMinutes({
    process, machineSetupTimeHr: rate.setupTimeHr, machineName: rate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupCost = r2((setupResolution.setupMin / Math.max(batchSize, 1) / 60) * rate.rate);
  const runCost = r2((runMin / 60) * rate.rate);
  return withRun(
    makeLine(process, setupCost, runCost, runMin, rate, identity, { setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source }),
    run, setupTraceSteps(setupResolution, rate.machineName, batchSize), extraMissing,
  );
}

/** Sums several calculator runs of one operation (one per real occurrence group). */
function sumRuns(runs: Array<{ label: string; run: CalcRun }>, total: string): CalcRun {
  if (runs.length === 1) return runs[0]!.run;
  const trace: CalculationTraceStep[] = [];
  const missing: string[] = [];
  let sec = 0;
  let anyPriced = false;
  for (const { label, run } of runs) {
    trace.push(...prefixTrace(`${label} ·`, run.trace));
    missing.push(...run.missing.map((m) => `${m} (${label})`));
    if (run.sec != null) { sec += run.sec; anyPriced = true; }
  }
  if (anyPriced) trace.push(traceCalc(total, sec, 's', 'Sum of every group Cycle Time'));
  const first = runs.find((r) => r.run.calculatorId)?.run;
  const lookups = Object.assign({}, ...runs.map((r) => r.run.lookups));
  return { sec: anyPriced ? sec : null, trace, missing, calculatorId: first?.calculatorId ?? null, calculatorVersion: first?.calculatorVersion ?? null, lookups };
}

function grindingSeeds(
  diameterMm: number, diameterSource: string, lengthMm: number | null | undefined, lengthSource: string,
  surfaces: number, lookup: LookupSeeds,
): Record<string, CalcSeed> {
  const seeds: Record<string, CalcSeed> = {
    'Grind Diameter': { value: diameterMm, source: diameterSource },
    'Surfaces': { value: surfaces, source: 'CAD: surfaces to grind' },
    ...lookup.seeds,
  };
  if (lengthMm != null && lengthMm > 0) seeds['Grind Length'] = { value: lengthMm, source: lengthSource };
  return seeds;
}

// ── Reaming — tolerance-triggered finishing pass through the smallest real
// hole group (tight-tolerance requirements concentrate on the precision
// locating holes). tblReaming speed/feed for that diameter and material; the
// hole depth is the group's real CAD depth.
function computeReamingLine(
  calculators: MachiningCalculators | null | undefined,
  holeGroups: HoleGroup[],
  matClass: MaterialClass,
  reamTable: any[] | null | undefined,
  rate: MHRRateInput,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost {
  const g = smallestGroup(holeGroups);
  const seeds = { ...holeSeeds(g.diameter_mm, g.depth_mm, g.count), ...reamingLookupSeeds({ matClass, reamTable }, { 'Hole Diameter': g.diameter_mm }).seeds };
  const run = runMachiningCalculator(calculators, 'Reaming', seeds);
  const gap = run.missing;
  if (gap.length > 0) warnings.push(`Reaming not priced — missing real input: ${gap.join('; ')}.`);
  const min = (run.sec ?? 0) / 60;
  // Reaming runs on the part's primary machine (rate), whose real setup is
  // already charged on that machine's own line — no separate coded reamer
  // setup is added.
  return withRun(makeLine('Reaming', 0, r2((min / 60) * rate.rate), min, rate, identity), run, []);
}

// The finishing-process rules (capability-rules.ts), or null with one
// warning naming the absent reference values: no grinding / jig line is then
// decided, rather than decided on a number the database does not hold.
function capabilityRulesOrWarn(input: MachiningCostInput, warnings: string[]): MachiningCapabilityRules | null {
  if (input.capabilityRules) return input.capabilityRules;
  const w = `Grinding, jig boring and jig grinding not evaluated: capability reference data missing (${(input.capabilityRulesMissing ?? ['not loaded']).join('; ')}).`;
  if (!warnings.includes(w)) warnings.push(w);
  return null;
}

// ── Jig Boring — tier above reaming (rules.jigBorePositionToleranceMm):
// tblBoringV2 finish-boring physics repeated tblGtolProcessCapabilities'
// jig-boring pass count, on the smallest real hole group.
function computeJigBoreLine(
  calculators: MachiningCalculators | null | undefined,
  tightestToleranceMm: number | null | undefined,
  rules: MachiningCapabilityRules,
  holeGroups: HoleGroup[],
  matClass: MaterialClass,
  finishBoringTable: any[] | null | undefined,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (tightestToleranceMm == null || tightestToleranceMm <= 0 || tightestToleranceMm > rules.jigBorePositionToleranceMm) return null;
  if (holeGroups.length === 0 || !rate) return null;
  const g = smallestGroup(holeGroups);
  const seeds = { ...holeSeeds(g.diameter_mm, g.depth_mm, g.count), ...jigBoringLookupSeeds({ matClass, finishBoringTable, capabilityRules: rules }, { 'Hole Diameter': g.diameter_mm }).seeds };
  return secondaryLine('Jig Boring', runMachiningCalculator(calculators, 'Jig Boring', seeds), rate, batchSize, warnings, identity);
}

// ── Deep-hole routing (Gun Drilling / Deep Bore Machine) — each candidate is
// a real per-occurrence CAD signal (depth vs diameter, deep-hole-routing.ts);
// its speed/feed come from the shared lookup resolvers (machining-lookup-seeds.ts).
function computeDeepHoleLine(
  calculators: MachiningCalculators | null | undefined,
  processName: 'Gun Drilling' | 'Deep Bore Machine',
  candidates: DeepHoleCandidate[] | undefined,
  lookupSeeds: (diameterMm: number) => LookupSeeds,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  const runs = candidates.map((c) => {
    const seeds = { ...holeSeeds(c.diameterMm, c.depthMm, c.count), ...lookupSeeds(c.diameterMm).seeds };
    return { label: `Ø${c.diameterMm} mm × ${c.depthMm} mm`, run: runMachiningCalculator(calculators, processName, seeds) };
  });
  return secondaryLine(processName, sumRuns(runs, `${processName} cycle time`), rate, batchSize, warnings, identity);
}

// ── Cylindrical Grinding — turned OD, drawing Ra below turning/milling's
// best achievable (capability-rules.ts grindingRaTriggerUm).
function computeCylindricalGrindingLine(
  calculators: MachiningCalculators | null | undefined,
  tightestRaMicron: number | null | undefined,
  rules: MachiningCapabilityRules,
  partDiameterMm: number,
  partDiameterSource: string,
  partLengthMm: number,
  partLengthSource: string,
  params: GrindingParams | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (tightestRaMicron == null || tightestRaMicron <= 0 || tightestRaMicron >= rules.grindingRaTriggerUm) return null;
  if (!rate) return null;
  const run = runMachiningCalculator(calculators, 'Cylindrical Grinding',
    grindingSeeds(partDiameterMm, partDiameterSource, partLengthMm, partLengthSource, 1, grindingLookupSeeds({ matClass, grindingParams: params, capabilityRules: rules })));
  return secondaryLine('Cylindrical Grinding', run, rate, batchSize, warnings, identity);
}

// ── Internal Grinding — the smallest real bore, same Ra trigger; its real
// CAD depth is the ground length.
function computeInternalGrindingLine(
  calculators: MachiningCalculators | null | undefined,
  tightestRaMicron: number | null | undefined,
  rules: MachiningCapabilityRules,
  holeGroups: HoleGroup[],
  params: GrindingParams | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (tightestRaMicron == null || tightestRaMicron <= 0 || tightestRaMicron >= rules.grindingRaTriggerUm) return null;
  if (holeGroups.length === 0 || !rate) return null;
  // Every bore: a title-block Ra applies to every surface.
  const runs = holeGroups.map((g) => ({
    label: `Ø${g.diameter_mm} mm bore`,
    run: runMachiningCalculator(calculators, 'Internal Grinding',
      grindingSeeds(g.diameter_mm, 'CAD: bore diameter', g.depth_mm, 'CAD: bore depth', g.count,
        grindingLookupSeeds({ matClass, internalGrindingParams: params, capabilityRules: rules }, undefined, 'tblInternalGrinding'))),
  }));
  return secondaryLine('Internal Grinding', sumRuns(runs, 'Internal grinding cycle time'), rate, batchSize, warnings, identity);
}

// ── Rotary Broaching — polygon sockets on the part's own machine: the pilot
// hole (variables pilotRotaryBroachHoleDiamPercentIncreaseHex / Square x across
// flats, pilotRotaryBroachHoleLengthPercentIncrease x depth) through the
// Drilling calculator, then the broach (tblRotaryBroaching).
function computeRotaryBroachingLine(
  input: MachiningCostInput,
  machineClass: string,
  matClass: MaterialClass,
  warnings: string[],
): ProcessLineCost | null {
  const polygons = input.polygons ?? [];
  for (const p of polygons.filter((x) => x.kind === 'boss')) {
    warnings.push(`Polygon turning (${p.sides}-sided, ${p.acrossFlatsMm} mm across flats) not priced — tblPolygonTurning gives cutter speed and feed but not the cutter-to-workpiece speed ratio a cycle time needs.`);
  }
  const sockets = polygons.filter((x) => x.kind === 'socket');
  if (sockets.length === 0) return null;
  const ref = input.rotaryBroach;
  const runs = sockets.flatMap((p) => {
    const label = `${p.sides}-sided ${p.acrossFlatsMm} mm A/F socket`;
    const out: Array<{ label: string; run: CalcRun }> = [];
    const diaRatio = ref?.pilotDiameterRatio[p.sides];
    if (diaRatio == null || ref?.pilotLengthRatio == null) {
      out.push({ label: `${label} pilot hole`, run: { sec: null, trace: [], calculatorId: null, calculatorVersion: null, lookups: {},
        missing: [`a pilot-hole ratio for a ${p.sides}-sided polygon (variables give hex and square only)`] } });
    } else {
      const pilot = computeDrillCycle(p.acrossFlatsMm * diaRatio, input.materialGrade, p.depthMm * ref.pilotLengthRatio, input.drillingTable, input.machiningCalculators, p.count);
      out.push({ label: `${label} pilot Ø${(p.acrossFlatsMm * diaRatio).toFixed(2)} x ${(p.depthMm * ref.pilotLengthRatio).toFixed(2)} mm`,
        run: { sec: pilot.sec, trace: pilot.trace, missing: pilot.missing, calculatorId: pilot.calculatorId, calculatorVersion: pilot.calculatorVersion, lookups: pilot.lookups } });
    }
    const lookup = rotaryBroachingLookupSeeds({ matClass, rotaryBroach: ref }, { 'Across Flats': p.acrossFlatsMm, 'Polygon Depth': p.depthMm });
    const run = runMachiningCalculator(input.machiningCalculators, 'Rotary Broaching', {
      'Polygon Depth': { value: p.depthMm, source: 'CAD: polygon ring depth along its axis' },
      'Polygons': { value: p.count, source: 'CAD: polygon sockets of this size' },
      ...lookup.seeds,
    });
    if (run.missing.length > 0) run.missing.unshift(...lookup.missing);
    out.push({ label: `${label} broach`, run });
    return out;
  });
  return secondaryLine('Rotary Broaching', sumRuns(runs, 'Rotary broaching cycle time'), { ...input.mhrRate, machineClass }, input.batchSize, warnings, input.processIdentityByMachineClass);
}

// ── Surface Grinding — every CAD planar face, same Ra trigger as the other
// grinding lines; reciprocating traverse grinding (tblReciprocatingSurfaceGrinding).
function computeSurfaceGrindingLine(
  calculators: MachiningCalculators | null | undefined,
  tightestRaMicron: number | null | undefined,
  rules: MachiningCapabilityRules,
  faces: Array<{ lengthMm: number; widthMm: number; count: number }> | undefined,
  params: SurfaceGrindingParams | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (tightestRaMicron == null || tightestRaMicron <= 0 || tightestRaMicron >= rules.grindingRaTriggerUm) return null;
  if (!faces?.length || !rate) return null;
  const lookup = surfaceGrindingLookupSeeds({ matClass, surfaceGrindingParams: params, capabilityRules: rules });
  const runs = faces.map((f) => {
    const run = runMachiningCalculator(calculators, 'Surface Grinding', {
      'Grind Length': { value: f.lengthMm, source: 'CAD: planar face, longest extent' },
      'Grind Width': { value: f.widthMm, source: 'CAD: planar face area / its longest extent' },
      'Faces': { value: f.count, source: 'CAD: planar faces of this size' },
      ...lookup.seeds,
    });
    if (run.missing.length > 0) run.missing.unshift(...lookup.missing);
    return { label: `${f.lengthMm} × ${f.widthMm} mm face`, run };
  });
  return secondaryLine('Surface Grinding', sumRuns(runs, 'Surface grinding cycle time'), rate, batchSize, warnings, identity);
}

// ── Jig Grind — hardened (real heat-treat callout) precision bore: traverse
// grinding repeated tblGtolProcessCapabilities' jig-grinding pass count.
function computeJigGrindLine(
  calculators: MachiningCalculators | null | undefined,
  rules: MachiningCapabilityRules,
  holeGroups: HoleGroup[],
  params: GrindingParams | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (holeGroups.length === 0 || !rate) return null;
  const g = smallestGroup(holeGroups);
  // Bore grinding: tblInternalGrinding values (memory/ has no jig-grinding
  // table of its own), repeated per tblGtolProcessCapabilities.
  const seeds = grindingSeeds(g.diameter_mm, 'CAD: bore diameter', g.depth_mm, 'CAD: bore depth', g.count, grindingLookupSeeds({ matClass, internalGrindingParams: params, capabilityRules: rules }, 'jig_grind', 'tblInternalGrinding'));
  return secondaryLine('Jig Grind', runMachiningCalculator(calculators, 'Jig Grind', seeds), rate, batchSize, warnings, identity);
}

// ── Keyway Broaching — the reference broach for each keyway's width and
// length (pull type single pass first, else shim type multipass).
function computeKeywayBroachingLine(
  calculators: MachiningCalculators | null | undefined,
  candidates: Array<{ lengthMm: number; widthMm: number; depthMm: number; count: number }> | undefined,
  keywayBroach: KeywayBroachReference | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  const runs = candidates.map((c) => {
    const seeds: Record<string, CalcSeed> = {
      'Keyway Length': { value: c.lengthMm, source: 'CAD: keyway length' },
      'Keyway Width': { value: c.widthMm, source: 'CAD: keyway width' },
      'Keyways': { value: c.count, source: 'CAD: keyways of this size' },
    };
    const lookup = keywayBroachingLookupSeeds({ matClass, keywayBroach }, { 'Keyway Width': c.widthMm, 'Keyway Length': c.lengthMm });
    const run = runMachiningCalculator(calculators, 'Keyway Broaching', { ...seeds, ...lookup.seeds });
    if (run.missing.length > 0) run.missing.unshift(...lookup.missing);
    return { label: `${c.lengthMm} × ${c.widthMm} mm keyway`, run };
  });
  return secondaryLine('Keyway Broaching', sumRuns(runs, 'Keyway broaching cycle time'), rate, batchSize, warnings, identity);
}

// ── Wire EDM — hardened slots (real heat-treat callout): one roughing and one
// finishing wire pass over the real cut path (tblWireEDMing feed rates).
function computeWireEdmLine(
  calculators: MachiningCalculators | null | undefined,
  candidates: Array<{ lengthMm: number; count: number }> | undefined,
  params: { roughFeedRateMmPerMin: number; finishFeedRateMmPerMin: number; dataFound: boolean; materialCutCode?: string } | null | undefined,
  matClass: MaterialClass,
  rate: MHRRateInput | undefined,
  batchSize: number,
  warnings: string[],
  identity: Identity,
): ProcessLineCost | null {
  if (!candidates?.length || !rate) return null;
  const runs = candidates.map((c) => {
    const seeds: Record<string, CalcSeed> = {
      'Cut Length': { value: c.lengthMm, source: 'CAD: slot cut path length' },
      'Cuts': { value: c.count, source: 'CAD: slots of this length' },
      ...wireEdmLookupSeeds({ matClass, wireEdmParams: params }).seeds,
    };
    return { label: `${c.lengthMm} mm cut`, run: runMachiningCalculator(calculators, 'Wire EDM', seeds) };
  });
  return secondaryLine('Wire EDM', sumRuns(runs, 'Wire EDM cycle time'), rate, batchSize, warnings, identity);
}

// ── Per-machine constants ─────────────────────────────────────────────────────
// Fixture costs are 0 until the cnc_fixture_rates table is seeded in a future
// migration. The service will pass fixtureUnitCostLocal via MachiningCostInput.

// SETUP_COUNT: how many setups (rechucks) a class needs for a part — used for
// route ranking (setupCount on the result), NOT for setup cost. Setup cost is
// the selected machine's real mhr_records.setup_time_hr via
// resolveSetupMinutes(); with none on file, setup is not costed.
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
  // A multi-spindle automatic completes every station in one continuous
  // index cycle — no rechucking between operations (that's the whole real
  // manufacturing advantage of the machine type), same as the bar-feed
  // lathe classes above.
  simultaneous_turning: 1,
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
  // Real, conservative: the MINIMUM max_length_mm/max_diameter_mm across all
  // 14 real machines in simultaneous_turning_usa.csv (range 70-1000mm length,
  // 22-90mm diameter) — same "conservative class default from real per-
  // machine limits" discipline used elsewhere this session, not an invented
  // envelope. No real machine weight-capacity data exists for this class
  // either, so maxWeightKg reuses the same disclosed bar-feed-lathe default.
  simultaneous_turning: { l: 70, w: 22, h: 22, maxWeightKg: 150 },
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
export function resolveOperationName(
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

/**
 * Deburring line from real inputs only: the part's CAD sharp-edge length
 * travelled at the real tblDeburring edge speed for this material. Either
 * missing → the line reports the gap; nothing is estimated in its place.
 */
function computeDeburringLine(
  input: MachiningCostInput,
  deburrRate: MHRRateInput,
  matClass: MaterialClass,
  warnings: string[],
): ProcessLineCost | null {
  const seeds: Record<string, CalcSeed> = {};
  if (input.sharpEdgeLengthMm != null && input.sharpEdgeLengthMm > 0) {
    seeds['Sharp Edge Length'] = { value: input.sharpEdgeLengthMm, source: 'CAD: total length of sharp B-Rep edges (seams and tangent edges excluded)' };
  }
  Object.assign(seeds, deburringLookupSeeds({
    matClass,
    deburrParams: input.deburrLinearSpeedMmPerSec != null
      ? { linearSpeedMmPerSec: input.deburrLinearSpeedMmPerSec, dataFound: true, materialCutCode: input.deburrMaterialCutCode ?? undefined }
      : null,
  }).seeds);
  const run = runMachiningCalculator(input.machiningCalculators, 'Deburring', seeds);
  const why: string[] = [];
  if (!seeds['Sharp Edge Length']) why.push('CAD sharp-edge length (re-run CAD analysis to measure it)');
  if (!seeds['Edge Speed']) why.push(`tblDeburring edge speed for ${matClass}`);
  const missing = run.sec == null ? (why.length ? why : run.missing) : [];
  if (missing.length > 0) warnings.push(`Deburring not priced — missing real input: ${missing.join('; ')}.`);
  const min = (run.sec ?? 0) / 60;
  return withRun(
    makeLine('Deburring', 0, r2((min / 60) * deburrRate.rate), min, deburrRate, input.processIdentityByMachineClass),
    { ...run, missing },
  );
}

const EMPTY_RUN: CalcRun = { sec: null, trace: [], missing: [], calculatorId: null, calculatorVersion: null, lookups: {} };

/** Attaches a calculator run (trace, gap, calculator identity) to a line. */
function withRun(
  line: ProcessLineCost,
  run: Pick<CalcRun, 'trace' | 'missing' | 'calculatorId' | 'calculatorVersion'> & { lookups?: CalcRun['lookups'] },
  extraTrace: CalculationTraceStep[] = [],
  extraMissing: string[] = [],
): ProcessLineCost {
  const out = withTrace(line, [...run.trace, ...extraTrace], [...run.missing, ...extraMissing]);
  if (run.calculatorId) {
    out.calculatorId = run.calculatorId;
    out.calculatorVersion = run.calculatorVersion ?? 1;
  }
  if (run.lookups && Object.keys(run.lookups).length > 0) out.lookupMatches = run.lookups;
  return out;
}

/** CAD hole diameter / depth / count as calculator seeds (depth omitted when CAD has none). */
function holeSeeds(diameterMm: number, depthMm: number | null | undefined, count: number): Record<string, CalcSeed> {
  const seeds: Record<string, CalcSeed> = {
    'Hole Diameter': { value: diameterMm, source: 'CAD: hole diameter' },
    'Holes': { value: count, source: 'CAD: holes of this diameter' },
  };
  if (depthMm != null && depthMm > 0) seeds['Hole Depth'] = { value: depthMm, source: 'CAD: hole depth' };
  return seeds;
}

/** Where a resolved setup time came from, as trace steps (see resolveSetupMinutes). */
function setupTraceSteps(
  resolution: SetupTimeResolution,
  machineName: string | null,
  batchSize: number,
): CalculationTraceStep[] {
  const source =
    resolution.source === 'machine' ? `Machine: ${machineName ?? 'selected machine'} setup_time_hr (mhr_records)`
    : resolution.source === 'calculator' ? 'Calculator: setup modelled for this part'
    : resolution.source === 'operation_lookup' ? 'Lookup: per-operation setup time'
    : 'Assumption: class default setup (no setup time on the machine record)';
  const batch = Math.max(batchSize, 1);
  return [
    traceInput('Setup time', resolution.setupMin, 'min', source),
    traceInput('Batch size', batch, null, 'BOM: batch size'),
    traceCalc('Setup per part', resolution.setupMin / batch, 'min', 'Setup time / Batch size'),
  ];
}

/**
 * Attaches a line's calculation trace and the confidence it supports:
 * 'verified' when every input is measured or looked up, 'derived' when any
 * input is a disclosed assumption (see machining-trace.ts).
 */
function withTrace(line: ProcessLineCost, trace: CalculationTraceStep[], missing: string[] = []): ProcessLineCost {
  if (trace.length > 0) {
    line.calculationTrace = trace;
    line.confidence = traceHasAssumption(trace) ? 'derived' : 'verified';
  }
  if (missing.length > 0) {
    // Part of this line's work has no real input to price it with: shown as a
    // gap (and the line total excludes it), never filled with a stand-in value.
    line.physicsGap = {
      gapType: 'unsupported_operation',
      process: line.process,
      machineClass: line.machineClass,
      reason: `Not priced — missing real input: ${missing.join('; ')}.`,
    };
    line.confidence = 'unsupported';
  }
  return line;
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
  // An operation run on another machine (rate.hostMachineClass) takes that
  // machine's Process/Category, and its own name as the Operation — never the
  // operation class's identity (tapping's catalog row is Sheet Metal). No host
  // identity on file means no identity, not the wrong one.
  const hostClass = rate.hostMachineClass;
  const hostIdentity = hostClass ? processIdentityByMachineClass?.[hostClass] : undefined;
  const identity = hostClass
    ? (hostIdentity ? { processGroup: hostIdentity.processGroup, processRoute: hostIdentity.processRoute, operation: process } : undefined)
    : processIdentityByMachineClass?.[rate.machineClass];
  return {
    process,
    ...(identity ? { processGroup: identity.processGroup, processRoute: identity.processRoute, operation: identity.operation } : {}),
    ...(hostClass ? { hostMachineClass: hostClass } : {}),
    setupCost: r2(setupCost),
    runCost: r2(runCost),
    totalCost: r2(setupCost + runCost),
    // Four decimals (0.006 s): two decimals of a minute is 0.6 s, which turned
    // a real 2.63 s drilling cycle into a displayed 2.4 s.
    cycleTimeMin: Math.round(cycleTimeMin * 10000) / 10000,
    hourlyRate: rate.rate,
    rateSource: rate.source,
    machineClass: rate.machineClass,
    machineName: rate.machineName,
    commodityCode: rate.commodityCode,
    labourRate: rate.labourRate ?? null,
    ...(setupDisclosure ? { setupTimeMin: setupDisclosure.setupTimeMin, setupTimeSource: setupDisclosure.setupTimeSource } : {}),
  };
}

/**
 * One thread-size group through the "Tapping" calculator: nominal diameter
 * from the thread size (M8 -> 8 mm), the part's pitch else the ISO 261 coarse
 * pitch of that size, the part's thread depth, and tblTapping's cutting speed.
 * A size that is not metric, an off-series size with no pitch, or a thread
 * with no depth is left unpriced and named — never an assumed value.
 */
export function computeTapCycle(
  thread: { size: string; count: number; pitchMm?: number; depthMm?: number },
  matClass: MaterialClass,
  tappingTable: any[] | null | undefined,
  calculators: MachiningCalculators | null | undefined,
): DrillCycle {
  const none = (missing: string[]): DrillCycle => ({ sec: null, trace: [], missing, calculatorId: null, calculatorVersion: null, lookups: {} });
  const m = /^M\s*(\d+(?:\.\d+)?)/i.exec(String(thread.size ?? '').trim());
  if (!m) return none([`a metric thread size (got "${thread.size}")`]);
  const diameterMm = Number(m[1]);
  const pitchMm = thread.pitchMm != null && thread.pitchMm > 0 ? thread.pitchMm : isoCoarsePitchMm(diameterMm);
  const seeds: Record<string, CalcSeed> = {
    'Thread Diameter': { value: diameterMm, source: `Thread size ${thread.size}` },
    'Threads': { value: thread.count, source: 'CAD/drawing: threads of this size' },
  };
  if (pitchMm != null) {
    seeds['Thread Pitch'] = thread.pitchMm != null && thread.pitchMm > 0
      ? { value: pitchMm, source: 'CAD/drawing: thread pitch' }
      : { value: pitchMm, source: `ISO 261 coarse pitch of M${diameterMm}` };
  }
  if (thread.depthMm != null && thread.depthMm > 0) seeds['Thread Depth'] = { value: thread.depthMm, source: 'CAD: tapped hole depth' };
  const lookup = pitchMm != null ? tappingLookupSeeds({ matClass, tappingTable }, { 'Thread Pitch': pitchMm }) : { seeds: {}, missing: [`a thread pitch (M${diameterMm} is off the ISO 261 coarse series and none was given)`] };
  const run = runMachiningCalculator(calculators, 'Tapping', { ...seeds, ...lookup.seeds });
  const missing = run.missing.length > 0 ? [...lookup.missing, ...run.missing] : run.missing;
  return { sec: run.sec, trace: run.trace, missing, calculatorId: run.calculatorId, calculatorVersion: run.calculatorVersion, lookups: run.lookups };
}

/** Tapping time for every thread on the part: one calculator run per thread-size group. */
function tapThreadGroups(
  threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number }>,
  matClass: MaterialClass,
  tappingTable: any[] | null | undefined,
  calculators: MachiningCalculators | null | undefined,
): { min: number; trace: CalculationTraceStep[]; missing: string[]; calculatorId: string | null; calculatorVersion: number | null; lookups: CalcRun['lookups'] } {
  const trace: CalculationTraceStep[] = [];
  const missing: string[] = [];
  const lookups: CalcRun['lookups'] = {};
  let totalSec = 0;
  let calculatorId: string | null = null;
  let calculatorVersion: number | null = null;
  const multi = threads.length > 1;
  for (const t of threads) {
    const cycle = computeTapCycle(t, matClass, tappingTable, calculators);
    calculatorId = cycle.calculatorId ?? calculatorId;
    calculatorVersion = cycle.calculatorVersion ?? calculatorVersion;
    Object.assign(lookups, cycle.lookups);
    if (cycle.sec == null) {
      missing.push(...cycle.missing.map((x) => `${x} (${t.size} × ${t.count})`));
      continue;
    }
    totalSec += cycle.sec;
    trace.push(...(multi ? prefixTrace(`${t.size} ·`, cycle.trace) : cycle.trace));
  }
  if (multi && trace.length > 0) trace.push(traceCalc('Tapping cycle time', totalSec, 's', 'Sum of every thread-size group Cycle Time'));
  return { min: totalSec / 60, trace, missing, calculatorId, calculatorVersion, lookups };
}

/**
 * GD&T inspection minutes (up to 5 callouts): the inspection_rules time per
 * callout when resolved, else the coded severity matrix — with the source that
 * applied. gdtFeatures and the part's GD&T count come from the same resolver
 * (resolveGdtCallouts), so there is no count without callouts to time.
 */
function gdtInspectionTime(
  gdtFeatures?: Array<{ symbol: string; tolerance: number; timeMin?: number }>,
): CalcSeed {
  if (gdtFeatures && gdtFeatures.length > 0) {
    const used = gdtFeatures.slice(0, 5);
    const fromRules = used.every((g) => g.timeMin != null);
    return {
      value: used.reduce((sum, g) => sum + (g.timeMin ?? deriveGdtSeverity(g.symbol, g.tolerance).inspectionTimeMin), 0),
      source: fromRules
        ? `inspection_rules: ${used.map((g) => `${g.symbol} ${g.tolerance}`).join(', ')}`
        : 'Assumption: coded GD&T severity matrix for callouts without an inspection_rules row',
    };
  }
  return { value: 0, source: 'No GD&T callouts (STEP model PMI or drawing)' };
}

// ── Inspection line (three-stage sampling, CMM-amortized) ────────────────────
// Cost per part = (setup + FAI + in-process samples + final checks) / batchSize.
//   FAI:        first article, full per-piece measurement, once per batch
//   in-process: 1 of every N parts (samplingPerN override), full measurement
//   final:      1 of every finalPerN parts, short visual/gauge check
// The rate carries CMM equipment amortization when an MHR record exists — the
// MHR engine already prices depreciation/interest/maintenance per effective hour.
function computeInspectionLine(
  holes: number,
  threadCount: number,
  tightestToleranceMm: number | null,
  gdtFeatureCount: number,
  gdtFeatures: Array<{ symbol: string; tolerance: number; timeMin?: number }> | undefined,
  inspectionRate: MHRRateInput,
  batchSize: number,
  samplingPerN: number | undefined,
  samplingPolicy: InspectionStagePolicy | undefined,
  calculators: MachiningCalculators | null | undefined,
  warnings: string[],
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>,
): ProcessLineCost {
  const policy = samplingPolicy ?? INSPECTION_SAMPLING_DEFAULT;
  const policySource = samplingPolicy ? 'Sampling policy: inspection_rules' : 'Assumption: default sampling policy (coded)';
  const batch = Math.max(batchSize, 1);
  const run = runMachiningCalculator(calculators, 'Inspection', {
    'Holes': { value: holes, source: 'CAD: drilled holes' },
    'Threads': { value: threadCount, source: 'Drawing/CAD: threads' },
    'Tightest Tolerance': tightestToleranceMm != null && tightestToleranceMm > 0
      ? { value: tightestToleranceMm, source: 'Drawing: tightest tolerance' }
      : { value: 0, source: 'Drawing: no tolerance callout' },
    'GDT Time': gdtInspectionTime(gdtFeatures),
    'Batch Size': { value: batch, source: 'BOM: batch size' },
    'First Article Pieces': { value: policy.fai ? 1 : 0, source: policySource },
    'In-process 1 in N': { value: Math.max(samplingPerN ?? policy.inProcessPerN, 1), source: samplingPerN != null ? 'Scenario: sampling override' : policySource },
    'Final Check 1 in N': { value: Math.max(policy.finalPerN, 1), source: policySource },
    'Final Check Time': { value: policy.finalCheckMin, source: policySource },
  });
  const cycleMin = (run.sec ?? 0) / 60;
  // Real per-CMM mhr_records.setup_time_hr first, then the cited class
  // constant — see resolveSetupMinutes().
  const setupResolution = resolveSetupMinutes({
    process: 'Inspection',
    machineSetupTimeHr: inspectionRate.setupTimeHr,
    machineName: inspectionRate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupCost = r2((setupResolution.setupMin / 60) * inspectionRate.rate / batch);
  const runCost = r2((cycleMin / 60) * inspectionRate.rate);
  return withRun(makeLine('Inspection', setupCost, runCost, cycleMin, inspectionRate, processIdentityByMachineClass, {
    setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source,
  }), run, setupTraceSteps(setupResolution, inspectionRate.machineName, batchSize));
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
export function checkMachiningCapability(
  machineClass: MachineClassId,
  maxLength: number,
  maxWidth: number,
  maxHeight: number,
  weightKg: number,
  realCapability?: MachineCapability | null,
  capabilitySource?: 'imported' | 'seed' | 'default_class',
): MachiningCapabilityResult {
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
            // elsewhere in this file for turned parts (e.g. computeTurningCostSummary's
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

// ── Milled cost summary ──────────────────────────────────────────────────

export function computeMillingCostSummary(
  input: MachiningCostInput,
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
  // to bbox + the reference per-side stock allowance when the optimizer was not called.
  const allow = 2 * (input.stockAllowancePerSideMm ?? 0);
  if (!input.blankResult && input.stockAllowancePerSideMm == null) {
    warnings.push('Stock allowance not applied to the billet — the reference rule (percentStockAllowance / minStockAllowance / maxStockAllowance, memory/Stock Maching) is not staged.');
  }
  const rawBilletVol =
    maxLength > 0 && maxWidth > 0 && maxHeight > 0
      ? (maxLength + allow) * (maxWidth + allow) * (maxHeight + allow)
      : 0;
  const billetVolMm3 = input.blankResult?.billetVolMm3 ?? rawBilletVol;
  const billetWeightKg = r3((billetVolMm3 / 1e9) * materialDensityKgM3);
  // Stock weight x cost/kg. No markup: the reference has none, and its only
  // scrap adjustment (per-material Scrap Cost Percent) is a resale CREDIT,
  // applied only when enableScrapMaterialCredit is true — false in
  // memory/Machining, Stock Maching and Multi-Spindle Maching.
  const materialCost = r2(billetWeightKg * materialCostPerKg);

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
  // Real per-machine mhr_records.setup_time_hr, else not costed — see
  // resolveSetupMinutes() (no per-operation machining_reference_data table
  // analogous to Sheet Metal's sm_lookup_op_setup_time exists yet).
  const setupCount = SETUP_COUNT[machineClass];
  const setupResolution = resolveSetupMinutes({
    process: realProcessName(machineClass),
    machineSetupTimeHr: mhrRate.setupTimeHr,
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
    // sequencer) emits its OWN "Tapping" entry for every tapped hole (real
    // tapping physics) and an unconditional flat "Deburr" 90s
    // placeholder for every part — but this function ALSO independently
    // computes real Tapping time (tapThreadGroups, the tblTapping
    // calculator, same threads) and real Deburring time
    // (tblDeburring-based deburrMin below), each billed as its OWN dedicated
    // process line at its OWN dedicated rate (tappingRate/deburrRate, not
    // mhrRate) — see MILLING_DOUBLE_BILLED_ELSEWHERE's own doc comment
    // above for why this exact set and why it's shared, not local.
    // 15% rapids/ATC overhead added on top of pure cutting time.
    const totalFeatureSec = input.featureOps
      .filter((o) => !MILLING_DOUBLE_BILLED_ELSEWHERE.has(o.name))
      .reduce((s, o) => s + o.timeSec, 0);
    cncMillingMin = (totalFeatureSec / 60) * 1.15;
  } else {
    // Bbox-subtraction fallback (used when CAD engine did not return feature_graph_v2)
    const materialRemovalMm3 = Math.max(0, billetVolMm3 - volume);
    const roughingMin = materialRemovalMm3 > 0 ? (materialRemovalMm3 / mrr) * 1.3 : 0;

    const drilling = drillHoleGroups(holeGroups, holeCount, materialGrade, input.drillingTable, input.machiningCalculators);
    const drillingMin = drilling.min;
    if (drilling.missing.length > 0) warnings.push(`Drilling not priced for: ${drilling.missing.join('; ')}.`);

    cncMillingMin = roughingMin + drillingMin;
  }
  // Setup always folds into this line (even when cncMillingMin itself is 0
  // and volume data is genuinely unavailable) so the real setup cost is
  // never silently dropped — see setupDisclosure's own doc comment above.
  // Named after the real, class-specific process (realProcessName — "3 Axis
  // Mill"/"4 Axis Mill"/"5 Axis Mill", per memory/machining/processes.csv),
  // not run through resolveOperationName -- it deliberately sums roughing +
  // all hole operations into one number (real per-operation Face/Rough/
  // Finish Milling split needs the power-limited MRR model, staged
  // variables.json + tblEngagementLengthPower, not yet built — a disclosed,
  // known-generic gap, not a fabricated name).
  if (cncMillingMin > 0 || setupCostVal > 0) {
    processLines.push(makeLine(
      realProcessName(machineClass), setupCostVal, r2((cncMillingMin / 60) * mhrRate.rate), cncMillingMin, mhrRate,
      input.processIdentityByMachineClass, setupDisclosure,
    ));
  }
  if (cncMillingMin <= 0) {
    warnings.push('Volume data unavailable — milling time estimated at 0');
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tapping = tapThreadGroups(threads, matClass, input.tappingTable, input.machiningCalculators);
  const tappingMin = tapping.min;
  if (tapping.missing.length > 0) warnings.push(`Tapping not priced for: ${tapping.missing.join('; ')}.`);
  if (tappingMin > 0 || tapping.missing.length > 0) {
    // Tapping on the machining centre (hostMachineClass) shares that machine's
    // setup, already charged on its own line. A dedicated tapping machine uses
    // its own real setup_time_hr, or none — never a coded constant.
    const tapSetupResolution = tappingRate.hostMachineClass
      ? null
      : resolveSetupMinutes({ process: 'Tapping', machineSetupTimeHr: tappingRate.setupTimeHr, machineName: tappingRate.machineName });
    if (tapSetupResolution?.warning) warnings.push(tapSetupResolution.warning);
    const tapSetupMin = tapSetupResolution?.setupMin ?? 0;
    const tapSetup = r2((tapSetupMin / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(withRun(makeLine(
      resolveOperationName(tappingRate.hostMachineClass ?? tappingRate.machineClass, 'Tapping', input.realOperationCategories, warnings),
      tapSetup, tapRun, tappingMin, tappingRate, input.processIdentityByMachineClass,
      tapSetupResolution ? { setupTimeMin: tapSetupMin, setupTimeSource: tapSetupResolution.source } : undefined,
    ), tapping));
  }

  // ── Deburring ────────────────────────────────────────────────────────────
  const deburrLine = computeDeburringLine(input, deburrRate, matClass, warnings);
  if (deburrLine) processLines.push(deburrLine);

  // ── Jig Boring / Jig Grind (new — a real, tighter tier ABOVE Reaming;
  // see capability-rules.ts). Mutually exclusive
  // at the same real tolerance ceiling: a real heat-treat callout routes to
  // Jig Grind instead of Jig Boring (see isRealHeatTreatmentCallout) —────
  const rules = capabilityRulesOrWarn(input, warnings);
  const needsJigGrind = rules != null && tightestToleranceMm != null && tightestToleranceMm > 0 &&
    tightestToleranceMm <= rules.jigBorePositionToleranceMm && isRealHeatTreatmentCallout(input.heatTreatment);
  if (needsJigGrind) {
    const jigGrindLine = computeJigGrindLine(
      input.machiningCalculators, rules, holeGroups, input.internalGrindingParams, matClass, input.jigGrindRate, batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigGrindLine) processLines.push(jigGrindLine);
  } else if (rules) {
    const jigBoreLine = computeJigBoreLine(
      input.machiningCalculators, tightestToleranceMm, rules, holeGroups, matClass, input.jigBoreTable, input.jigBoreRate,
      batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigBoreLine) processLines.push(jigBoreLine);
  }

  // ── Internal Grinding (new — bore/ID grinding; see MachiningCostInput's own
  // doc comment) ───────────────────────────────────────────────────────────
  const internalGrindingLine = rules && computeInternalGrindingLine(
    input.machiningCalculators, input.tightestRaMicron, rules, holeGroups, input.internalGrindingParams, matClass, input.internalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (internalGrindingLine) processLines.push(internalGrindingLine);
  const surfaceGrindingLine = rules && computeSurfaceGrindingLine(
    input.machiningCalculators, input.tightestRaMicron, rules, input.planarFaces, input.surfaceGrindingParams, matClass, input.surfaceGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (surfaceGrindingLine) processLines.push(surfaceGrindingLine);
  const rotaryBroachingLine = computeRotaryBroachingLine(input, machineClass, matClass, warnings);
  if (rotaryBroachingLine) processLines.push(rotaryBroachingLine);

  // ── Reaming (see computeReamCycleSec's own doc comment for why this is
  // tolerance-triggered rather than a distinct CAD feature, and why it
  // applies to the smallest real hole group). Excludes the Jig Boring
  // tier above (tightestToleranceMm > rules.jigBorePositionToleranceMm) —
  // that tighter tolerance band now gets a real, dedicated jig borer
  // instead of reaming, not both.
  if (
    tightestToleranceMm != null && tightestToleranceMm > (rules?.jigBorePositionToleranceMm ?? 0) &&
    tightestToleranceMm <= TIGHT_TOLERANCE_REAM_THRESHOLD_MM &&
    holeGroups.length > 0
  ) {
    processLines.push(computeReamingLine(
      input.machiningCalculators, holeGroups, matClass, input.reamTable, mhrRate, batchSize, warnings, input.processIdentityByMachineClass,
    ));
  }

  // ── Gun Drilling / Deep Bore Machine (new — see deep-hole-routing.ts) ────
  const gunDrillLine = computeDeepHoleLine(
    input.machiningCalculators, 'Gun Drilling', input.gunDrillCandidates,
    (d) => gunDrillingLookupSeeds({ matClass, gunDrillTable: input.gunDrillTable }, { 'Hole Diameter': d }),
    input.gunDrillRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (gunDrillLine) processLines.push(gunDrillLine);

  const deepBoreLine = computeDeepHoleLine(
    input.machiningCalculators, 'Deep Bore Machine', input.deepBoreCandidates,
    (d) => deepBoreLookupSeeds({ matClass, deepBoreMaterials: input.deepBoreMaterials }, { 'Hole Diameter': d }),
    input.deepBoreRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (deepBoreLine) processLines.push(deepBoreLine);

  // ── Keyway Broaching (new — real "keyway" occurrences pre-filtered out of
  // fgv2Features by splitKeywayOccurrences; see MachiningCostInput's own doc
  // comment) ────────────────────────────────────────────────────────────────
  const keywayLine = computeKeywayBroachingLine(
    input.machiningCalculators, input.keywayCandidates, input.keywayBroach, matClass, input.broachRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (keywayLine) processLines.push(keywayLine);

  // ── Wire EDM (new — real "slot" occurrences pre-filtered out of
  // fgv2Features by splitWireEdmOccurrences ONLY when a real heat-treat
  // callout is present; see MachiningCostInput's own doc comment) ───────────────
  const wireEdmLine = computeWireEdmLine(
    input.machiningCalculators, input.wireEdmCandidates, input.wireEdmParams, matClass, input.wireEdmRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (wireEdmLine) processLines.push(wireEdmLine);

  // ── Surface Treatment (anodize / plating — drawing callout) ──────────────
  const surfaceLine = computeSurfaceTreatmentLine(surfaceTreatment, surfaceArea, batchSize, location, warnings, input.surfaceTreatmentDbRate);
  if (surfaceLine) processLines.push(surfaceLine);

  // ── Inspection (batch-sampled; CMM amortization rides on the MHR rate) ───
  processLines.push(computeInspectionLine(
    holeCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures, inspectionRate, batchSize,
    input.samplingPerN, input.samplingPolicy, input.machiningCalculators, warnings, input.processIdentityByMachineClass,
  ));

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
      deburrMin:     r2(deburrLine?.cycleTimeMin ?? 0),
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

// ── Turned cost summary ──────────────────────────────────────────────────

export function computeTurningCostSummary(
  input: MachiningCostInput,
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
      `Material "${materialGrade}" looks like a sheet/plate product form — this part is machined. ` +
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
  // Stock weight x cost/kg — no markup (see the milling billet above).
  const materialCost = r2(barWeightKg * materialCostPerKg);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (volume > 0 && barVolMm3 > 0 && volume > barVolMm3) {
    warnings.push(
      'CAD part volume exceeds the bar-stock volume — geometry or unit data is inconsistent; material cost and chip loss are unreliable until the model is re-analysed.',
    );
  }

  // ── Setup (amortised, includes fixture amortization) ────────────────────
  // Folded into the first real line (OD Turning) instead of its own row —
  // same rationale as the milling path, see its own doc comment above.
  // Real per-machine mhr_records.setup_time_hr, else not costed — see
  // resolveSetupMinutes().
  const setupCount = SETUP_COUNT[machineClass];
  const setupResolution = resolveSetupMinutes({
    process: realProcessName(machineClass),
    machineSetupTimeHr: mhrRate.setupTimeHr,
    machineName: mhrRate.machineName,
  });
  if (setupResolution.warning) warnings.push(setupResolution.warning);
  const setupMin = setupResolution.setupMin / Math.max(batchSize, 1);
  const fixtureCost = r2((input.fixtureUnitCostLocal ?? 0) / Math.max(batchSize, 1));
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate) + fixtureCost;
  const setupDisclosure = { setupTimeMin: setupResolution.setupMin, setupTimeSource: setupResolution.source };
  const setupTrace = setupTraceSteps(setupResolution, mhrRate.machineName, batchSize);

  // ── OD Turning ───────────────────────────────────────────────────────────
  // Real per-pass physics only (computeTurningCycleSec): the turned diameter
  // and axial length come from CAD (input.turnedGeometry), the bar diameter
  // from the real stock size the blank optimizer chose, and depth of cut /
  // speed / feed from tblGeneralTurning. With no real turning data there is
  // no estimate: the line reports the gap.
  const materialRemovalMm3 = Math.max(0, barVolMm3 - volume);
  const turned = input.turnedGeometry;
  const partDiameterMm = turned?.diameterMm ?? Math.max(maxWidth, maxHeight);
  const partLengthMm = turned?.lengthMm ?? maxLength;
  const partDiameterSource = turned?.diameterSource ?? 'CAD: bounding-box cross-section';
  const partLengthSource = turned?.lengthSource ?? 'CAD: bounding-box length';
  // The real round-bar diameter the blank optimizer chose from stock_profiles.
  // A non-round blank (billet, rectangular bar) has no bar diameter to turn
  // from: turning and parting report that gap rather than inventing one.
  const barDiameterMm = input.blankResult?.barDiameterMm ?? 0;
  const barDiameterSource = `Blank optimizer: ${input.blankResult?.sizeLabel ?? 'none'} (stock_profiles)`;
  const barMissing = barDiameterMm > 0 ? null
    : `round-bar stock for this part (blank optimizer chose ${input.blankResult?.sizeLabel ?? 'no blank'}, not a round bar)`;
  const radialStockMm = Math.max(0, (barDiameterMm - partDiameterMm) / 2);

  let roughTurningMin = 0;
  let finishTurningMin = 0;
  let roughRun: CalcRun = EMPTY_RUN;
  let finishRun: CalcRun = EMPTY_RUN;
  const roughExtraTrace: CalculationTraceStep[] = [];
  const turningMissing: string[] = [];
  const tp = input.turningParams?.dataFound ? input.turningParams : null;
  if (barMissing) {
    turningMissing.push(barMissing);
  } else if (radialStockMm > 0 && !tp) {
    turningMissing.push(`tblGeneralTurning cutting data for ${matClass}`);
  } else if (radialStockMm > 0 && tp) {
    const geometry: Record<string, CalcSeed> = {
      'Turned Diameter': { value: partDiameterMm, source: partDiameterSource },
      'Turned Length': { value: partLengthMm, source: partLengthSource },
    };
    roughRun = runMachiningCalculator(input.machiningCalculators, 'Rough Turning', {
      ...geometry,
      'Bar Diameter': { value: barDiameterMm, source: barDiameterSource },
      ...roughTurningLookupSeeds({ matClass, turningParams: tp }).seeds,
    });
    finishRun = runMachiningCalculator(input.machiningCalculators, 'Finish Turning', {
      ...geometry,
      ...finishTurningLookupSeeds({ matClass, turningParams: tp }).seeds,
    });
    roughTurningMin = (roughRun.sec ?? 0) / 60;
    finishTurningMin = (finishRun.sec ?? 0) / 60;
  }

  // ── Multi-spindle station split (Simultaneous Turning only) ───────────────
  // Real, gated on the resolved machine's own real capability
  // (mhrRate.numberSpindles, migration 788) — never a machineClass string
  // check. When the real op-splitting table (migration 785) says this
  // feature/operation combination splits across N stations at this real
  // spindle count, AND the real removed-volume ratio crosses the real
  // threshold, roughTurningMin is divided by N: the work is spread across N
  // concurrent index positions, so the marginal per-part time contribution
  // for THIS operation shrinks by roughly that factor (this is the
  // real-data-driven approximation the source table supports — it does not
  // simulate full station-to-station scheduling/bottlenecking).
  //
  // Approximation, disclosed: the real table's threshold is defined against
  // a Ring FEATURE's own removed volume specifically, but turned-part
  // feature extraction in this function does not separately break out a
  // Ring feature's volume — materialRemovalMm3/barVolMm3 (the part's TOTAL
  // turning removal ratio) is used as the closest real, already-computed
  // proxy. Same "disclosed reuse of an adjacent real signal" precedent as
  // Parting reusing finish_turning physics above.
  if (input.roughTurningOpSplit?.dataFound && roughTurningMin > 0 && barVolMm3 > 0) {
    const removalRatio = materialRemovalMm3 / barVolMm3;
    if (input.roughTurningOpSplit.thresholdRatio != null && removalRatio >= input.roughTurningOpSplit.thresholdRatio) {
      const n = input.roughTurningOpSplit.numberOfOperations;
      if (n > 1) {
        roughTurningMin = roughTurningMin / n;
        roughExtraTrace.push(
          traceInput('Stations sharing the rough turning', n, null,
            `tblMultiSpindleOpSplitting: ${mhrRate.numberSpindles} spindles, removal ratio ${(removalRatio * 100).toFixed(0)}% ≥ threshold`, true),
          traceCalc('Rough turning per part', roughTurningMin * 60, 's', 'Cycle Time / Stations sharing the rough turning'),
        );
        warnings.push(
          `Rough Turning split across ${n} stations (real removed-volume ratio ${(removalRatio * 100).toFixed(0)}% ≥ real threshold ${(input.roughTurningOpSplit.thresholdRatio * 100).toFixed(0)}%, per this machine's real ${mhrRate.numberSpindles}-spindle op-splitting data) — per-part time divided accordingly, not a full station-scheduling simulation.`,
        );
      }
    }
  }
  // Real per-part index-cycle overhead (drum index + transfer + stock feed +
  // speed sync, migration 788) — only present for a real Simultaneous
  // Turning machine (mhrRate.numberSpindles set); every other class leaves
  // these null and this line is skipped entirely, not zeroed.
  if (mhrRate.numberSpindles != null) {
    const machineSeed = (value: number | null | undefined, field: string): CalcSeed | undefined =>
      value != null ? { value, source: `Machine: ${mhrRate.machineName ?? 'selected machine'} ${field} (mhr_records)` } : undefined;
    const indexSeeds = Object.fromEntries(Object.entries({
      'Drum Index Time': machineSeed(mhrRate.drumIndexTimeS, 'drum_index_time_s'),
      'Transfer Time': machineSeed(mhrRate.transferTimeS, 'transfer_time_s'),
      'Stock Feed Time': machineSeed(mhrRate.stockFeedTimeS, 'stock_feed_time_s'),
      'Speed Synchronization Time': machineSeed(mhrRate.speedSynchronizationTimeS, 'speed_synchronization_time_s'),
    }).filter(([, v]) => v !== undefined)) as Record<string, CalcSeed>;
    if (Object.keys(indexSeeds).length > 0) {
      const run = runMachiningCalculator(input.machiningCalculators, 'Index Transfer', indexSeeds);
      const indexCycleMin = (run.sec ?? 0) / 60;
      processLines.push(withRun(makeLine(
        resolveOperationName(machineClass, 'Index Transfer', input.realOperationCategories, warnings),
        0, r2((indexCycleMin / 60) * mhrRate.rate), indexCycleMin, mhrRate, input.processIdentityByMachineClass,
      ), run));
    }
  }
  // Setup always folds into the first real turning line (even when its own
  // run time is 0) so the real setup cost is never silently dropped.
  if (turningMissing.length > 0) warnings.push(`Turning not priced — missing real input: ${turningMissing.join('; ')}.`);
  if (roughTurningMin > 0 || setupCostVal > 0 || turningMissing.length > 0) {
    processLines.push(withRun(makeLine(
      resolveOperationName(machineClass, 'Rough Turning', input.realOperationCategories, warnings),
      setupCostVal, r2((roughTurningMin / 60) * mhrRate.rate), roughTurningMin, mhrRate,
      input.processIdentityByMachineClass, setupDisclosure,
    ), roughRun, [...roughExtraTrace, ...setupTrace], turningMissing));
  }
  if (finishTurningMin > 0) {
    processLines.push(withRun(makeLine(
      resolveOperationName(machineClass, 'Finish Turning', input.realOperationCategories, warnings),
      0, r2((finishTurningMin / 60) * mhrRate.rate), finishTurningMin, mhrRate,
      input.processIdentityByMachineClass,
    ), finishRun));
  }

  // ── Drilling ──────────────────────────────────────────────────────────────
  // Real material-aware physics (same computeDrillCycleSec as the milled
  // path) — replaces the previous flat diameter-bucket table. Real catalog
  // name is "Drilling" (e.g. "2 Axis Bar Feed Lathe with Sub Spindle:
  // Drilling//SimpleHole") -- "Boring/Drilling" was never a real operation
  // string; this function only implements drill physics, not a distinct
  // boring model (real boring-tolerance work is handled by the separate
  // Jig Boring/Reaming tiers elsewhere in this function).
  const drilling = drillHoleGroups(holeGroups, drilledHoleCount, materialGrade, input.drillingTable, input.machiningCalculators);
  const boringMin = drilling.min;
  if (boringMin > 0 || drilling.missing.length > 0) {
    if (drilling.missing.length > 0) warnings.push(`Drilling not priced for: ${drilling.missing.join('; ')}.`);
    processLines.push(withRun(makeLine(
      resolveOperationName(machineClass, 'Drilling', input.realOperationCategories, warnings),
      0, r2((boringMin / 60) * mhrRate.rate), boringMin, mhrRate, input.processIdentityByMachineClass,
    ), drilling));
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tapping = tapThreadGroups(threads, matClass, input.tappingTable, input.machiningCalculators);
  const tappingMin = tapping.min;
  if (tapping.missing.length > 0) warnings.push(`Tapping not priced for: ${tapping.missing.join('; ')}.`);
  if (tappingMin > 0 || tapping.missing.length > 0) {
    // Tapping on the machining centre (hostMachineClass) shares that machine's
    // setup, already charged on its own line. A dedicated tapping machine uses
    // its own real setup_time_hr, or none — never a coded constant.
    const tapSetupResolution = tappingRate.hostMachineClass
      ? null
      : resolveSetupMinutes({ process: 'Tapping', machineSetupTimeHr: tappingRate.setupTimeHr, machineName: tappingRate.machineName });
    if (tapSetupResolution?.warning) warnings.push(tapSetupResolution.warning);
    const tapSetupMin = tapSetupResolution?.setupMin ?? 0;
    const tapSetup = r2((tapSetupMin / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(withRun(makeLine(
      resolveOperationName(tappingRate.hostMachineClass ?? tappingRate.machineClass, 'Tapping', input.realOperationCategories, warnings),
      tapSetup, tapRun, tappingMin, tappingRate, input.processIdentityByMachineClass,
      tapSetupResolution ? { setupTimeMin: tapSetupMin, setupTimeSource: tapSetupResolution.source } : undefined,
    ), tapping));
  }

  // ── Secondary setup / rechucking (2-axis lathe only) ─────────────────────
  // A 2-axis lathe cannot do cross holes or radial milling in one setup.
  // The part must be unloaded and transferred to a drill press or VMC —
  // this transfer + re-clamping adds ~15 min to EVERY PART's cycle (not amortised setup).
  // Live-tooling and mill-turn complete all features in a single chucking → 0 penalty.
  // A second chucking is a second SETUP (once per batch), not per-part work:
  // the workholder install-and-remove time comes from the real
  // tblInstallingTurningWorkholders row and is spread over the batch.
  if (SETUP_COUNT[machineClass] > 1) {
    const seeds: Record<string, CalcSeed> = {
      'Batch Size': { value: Math.max(batchSize, 1), source: 'BOM: batch size' },
      ...rechuckLookupSeeds({ matClass, workholderTable: input.workholderTable }).seeds,
    };
    const run = runMachiningCalculator(input.machiningCalculators, 'Secondary Setup (Rechuck)', seeds);
    const rechuckMin = (run.sec ?? 0) / 60;
    processLines.push(withRun(
      makeLine('Secondary Setup (Rechuck)', 0, r2((rechuckMin / 60) * mhrRate.rate), rechuckMin, mhrRate, input.processIdentityByMachineClass),
      run,
    ));
  }

  // ── Parting ────────────────────────────────────────────────────────────
  // Real catalog operation "Parting//StockTrim". A part-off is a radial
  // plunge from the bar surface to its centre, so the cut depth is the real
  // bar radius. Insert, cutting speed and feed come from the real
  // tblVirtualPartoffInsertCutData row (resolvePartoffParams: this material,
  // narrowest insert whose DepthMaxMm reaches the cut). No real insert → gap.
  const partingMissing: string[] = [];
  let partingRun: CalcRun = EMPTY_RUN;
  let partingMin = 0;
  const partoff = barMissing ? null : partingLookupSeeds({ matClass, partoffTable: input.partoffTable }, { 'Bar Diameter': barDiameterMm });
  if (barMissing) {
    partingMissing.push(barMissing);
  } else if (partoff && partoff.missing.length > 0) {
    partingMissing.push(...partoff.missing);
  } else if (partoff) {
    partingRun = runMachiningCalculator(input.machiningCalculators, 'Parting', {
      'Bar Diameter': { value: barDiameterMm, source: barDiameterSource },
      ...partoff.seeds,
    });
    partingMin = (partingRun.sec ?? 0) / 60;
  }
  const partingGap = [...partingMissing, ...partingRun.missing];
  if (partingGap.length > 0) warnings.push(`Parting not priced — missing real input: ${partingGap.join('; ')}.`);
  processLines.push(withRun(makeLine(
    resolveOperationName(machineClass, 'Parting', input.realOperationCategories, warnings),
    0, r2((partingMin / 60) * mhrRate.rate), partingMin, mhrRate, input.processIdentityByMachineClass,
  ), partingRun, [], partingMissing));

  // ── Gear/spline teeth (AxiGroove → Hobbing) ────────────────────────────
  // One Hobbing calculator run per recognised tooth form. Module = tip
  // diameter / (teeth + 2) and tooth depth = (tip - root) / 2 (the standard
  // full-depth tooth; CAD gives no module); no root diameter = depth missing.
  const toothForms = input.toothForms ?? [];
  const route = input.gearRoute ?? null;
  if (toothForms.length > 0 && route) {
    warnings.push(`Gears: ${route.qualitySource}${route.quality ? ` -> tblGearQuality ${route.quality.new_agma_quality_number} (${route.quality.old_agma_quality_number}, DIN ${route.quality.din_quality_number})` : ' — not in tblGearQuality'}.`);
  }
  const gearSeeds = (t: (typeof toothForms)[number]) => {
    const module = t.tip_diameter_mm / (t.tooth_count + 2);
    const seeds: Record<string, CalcSeed> = {
      'Teeth': { value: t.tooth_count, source: 'CAD: AxiGroove rotational symmetry order' },
      'Face Width': { value: t.face_width_mm, source: 'CAD: tooth face length along the axis' },
      'Module': { value: module, source: `CAD: tip diameter ${t.tip_diameter_mm} mm / (${t.tooth_count} teeth + 2)` },
    };
    if (t.root_diameter_mm != null && t.root_diameter_mm < t.tip_diameter_mm) {
      seeds['Tooth Depth'] = { value: (t.tip_diameter_mm - t.root_diameter_mm) / 2, source: `CAD: (tip ${t.tip_diameter_mm} - root ${t.root_diameter_mm}) / 2` };
    }
    return { module, seeds };
  };
  const label = (t: (typeof toothForms)[number]) => `${t.tooth_count}-tooth form Ø${t.tip_diameter_mm} mm`;
  if (route?.cut === 'shaping' && toothForms.length > 0) {
    // The drawing names gear shaping. tblShaping gives three cut-type rows per
    // material with no definition of how they combine into a cycle, so shaping
    // is not priced; the teeth are not hobbed instead.
    warnings.push('Gear shaping (drawing callout) not priced — tblShaping does not define how its three cut types make up a shaping cycle.');
  } else if (input.hobRate && toothForms.length > 0) {
    const runs = toothForms.map((t) => {
      const { module, seeds } = gearSeeds(t);
      const lookup = hobbingLookupSeeds({ matClass, hobbing: input.hobbing }, { 'Module': module });
      const run = runMachiningCalculator(input.machiningCalculators, 'Hobbing', { ...seeds, ...lookup.seeds });
      if (run.missing.length > 0) run.missing.unshift(...lookup.missing);
      return { label: label(t), run };
    });
    const hobLine = secondaryLine('Hobbing', sumRuns(runs, 'Hobbing cycle time'), input.hobRate, batchSize, warnings, input.processIdentityByMachineClass);
    if (hobLine) processLines.push(hobLine);
  }
  if (route?.shave && input.shaverRate && toothForms.length > 0) {
    const lookup = shavingLookupSeeds({ matClass, shaving: input.shaving });
    const runs = toothForms.map((t) => {
      const run = runMachiningCalculator(input.machiningCalculators, 'Shaving', { ...gearSeeds(t).seeds, ...lookup.seeds });
      if (run.missing.length > 0) run.missing.unshift(...lookup.missing);
      return { label: label(t), run };
    });
    const shaveLine = secondaryLine('Shaving', sumRuns(runs, 'Shaving cycle time'), input.shaverRate, batchSize, warnings, input.processIdentityByMachineClass);
    if (shaveLine) {
      warnings.push(`Shaving: ${route.shaveSource}.`);
      processLines.push(shaveLine);
    }
  }
  if (route?.grind && toothForms.length > 0) {
    warnings.push(`Gear grinding required (tblGearQuality ${route.quality!.new_agma_quality_number}: must grind) — not priced: the Profile / Threaded Wheel gear grinding models are not built.`);
  }

  // ── Deburring (same real CAD-edge × tblDeburring computation as the milled path)
  const deburrLine = computeDeburringLine(input, deburrRate, matClass, warnings);
  if (deburrLine) processLines.push(deburrLine);

  // ── Jig Boring / Jig Grind — same real tier + real routing rule as the
  // milled path.
  const rules = capabilityRulesOrWarn(input, warnings);
  const needsJigGrind = rules != null && tightestToleranceMm != null && tightestToleranceMm > 0 &&
    tightestToleranceMm <= rules.jigBorePositionToleranceMm && isRealHeatTreatmentCallout(input.heatTreatment);
  if (needsJigGrind) {
    const jigGrindLine = computeJigGrindLine(
      input.machiningCalculators, rules, holeGroups, input.internalGrindingParams, matClass, input.jigGrindRate, batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigGrindLine) processLines.push(jigGrindLine);
  } else if (rules) {
    const jigBoreLine = computeJigBoreLine(
      input.machiningCalculators, tightestToleranceMm, rules, holeGroups, matClass, input.jigBoreTable, input.jigBoreRate,
      batchSize, warnings, input.processIdentityByMachineClass,
    );
    if (jigBoreLine) processLines.push(jigBoreLine);
  }

  // ── Internal Grinding — same real bore/ID grinding trigger as the milled
  // path (a turned part's own bores use the same real holeGroups data).
  const internalGrindingLine = rules && computeInternalGrindingLine(
    input.machiningCalculators, input.tightestRaMicron, rules, holeGroups, input.internalGrindingParams, matClass, input.internalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (internalGrindingLine) processLines.push(internalGrindingLine);
  const surfaceGrindingLine = rules && computeSurfaceGrindingLine(
    input.machiningCalculators, input.tightestRaMicron, rules, input.planarFaces, input.surfaceGrindingParams, matClass, input.surfaceGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (surfaceGrindingLine) processLines.push(surfaceGrindingLine);
  const rotaryBroachingLine = computeRotaryBroachingLine(input, machineClass, matClass, warnings);
  if (rotaryBroachingLine) processLines.push(rotaryBroachingLine);

  // ── Reaming — same tight-tolerance trigger as the milled path, using
  // drilledHoleCount's real holeGroups (not raw holeCount, same rationale
  // as the Boring/Drilling and Inspection sections above). Excludes the
  // Jig Boring tier above — see the milled path's identical comment.
  if (
    tightestToleranceMm != null && tightestToleranceMm > (rules?.jigBorePositionToleranceMm ?? 0) &&
    tightestToleranceMm <= TIGHT_TOLERANCE_REAM_THRESHOLD_MM &&
    holeGroups.length > 0
  ) {
    processLines.push(computeReamingLine(
      input.machiningCalculators, holeGroups, matClass, input.reamTable, mhrRate, batchSize, warnings, input.processIdentityByMachineClass,
    ));
  }

  // ── Cylindrical Grinding (new; see MachiningCostInput's own doc comment for
  // the real Ra < grindingRaTriggerUm trigger). Turned
  // part's own real OD/length: max(maxWidth, maxHeight) is the diameter,
  // maxLength the ground length -- same bbox-to-cylinder convention the
  // turned bar-stock fallback already uses elsewhere in this function.
  const grindingLine = rules && computeCylindricalGrindingLine(
    input.machiningCalculators, input.tightestRaMicron, rules, partDiameterMm, partDiameterSource, partLengthMm, partLengthSource,
    input.cylindricalGrindingParams, matClass, input.cylindricalGrindingRate,
    batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (grindingLine) processLines.push(grindingLine);

  // ── Keyway Broaching — a turned shaft's own real keyway occurrences,
  // same real pre-filter/candidate shape as the milled path.
  const keywayLine = computeKeywayBroachingLine(
    input.machiningCalculators, input.keywayCandidates, input.keywayBroach, matClass, input.broachRate, batchSize, warnings, input.processIdentityByMachineClass,
  );
  if (keywayLine) processLines.push(keywayLine);

  // ── Wire EDM — a turned part's own real hardened-slot occurrences, same
  // real pre-filter/candidate shape as the milled path.
  const wireEdmLine = computeWireEdmLine(
    input.machiningCalculators, input.wireEdmCandidates, input.wireEdmParams, matClass, input.wireEdmRate, batchSize, warnings, input.processIdentityByMachineClass,
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
  processLines.push(computeInspectionLine(
    drilledHoleCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures, inspectionRate, batchSize,
    input.samplingPerN, input.samplingPolicy, input.machiningCalculators, warnings, input.processIdentityByMachineClass,
  ));

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
      deburrMin:     r2(deburrLine?.cycleTimeMin ?? 0),
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

// The minimum milled machine class comes from the features' tool axes and the
// reference setup rule: requiredMilledClassFromToolAxes (../setup-axis-rule).
// requiredMilledMachineClass(difficultyLevel, pocketCount) was here, gating on
// invented difficulty / pocket-count thresholds.

const MILLED_CLASS_RANK: Record<string, number> = {
  '3_axis_mill': 0, '4_axis_mill': 1, '5_axis_mill': 2,
};

/** `required` null = no requirement could be derived: every class passes. */
export function meetsRequiredMilledClass(
  machineClass: MachineClassId,
  required: MachineClassId | null,
): boolean {
  if (required == null) return true;
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
