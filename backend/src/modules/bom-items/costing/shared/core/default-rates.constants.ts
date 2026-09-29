// eMithranTerms()'s (engine-kernel.ts) default yield fraction when no
// per-part/per-material yield has been resolved — a single named constant so
// every caller (cost-engine.ts's 9 inline blocks, and every registered
// engine as of Phase 1's engine registry unification) references the exact
// same default instead of two independently-maintained "0.98" literals that
// could silently drift apart.
export const DEFAULT_YIELD_PCT = 0.98;

// Batch inspection sampling — three stages (eMithran-style):
//   FAI:        first article, full measurement, once per batch
//   in-process: 1 of every N parts, full per-piece measurement
//   final:      1 of every N parts, short visual/gauge check before pack
// Per-item override for the in-process interval:
// bom_items.validation_config.inspection.samplePerN (AS9100 parts → tighter).
export interface InspectionStagePolicy {
  fai: boolean;
  inProcessPerN: number;
  finalPerN: number;
  finalCheckMin: number;   // minutes per final visual/gauge check
}

export const INSPECTION_SAMPLING_DEFAULT: InspectionStagePolicy = {
  fai: true,
  inProcessPerN: 10,
  finalPerN: 25,
  finalCheckMin: 2,
};

export const MATERIAL_OVERHEAD_PCT = 5;  // nesting skeleton + handling scrap

// Mass-based utilization below which a panel-nesting advisory is shown
// alongside the material cost. This is informational, not an error --
// genuinely irregular flat patterns (large internal cutouts, long/thin
// brackets) can legitimately nest below this and are still costed
// correctly from the real flat-pattern silhouette. Tune per shop-floor
// manufacturing standard, not per part.
export const UTILIZATION_ADVISORY_THRESHOLD_PCT = 75;

// Fiber laser cutting speed (mm/min) by sheet thickness — mild steel (CRCA / IS2062)
export const LASER_SPEED_MM_PER_MIN: Record<number, number> = {
  0.8: 8000, 1.0: 6000, 1.2: 5000, 1.5: 4000,
  2.0: 3000, 2.5: 2500, 3.0: 2000, 4.0: 1500,
  5.0: 1200, 6.0: 1000, 8.0: 700,  10.0: 500,
};

// Material speed factor applied to LASER_SPEED_MM_PER_MIN (mild-steel baseline).
// 6kW fiber, production gas choices: stainless cuts ~25% slower (N₂, no exothermic
// assist), aluminium ~10% slower (reflectivity + N₂), mild steel = 1.0 (O₂ assist).
export const LASER_MATERIAL_SPEED_FACTOR: Record<string, number> = {
  carbon_steel: 1.0,
  stainless:    0.75,
  aluminum:     0.90,
  __default__:  1.0,
};

// Coarse substrate classing for physics lookups (UTS, laser factor). Mirrors the
// frontend classifySubstrate — keep the keyword lists in sync.
export function classifyMaterialFamily(
  grade: string | null | undefined,
): 'aluminum' | 'stainless' | 'carbon_steel' | 'unknown' {
  const g = (grade ?? '').toUpperCase();
  if (g.trim().length === 0) return 'unknown';
  // T6 (ANSI H35.1 temper designation) is exclusive to heat-treatable
  // aluminum alloys (6061-T6, 7075-T6, etc.) — real parts in this shop are
  // stored as e.g. "T6 - Sheet" with no alloy number, so match the temper
  // code itself.
  if (/ALUMIN|AA\s?\d{4}|AL\s?\d{4}|6061|6063|5052|5754|7075|2024|\bT6\b/.test(g)) return 'aluminum';
  if (/STAINLESS|SS\s?3\d{2}|SS\s?4\d{2}|AISI\s?3\d{2}|17-4/.test(g)) return 'stainless';
  // SECC/SPCC/SGCC/SPHC/SPCE: JIS G3141/G3302/G3313 cold-rolled and
  // galvanized/electrogalvanized mild-steel sheet codes — common in
  // enclosure/chassis sheet metal, same substrate family as CRCA/IS2062/S235.
  if (/CRCA|IS\s?2062|DC01|MILD|\bMS\b|E250|E350|S235|S355|HR\b|CR[1-5]\b|SECC|SPCC|SGCC|SPHC|SPCE/.test(g)) return 'carbon_steel';
  return 'unknown';
}

// Materials that can NEVER run a laser + press-brake sheet route, regardless of
// how flat the geometry looks. Cast bronzes (ALBC, gunmetal, C95x) and cast irons
// are machined from plate/castings — bending cracks them. Deliberately
// conservative: copper and brass SHEET are formable (busbars) and stay allowed.
const NON_SHEET_FORMABLE = /BRONZE|ALBC|AL\.?\s?BR|CU\s?AL|C9[0-5]\d|GUNMETAL|LG[124]\b|CAST\s?IRON|FG\s?\d{3}|SG\s?IRON|EN-?GJ/i;

export function isSheetFormableMaterial(grade: string | null | undefined): boolean {
  if (!grade || grade.trim().length === 0) return true; // unknown → don't veto
  return !NON_SHEET_FORMABLE.test(grade);
}

export function laserSpeedFactor(grade: string | null | undefined): number {
  const family = classifyMaterialFamily(grade);
  return LASER_MATERIAL_SPEED_FACTOR[family] ?? LASER_MATERIAL_SPEED_FACTOR['__default__']!;
}

// Pierce time (sec) by sheet thickness — stabilisation after piercing
export const LASER_PIERCE_SEC: Record<number, number> = {
  0.8: 0.5, 1.0: 0.8, 1.2: 1.0, 1.5: 1.2,
  2.0: 1.5, 2.5: 1.8, 3.0: 2.2, 4.0: 3.0,
  5.0: 4.0, 6.0: 5.0, 8.0: 7.0, 10.0: 9.0,
};

// Press brake: seconds per bend by sheet thickness — consistent-radius CNC press brake.
// ≥8mm entries include two-person handling and slower approach speeds for plate.
export const PRESS_BRAKE_SEC_PER_BEND: Record<number, number> = {
  1.0: 10, 1.5: 13, 2.0: 15, 2.5: 18,
  3.0: 20, 4.0: 25, 5.0: 30, 6.0: 38,
  8.0: 48, 10.0: 58, 12.0: 70,
};

// ── Press brake tonnage physics ───────────────────────────────────────────────
// Air-bending force: F(kN) = (1.42 × UTS(N/mm²) × L(mm) × t²(mm²)) / (1000 × V(mm)),
// V-die opening V = 8 × t (industry rule of thumb). Tons = F / 9.81.
// Sanity: 2mm mild steel (UTS 410), 1m bend, V16 → ~15 t/m — matches brake charts.

// Ultimate tensile strength (MPa) by material family/grade — bend-force lookup.
// Approved per-family values only. There is deliberately no catch-all
// default: an unmatched grade previously fell back to '__default__: 410'
// (mild steel), which silently priced/gated exotic or unlisted materials as
// if they were mild steel with no indication anything was assumed. Removed
// per the P0.7 correctness gate — resolveUtsMpa now returns null for an
// unmatched grade, and every caller must treat null as "not available"
// (skip the UTS-dependent check, surface a warning) rather than invent one.
export const MATERIAL_UTS_MPA: Record<string, number> = {
  CRCA:    370,  DC01: 370,
  IS2062:  410,  MS: 410,   E250: 410, E350: 490,
  SS304:   620,  SS316: 580, SS316L: 560,
  AL6061:  310,  AA6061: 310,   // T6 temper
  AL5052:  230,  AA5052: 230,
};

export function resolveUtsMpa(grade: string | null | undefined): number | null {
  const g = (grade ?? '').toUpperCase().replace(/[\s\-]/g, '');
  const hit = Object.keys(MATERIAL_UTS_MPA).find((k) => g.includes(k));
  return hit ? MATERIAL_UTS_MPA[hit]! : null;
}

/** Estimated press-brake force in metric tons for one air bend. */
export function estimateBendTonnage(
  utsMpa: number | null,
  thicknessMm: number,
  bendLengthMm: number,
): number | null {
  if (thicknessMm <= 0 || bendLengthMm <= 0 || utsMpa == null || utsMpa <= 0) return null;
  const vOpeningMm = 8 * thicknessMm;
  const forceKn = (1.42 * utsMpa * bendLengthMm * thicknessMm * thicknessMm) / (1000 * vOpeningMm);
  return Math.round((forceKn / 9.81) * 10) / 10;
}

// ── Minimum bend radius (DFM crack-risk threshold) ────────────────────────────
// Real, per-material, per-blank-thickness-bracket minimum bend radius factor
// (radius / thickness) below which forming cracks the material — sourced
// from a real USA-region manufacturing reference dataset (2026-03 snapshot;
// see sm_reference_data category='lookup_table', key prefix
// 'InsufficientBendRadius:'). Deliberately a SEPARATE classification from
// classifyMaterialFamily() above: that function intentionally folds
// galvanized/electrogalvanized codes (SECC/SGCC) into 'carbon_steel' because
// they cut at the same laser speed as plain mild steel — but galvanized
// steel's real minimum bend radius (3.5x) is far higher than plain steel's
// (0.8-1.5x), so reusing that classifier here would silently under-flag
// every galvanized part. Brackets are blank thickness upper bounds (mm);
// thickness above the highest bracket uses that bracket's factor (disclosed
// extrapolation, same "nearest/highest bracket" convention used elsewhere
// in this file, e.g. resolveNearestStandardTonnageClass).
export type BendRadiusMaterial =
  | 'steel' | 'stainless_steel' | 'aluminum' | 'galvanized_steel'
  | 'titanium' | 'brass' | 'copper' | 'heat_resistant_super_alloy';

// Generic upper-bound-bracket resolver — brackets are [upperBoundKey, value]
// pairs ascending by bound; a key above the highest bracket uses that
// bracket's value (disclosed extrapolation). Every bracket-shaped lookup in
// this file (bend radius, min hole diameter, and future ones) should call
// this instead of re-implementing the same find/fallback logic — one tested
// primitive instead of N near-identical hand-rolled searches.
export function resolveBracket<T>(brackets: ReadonlyArray<readonly [number, T]>, key: number): T {
  const hit = brackets.find(([upperBound]) => key <= upperBound);
  return (hit ?? brackets[brackets.length - 1]!)[1];
}

// [thicknessBracketMaxMm, minRadiusFactor][], ascending by bracket.
const BEND_RADIUS_MIN_FACTOR: Record<BendRadiusMaterial, Array<[number, number]>> = {
  steel:                     [[6, 0.8], [12, 1.2], [25, 1.5]],
  stainless_steel:           [[6, 2.0], [12, 2.5], [25, 3.0]],
  aluminum:                  [[6, 1.0], [12, 1.5], [25, 2.0]],
  galvanized_steel:          [[Infinity, 3.5]],
  titanium:                  [[Infinity, 4.5]],
  brass:                     [[Infinity, 0.5]],
  copper:                    [[Infinity, 0.5]],
  heat_resistant_super_alloy: [[1.24, 1.0], [6.35, 2.0]],
};

export function classifyBendRadiusMaterial(grade: string | null | undefined): BendRadiusMaterial {
  const g = (grade ?? '').toUpperCase();
  if (/SECC|SGCC|GALV/.test(g)) return 'galvanized_steel';
  if (/ALUMIN|AA\s?\d{4}|AL\s?\d{4}|6061|6063|5052|5754|7075|2024|\bT6\b/.test(g)) return 'aluminum';
  if (/STAINLESS|SS\s?3\d{2}|SS\s?4\d{2}|AISI\s?3\d{2}|17-4/.test(g)) return 'stainless_steel';
  if (/TITANIUM|\bTI\b/.test(g)) return 'titanium';
  if (/BRASS/.test(g)) return 'brass';
  if (/COPPER|\bCU\b/.test(g)) return 'copper';
  if (/INCONEL|HASTELLOY|SUPER\s?ALLOY|HEAT\s?RESIST/.test(g)) return 'heat_resistant_super_alloy';
  return 'steel'; // mild/unalloyed/low-alloy carbon steel baseline — same disclosed fallback convention as classifyMaterialFamily()
}

export function resolveBendRadiusMinFactor(grade: string | null | undefined, thicknessMm: number): number {
  const material = classifyBendRadiusMaterial(grade);
  return resolveBracket(BEND_RADIUS_MIN_FACTOR[material], thicknessMm);
}

// ── Minimum punched-hole diameter ────────────────────────────────────────────
// Real punch-tooling physics: a punched hole narrower than the sheet is thick
// risks the punch snapping under lateral load, and the safe minimum scales
// with the material's own strength — a higher-UTS material needs a
// proportionally larger hole for the same thickness. Source: sm_reference_data
// category='lookup_table', key prefix 'tblMinHoleDiameterRatio' (migration
// 518) — 5 UTS brackets (MPa) -> minimum diameter-to-thickness ratio.
// [utsMpaBracketMax, minDiameterToThicknessRatio][], ascending by bracket.
// Source table's 655/999999999 rows both resolve to 2.0 — collapsed into the
// single trailing Infinity bracket (resolveBracket's own highest-bracket
// fallback already covers everything above 345 with the same value).
const MIN_HOLE_DIAMETER_RATIO: Array<[number, number]> = [
  [220, 1.0],
  [345, 1.5],
  [Infinity, 2.0],
];

export function resolveMinHoleDiameterRatio(utsMpa: number): number {
  return resolveBracket(MIN_HOLE_DIAMETER_RATIO, utsMpa);
}

// ── Turret punch force ─────────────────────────────────────────────────────────
// Real formula from the "Sheet Metal - TPP Manufacturing" calculator (migration
// calculators/008 — calculator_id a5d9b23a-5b8c-4d2b-98dd-3fa623458716, mapped
// to every real turret_punch catalog row): Theoretical Force (Ton) = (Length Of
// Cut × Thickness × Shear Strength) / 9810; Recommended Force = Theoretical ×
// 1.25 (the calculator's own safety margin, applied here too). Previously this
// formula existed ONLY inside the interactive calculator — machine-capability.ts
// gated turret punch on a flat thickness cutoff with no real tonnage check at
// all. Mirrors estimateBendTonnage's shape/signature so checkMachineCapability
// can treat both machine classes the same way (see that function's own
// estimatedTonnage branch).
export function estimateTurretPunchTonnage(
  shearStrengthMpa: number | null,
  thicknessMm: number,
  cutLengthMm: number,
): number | null {
  if (thicknessMm <= 0 || cutLengthMm <= 0 || shearStrengthMpa == null || shearStrengthMpa <= 0) return null;
  const theoreticalForceTon = (cutLengthMm * thicknessMm * shearStrengthMpa) / 9810;
  return Math.round(theoreticalForceTon * 1.25 * 100) / 100;
}

// ── Hole-extrusion (burl/flange) forming tonnage ──────────────────────────────
// Real drawing/forming force formula from memory/sheetmetal/Drawing_Forming_Calculator.md
// ("Stamping - Progressive" sheet): Fd(Ton) = (Punch Perimeter × T × Y × (Fp/Dp − 0.7)) / 9810,
// with Punch Perimeter = Form Perimeter × 95% (standard round-die clearance).
// For a round hole flange, Form Perimeter (Fp) = π×D and Punch Perimeter (Dp) = 0.95×π×D,
// so Fp/Dp = 1/0.95 always — collapses to a constant ≈0.3526 regardless of diameter.
// Stage 1 of 3 in the burring pipeline (force calc → sm_lookup_manual_stroke time
// lookup → machine selection) — deliberately kept as its own pure function, no DB
// access, so each stage stays independently testable.
const HOLE_FLANGE_PUNCH_CLEARANCE = 0.95;
const HOLE_FLANGE_FORM_FACTOR = (1 / HOLE_FLANGE_PUNCH_CLEARANCE) - 0.7;

/** Estimated forming force in metric tons for one round hole-extrusion (burl) hit. */
export function estimateBurlTonnage(
  utsMpa: number | null,
  thicknessMm: number,
  holeDiameterMm: number,
): number | null {
  if (thicknessMm <= 0 || holeDiameterMm <= 0 || utsMpa == null || utsMpa <= 0) return null;
  const punchPerimeterMm = HOLE_FLANGE_PUNCH_CLEARANCE * Math.PI * holeDiameterMm;
  const forceTon = (punchPerimeterMm * thicknessMm * utsMpa * HOLE_FLANGE_FORM_FACTOR) / 9810;
  return Math.round(forceTon * 100) / 100;
}

// Representative burl diameter for a part — a count-weighted average of its
// tapped nominal diameters (parsing "M3" → 3mm, same regex computeTapCycleSec
// uses), falling back to the smallest real hole diameter when there are no
// threads. Part-level approximation (same disclosed-approximation style as the
// Reaming trigger elsewhere in this file) since per-hole face/diameter linkage
// for extruded flanges doesn't exist yet. Single source of truth — was
// duplicated identically in getCostSummary and getRouteComparison before this
// was extracted; now also feeds the hole_forming capability requirement.
export function estimateBurlDiameterMm(
  threads: Array<{ size: string; count: number }>,
  holeDiametersMm: number[],
): number {
  const threadTotalCount = threads.reduce((s, t) => s + t.count, 0);
  if (threadTotalCount > 0) {
    const weightedSum = threads.reduce((s, t) => {
      const m = t.size.match(/M\s*(\d+(?:\.\d+)?)/i);
      return s + t.count * (m ? parseFloat(m[1]!) : 4);
    }, 0);
    return weightedSum / threadTotalCount;
  }
  return holeDiametersMm.length > 0 ? Math.min(...holeDiametersMm) : 3;
}

// Tapping: cycle time (sec per hole) — ISO 965-1, rigid tapping.
// Kept as the last-resort fallback for computeTapCycleSec() below (e.g. an
// unparseable size string) — not a second source of truth for the real cases.
export const TAP_CYCLE_SEC: Record<string, number> = {
  'M2': 4, 'M2.5': 5, 'M3': 6, 'M4': 7, 'M5': 8,
  'M6': 10, 'M8': 14, 'M10': 18, 'M12': 22, 'M16': 28,
};

// Same ISO metric coarse-thread pitch series used by drawing_analyzer.py's
// _default_pitch() — kept in sync so a bare "M4" drawing callout (no explicit
// pitch) and a CAD-detected tapped_hole (which has no pitch field at all)
// resolve to the identical standard pitch.
const DEFAULT_THREAD_PITCH_MM: Record<number, number> = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 16: 2.0, 20: 2.5, 24: 3.0,
};

/** ISO 261 coarse pitch of a metric nominal diameter, or null off the series. */
export function isoCoarsePitchMm(nominalDiameterMm: number): number | null {
  return Number.isInteger(nominalDiameterMm) ? DEFAULT_THREAD_PITCH_MM[nominalDiameterMm] ?? null : null;
}

// The two values used when even the standard series cannot answer. Named, so
// they read as assumptions at every use site instead of as bare literals, and
// so resolveTapPhysicsInputs can flag when it fell back to them.
const ASSUMED_TAP_DIAMETER_MM = 4;
const ASSUMED_THREAD_PITCH_MM = 1.0;

// Real HSS (M2 grade) tapping surface speed by material family — cross-verified
// from two independent published tap-vendor references:
//   - Viking Drill & Tool / Norseman Drill & Tool "Recommended Feeds and
//     Speeds" tap tech data (SFM; converted here at 1 SFM = 0.3048 m/min):
//     http://www.vikingdrill.com/viking-Tap-FeedandSpeed.php
//     http://www.norsemandrill.com/feeds-speeds-tap.php
//   - Slugger Tools Tap Speed Chart (m/min, M2 HSS tier):
//     https://www.sluggertool.com/resources/tap-speed-chart/
// Value used is the midpoint of the two sources' overlapping range:
//   mild/carbon steel: Viking 30-50 SFM (9.1-15.2 m/min) vs Slugger 8-14 m/min -> 10
//   stainless (300-series): Viking 10-20 SFM (3.0-6.1 m/min) vs Slugger 304/316 3-6 m/min -> 4.5
//   aluminum (wrought): Viking 80 SFM (24.4 m/min) vs Slugger 6061/5052 20-40 m/min -> 25
// classifyMaterialFamily()'s 'unknown' case keeps the mild-steel baseline --
// same fallback convention LASER_MATERIAL_SPEED_FACTOR above already uses.
export const TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL: Record<string, number> = {
  carbon_steel: 10,
  stainless: 4.5,
  aluminum: 25,
  __default__: 10,
};

export const TAP_APPROACH_SEC = 1;    // rapid traverse + engage, fixed allowance
export const TAP_TOOL_CHANGE_SEC = 3; // once per thread-size group (switch tap/holder)
const TAP_UNLOAD_SEC = 2;      // once per tapping operation (final clear/unload)

export interface TapPhysicsResult {
  rpm: number;
  machiningTimeSec: number; // single-pass cutting time (depth-driven)
  approachSec: number;
  retractSec: number;       // mirrors machiningTimeSec — same feed rate both ways
  toolChangeSec: number;
  perHoleSec: number;       // approach + machining + retract, for ONE hole
  totalSecWithoutUnload: number; // toolChangeSec + perHoleSec * count (unload is added once per OPERATION by the caller, not here — see cost-engine.ts's TAP_UNLOAD_SEC usage)
}

// Core rigid-tapping physics, taking surface speed DIRECTLY rather than
// deriving it from material — reusable by the interactive Tapping
// calculator's physics-registry entry, which has its own editable Cutting
// Speed input (auto-filled from material, but independently overridable by
// the engineer) that must be respected as-is, not silently re-derived.
export function computeTapPhysics(
  diameterMm: number,
  count: number,
  pitchMm: number,
  depthMm: number,
  surfaceSpeedMMin: number,
): TapPhysicsResult {
  const rpm = (surfaceSpeedMMin * 1000) / (Math.PI * diameterMm);
  const feedMmPerMin = rpm * pitchMm;
  const machiningTimeSec = feedMmPerMin > 0 ? (depthMm / feedMmPerMin) * 60 : 0;
  const retractSec = machiningTimeSec;
  const perHoleSec = TAP_APPROACH_SEC + machiningTimeSec + retractSec;
  return {
    rpm,
    machiningTimeSec,
    approachSec: TAP_APPROACH_SEC,
    retractSec,
    toolChangeSec: TAP_TOOL_CHANGE_SEC,
    perHoleSec: Math.round(perHoleSec * 100) / 100,
    totalSecWithoutUnload: Math.round((TAP_TOOL_CHANGE_SEC + perHoleSec * count) * 100) / 100,
  };
}

export interface TapCycleBreakdown {
  toolChangeSec: number;
  perHoleSec: number;   // approach + tap + retract, for ONE hole
  tapSec: number;       // the depth-driven component of perHoleSec (for display)
  totalSec: number;     // toolChangeSec + perHoleSec * count
  pitchMm: number;
  depthMm: number;
  pitchIsAssumed: boolean; // true when neither a real pitch nor an ISO coarse-series entry existed
  depthIsAssumed: boolean; // true when no real depth was available and fallbackDepthMm was used
  surfaceSpeedMMin: number;   // real material-specific speed actually used (see TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL)
  materialFamily: string;     // classifyMaterialFamily() result that picked surfaceSpeedMMin
}

/**
 * Rigid-tapping physics: RPM = (surface_speed_m_min * 1000) / (pi * diameter_mm);
 * feed_mm_per_min = RPM * pitch_mm (one thread pitch advances per revolution);
 * tap_time_sec = (depth_mm / feed_mm_per_min) * 60. Retract mirrors the same
 * feed rate — a rigid tap must unscrew at the same rate it screwed in (no
 * rapid-retract synchronization assumed; that's a CNC-specific option this
 * shop-floor-agnostic formula doesn't model).
 *
 * fallbackDepthMm is supplied by the caller (not hardcoded here) because the
 * right assumption differs by context: a sheet-metal tapped hole runs through
 * the sheet thickness (shallow), while a CNC-machined blind tapped hole in
 * solid stock is conventionally ~1.5-2x the nominal diameter for full thread
 * engagement — this function has no way to know which applies.
 */
export interface TapPhysicsInputs {
  diameterMm: number;
  /** true when sizeStr carried no parseable M-diameter and the assumption was used. */
  diameterIsAssumed: boolean;
  pitchMm: number;
  /** true when neither a real pitch nor an ISO coarse-series entry was available. */
  pitchIsAssumed: boolean;
  depthMm: number;
  depthIsAssumed: boolean;
  surfaceSpeedMMin: number;
  materialFamily: string;
}

// Resolves the real, thread-size/material-specific inputs a rigid-tapping
// physics calculation needs — diameter (parsed from the thread size string),
// thread pitch (real when known, else a standard-pitch default by nominal
// diameter), hole depth (real when known, else the caller's context-specific
// fallback), and material-specific surface speed. Pure input resolution, no
// time formula — shared by computeTapCycleSec below (this module's own
// caller) and bom-items.service.ts's resolvePhysicsQuantity wiring, which
// feeds these same real values into the registered "Machining - Tapping"
// calculator instead of a second, independent time formula.
export function resolveTapPhysicsInputs(
  sizeStr: string,
  pitchMmIn: number | null | undefined,
  depthMmIn: number | null | undefined,
  fallbackDepthMm: number,
  materialGrade?: string | null,
): TapPhysicsInputs {
  const diaMatch = sizeStr.match(/M\s*(\d+(?:\.\d+)?)/i);
  // An unparseable size string used to silently become M4 — a real tap
  // diameter, fed straight into the RPM term of the cycle-time physics, while
  // the calculator's own provenance line still read 'Parsed from thread size'.
  // The number was fabricated and the label said it was measured. Both are
  // reported now: the assumption is flagged so every consumer can disclose it.
  const diameterIsAssumed = !diaMatch;
  const diameterMm = diaMatch ? parseFloat(diaMatch[1]) : ASSUMED_TAP_DIAMETER_MM;
  // The ISO 261 coarse-pitch series below is real reference data — M4 really is
  // 0.7. The `?? 1.0` tail was not: an off-series nominal (M7, M14, M18, M22, or
  // a diameter that came from the assumption above) got a 1.0mm pitch that
  // scales feed = RPM x pitch, and so scales tapping cycle time and cost.
  const tablePitch = DEFAULT_THREAD_PITCH_MM[Math.round(diameterMm)];
  const pitchIsAssumed = pitchMmIn == null && tablePitch == null;
  const pitchMm = pitchMmIn ?? tablePitch ?? ASSUMED_THREAD_PITCH_MM;
  const depthIsAssumed = depthMmIn == null || depthMmIn <= 0;
  const depthMm = depthIsAssumed ? Math.max(fallbackDepthMm, 0.1) : depthMmIn!;
  const materialFamily = classifyMaterialFamily(materialGrade);
  const surfaceSpeedMMin = TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL[materialFamily] ?? TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL['__default__']!;
  return { diameterMm, diameterIsAssumed, pitchMm, pitchIsAssumed, depthMm, depthIsAssumed, surfaceSpeedMMin, materialFamily };
}

export function computeTapCycleSec(
  sizeStr: string,
  count: number,
  pitchMmIn: number | null | undefined,
  depthMmIn: number | null | undefined,
  fallbackDepthMm: number,
  materialGrade?: string | null,
): TapCycleBreakdown {
  const { diameterMm, pitchMm, pitchIsAssumed, depthMm, depthIsAssumed, surfaceSpeedMMin, materialFamily } =
    resolveTapPhysicsInputs(sizeStr, pitchMmIn, depthMmIn, fallbackDepthMm, materialGrade);

  const physics = computeTapPhysics(diameterMm, count, pitchMm, depthMm, surfaceSpeedMMin);

  return {
    toolChangeSec: physics.toolChangeSec,
    perHoleSec: physics.perHoleSec,
    tapSec: Math.round(physics.machiningTimeSec * 100) / 100,
    totalSec: physics.totalSecWithoutUnload,
    pitchMm,
    pitchIsAssumed,
    depthMm: Math.round(depthMm * 100) / 100,
    depthIsAssumed,
    surfaceSpeedMMin,
    materialFamily,
  };
}

export { TAP_UNLOAD_SEC };

// Real HSS drilling/counterboring surface speed by material family — cross-
// verified from published drilling-vendor references:
//   - AIMS Industrial "Cutting Speeds & Feeds Reference" (mild steel ~100 SFM
//     = 30.5 m/min for HSS): https://aimsindustrial.com.au/blogs/product-guides/cutting-speeds-feeds-reference
//   - Slugger Tool "Drill Speed Chart by Material" (stainless typically
//     drilled at 30-50% of mild steel's speed; aluminum at roughly 2-3x):
//     https://www.sluggertool.com/calculators/drill-speed-chart/
// Straight drilling/counterboring runs faster than tapping for the same
// material (tapping's full thread-form engagement is far more constrained
// than a drill/counterbore's point-contact cutting) — these values are
// deliberately higher than TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL above, not a
// second, disagreeing table for the same operation.
export const DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL: Record<string, number> = {
  carbon_steel: 30,
  stainless: 15,
  aluminum: 80,
  __default__: 30,
};

// Standard HSS drilling/counterboring feed — midpoint of the commonly-cited
// 0.005"-0.010" per rev range (SuperTool "Counterbore Feeds and Speeds":
// https://www.supertoolinc.com/wp-content/uploads/2023/02/CounterboreFeedsandSpeeds.pdf;
// AIMS Industrial's general 0.05-0.2mm/rev HSS guideline above). An
// engineering-standard assumption, disclosed as such — not a per-tool-vendor
// exact spec, same rigor tier as Press Brake's "Shoulder Width = 8x
// thickness" convention elsewhere in this file.
export const DRILL_FEED_MM_PER_REV = 0.15;

// Countersinking runs at 25% of the equivalent drill's speed, same feed per
// rev — a direct, repeatedly-published tool-vendor design rule (Melin Tool /
// MAFord / SuperTool countersink speed-feed sheets), not a value derived here:
//   https://www.melintool.com/wp-content/uploads/2017/05/Speed-and-Feed-Countersink-Data.pdf
//   https://www.maford.com/SiteContent/Documents/2020_speed_feed_files/MAFord%20Countersinks%20speeds%20and%20feeds.pdf
export const COUNTERSINK_SPEED_FACTOR = 0.25;

// Drill-press secondary-hole-operation overhead (approach/retract/tool-change/
// unload) — same machine class and handling-motion profile as rigid tapping,
// so reuses TAP_APPROACH_SEC/TAP_TOOL_CHANGE_SEC/TAP_UNLOAD_SEC's already-
// disclosed values rather than inventing a second, undocumented set for the
// same physical motions. Retract is a rapid withdrawal (not synchronized to
// the feed rate the way a rigid tap's retract is, which must unscrew), so it
// mirrors approach, not machining time.
export const HOLE_OP_UNLOAD_SEC = TAP_UNLOAD_SEC;

export interface DrillingSpeedFeed {
  surfaceSpeedMMin: number;
  feedMmPerRev: number;
  materialFamily: string;
}

// Resolves real, material-specific cutting speed/feed for any rigid-drilling-
// style secondary hole operation (counterbore, countersink) — same role as
// resolveTapPhysicsInputs() above's speed resolution, factored out on its own
// because depth resolution differs meaningfully per operation (counterbore
// has no real depth signal today and falls back to a disclosed assumption;
// countersink's depth is real cone geometry derived from diameter + included
// angle) — see each operation's own caller. speedFactor lets Countersink
// apply its real 25%-of-drill-speed design rule without a second, duplicated
// speed table.
export function resolveDrillingSpeedFeed(
  materialGrade: string | null | undefined,
  speedFactor: number = 1,
): DrillingSpeedFeed {
  const materialFamily = classifyMaterialFamily(materialGrade);
  const baseSpeed = DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL[materialFamily] ?? DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL['__default__']!;
  return {
    surfaceSpeedMMin: Math.round(baseSpeed * speedFactor * 100) / 100,
    feedMmPerRev: DRILL_FEED_MM_PER_REV,
    materialFamily,
  };
}

// Deburring: time constants
export const DEBURR_SEC_PER_METRE = 60;   // per metre of cut edge
export const DEBURR_SEC_PER_PIERCE = 0.5; // per pierce (hole cleanup)

// Single real formula for deburr cycle time — was previously duplicated
// inline in both cost-engine.ts and bom-items.service.ts; both now call this.
// secPerMetre/secPerPierce default to the module constants above ONLY as a
// last-resort safety net — real callers resolve them from sm_lookup_deburr_rate
// (migration 413) via SheetMetalLookupService.getDeburrRate() and pass the
// result in explicitly, disclosing when the DB has no row yet.
export function computeDeburrCycleSec(
  cutLengthMm: number,
  pierceCount: number,
  secPerMetre: number = DEBURR_SEC_PER_METRE,
  secPerPierce: number = DEBURR_SEC_PER_PIERCE,
): number {
  return (cutLengthMm / 1000) * secPerMetre + pierceCount * secPerPierce;
}

// Reaming replaces a laser-pierced hole's finish with a drilled+reamed one when
// tolerance can't be held by piercing alone — same threshold CNC already uses
// in operation-sequencer.ts::injectDrawingIntelligence for the CMM trigger.
export const TIGHT_TOLERANCE_REAM_THRESHOLD_MM = 0.05;

// Finishing-process capability thresholds (finish grinding depth, the
// grinding Ra trigger, the jig boring / jig grinding tolerance and their
// pass counts) are read from the staged reference data, never held here:
// machining/capability-rules.ts (variables + tblGtolProcessCapabilities).

// Real per-stroke approach/overtravel allowance: no dedicated field for
// this exists in tblBroaching (a material cutting-speed/feed table, not a
// machine-geometry table), so the real keyway length alone drives stroke
// time — a disclosed simplification (approach/overtravel isn't modeled),
// not a fabricated allowance.

// Real HSS reaming surface speed by material family — reaming is a distinct
// finishing operation from drilling/tapping (lower speed, precision-focused,
// minimal stock removal), not an approximation borrowed from the drilling
// table above. Sourced from a published HSS reamer speed/feed chart
// (CNC Lathing "Carbide & HSS Reamer Speeds and Feeds (RPM) Chart in
// Metric", cross-referenced against the same chart family cited by
// Be-Cu.com): https://www.cnclathing.com/guide/carbide-hss-reamer-speeds-and-feeds-rpm-chart-in-metric
//   carbon steel (~700 N/mm²): 10-12 m/min -> midpoint 11
//   stainless steel: 4-8 m/min -> midpoint 6
//   aluminum alloy: 10-14 m/min -> midpoint 12
// classifyMaterialFamily()'s 'unknown' case keeps the mild-steel baseline —
// same fallback convention TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL already uses.
export const REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL: Record<string, number> = {
  carbon_steel: 11,
  stainless: 6,
  aluminum: 12,
  __default__: 11,
};

// Reaming feed scales with diameter (unlike tapping's fixed thread pitch) —
// the same cited HSS reamer chart's carbon-steel column is fit almost
// exactly by feed_mm_per_rev = 0.02 x diameter_mm (Ø4mm -> 0.08, Ø6mm ->
// 0.12, Ø10mm -> 0.20, all real chart values). Applied uniformly across
// materials as a disclosed simplification — the chart's stainless/aluminum
// columns follow a similar but not identical progression; the dominant real
// signal (speed) is already material-specific above, this coefficient is
// the same order of rigor as DRILL_FEED_MM_PER_REV's own disclosed-standard
// convention.
export const REAM_FEED_MM_PER_REV_PER_MM_DIAMETER = 0.02;

export interface ReamPhysicsInputs {
  surfaceSpeedMMin: number;
  feedMmPerRev: number;
  materialFamily: string;
}

export function resolveReamPhysicsInputs(diameterMm: number, materialGrade: string | null | undefined): ReamPhysicsInputs {
  const materialFamily = classifyMaterialFamily(materialGrade);
  const surfaceSpeedMMin = REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL[materialFamily] ?? REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL['__default__']!;
  const feedMmPerRev = Math.round(REAM_FEED_MM_PER_REV_PER_MM_DIAMETER * diameterMm * 1000) / 1000;
  return { surfaceSpeedMMin, feedMmPerRev, materialFamily };
}

// ── Surface treatment ─────────────────────────────────────────────────────────
// The drawing callout is matched to a reference process from
// memory/SurfaceTreatment and costed by the surface-treatment engine
// (costing/surface/surface-treatment-engine.ts, via SecondaryProcessService).
// The old surface_treatment_rates table (migration 362) and the regex
// classifier that keyed into it (anodize_type_ii, zinc_plate, a __default__
// catch-all for any plat/paint/coat text) are no longer read.

export interface SurfaceTreatmentDbRate {
  /** Reference machine class, e.g. surface_zinc_plating. */
  treatmentType: string;
  /** Reference process name, e.g. Zinc Plating. */
  label: string;
  machineName: string | null;
  /** Per-part cost in the location currency; absent when the engine could not
   *  cost the process (see gap). */
  totalCostFromCalculatorLocal?: number;
  cycleTimeMin?: number;
  hourlyRateLocal?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  gap?: import('../../../dto/cost-breakdown.dto').PhysicsGap | null;
  confidence?: import('../../../dto/cost-breakdown.dto').ConfidenceLevel;
  resolutionStatus?: import('../../../dto/cost-breakdown.dto').ResolutionStatus;
}

// ── Inspection resource classification (CMM vs manual-inspection vs other) ────
// This schema has no dedicated machine_class distinguishing "actual CMM" from
// "manual inspection bench/gauge equipment" -- both get tagged machine_class=
// 'cmm' (migration 367's own backfill maps any name containing "Inspection"
// into 'cmm' too). So an explicit machine_class==='cmm' is necessary but not
// sufficient evidence a row is a real CMM. Precedence, most to least authoritative:
//   1. Known manual-inspection resource name (curated list below) -- wins even
//      over an explicit machine_class='cmm', since that tag is over-broad by
//      construction here (e.g. real rows "Manual Inspection" / "Manual
//      Inspection Bench" are tagged 'cmm' but are not CMMs).
//   2. Explicit machine_class === 'cmm' (not overridden above) -- trust the
//      curated classification over the machine's own display name (e.g.
//      "Axiom Zenith 1000" is a real CMM whose name has no CMM-indicating word).
//   3. machine_class is null/unknown -- fall back to the pre-existing
//      CMM_NAME_PATTERN name-text heuristic (legacy/benchmark rows from before
//      machine_class existed on this table).
//   4. Otherwise -- OTHER. Never guessed into CMM or MANUAL_INSPECTION.
export type InspectionResourceClass = 'CMM' | 'MANUAL_INSPECTION' | 'OTHER';

// Centralized -- extend this list (not ad-hoc regexes at call sites) as more
// manual-inspection resource names turn up mistakenly tagged machine_class='cmm'.
const MANUAL_INSPECTION_NAME_PATTERN =
  /\bmanual\s+inspection\b|\bmanual\s+bench\b|\binspection\s+bench\b|\bgauge\s+bench\b/i;

export const CMM_NAME_PATTERN = /\bcmm\b|coordinate measur|video measur|vision measur/i;

export function classifyInspectionResource(
  machineClass: string | null | undefined,
  machineName: string | null | undefined,
): InspectionResourceClass {
  const name = machineName ?? '';
  if (MANUAL_INSPECTION_NAME_PATTERN.test(name)) return 'MANUAL_INSPECTION';
  if (machineClass === 'cmm') return 'CMM';
  if (machineClass == null && CMM_NAME_PATTERN.test(name)) return 'CMM';
  return 'OTHER';
}

export const TURRET_TOOL_CHANGE_SEC = 1.5;  // per unique hole diameter — real, cited above

// REMOVED (2026-09-02): TURRET_HITS_PER_MIN and TURRET_NIBBLE_MM_PER_MIN used
// to live here as "fallback" tables for when sm_lookup_turret_punch had no
// row — but sm_lookup_turret_punch's own seeded values (migration 414) are
// IDENTICAL to these tables. That DB table is not independently-sourced real
// machine data; it's the same synthetic thickness-vs-speed estimate, just
// duplicated into the DB and then this file. No real per-machine punch/hit-
// rate field exists anywhere in machine_library.json's Turret Press category
// (verified: full field-name union across all 21 real machines checked) — a
// genuine, disclosed capability gap, not fabricated. Real per-machine nibble
// data DOES exist (nibble_rate_cycles_min + nibble_tool_diameter_mm/
// nibble_tool_overlap_mm — same shape as Laser Punch's real data) and is now
// resolved via getTurretPunchMachineParams() instead. Punching (hits/min)
// has no real substitute and now costs an honest $0 with a disclosed warning
// — see computeTurretPunchCost's own comment.

// Generic fallback of last resort, behind getWaterjetAbrasiveRateForMachine's
// real per-machine abrasive_flow_rate_kg_min (0.34-0.46 across the 27 real
// machines) — this constant is only reached when no per-machine row
// resolves; not independently re-verified against real data since it's
// already correctly gated behind the real resolver, unlike the constants
// above.
export const WATERJET_ABRASIVE_KG_PER_MIN = 0.5; // kg/min of active cutting

// Every contour the head cuts needs a ramp-up run before it reaches full
// pressure/speed and a mirrored ramp-down on exit — this distance is real
// machine travel that isn't "useful" cut length but still consumes cutting
// time. pierceCount already means "contour starts" (see WaterjetInput's own
// doc comment), so each one gets 2x this amount (entry + exit) added to the
// cut length before the speed-based time calculation. Sourced from a real
// USA-region manufacturing reference dataset (2026-03 snapshot); see
// sm_reference_data (category='variable', key='standardWaterjetCutLeadInAmount').
export const WATERJET_LEAD_IN_MM = 5;

// Global overhead on top of the lead-in distance above — accounts for
// acceleration/deceleration the head does mid-path (direction changes,
// speed ramping) that a straight length/speed calculation doesn't capture.
// Sourced alongside WATERJET_LEAD_IN_MM from the same real reference
// dataset (sm_reference_data key='waterjetCutTimeAdjustmentFactor') — the
// source models both as part of one combined cut-time formula, not
// alternatives, so both apply together here too.
export const WATERJET_CUT_TIME_ADJUSTMENT_FACTOR = 1.4;

// A guillotine/power shear cuts one full straight line per stroke — it
// cannot follow a contour. "Shear:Shear//Blank" is the ONLY feature type
// this process appears under in process_operations.json (391 raw compound
// strings), confirming shearing here means trimming a rectangular blank
// from oversized raw stock, never cutting internal holes/contours. Producing
// a rectangular blank of any size from a larger rectangular stock corner
// needs exactly 2 orthogonal straight cuts (trim to length, trim to width) —
// this is Euclidean geometric necessity, not a fitted or guessed business
// constant, the same standard the codebase already relies on for K-factor/
// bend-allowance math. Real per-machine shear_speed (strokes/min,
// machine_library.json's "Shearing Machine" category) is converted to
// press_cycle_time_s (=60/shear_speed) at the data-seeding layer, flowing
// through the exact same rate.pressCycleTimeS field Standard/Tandem/
// Progressive-Die Press already use.
export const SHEARING_CUTS_PER_BLANK = 2;

export const RATES_SOURCE_LABEL = 'Location benchmark rates v2 (2026)';

// Every costing endpoint must default to the SAME location. A summary priced in
// India next to a route comparison priced in USA is a 20× silent error.
export const DEFAULT_COSTING_LOCATION = 'India';

// Machining billet stock allowance: the reference rule in
// costing/machining/stock-allowance.ts (memory/Stock Maching variables).

// ── Machine Registry ──────────────────────────────────────────────────────────
// Maps each cost-engine process to the exact commodity codes that belong to it.
// The Capability Engine (future sprint) will extend each entry with machine limits
// (maxThicknessMm, maxTonnage, maxBendLengthMm, etc.) and use them for selection.
// For this sprint, resolveMHRRates() picks the lowest-rate DB record per class.

export interface MachineRegistryEntry {
  commodityCodes: readonly string[];
  processGroupKeywords: readonly string[];
  machineClassKeywords: readonly string[];
}

export const MACHINE_REGISTRY = {
  // commodityCodes: DB uses 'KW' suffix (SM-LASER-2KW) not 'K' — both kept for legacy compat.
  // processGroupKeywords includes exact process_group values from process_calculator_mappings so
  // that mhr_records seeded with DB-canonical group names (e.g. 'Machining', 'Plastic Molding')
  // resolve correctly alongside legacy/eMithran group names.
  // 'Sheet metal' (lowercase m) matches the eMithran India DB rows.
  // 'Laser Cut', 'Laser Cutter', 'Laser Cutting' removed from this class's own
  // machineClassKeywords (root-caused 2026-09-10, confirmed by the user
  // directly: Fiber Laser Cutting Machine (26), Laser Cutting Machine (24)
  // and 3D Laser Cutting Machine (15) are three real, separately-specced
  // Digital Factory machine pools). This is a DIFFERENT concern from
  // migration 715 (2026-09-09), which deactivated a duplicate OPERATION
  // NAME ("Fiber Laser Cut", byte-identical to "Laser Cut" in route/
  // machine_class/calculator) — that migration never claimed the three real
  // machine POOLS should share one machine_class, only that the "Laser Cut"
  // operation correctly uses the real, verified fiber-laser-shaped
  // cutting-speed calculator (migration 457/f8537846) — a calculator choice
  // that is independent of which machine pool prices against it. Generic
  // laser keywords here would keep sweeping "Laser Cutting Machine"'s and
  // "3D Laser Cutting Machine"'s real, distinctly-specced machines into
  // fiber_laser's pool, exactly the same shape of bug already fixed once for
  // CO2 ("Quattro") below — so 'Fiber Laser' is the only keyword left.
  fiber_laser:    { commodityCodes: ['SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K', 'SM-LASER-2KW', 'SM-LASER-4KW', 'SM-LASER-6KW'], processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'Fiber Laser', 'Laser Cutting'],                                              machineClassKeywords: ['Fiber Laser'] },
  // A real, physically distinct laser technology from fiber_laser — CO2
  // discharge oscillator (10.6μm) vs fiber (~1.06μm), different real machines
  // (e.g. AMADA Quattro AF1000i-C/AF2000i-C — confirmed via AMADA's own
  // product brochure), and NOT interchangeable with a generic fiber-laser
  // cutting-speed table (different absorption physics per material).
  // 'CO2 Laser' is deliberately removed from fiber_laser's own
  // machineClassKeywords above so a real CO2 machine name stops being
  // keyword-matched into the wrong class going forward — this is exactly
  // the bug that had "Quattro" (a real AMADA CO2 laser) tagged fiber_laser
  // in mhr_records, which then silently applied fiber-laser cutting-speed
  // assumptions to a machine that doesn't use fiber-laser physics at all.
  //
  // Corrected 2026-09-10: machine_library.json's "Laser Cutting Machine"
  // category (24 machines, e.g. "Cincinnati CL 850", "Quattro") is NOT a
  // fourth, separate real machine pool — memory/sheetmetal/machine/
  // india_base.json independently names this exact same 24-machine set
  // "CO2 Laser Cutter" (confirmed name-for-name, only OCR-level spelling
  // differences like "FO-Mil" vs "FO-MII"). A short-lived 'laser_cut' class
  // briefly split these 24 machines out on their own (same-day migration
  // 722 draft, never run) before this cross-file reconciliation caught the
  // error — reverted; they resolve through this co2_laser class instead,
  // where "Quattro" (migration 456) already lived.
  co2_laser:      { commodityCodes: [],                                                                                              processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'CO2 Laser', 'Laser Cutting'],                                                 machineClassKeywords: ['CO2 Laser', 'CO2', 'Laser Cut', 'Laser Cutter', 'Laser Cutting Machine'] },
  // The real "3D Laser Cutting Machine" Digital Factory pool (15 machines,
  // user-confirmed distinct specs) — 3D/tube/5-axis laser cutting, a
  // genuinely different capability from flat-sheet cutting (real taxonomy
  // operations are ComplexHole/SimpleHole only, no //Blank — it does not
  // blank its own stock, see routeProducesBlank).
  laser_3d:       { commodityCodes: [],                                                                                              processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'Laser Cutting', '3D Laser'],                                                    machineClassKeywords: ['3D Laser'] },
  // 'Bend Brake' is the DB machine_class name for India press brake records.
  // Root-caused 2026-08-30 (live bug report): a bare 'Press' keyword here
  // matched ANY machine whose machine_class contains the word "press" as a
  // substring — including the entire, genuinely distinct "Press/Forming
  // family" (Progressive Die Press, Standard Press, Tandem Press, Turret
  // Press — CLAUDE.md's own documented "unwired placeholders", none of which
  // bend sheet metal) — pulling machines like "Aida UMX-600" (a Progressive
  // Die Press machine) into real, currently-active Bend Brake quotes. Same
  // over-broad-keyword bug class already fixed once for router_2axis's own
  // entry below — removed here too, keeping only the genuinely specific
  // 'Press Brake'/'Bend Brake'/'Bending Machine' keywords.
  press_brake:    { commodityCodes: ['SM-BRAKE-80T', 'SM-BRAKE-160T', 'SM-BRAKE-320T'],                                             processGroupKeywords: ['Press Brake', 'Bending', 'Bend Brake', 'Sheet Metal', 'Sheet metal'],                                               machineClassKeywords: ['Press Brake', 'Bending Machine', 'Bend Brake'] },
  turret_punch:   { commodityCodes: ['SM-PUNCH-CNC'],                                                                                processGroupKeywords: ['Turret', 'Punch', 'Sheet Metal', 'Sheet metal'],                                                                     machineClassKeywords: ['Turret Punch', 'CNC Punch', 'Punching'] },
  waterjet:       { commodityCodes: ['SM-WATERJET'],                                                                                 processGroupKeywords: ['Waterjet', 'Sheet Metal', 'Sheet metal'],                                                                            machineClassKeywords: ['Waterjet', 'Water Jet', 'Abrasive Jet'] },
  // Track B Phase 2 (2026-08-30): real cost engine + real sm_lookup_router_cut
  // data (tblRouterUtilities.json) now exist — no commodityCodes yet (no
  // process_calculator_mappings commodity code assigned for this operation).
  // machineClassKeywords are DELIBERATELY specific to "2-Axis Router"/
  // "2 Axis Router" (machine_library.json's own category name, and the
  // process_calculator_mappings 'operation' column's spelling) — NOT a bare
  // 'Router' keyword. Real machining-center CNC routers (3-axis/5-axis
  // gantry routers for wood/composite panels — e.g. "Router 5axis"/
  // "Router 3axis" machine_class values, Thermwood/Multicam brand machines)
  // are a completely different real machine category from this app's sheet-
  // metal 2-axis router class, and machine-selection.spec.ts's own
  // classifyMachineRecord test explicitly proves those must stay
  // unclassified (this app has no real engine for CNC machining routers) —
  // a bare 'Router' keyword here would wrongly classify them into this
  // sheet-metal class instead, exactly the cross-category misclassification
  // selector.ts's own isRouterRecord guard already exists to prevent
  // elsewhere in this file.
  router_2axis:   { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Router Cutting'],                                                                      machineClassKeywords: ['2-Axis Router', '2 Axis Router'] },
  // OxyFuel Cut (2026-09-01) — real cost engine + real sm_reference_data
  // 'nestingCutRate:*:OxyFuelCut:*' feed-rate/pierce-time data (migration
  // 492) + 18 real machines in machine_library.json's "Oxyfuel Cutting
  // Machine" category (no cross-category contamination like the Press
  // family had). machineClassKeywords deliberately specific ('Oxyfuel',
  // 'Oxy Fuel', 'Oxy-Fuel') so a genuinely different thermal-cutting class
  // (Plasma, still unwired — see CLAUDE.md) never keyword-matches here.
  oxyfuel_cut:    { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Cutting'],                                                                             machineClassKeywords: ['Oxyfuel', 'Oxy Fuel', 'Oxy-Fuel'] },
  // Shearing (2026-09-01) — real cost engine (reuses computePressStrokeCost,
  // see SHEARING_CUTS_PER_BLANK's doc comment) + 10 real machines in
  // machine_library.json's "Shearing Machine" category, no cross-category
  // contamination. process_route is 'Sheet Cutting' in the live catalog
  // (process_calculator_mappings), distinct from the other cutting engines'
  // 'Cutting' route — a real, pre-existing distinction, not introduced here.
  shear:          { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Sheet Cutting', 'Cutting'],                                                            machineClassKeywords: ['Shear', 'Shearing'] },
  // Cut To Length Line (2026-09-10) — real cost engine (cut-to-length-engine.ts)
  // for all 8 real machines in machine_library.json's "Cut To Length Line
  // (CTL)" category. Confirmed (migration 572) as a genuine, previously
  // unwired gap: zero process_calculator_mappings row and every one of its 40
  // real mhr_records rows (8 machines x 5 locations) carried machine_class =
  // NULL. machineClassKeywords deliberately specific ('Cut To Length',
  // 'CTL') so it never keyword-matches Shearing's own class above, despite
  // both being coil/blank-processing machines in the same process group.
  cut_to_length:  { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Sheet Cutting', 'Cutting'],                                                            machineClassKeywords: ['Cut To Length', 'CTL'] },
  // Laser Punch (2026-09-01) — real cost engine + real per-machine physics
  // (sm_reference_data 'laserPunchMachine:*' rows) for all 26 real machines
  // in machine_library.json's "Laser Punch / Punch Press" category. Fixes a
  // real, pre-existing data bug: 127 mhr_records rows for these machines
  // were mislabeled machine_class='turret_punch' (benchmark_source_key
  // literally reads "Laser Punch / Punch Press:...") — reclassified to this
  // real class as part of this change, not a fresh contamination. Deliberately
  // specific keywords so 'Turret Punch'/'CNC Punch' never match here.
  laser_punch:    { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending/Floating /Forming', 'Cutting'],                                              machineClassKeywords: ['Laser Punch'] },
  // Plasma Cut (2026-09-01) — real cost engine + real per-machine power
  // (sm_reference_data 'plasmaCutMachine:*' rows) feeding real material+
  // thickness+power cut-rate data (sm_reference_data 'nestingCutRate:*:
  // PlasmaCut:*', 1153 rows) for all 13 real machines in machine_library.json's
  // "Plasma Cutting Machine" category. Was already carrying a phantom
  // machine_class='plasma' (not a real registered class) on all 65 live
  // mhr_records rows — reclassified to this real class as part of this
  // change. Deliberately specific keywords so 'Plasma Punch' (different real
  // class below) never matches here.
  plasma_cut:     { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Cutting'],                                                                             machineClassKeywords: ['Plasma Cut', 'Plasma Cutting'] },
  // Plasma Punch (2026-09-01) — real cost engine. Despite the "Punch" name,
  // the only real data available (sm_reference_data 'nestingCutRate:*:
  // PlasmaPunch:*', 139 rows) is a feed-rate/pierce-time cutting model keyed
  // by material+thickness+power, identical in shape to Plasma Cut/OxyFuel —
  // these are plasma torches mounted on punch-press-style machines, not
  // discrete-cycle punches like Laser Punch's real punch_rate_cycles_min
  // data. No punch-cycle data exists for this class, so this engine is NOT
  // modeled like LaserPunchEngine — the real data available determines the
  // model, not the taxonomy name.
  plasma_punch:   { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Sheet Metal Fabrication'],                                                              machineClassKeywords: ['Plasma Punch'] },
  // 2/3/4 Roll Bending (2026-09-01) — real cost engine (shared formula,
  // reuses the PressStrokeEngine-style "one class, constructor-parameterized"
  // pattern) + real per-machine rolling speed/prebend time (sm_reference_data
  // 'rollBenderMachine:*' rows) for 4/25/19 real machines. Fixes a real,
  // pre-existing data bug: all 236 live mhr_records rows for these 3
  // PHYSICALLY DIFFERENT machine categories (2-Roll has no prebend step;
  // 3/4-Roll do) were sharing one undifferentiated 'roll_forming'
  // machine_class with zero registered engine behind it — an active,
  // phantom-calculator route in the live catalog before this change (same
  // class of bug as the Laser Punch/turret_punch contamination fixed
  // earlier). Distinct real classes per category, no name overlap between
  // the 3 real machine pools (verified before this split).
  roll_bending_2: { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending/Floating /Forming'],                                                            machineClassKeywords: ['2 Roll Bender', '2-Roll Bender'] },
  roll_bending_3: { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending/Floating /Forming'],                                                            machineClassKeywords: ['3 Roll Bender', '3-Roll Bender'] },
  roll_bending_4: { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending/Floating /Forming'],                                                            machineClassKeywords: ['4 Roll Bender', '4-Roll Bender'] },
  // Track B Phase 2 — Standard Press / Tandem Press (migration 608). Only the
  // 8 real "Standard Press - X,000kN Press Force"/"Tandem Press - X,000kN
  // Press Force" machines carry these classes today (already set directly on
  // mhr_records.machine_class, so Tier 0 of classifyMachineRecord always wins
  // — these keywords are a defensive Tier 2/3 fallback only, deliberately
  // specific so they never match "Progressive Die Press"/"Bend Press Brake"
  // family names, which share the bare word "Press").
  standard_press: { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending', 'Forming'],                                                                   machineClassKeywords: ['Standard Press'] },
  tandem_press:   { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending', 'Forming'],                                                                   machineClassKeywords: ['Tandem Press'] },
  // Progressive Die Press (2026-09-01) — real data audit found 14 of
  // machine_library.json's 26 "Progressive Die Press" machines are
  // category-EXCLUSIVE (never duplicated under Tandem/Standard Press),
  // confirmed internally consistent (strokes_per_min/press_force_kn/
  // press_table dims all real and physically monotonic). The other 12
  // (Default Press, 3 Schulers, 8 United Power units) are shared hardware
  // with CONTRADICTORY specs across categories (e.g. "Schuler 1150 Ton"
  // shows press_force_kn=7000 here but 658 under Standard Press) — migration
  // 608 already excluded them for Standard/Tandem's own build; this class
  // inherits that same exclusion, deliberately keyword-specific so it never
  // matches the shared/contaminated machine names.
  progressive_die_press: { commodityCodes: [],                                                                                       processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending', 'Forming'],                                                                   machineClassKeywords: ['Progressive Die Press'] },
  tapping:        { commodityCodes: ['SM-TAP-CNC'],                                                                                  processGroupKeywords: ['Tapping', 'Sheet Metal', 'Sheet metal', 'Machining'],                                                               machineClassKeywords: ['Tapping', 'Tap', 'CNC Tap'] },
  // SM-DEBURR = India deburring bench code; Deslag = sheet metal slag removal op.
  // Rotary/Wide Belt keywords added migration 425 alongside real Rotary Deburring
  // Machine / Wide Belt Deburring Machine benchmark rows — genuine deburring
  // equipment, unlike the ultrasonic CLEANING tank that migration 425 moved OUT
  // of this class (see the new 'cleaning' entry below).
  deburring:      { commodityCodes: ['BENCH-DEBURR', 'SM-DEBURR'],                                                                   processGroupKeywords: ['Deburr', 'Finishing', 'Vibratory', 'Tumbling', 'Deslag'],                                        machineClassKeywords: ['Deburring', 'Bench', 'Deburr', 'Vibratory', 'Tumbl', 'Vibro', 'Finishing Cell', 'Deslag', 'Rotary', 'Wide Belt', 'Belt Deburr'] },
  // Real, Machining-specific deburr resource (migration 737/738/753 —
  // 'Manual Deburr:Default Manual Deburr', a real staged mhr_records row,
  // $14.14/hr USA total) — distinct from the generic 'deburring' class
  // above, whose only real data today is a Sheet-Metal-sourced bench
  // (migration 361's "Deburring Cell"/"Manual Deburr bench"). CNC parts
  // prefer this real, domain-specific rate when it's on file — see
  // preferRealRate() in engine-kernel.ts. 'automated_deburr' is activated in
  // process_taxonomy (same migration) but has NO real mhr_records row
  // anywhere in the staged corpus -- a genuine, disclosed gap, not wired.
  manual_deburr:  { commodityCodes: [],                                                                                              processGroupKeywords: ['Finishing', 'Deburring', 'Machining'],                                                                              machineClassKeywords: ['Manual Deburr'] },
  // Real Cylindrical Grinding fleet (migration 737/738/753, 6 machines,
  // e.g. "Flex Grind Schaudt M") — see cost-machining-engine.ts's Cylindrical
  // Grinding line for the real Ra<0.4µm trigger this feeds.
  cylindrical_grinder: { commodityCodes: [],                                                                                          processGroupKeywords: ['Grinding', 'Finishing', 'Machining'],                                                                              machineClassKeywords: ['Cylindrical Grind'] },
  // Real Jig Bore fleet (migrations 757/758, 4 machines, e.g. "SIP
  // Hydroptic 6A") — activated earlier this session; the cost engine that
  // consumes it (real tblBoringV2 Finish Boring physics x real repeat-pass
  // count) is new — see cost-machining-engine.ts's Jig Boring line.
  jig_bore:       { commodityCodes: [],                                                                                              processGroupKeywords: ['Drilling', 'Boring', 'Machining'],                                                                                 machineClassKeywords: ['Jig Bore'] },
  // Real Jig Grind fleet (migrations 737/738/753, 4 machines, default
  // "Hauser S3-DR") — see machining/capability-rules.ts for the
  // real distinguishing trigger vs. Jig Boring and the disclosed physics-
  // reuse choice.
  jig_grind:      { commodityCodes: [],                                                                                              processGroupKeywords: ['Grinding', 'Drilling', 'Boring', 'Machining'],                                                                      machineClassKeywords: ['Jig Grind'] },
  // Real Internal Grinder fleet (migrations 737/738/753, 10 machines, e.g.
  // "Danobat Overbeck IC/iD"). Bore grinding from tblInternalGrinding.
  internal_grinder: { commodityCodes: [],                                                                                           processGroupKeywords: ['Grinding', 'Finishing', 'Machining'],                                                                              machineClassKeywords: ['Internal Grind'] },
  // Real Reciprocating Surface Grinder fleet (migrations 737/738) — flat-face
  // traverse grinding from tblReciprocatingSurfaceGrinding.
  reciprocating_surface_grinder: { commodityCodes: [],                                                                                           processGroupKeywords: ['Grinding', 'Finishing', 'Machining'],                                                                              machineClassKeywords: ['Reciprocating Surface Grind'] },
  // Real Broach fleet (migrations 737/738/753, 4 machines: Pioneer VT1040/
  // H1560, Nachi NUV-20-23, Cell-Mate) — genuinely LINEAR stroke-based
  // physics (max_cutting_speed_m_per_min/max_stroke_length_mm), not rotary
  // like every other class above. See cost-machining-engine.ts's Keyway
  // Broaching line
  // (computeKeywayBroachingLine) for the real cutting physics.
  broach:         { commodityCodes: [],                                                                                              processGroupKeywords: ['Broaching', 'Machining'],                                                                                            machineClassKeywords: ['Broach'] },
  // Real Wire EDM fleet (migrations 737/738/753, 6 machines, e.g. "Fanuc
  // 0id") — see wire-edm-routing.ts for the real hardened-slot trigger and
  // disclosed physics.
  // Real Hob Machine fleet (mhr_records machine_class 'hob_machine', 4 machines)
  // — cuts gear/spline teeth (catalog "Hob Machine:Setup:Hobbing//AxiGroove").
  hob_machine:    { commodityCodes: [], processGroupKeywords: ['Hobbing', 'Machining'], machineClassKeywords: ['Hob'] },
  // Real Shaver fleet (migration 758, 2 machines) — gear shaving after hobbing
  // when tblGearQuality says the gear must be shaved or the drawing calls for it.
  shaver:         { commodityCodes: [], processGroupKeywords: ['Shaving', 'Machining'], machineClassKeywords: ['Shaver'] },
  wire_edm:       { commodityCodes: [],                                                                                              processGroupKeywords: ['EDM', 'Machining'],                                                                                                  machineClassKeywords: ['Wire EDM'] },
  // Genuine cleaning/degreasing equipment (ultrasonic cleaning tanks, vapor
  // degreasers) — NOT deburring (removes contaminants/residue, not burrs/
  // material). Was folded into 'deburring' by an incorrect keyword rule in
  // migration 371; migration 425 splits it out into its own real class,
  // matching the source spreadsheet's own "Process Group: Cleaning" tag.
  cleaning:       { commodityCodes: [],                                                                                              processGroupKeywords: ['Cleaning'],                                                                                       machineClassKeywords: ['Ultrasonic', 'Cleaning', 'Clean', 'Degreas'] },
  // SM-CMM-SM = India CMM (Small) commodity code.
  cmm:            { commodityCodes: ['QA-CMM', 'SM-CMM-SM'],                                                                         processGroupKeywords: ['Inspection', 'Quality'],                                                                         machineClassKeywords: ['CMM', 'Coordinate', 'Video Measuring', 'Vision Measuring', 'Inspection'] },
  // 'Machining' / 'Drilling' route — shared by Reaming (existing, migration 368),
  // Counterboring/Countersinking (migration 381). Secondary hole ops, not primary cutting.
  drill_press:    { commodityCodes: ['SM-DRILL', 'CNC-DRILL'],                                                                       processGroupKeywords: ['Drilling', 'Machining'],                                                                                            machineClassKeywords: ['Drill Press', 'Drilling', 'Bench Drill'] },
  // PEM self-clinching fastener insertion press — distinct equipment from a drill press.
  pem_press:      { commodityCodes: ['SM-PEM-PRESS'],                                                                                processGroupKeywords: ['Hardware Insertion', 'Assembly'],                                                                                   machineClassKeywords: ['PEM Press', 'PEM Insertion', 'Fastener Press', 'Clinch Press'] },
  // Hole extrusion / burring (extruded hole flange formed before tapping — see
  // drawing callouts like "2X M3 BURLING BACK CONVEX"). Deliberately its own class,
  // NOT an alias for turret_punch — many shops do burl on a turret-punch die
  // station, but this should be driven by what a shop actually has on file
  // (mhr_records tagged with these keywords), not a hardcoded machine assumption.
  // No commodityCodes yet — no process_calculator_mappings row exists for this
  // operation; matching relies on processGroupKeywords/machineClassKeywords only.
  hole_forming:   { commodityCodes: [],                                                                                              processGroupKeywords: ['Forming', 'Hole Forming', 'Burring', 'Sheet Metal', 'Sheet metal'],                                                 machineClassKeywords: ['Burring', 'Hole Flanging', 'Flanging Press', 'Hole Forming', 'Burl'] },
  // Real, dedicated deep-hole machine classes (migrations 737/738/752/753
  // already stage the real fleets and activate their process_calculator_mappings
  // rows — 'gun_drill'/'deep_bore_machine' are the clean machine_class values
  // those migrations write directly, not derived from these keywords at query
  // time; kept here mainly so MachineClass (keyof MACHINE_REGISTRY) accepts
  // them and a fallback classification path has something real to match).
  // Real fleet diameter ranges are genuinely disjoint (gun_drill_usa.json:
  // 3-50mm; deep_bore_machine_usa.json: 50-600mm) — see deep-hole-routing.ts.
  gun_drill:        { commodityCodes: [],                                                                                            processGroupKeywords: ['Drilling', 'Machining'],                                                                                            machineClassKeywords: ['Gun Drill', 'Gun Drilling'] },
  deep_bore_machine: { commodityCodes: [],                                                                                           processGroupKeywords: ['Drilling', 'Machining'],                                                                                            machineClassKeywords: ['Deep Bore', 'Deep Bore Machine', 'Trepan'] },
  // Real, staged Machining-domain inspection classes (memory/machining/machine/
  // inspection_usa.json, special_inspection_usa.json — real labor/overhead
  // rates, machine_price_usd, confirmed live 2026-09-18 against a real
  // mhr_records row: process_group 'Machining', machine_class
  // 'machining_inspection', direct OH $0.30/hr, indirect OH $13.90/hr,
  // labor $43.21/hr, machine price $5,000 — matches inspection_usa.json's
  // "Default" station exactly). Deliberately distinct from the shared 'cmm'
  // class: Machining's inspection equipment is its own real fleet, not the
  // same CMM/bench pool Sheet Metal's classifyInspectionResource splits.
  // Genuinely narrow, exact keyword (the real snake_case class value itself,
  // not a generic "Inspection" substring — cmm's own registry entry above
  // already carries that word, so reusing it here would let a single row
  // satisfy both classes' keyword match) so 'machining_inspection' and
  // 'special_inspection' rows can never cross-match each other or the
  // shared 'cmm' class's own real rows.
  machining_inspection: { commodityCodes: [],                                                                                        processGroupKeywords: ['Machining'],                                                                                                        machineClassKeywords: ['machining_inspection'] },
  // Real per-feature cycle-time signal for this tier not yet confirmed real
  // (disclosed gap, not fabricated) — rate is resolvable/queryable now;
  // wiring it into an actual CNC cost line is deferred until a real
  // time-per-feature source is found, same discipline as every other
  // documented "resolvable but not yet costed" gap in this file.
  special_inspection: { commodityCodes: [],                                                                                          processGroupKeywords: ['Machining'],                                                                                                        machineClassKeywords: ['special_inspection', 'Special Inspection'] },
  // Real, granular primary CNC milling/turning classes — replaces the 6
  // generic cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc/cnc_lathe/cnc_lathe_live/
  // cnc_mill_turn buckets that used to sit here (Machining Engine
  // Re-Architecture, see the plan at C:\Users\singi\.claude\plans\
  // logical-noodling-lampson.md). Each is a real, distinct station category
  // seeded into mhr_records by migration 693 (source: memory/machining/
  // machine/machiningusa.json), no longer coarsened by selector.ts's
  // MACHINING_CATEGORY_ALIAS (removed). 'Machining' is the exact
  // process_group in process_calculator_mappings for all CNC ops.
  // Machine-class keywords are the exact real category names — Tier 0
  // (exact machine_class match) is the primary resolution path for these
  // clean, freshly-seeded snake_case values; these keyword entries are only
  // the Tier 1+ fallback for messy/legacy free-text data, same role as
  // every other entry in this registry.
  // Generic axis-count keywords (e.g. '3AX', 'VMC 3') are carried forward
  // from the deleted cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc entries — real,
  // legacy free-text machine names like "Milling_Center 3axis" never say
  // "3 Axis Mill" verbatim, so dropping these would silently stop
  // classifying them (Tier 2/3 fallback, only consulted when Tier 0's
  // exact machine_class match already failed).
  '3_axis_mill':    { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['3 Axis Mill', '3-Axis Mill', '3-Axis', '3 Axis', '3AX', 'VMC 3', '3-axis'] },
  '4_axis_mill':    { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['4 Axis Mill', '4-Axis Mill', '4-Axis', '4 Axis', '4AX', 'VMC 4', '4-axis'] },
  '5_axis_mill':    { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['5 Axis Mill', '5-Axis Mill', '5-Axis', '5 Axis', '5AX', '5-axis'] },
  '2_axis_lathe':   { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['2 Axis Lathe', '2-Axis Lathe'] },
  '3_axis_lathe':   { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['3 Axis Lathe', '3-Axis Lathe'] },
  '2_axis_bar_feed_lathe_with_sub_spindle': { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['2 Axis Bar Feed Lathe with Sub Spindle'] },
  '3_axis_bar_feed_lathe_with_sub_spindle': { commodityCodes: [], processGroupKeywords: ['Machining'], machineClassKeywords: ['3 Axis Bar Feed Lathe with Sub Spindle'] },
  // Real, DISTINCT multi-spindle automatic-lathe fleet (memory/machining/
  // machine/simultaneous_turning_usa.csv, 9 real machines: DMG Mori
  // GMC25ISM-6, Index MS16C-6/MS22-8/MS32-6/MS40-8, plus 4 "Virtual CNC
  // Multi-Spindle" reference machines — real 6/8-spindle rates, staged via
  // migrations 737/738, already active in process_calculator_mappings
  // (migration 752, machine_class='simultaneous_turning'). Reuses
  // computeTurningCostSummary unchanged (same real per-material turning/
  // drilling physics as any other lathe) plus a real, disclosed multi-
  // station adjustment gated on this class's own real
  // slide_configuration.number_spindles capability (mhr_records, migration
  // 788) — never a machine_class string check, matching the platform's
  // "real capability question, never machine_name string matching" rule.
  simultaneous_turning: { commodityCodes: [] as string[], processGroupKeywords: ['Machining'], machineClassKeywords: ['Simultaneous Turning', 'Multi-Spindle', 'Multi Spindle'] },
  // Real, DISTINCT "MillTurn" Machining-domain fleet (migrations 737/738/
  // 753, machine_class literal 'machining_millturn' — deliberately renamed
  // to avoid colliding with the pre-existing 'cnc_mill_turn' bucket above,
  // a different real machine population; see migration 738's own comment).
  // Reuses computeTurningCostSummary unchanged — its real ops (Back
  // Finish Turning, Dovetail Milled, Polygon Turned, Rotary Broached, ...)
  // are the same real turning taxonomy already priced there, just on a
  // simultaneous mill+turn center rather than a lathe. Resolves via Tier 0
  // exact match (class_key === 'machining_millturn'), so the shared
  // 'MillTurn' keyword below never actually needs to disambiguate against
  // cnc_mill_turn's own identical keyword.
  machining_millturn: { commodityCodes: [],                                                                                          processGroupKeywords: ['Mill-Turn', 'Turn-Mill', 'Machining'],                                                                               machineClassKeywords: ['MillTurn'] },
  // SM-IM-* = India injection molder commodity codes (100T / 200T / 500T).
  // 'Plastic Molding' is the exact process_group in process_calculator_mappings
  // and process_taxonomy (migration 733 — the category label for all 4 real
  // sibling processes: Injection/Compression/Reaction Injection/Structural
  // Foam Molding; migration 647 had already renamed mhr_records/mhr_benchmark_
  // rates/lhr_benchmark_rates/lhr_records to this same label, but
  // process_taxonomy/process_calculator_mappings were left on the interim
  // 'Injection Molding' name from migration 614 until 733 finished it).
  injection_molding: { commodityCodes: ['IM-SMALL', 'IM-MED', 'IM-LARGE', 'SM-IM-100T', 'SM-IM-200T', 'SM-IM-500T'],             processGroupKeywords: ['Injection Molding', 'Plastic Molding', 'Injection Mold', 'Plastics'],                            machineClassKeywords: ['Injection Molding', 'Injection Molder', 'IMM', 'Injection Mold'] },
  // Real, distinct machine class (2026-09-02 process-duplicate-audit fix) —
  // previously "Structural foam molding" shared machine_class='compression_molding'
  // with the real Compression Molding process (a live data bug: both real,
  // different manufacturing processes silently costed as the same class).
  // Real machine pool: memory/Injection/machine/structural_foam_molding_machines.json
  // (21 machines, e.g. "Milacron LP500M-423", machineStyle='FOAM'). This IS
  // genuinely injection-style physics (fill/pack/cool/eject via a nozzle,
  // low-pressure with a blowing agent) — reuses computeInjectionMoldedCostSummary
  // unchanged, only the machine pool/rate differs from injection_molding.
  structural_foam_molding: { commodityCodes: [] as string[], processGroupKeywords: ['Injection Molding', 'Plastic Molding'], machineClassKeywords: ['Structural Foam', 'Foam Molder', 'Foam Molding'] },
  // Real, distinct machine class (2026-09-02). Real machine pool:
  // memory/Injection/machine/compression_molding_machines.json (23 machines,
  // e.g. "Accurl Hydraulic Press HBP-40"). Compression molding is NOT
  // injection-style physics (no fill/gate/runner/pack — a preheated charge
  // is placed in an open mold, the press closes under real force/time, the
  // material cures/consolidates, the press opens) — costed by its own
  // computeCompressionMoldingCost(), not the injection-molding engine. See
  // that file's own header for the real-data-only, no-fabricated-cure-time
  // discipline this class's costing follows.
  compression_molding: { commodityCodes: [] as string[], processGroupKeywords: ['Injection Molding', 'Plastic Molding'], machineClassKeywords: ['Compression Molding', 'Compression Press'] },
  // Real, distinct machine class (2026-09-02). Real machine pool:
  // memory/Injection/machine/reaction_injection_molding_machines.json (2
  // machines, e.g. "Gusmer-Decker Reactor IP-40"). RIM genuinely injects
  // (real injectionRateMm3PerS data exists, unlike compression molding) but
  // cures via a chemical reaction between two mixed liquid components, not
  // thermal cooling — Menges cooling physics (computeInjectionMoldedCostSummary)
  // does not apply. Costed by its own computeReactionInjectionMoldingCost(),
  // real fill time from injectionRateMm3PerS, honest disclosed gap for the
  // chemical cure/reaction time (no real cure-kinetics data exists).
  reaction_injection_molding: { commodityCodes: [] as string[], processGroupKeywords: ['Injection Molding', 'Plastic Molding'], machineClassKeywords: ['Reaction Injection', 'RIM', 'Reactor'] },
  // Real, DB-backed class (Platform Architecture Remediation Phase 1) —
  // computeSurfaceTreatmentLine() (cost-surface-treatment.ts) already used
  // this exact literal for every ProcessLineCost it emits; it was never
  // registered here, so the closed MachineClass union didn't cover it. The
  // costed line itself carries the reference class (surface_<process>,
  // migration 820) chosen by the surface-treatment engine, so there is no
  // fleet to match by commodityCode/keyword for this umbrella class —
  // this entry exists only so the class itself is a real, typed member of
  // the vocabulary (satisfies the SurfaceTreatmentEngine registry wrapper's
  // `readonly machineClass: MachineClass`), never resolved via this table's
  // keyword-matching path.
  surface_treatment: { commodityCodes: [] as string[], processGroupKeywords: ['Surface Treatment'], machineClassKeywords: [] as string[] },
} as const satisfies Record<string, MachineRegistryEntry>;

export type MachineClass = keyof typeof MACHINE_REGISTRY;

// ── Digital Factory — location currency metadata ───────────────────────────────
// Real exchange rates always come from ExchangeRateService (the exchange_rates
// table) — no hardcoded/fallback rate lives here anymore (removed the old
// `defaultInrRate` field, which several call sites silently fell back to when
// a real rate lookup came back empty).
// `materialCol`: column to read from raw_materials for this location.

export interface LocationCurrencyInfo {
  readonly code: string;          // ISO 4217 currency code
  readonly symbol: string;        // display symbol
  readonly materialCol: string;   // raw_materials column
}

export const LOCATION_INFO: Readonly<Record<string, LocationCurrencyInfo>> = {
  'India':     { code: 'INR', symbol: '₹', materialCol: 'cost_india'    },
  'USA':       { code: 'USD', symbol: '$', materialCol: 'cost_usa'      },
  'China':     { code: 'CNY', symbol: '¥', materialCol: 'cost_china'    },
  'Germany':   { code: 'EUR', symbol: '€', materialCol: 'cost_germany'  },
  'France':    { code: 'EUR', symbol: '€', materialCol: 'cost_france'   },
  'W. Europe': { code: 'EUR', symbol: '€', materialCol: 'cost_w_europe' },
  'E. Europe': { code: 'EUR', symbol: '€', materialCol: 'cost_e_europe' },
  'UK':        { code: 'GBP', symbol: '£', materialCol: 'cost_uk'       },
  'Vietnam':   { code: 'USD', symbol: '$', materialCol: 'cost_vietnam'  },
  'Mexico':    { code: 'MXN', symbol: 'MX$', materialCol: 'cost_mexico'   },
  'Other':     { code: 'USD', symbol: '$', materialCol: 'cost_usa'      },
} as const;

// Derived from LOCATION_INFO so a currency's display symbol has exactly one
// source — used wherever a currency CODE (not a Digital Factory location) is
// the only thing on hand, e.g. resolving the symbol for a scenario currency
// the user picked in the Currency & Ask Price widget.
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(LOCATION_INFO).map((info) => [info.code, info.symbol]),
);

/** Every Digital Factory location the app knows about, with its native currency — backs GET /api/fx/factories. */
export function listFactoryLocations(): Array<{ location: string; code: string; symbol: string }> {
  return Object.entries(LOCATION_INFO).map(([location, info]) => ({ location, code: info.code, symbol: info.symbol }));
}
