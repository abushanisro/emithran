export const LASER_SETUP_MIN = 15;       // minutes per batch
export const PRESS_BRAKE_SETUP_MIN = 20;
export const TAPPING_SETUP_MIN = 10;
export const CMM_SETUP_MIN = 15;         // per batch — program recall + fixture + datum alignment

// Batch inspection sampling — three stages (aPriori-style):
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
export const SCRAP_PCT = 3;              // process scrap

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
  if (/ALUMIN|AA\s?\d{4}|AL\s?\d{4}|6061|6063|5052|5754|7075|2024/.test(g)) return 'aluminum';
  if (/STAINLESS|SS\s?3\d{2}|SS\s?4\d{2}|AISI\s?3\d{2}|17-4/.test(g)) return 'stainless';
  if (/CRCA|IS\s?2062|DC01|MILD|\bMS\b|E250|E350|S235|S355|HR\b|CR[1-5]\b/.test(g)) return 'carbon_steel';
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
export const MATERIAL_UTS_MPA: Record<string, number> = {
  CRCA:    370,  DC01: 370,
  IS2062:  410,  MS: 410,   E250: 410, E350: 490,
  SS304:   620,  SS316: 580, SS316L: 560,
  AL6061:  310,  AA6061: 310,   // T6 temper
  AL5052:  230,  AA5052: 230,
  __default__: 410,              // mild steel assumption
};

export function resolveUtsMpa(grade: string | null | undefined): number {
  const g = (grade ?? '').toUpperCase().replace(/[\s\-]/g, '');
  const hit = Object.keys(MATERIAL_UTS_MPA).find((k) => k !== '__default__' && g.includes(k));
  return MATERIAL_UTS_MPA[hit ?? '__default__']!;
}

/** Estimated press-brake force in metric tons for one air bend. */
export function estimateBendTonnage(
  utsMpa: number,
  thicknessMm: number,
  bendLengthMm: number,
): number | null {
  if (thicknessMm <= 0 || bendLengthMm <= 0 || utsMpa <= 0) return null;
  const vOpeningMm = 8 * thicknessMm;
  const forceKn = (1.42 * utsMpa * bendLengthMm * thicknessMm * thicknessMm) / (1000 * vOpeningMm);
  return Math.round((forceKn / 9.81) * 10) / 10;
}

// Tapping: cycle time (sec per hole) — ISO 965-1, rigid tapping
export const TAP_CYCLE_SEC: Record<string, number> = {
  'M2': 4, 'M2.5': 5, 'M3': 6, 'M4': 7, 'M5': 8,
  'M6': 10, 'M8': 14, 'M10': 18, 'M12': 22, 'M16': 28,
};

// Deburring: time constants
export const DEBURR_SEC_PER_METRE = 60;   // per metre of cut edge
export const DEBURR_SEC_PER_PIERCE = 0.5; // per pierce (hole cleanup)

// ── Surface treatment types ────────────────────────────────────────────────────
// Rates come from the `surface_treatment_rates` DB table (migration 362).
// This interface describes a resolved DB row converted to local currency.

export interface SurfaceTreatmentDbRate {
  treatmentType: string;
  label: string;
  ratePerM2Local: number;
  minLotChargeLocal: number;
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
  if (/plat|paint|coat|phosphat|black\s*oxide|blacken|nickel|chrom|e-?coat|trivalent/i.test(c)) return '__default__';
  return null;
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
export const WATERJET_SETUP_MIN = 30;       // per batch
export const WATERJET_PIERCE_SEC = 5;       // sec per contour start (pierceCount)
export const WATERJET_ABRASIVE_KG_PER_MIN = 0.5; // kg/min of active cutting

// Cutting speed (mm/min) by thickness — mild steel; same table applies to SS and Al
export const WATERJET_SPEED_MM_PER_MIN: Record<number, number> = {
  1: 2000, 2: 800, 3: 450, 4: 280, 5: 200,
  6: 150, 8: 100, 10: 75,
};

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
  // resolve correctly alongside legacy/aPriori group names.
  // 'Sheet metal' (lowercase m) matches the aPriori India DB rows.
  fiber_laser:    { commodityCodes: ['SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K', 'SM-LASER-2KW', 'SM-LASER-4KW', 'SM-LASER-6KW'], processGroupKeywords: ['Laser', 'Sheet Metal', 'Sheet metal', 'Fiber Laser', 'Laser Cutting'],                                              machineClassKeywords: ['Fiber Laser', 'Laser Cut', 'CO2 Laser', 'Laser Cutter', 'Laser Cutting'] },
  // 'Bend Brake' is the DB machine_class name for India press brake records.
  press_brake:    { commodityCodes: ['SM-BRAKE-80T', 'SM-BRAKE-160T', 'SM-BRAKE-320T'],                                             processGroupKeywords: ['Press Brake', 'Bending', 'Bend Brake', 'Sheet Metal', 'Sheet metal'],                                               machineClassKeywords: ['Press Brake', 'Bending Machine', 'Press', 'Bend Brake'] },
  turret_punch:   { commodityCodes: ['SM-PUNCH-CNC'],                                                                                processGroupKeywords: ['Turret', 'Punch', 'Sheet Metal', 'Sheet metal'],                                                                     machineClassKeywords: ['Turret Punch', 'CNC Punch', 'Punching'] },
  waterjet:       { commodityCodes: ['SM-WATERJET'],                                                                                 processGroupKeywords: ['Waterjet', 'Sheet Metal', 'Sheet metal'],                                                                            machineClassKeywords: ['Waterjet', 'Water Jet', 'Abrasive Jet'] },
  tapping:        { commodityCodes: ['SM-TAP-CNC'],                                                                                  processGroupKeywords: ['Tapping', 'Sheet Metal', 'Sheet metal', 'Machining'],                                                               machineClassKeywords: ['Tapping', 'Tap', 'CNC Tap'] },
  // SM-DEBURR = India deburring bench code; Deslag = sheet metal slag removal op.
  // 'Post Processing' is the process DB group that contains Deburring/Finishing routes.
  deburring:      { commodityCodes: ['BENCH-DEBURR', 'SM-DEBURR'],                                                                   processGroupKeywords: ['Deburr', 'Finishing', 'Vibratory', 'Tumbling', 'Deslag', 'Post Processing'],                                        machineClassKeywords: ['Deburring', 'Bench', 'Deburr', 'Vibratory', 'Tumbl', 'Vibro', 'Finishing Cell', 'Deslag'] },
  // SM-CMM-SM = India CMM (Small) commodity code.
  // 'Post Processing' is the process DB group that contains CMM/Inspection routes.
  cmm:            { commodityCodes: ['QA-CMM', 'SM-CMM-SM'],                                                                         processGroupKeywords: ['Inspection', 'Quality', 'Post Processing'],                                                                         machineClassKeywords: ['CMM', 'Coordinate', 'Video Measuring', 'Vision Measuring', 'Inspection'] },
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
} as const satisfies Record<string, MachineRegistryEntry>;

export type MachineClass = keyof typeof MACHINE_REGISTRY;

// ── Digital Factory — location currency metadata ───────────────────────────────
// `defaultInrRate`: 1 unit of this currency = N INR (FY2026-27 budget rates;
// overridden at runtime by the `exchange_rates` table if populated).
// `materialCol`: column to read from raw_materials for this location.

export interface LocationCurrencyInfo {
  readonly code: string;          // ISO 4217 currency code
  readonly symbol: string;        // display symbol
  readonly defaultInrRate: number; // fallback: 1 local unit = N INR
  readonly materialCol: string;   // raw_materials column
}

export const LOCATION_INFO: Readonly<Record<string, LocationCurrencyInfo>> = {
  'India':     { code: 'INR', symbol: '₹', defaultInrRate: 1,      materialCol: 'cost_india'    },
  'USA':       { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_usa'      },
  'China':     { code: 'CNY', symbol: '¥', defaultInrRate: 11.52,  materialCol: 'cost_china'    },
  'Germany':   { code: 'EUR', symbol: '€', defaultInrRate: 90.8,   materialCol: 'cost_germany'  },
  'France':    { code: 'EUR', symbol: '€', defaultInrRate: 90.8,   materialCol: 'cost_france'   },
  'W. Europe': { code: 'EUR', symbol: '€', defaultInrRate: 90.8,   materialCol: 'cost_w_europe' },
  'E. Europe': { code: 'EUR', symbol: '€', defaultInrRate: 90.8,   materialCol: 'cost_e_europe' },
  'UK':        { code: 'GBP', symbol: '£', defaultInrRate: 107.0,  materialCol: 'cost_uk'       },
  'Vietnam':   { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_vietnam'  },
  'Mexico':    { code: 'MXN', symbol: 'MX$', defaultInrRate: 4.77, materialCol: 'cost_mexico'   },
  'Other':     { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_usa'      },
} as const;

// ── Rate plausibility guard ────────────────────────────────────────────────────
// A DB machine rate far outside the location benchmark band almost always means a
// broken import (currency not converted, overhead-only rate, benchmark-sheet noise)
// — the class of bug migration 327 backfilled. The DB stays authoritative (we never
// silently clamp a rate the user entered), but the deviation must be VISIBLE on the
// cost summary so bad data cannot silently reach a quote.

const RATE_WARN_LOW_FRACTION = 0.5;   // below 50% of benchmark → suspicious
const RATE_WARN_HIGH_FRACTION = 3.0;  // above 300% of benchmark → suspicious

// benchmark: resolved from mhr_benchmark_rates (Pass 4 in resolveMHRRates).
// Returns null when no benchmark is available so the guard degrades gracefully.
export function benchmarkRateWarning(
  machineClass: string,
  location: string,
  rate: number,
  machineName: string | null,
  benchmark: number | undefined,
): string | null {
  if (benchmark == null || benchmark <= 0 || rate <= 0) return null;

  const symbol = LOCATION_INFO[location]?.symbol ?? '';
  const name = machineName ?? machineClass.replace(/_/g, ' ');
  if (rate < benchmark * RATE_WARN_LOW_FRACTION) {
    const pct = Math.round((1 - rate / benchmark) * 100);
    return `${name} rate ${symbol}${rate}/hr is ${pct}% below the ${location} ${machineClass.replace(/_/g, ' ')} benchmark (${symbol}${benchmark}/hr) — verify the MHR record before quoting`;
  }
  if (rate > benchmark * RATE_WARN_HIGH_FRACTION) {
    return `${name} rate ${symbol}${rate}/hr is over ${RATE_WARN_HIGH_FRACTION}× the ${location} ${machineClass.replace(/_/g, ' ')} benchmark (${symbol}${benchmark}/hr) — verify the MHR record before quoting`;
  }
  return null;
}
