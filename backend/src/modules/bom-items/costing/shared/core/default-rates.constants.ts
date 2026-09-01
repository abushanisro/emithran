export const LASER_SETUP_MIN = 15;       // minutes per batch
export const PRESS_BRAKE_SETUP_MIN = 20;
export const TAPPING_SETUP_MIN = 10;
export const CMM_SETUP_MIN = 15;         // per batch — program recall + fixture + datum alignment

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
  pitchMm: number;
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
  const diameterMm = diaMatch ? parseFloat(diaMatch[1]) : 4;
  const pitchMm = pitchMmIn ?? DEFAULT_THREAD_PITCH_MM[Math.round(diameterMm)] ?? 1.0;
  const depthIsAssumed = depthMmIn == null || depthMmIn <= 0;
  const depthMm = depthIsAssumed ? Math.max(fallbackDepthMm, 0.1) : depthMmIn!;
  const materialFamily = classifyMaterialFamily(materialGrade);
  const surfaceSpeedMMin = TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL[materialFamily] ?? TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL['__default__']!;
  return { diameterMm, pitchMm, depthMm, depthIsAssumed, surfaceSpeedMMin, materialFamily };
}

export function computeTapCycleSec(
  sizeStr: string,
  count: number,
  pitchMmIn: number | null | undefined,
  depthMmIn: number | null | undefined,
  fallbackDepthMm: number,
  materialGrade?: string | null,
): TapCycleBreakdown {
  const { diameterMm, pitchMm, depthMm, depthIsAssumed, surfaceSpeedMMin, materialFamily } =
    resolveTapPhysicsInputs(sizeStr, pitchMmIn, depthMmIn, fallbackDepthMm, materialGrade);

  const physics = computeTapPhysics(diameterMm, count, pitchMm, depthMm, surfaceSpeedMMin);

  return {
    toolChangeSec: physics.toolChangeSec,
    perHoleSec: physics.perHoleSec,
    tapSec: Math.round(physics.machiningTimeSec * 100) / 100,
    totalSec: physics.totalSecWithoutUnload,
    pitchMm,
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

// Counterbore/countersink/PEM/ream: fallback constants used ONLY when the
// corresponding sm_lookup_* table (migration 381) has no row for the diameter —
// same "last-resort safety net" convention as sheet-metal-lookup.service.ts.
export const COUNTERBORE_SETUP_MIN = 5;
export const COUNTERSINK_SETUP_MIN = 5;
export const PEM_INSERTION_SETUP_MIN = 5;
// Hole extrusion (burring): die/tool-change setup, same class as counterbore/
// countersink/PEM above. Cycle time itself comes from sm_lookup_manual_stroke
// (via estimateBurlTonnage + getManualStrokeTime), not a fallback constant here.
export const BURRING_SETUP_MIN = 5;
// Reaming replaces a laser-pierced hole's finish with a drilled+reamed one when
// tolerance can't be held by piercing alone — same threshold CNC already uses
// in operation-sequencer.ts::injectDrawingIntelligence for the CMM trigger.
export const TIGHT_TOLERANCE_REAM_THRESHOLD_MM = 0.05;
export const REAM_SETUP_MIN = 8;

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

// ── Surface treatment types ────────────────────────────────────────────────────
// Rates come from the `surface_treatment_rates` DB table (migration 362).
// This interface describes a resolved DB row converted to local currency.

export interface SurfaceTreatmentDbRate {
  treatmentType: string;
  label: string;
  ratePerM2Local: number;
  minLotChargeLocal: number;
  // Populated by BomItemsService.enrichSurfaceTreatmentRate() — the real
  // "Post Processing - Surface Treatment" calculator's resolved Total Cost
  // (area×rate vs. amortized min-lot, whichever is higher) for THIS part's
  // real surface area and batch size, via resolvePhysicsQuantity. Absent
  // (undefined) only when surface area wasn't known yet at resolution time
  // (computeSurfaceTreatmentLine's own "area unknown" guard already warns
  // and skips the line in that case) — never a fabricated fallback number.
  totalCostFromCalculatorLocal?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  gap?: import('../../../dto/cost-breakdown.dto').PhysicsGap | null;
  confidence?: import('../../../dto/cost-breakdown.dto').ConfidenceLevel;
  resolutionStatus?: import('../../../dto/cost-breakdown.dto').ResolutionStatus;
}

// Maps a drawing/coating callout ("Type III Hardcoat Black Anodize") to a rate
// key. Returns null for empty/none callouts AND for unrecognized text — the
// engine warns on unrecognized callouts instead of pricing them wrong.
export function classifySurfaceTreatment(callout: string | null | undefined): string | null {
  if (!callout) return null;
  const c = callout.trim();
  if (!c || /^(none|n\/a|na|nil|no|-|as.?required)$/i.test(c)) return null;
  if (/type\s*(iii|3)|hard\s*coat|hardcoat|hard\s*anodi/i.test(c)) return 'anodize_type_iii';
  if (/anodi/i.test(c)) return 'anodize_type_ii';
  if (/zinc|galvani/i.test(c)) return 'zinc_plate';
  if (/powder/i.test(c)) return 'powder_coat';
  if (/passivat/i.test(c)) return 'passivate';
  // Chromate/chemical conversion coating (e.g. MIL-DTL-5541, trade names
  // Alodine/Iridite) — checked BEFORE the generic catch-all below, since
  // "chrom" alone would otherwise match that bucket's broader regex and lose
  // this treatment's own real, region-specific rate (see migration 490).
  if (/chemical\s*conversion|chem\s*film|chromate\s*conversion|\balodine\b|\biridite\b/i.test(c)) return 'chem_conversion_coating';
  if (/plat|paint|coat|phosphat|black\s*oxide|blacken|nickel|chrom|e-?coat|trivalent/i.test(c)) return '__default__';
  return null;
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

// ── Turret Punch ──────────────────────────────────────────────────────────────
export const TURRET_SETUP_MIN = 45;        // per batch (programming + tool load)
export const TURRET_TOOL_CHANGE_SEC = 30;  // penalty per unique hole diameter

// Punching speed (hits/min) by sheet thickness
export const TURRET_HITS_PER_MIN: Record<number, number> = {
  1: 250, 2: 200, 3: 150, 4: 100, 5: 80, 6: 60,
};

// Nibbling speed (mm/min) for contour cuts by sheet thickness
export const TURRET_NIBBLE_MM_PER_MIN: Record<number, number> = {
  1: 1200, 2: 800, 3: 600, 4: 400,
};

// ── Waterjet ──────────────────────────────────────────────────────────────────
// Abrasive prices come from the `consumable_prices` DB table (migration 362).
// Cutting speed and pierce time are NOT here — they come from the real,
// material+thickness-specific sm_lookup_waterjet_cut table (migration 398) via
// SheetMetalLookupService.getWaterjetParams(), resolved in bom-items.service.ts
// and passed into computeWaterjetCost() (waterjet-engine.ts). A hardcoded,
// material-blind speed/pierce-time table used to live here and silently
// diverged from that real data — removed rather than kept as a "fallback".
export const WATERJET_SETUP_MIN = 30;       // per batch
export const WATERJET_ABRASIVE_KG_PER_MIN = 0.5; // kg/min of active cutting

// OxyFuel Cut (2026-09-01). Feed rate / pierce time are NOT here — real,
// material+thickness-specific data comes from sm_reference_data's staged
// 'nestingCutRate:*:OxyFuelCut:*' rows (migration 492) via
// SheetMetalLookupService.getOxyfuelParams(). Setup time: all 18 real
// Oxyfuel machines in machine_library.json report the identical real
// setup_time_hr=0.08 (4.8min) — used only when sm_lookup_op_setup_time has
// no row yet for 'oxyfuel_cut', same disclosed-fallback convention as
// WATERJET_SETUP_MIN above.
export const OXYFUEL_SETUP_MIN = 4.8; // per batch

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

// ── 2-Axis Router (Track B Phase 2) ────────────────────────────────────────────
// Cutting speed is NOT here — it comes from the real, material-family-specific
// sm_lookup_router_cut table (tblRouterUtilities.json) via
// SheetMetalLookupService.getRouterParams(), resolved in bom-items.service.ts
// and passed into computeRouterCost() (router-engine.ts). Setup time below is
// a real, cited default: machine_library.json's "2-Axis Router" category
// records setup_time_hr=0.5 (30min) consistently across all 10 real machines
// in that category — used only when sm_lookup_op_setup_time has no row yet
// for 'router_2axis' (same disclosed-fallback convention as WATERJET_SETUP_MIN).
export const ROUTER_SETUP_MIN = 30; // per batch

// Standard Press / Tandem Press (Track B Phase 2, migration 608) — used only
// when sm_lookup_op_setup_time has no row yet for these classes. Real,
// cited default: all 8 real Standard/Tandem Press machines' own
// setup_time_hr (migration 585/597 staging) is 0.5hr (30min) — same
// disclosed-fallback convention as ROUTER_SETUP_MIN above.
export const PRESS_STROKE_SETUP_MIN = 30; // per batch

// Shearing (2026-09-01) — used only when sm_lookup_op_setup_time has no row
// yet for 'shear'. Real, cited default: all 10 real machine_library.json
// "Shearing Machine" rows carry the identical setup_time_hr=0.38 (22.8min) —
// same disclosed-fallback convention as PRESS_STROKE_SETUP_MIN above.
export const SHEARING_SETUP_MIN = 22.8; // per batch

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

// Laser Punch (2026-09-01) — used only when sm_reference_data has no real
// 'laserPunchMachine:<name>' row for the selected machine yet. Real, cited
// default: all 26 real machine_library.json "Laser Punch / Punch Press"
// rows carry the identical setup_time_hr=0.5 (30min) — same disclosed-
// fallback convention as TURRET_SETUP_MIN/ROUTER_SETUP_MIN above.
export const LASER_PUNCH_SETUP_MIN = 30; // per batch

export const RATES_SOURCE_LABEL = 'Location benchmark rates v2 (2026)';

// Every costing endpoint must default to the SAME location. A summary priced in
// India next to a route comparison priced in USA is a 20× silent error.
export const DEFAULT_COSTING_LOCATION = 'India';

// CNC billet stock allowance per side (mm): saw-cut kerf + facing/skim clean-up.
// Applied to each bounding-box dimension (2 × per-side) when sizing milled billets.
export const CNC_STOCK_ALLOWANCE_PER_SIDE_MM = 3;

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
  // that mhr_records seeded with DB-canonical group names (e.g. 'Machining', 'Plastic & Rubber')
  // resolve correctly alongside legacy/eMithran group names.
  // 'Sheet metal' (lowercase m) matches the eMithran India DB rows.
  fiber_laser:    { commodityCodes: ['SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K', 'SM-LASER-2KW', 'SM-LASER-4KW', 'SM-LASER-6KW'], processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'Fiber Laser', 'Laser Cutting'],                                              machineClassKeywords: ['Fiber Laser', 'Laser Cut', 'Laser Cutter', 'Laser Cutting'] },
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
  co2_laser:      { commodityCodes: [],                                                                                              processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'CO2 Laser', 'Laser Cutting'],                                                 machineClassKeywords: ['CO2 Laser', 'CO2'] },
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
  // Laser Punch (2026-09-01) — real cost engine + real per-machine physics
  // (sm_reference_data 'laserPunchMachine:*' rows) for all 26 real machines
  // in machine_library.json's "Laser Punch / Punch Press" category. Fixes a
  // real, pre-existing data bug: 127 mhr_records rows for these machines
  // were mislabeled machine_class='turret_punch' (benchmark_source_key
  // literally reads "Laser Punch / Punch Press:...") — reclassified to this
  // real class as part of this change, not a fresh contamination. Deliberately
  // specific keywords so 'Turret Punch'/'CNC Punch' never match here.
  laser_punch:    { commodityCodes: [],                                                                                              processGroupKeywords: ['Sheet Metal', 'Sheet metal', 'Bending/Floating /Forming', 'Cutting'],                                              machineClassKeywords: ['Laser Punch'] },
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
  // 'Post Processing' is the process DB group that contains Deburring/Finishing routes.
  // Rotary/Wide Belt keywords added migration 425 alongside real Rotary Deburring
  // Machine / Wide Belt Deburring Machine benchmark rows — genuine deburring
  // equipment, unlike the ultrasonic CLEANING tank that migration 425 moved OUT
  // of this class (see the new 'cleaning' entry below).
  deburring:      { commodityCodes: ['BENCH-DEBURR', 'SM-DEBURR'],                                                                   processGroupKeywords: ['Deburr', 'Finishing', 'Vibratory', 'Tumbling', 'Deslag', 'Post Processing'],                                        machineClassKeywords: ['Deburring', 'Bench', 'Deburr', 'Vibratory', 'Tumbl', 'Vibro', 'Finishing Cell', 'Deslag', 'Rotary', 'Wide Belt', 'Belt Deburr'] },
  // Genuine cleaning/degreasing equipment (ultrasonic cleaning tanks, vapor
  // degreasers) — NOT deburring (removes contaminants/residue, not burrs/
  // material). Was folded into 'deburring' by an incorrect keyword rule in
  // migration 371; migration 425 splits it out into its own real class,
  // matching the source spreadsheet's own "Process Group: Cleaning" tag.
  cleaning:       { commodityCodes: [],                                                                                              processGroupKeywords: ['Cleaning', 'Post Processing'],                                                                                       machineClassKeywords: ['Ultrasonic', 'Cleaning', 'Clean', 'Degreas'] },
  // SM-CMM-SM = India CMM (Small) commodity code.
  // 'Post Processing' is the process DB group that contains CMM/Inspection routes.
  cmm:            { commodityCodes: ['QA-CMM', 'SM-CMM-SM'],                                                                         processGroupKeywords: ['Inspection', 'Quality', 'Post Processing'],                                                                         machineClassKeywords: ['CMM', 'Coordinate', 'Video Measuring', 'Vision Measuring', 'Inspection'] },
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
  // 'Machining' is the exact process_group in process_calculator_mappings for all CNC ops.
  cnc_3ax_vmc:    { commodityCodes: ['CNC-VMC-3AX', 'SM-VMC-3AX'],                                                                   processGroupKeywords: ['CNC Machining', 'Milling', 'Machining'],                                                                            machineClassKeywords: ['3-Axis', '3 Axis', '3AX', 'VMC 3', '3-axis'] },
  cnc_4ax_vmc:    { commodityCodes: ['CNC-VMC-4AX'],                                                                                  processGroupKeywords: ['CNC Machining', 'Milling', 'Machining'],                                                                            machineClassKeywords: ['4-Axis', '4 Axis', '4AX', 'VMC 4', '4-axis'] },
  cnc_5ax_mc:     { commodityCodes: ['CNC-MC-5AX', 'SM-VMC-5AX'],                                                                    processGroupKeywords: ['CNC Machining', 'Milling', 'Machining'],                                                                            machineClassKeywords: ['5-Axis', '5 Axis', '5AX', '5-axis'] },
  cnc_lathe:      { commodityCodes: ['CNC-LATHE-2AX', 'SM-LATHE-2AX'],                                                               processGroupKeywords: ['Turning', 'Lathe', 'Machining'],                                                                                    machineClassKeywords: ['2-Axis Lathe', 'CNC Lathe', '2-Axis', 'Lathe'] },
  cnc_lathe_live: { commodityCodes: ['CNC-LATHE-LT'],                                                                                processGroupKeywords: ['Turning', 'Lathe', 'Machining'],                                                                                    machineClassKeywords: ['Live Tool', 'Sub-Spindle', 'Live Tooling'] },
  cnc_mill_turn:  { commodityCodes: ['CNC-MILLTURN'],                                                                                processGroupKeywords: ['Mill-Turn', 'Turn-Mill', 'Machining'],                                                                               machineClassKeywords: ['Mill-Turn', 'MillTurn', 'Turn Mill', 'Mill Turn'] },
  // SM-IM-* = India injection molder commodity codes (100T / 200T / 500T).
  // 'Plastic & Rubber' is the exact process_group in process_calculator_mappings.
  injection_molding: { commodityCodes: ['IM-SMALL', 'IM-MED', 'IM-LARGE', 'SM-IM-100T', 'SM-IM-200T', 'SM-IM-500T'],             processGroupKeywords: ['Injection Molding', 'Plastic Molding', 'Injection Mold', 'Plastics', 'Plastic & Rubber'],                            machineClassKeywords: ['Injection Molding', 'Injection Molder', 'IMM', 'Injection Mold'] },
  // Real, DB-backed class (Platform Architecture Remediation Phase 1) —
  // computeSurfaceTreatmentLine() (cost-surface-treatment.ts) already used
  // this exact literal for every ProcessLineCost it emits; it was never
  // registered here, so the closed MachineClass union didn't cover it. Rates
  // come from surface_treatment_rates (migration 362), not mhr_records, so
  // there is no real per-machine fleet to match by commodityCode/keyword —
  // this entry exists only so the class itself is a real, typed member of
  // the vocabulary (satisfies the SurfaceTreatmentEngine registry wrapper's
  // `readonly machineClass: MachineClass`), never resolved via this table's
  // keyword-matching path.
  surface_treatment: { commodityCodes: [] as string[], processGroupKeywords: ['Surface Treatment', 'Post Processing'], machineClassKeywords: [] as string[] },
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

// ISO 4217 display names for every currency LOCATION_INFO actually resolves
// to — this is the ONLY place a currency's full name is spelled out. The
// frontend's Currency & Ask Price widget fetches this (via GET /api/fx/
// currencies) instead of keeping its own hardcoded label list, so adding a
// Digital Factory location in a new currency here is the only edit needed.
const ISO_CURRENCY_NAMES: Readonly<Record<string, string>> = {
  INR: 'Indian Rupee', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
  CNY: 'Chinese Yuan', MXN: 'Mexican Peso',
};

export const CURRENCY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(CURRENCY_SYMBOLS).map((code) => [code, ISO_CURRENCY_NAMES[code] ?? code]),
);

/** Every Digital Factory location the app knows about, with its native currency — backs GET /api/fx/factories. */
export function listFactoryLocations(): Array<{ location: string; code: string; symbol: string }> {
  return Object.entries(LOCATION_INFO).map(([location, info]) => ({ location, code: info.code, symbol: info.symbol }));
}

/** Every distinct scenario currency a Digital Factory location resolves to — backs GET /api/fx/currencies. */
export function listCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return Object.keys(CURRENCY_SYMBOLS).map((code) => ({
    code, symbol: CURRENCY_SYMBOLS[code], name: CURRENCY_NAMES[code],
  }));
}

// ── Rate plausibility guard ────────────────────────────────────────────────────
// A DB machine/labour rate far outside the location benchmark band almost
// always means a broken import (currency not converted, overhead-only rate,
// benchmark-sheet noise) — the class of bug migration 327 backfilled for MHR,
// and migration 348 for LHR. The DB stays authoritative (we never silently
// clamp a rate the user entered), but the deviation must be VISIBLE on the
// cost summary so bad data cannot silently reach a quote.
//
// The fractions themselves are business/costing POLICY, not an algorithmic
// constant — they belong in the database (`costing_settings`, migration 473:
// 'rate_warn_low_fraction'/'rate_warn_high_fraction'), read once per request
// by the caller (mirroring how sga_pct/profit_pct are already loaded in
// cost-aggregation.service.ts/location-comparison.service.ts) and passed in
// here. These two functions contain only the generic comparison — no DB
// access, no hardcoded policy — and DEFAULT_RATE_WARN_THRESHOLDS below is
// strictly the last-resort fallback for when that table is ever empty
// (same "fallback + disclosed warning" convention as SGA/profit).
export interface RateWarnThresholds {
  lowFraction: number;   // below this fraction of benchmark → suspicious (e.g. 0.5 = 50%)
  highFraction: number;  // above this multiple of benchmark → suspicious (e.g. 3.0 = 300%)
}

export const DEFAULT_RATE_WARN_THRESHOLDS: RateWarnThresholds = { lowFraction: 0.5, highFraction: 3.0 };

// benchmark: resolved from mhr_benchmark_rates (Pass 4 in resolveMHRRates).
// Returns null when no benchmark is available so the guard degrades gracefully.
export function benchmarkRateWarning(
  machineClass: string,
  location: string,
  rate: number,
  machineName: string | null,
  benchmark: number | undefined,
  thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
): string | null {
  if (benchmark == null || benchmark <= 0 || rate <= 0) return null;

  const symbol = LOCATION_INFO[location]?.symbol ?? '';
  const name = machineName ?? machineClass.replace(/_/g, ' ');
  if (rate < benchmark * thresholds.lowFraction) {
    const pct = Math.round((1 - rate / benchmark) * 100);
    return `${name} rate ${symbol}${rate}/hr is ${pct}% below the ${location} ${machineClass.replace(/_/g, ' ')} benchmark (${symbol}${benchmark}/hr) — verify the MHR record before quoting`;
  }
  if (rate > benchmark * thresholds.highFraction) {
    return `${name} rate ${symbol}${rate}/hr is over ${thresholds.highFraction}× the ${location} ${machineClass.replace(/_/g, ' ')} benchmark (${symbol}${benchmark}/hr) — verify the MHR record before quoting`;
  }
  return null;
}

// Same plausibility guard as benchmarkRateWarning above, for LABOUR rates —
// no equivalent existed until now, which is exactly how a stale lhr_records
// import artifact (migration 348: a USD-denominated import multiplying an
// already-INR India rate by ~83.5 again) reached a live quote as a real
// ₹12,062/hr labour rate with no warning at all, while the analogous
// machine-rate case has been caught since migration 327.
//
// processGroup: the resolved lhr_process_group (or process_group fallback)
// this rate was billed under — used only for the warning text, not lookup.
// benchmark: resolved from lhr_benchmark_rates for the SAME location+group
// this rate was actually billed under (see resolveLHRRates). Returns null
// when no benchmark is available so the guard degrades gracefully.
export function lhrRateWarning(
  processGroup: string,
  location: string,
  rate: number,
  benchmark: number | undefined,
  thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
): string | null {
  if (benchmark == null || benchmark <= 0 || rate <= 0) return null;

  const symbol = LOCATION_INFO[location]?.symbol ?? '';
  if (rate < benchmark * thresholds.lowFraction) {
    const pct = Math.round((1 - rate / benchmark) * 100);
    return `${processGroup} labour rate ${symbol}${rate}/hr is ${pct}% below the ${location} ${processGroup} benchmark (${symbol}${benchmark}/hr) — verify the LHR record before quoting`;
  }
  if (rate > benchmark * thresholds.highFraction) {
    return `${processGroup} labour rate ${symbol}${rate}/hr is over ${thresholds.highFraction}× the ${location} ${processGroup} benchmark (${symbol}${benchmark}/hr) — verify the LHR record before quoting`;
  }
  return null;
}
