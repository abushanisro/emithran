// All rates in INR. Fiber laser 6kW, India 2026 baseline.
// Replace with DB-driven MHR lookup in a future sprint.

export const LASER_MHR_INR = 1_200;     // ₹/hr — machine + operator
export const PRESS_BRAKE_MHR_INR = 600;
export const DEBURRING_MHR_INR = 300;
export const TAPPING_MHR_INR = 400;
export const CMM_MHR_INR = 450;          // ₹/hr — quality technician + CMM (fallback;
                                         // a real CMM MHR record carries full amortization)

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

// ── Surface treatment (anodize / plating / coating) ───────────────────────────
// India 2026 job-shop rates: per-m² of treated surface plus a minimum lot charge
// (tank setup, racking, chemistry) amortized over the batch. Localized in the
// cost engine via the deburring-rate ratio — treatment is local labour +
// chemistry, not a spot-FX conversion.

export interface SurfaceTreatmentRate {
  label: string;
  ratePerM2Inr: number;
  minLotChargeInr: number;
}

export const SURFACE_TREATMENT_RATES: Record<string, SurfaceTreatmentRate> = {
  anodize_type_ii:  { label: 'Anodize Type II',           ratePerM2Inr: 260, minLotChargeInr: 800 },
  anodize_type_iii: { label: 'Hardcoat Anodize Type III', ratePerM2Inr: 700, minLotChargeInr: 1_500 },
  zinc_plate:       { label: 'Zinc Plating',              ratePerM2Inr: 150, minLotChargeInr: 600 },
  powder_coat:      { label: 'Powder Coating',            ratePerM2Inr: 220, minLotChargeInr: 700 },
  passivate:        { label: 'Passivation',               ratePerM2Inr: 120, minLotChargeInr: 500 },
  __default__:      { label: 'Surface Treatment',         ratePerM2Inr: 250, minLotChargeInr: 800 },
};

export type SurfaceTreatmentKey = keyof typeof SURFACE_TREATMENT_RATES;

// Maps a drawing/coating callout ("Type III Hardcoat Black Anodize") to a rate
// key. Returns null for empty/none callouts AND for unrecognized text — the
// engine warns on unrecognized callouts instead of pricing them wrong.
export function classifySurfaceTreatment(callout: string | null | undefined): SurfaceTreatmentKey | null {
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
export const TURRET_MHR_INR = 1_350;       // ₹/hr — matches seeded mhr_records value
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
export const WATERJET_MHR_INR = 1_800;      // ₹/hr — pump + abrasive machine
export const WATERJET_SETUP_MIN = 30;       // per batch
export const WATERJET_PIERCE_SEC = 5;       // sec per contour start (pierceCount)
export const WATERJET_ABRASIVE_KG_PER_MIN = 0.5; // kg/min of active cutting
export const WATERJET_ABRASIVE_INR_PER_KG = 40;  // ₹/kg garnet abrasive (India fallback)

// Garnet abrasive price per kg, LOCAL currency, by digital factory location —
// same structure as LOCATION_MHR_DEFAULTS. 80-mesh alluvial garnet, delivered
// job-shop price, 2026. Consumables are location-priced like MHR/LHR records,
// never spot-FX-converted from the India rate.
export const LOCATION_ABRASIVE_PRICE_PER_KG: Readonly<Record<string, number>> = {
  'India':     40,     // ₹/kg — domestic garnet (major producer)
  'USA':       0.55,   // $/kg — imported garnet + logistics
  'China':     4.0,    // ¥/kg
  'Germany':   0.65,   // €/kg
  'UK':        0.58,   // £/kg (imported garnet, UK job shop)
  'France':    0.62,   // €/kg
  'W. Europe': 0.63,   // €/kg
  'E. Europe': 0.50,   // €/kg
  'Mexico':    10,     // MX$/kg
  'Other':     0.55,   // $/kg — USD default
};

// Cutting speed (mm/min) by thickness — mild steel; same table applies to SS and Al
export const WATERJET_SPEED_MM_PER_MIN: Record<number, number> = {
  1: 2000, 2: 800, 3: 450, 4: 280, 5: 200,
  6: 150, 8: 100, 10: 75,
};

// Material fallbacks (INR/kg + density kg/m³) when raw_materials DB lookup fails
export const MATERIAL_DEFAULTS: Record<string, { costPerKg: number; densityKgM3: number }> = {
  // Metals
  CRCA:    { costPerKg: 68,    densityKgM3: 7_850 },
  IS2062:  { costPerKg: 65,    densityKgM3: 7_850 },
  MS:      { costPerKg: 62,    densityKgM3: 7_850 },
  SS304:   { costPerKg: 220,   densityKgM3: 7_930 },
  SS316:   { costPerKg: 280,   densityKgM3: 8_000 },
  AL6061:  { costPerKg: 350,   densityKgM3: 2_700 },
  // Engineering plastics — fallback when DB has no matching record
  DELRIN:  { costPerKg: 420,   densityKgM3: 1_420 },
  POM:     { costPerKg: 400,   densityKgM3: 1_410 },
  ACETAL:  { costPerKg: 400,   densityKgM3: 1_410 },
  NYLON:   { costPerKg: 350,   densityKgM3: 1_130 },
  PA6:     { costPerKg: 330,   densityKgM3: 1_140 },
  PA66:    { costPerKg: 340,   densityKgM3: 1_150 },
  ABS:     { costPerKg: 300,   densityKgM3: 1_050 },
  PEEK:    { costPerKg: 8_000, densityKgM3: 1_320 },
  PLASTIC: { costPerKg: 380,   densityKgM3: 1_200 },
  __default__: { costPerKg: 68, densityKgM3: 7_850 },
};

export const RATES_SOURCE_LABEL = 'Location benchmark rates v2 (2026)';

// Every costing endpoint must default to the SAME location. A summary priced in
// India next to a route comparison priced in USA is a 20× silent error.
export const DEFAULT_COSTING_LOCATION = 'India';

// CNC billet stock allowance per side (mm): saw-cut kerf + facing/skim clean-up.
// Applied to each bounding-box dimension (2 × per-side) when sizing milled billets.
export const CNC_STOCK_ALLOWANCE_PER_SIDE_MM = 3;

// ── CNC default rates (INR/hr) ────────────────────────────────────────────────
export const CNC_3AX_VMC_MHR_INR   =   900;
export const CNC_4AX_VMC_MHR_INR   = 1_200;
export const CNC_5AX_MC_MHR_INR    = 2_200;
export const CNC_LATHE_MHR_INR     =   700;
export const CNC_LATHE_LIVE_MHR_INR = 1_100;
export const CNC_MILL_TURN_MHR_INR = 1_800;

// ── Injection molding default rate (INR/hr) ───────────────────────────────────
// Anchored to real machine data, not guessed: median fully-burdened rate of
// mid-tonnage (140-220T) injection molding machines — Milacron MAGNA T170,
// KraussMaffei 160 CX, Toyo TM-180H2 — in backend/data/MHR_LHR_India_2026.json
// (83 real Indian IMM records, ₹850-1400/hr in that tonnage band).
export const INJECTION_MOLDING_MHR_INR = 900;

// ── Machine Registry ──────────────────────────────────────────────────────────
// Maps each cost-engine process to the exact commodity codes that belong to it.
// The Capability Engine (future sprint) will extend each entry with machine limits
// (maxThicknessMm, maxTonnage, maxBendLengthMm, etc.) and use them for selection.
// For this sprint, resolveMHRRates() picks the lowest-rate DB record per class.

export interface MachineRegistryEntry {
  defaultRate: number;
  commodityCodes: readonly string[];
  processGroupKeywords: readonly string[];
  machineClassKeywords: readonly string[];
}

export const MACHINE_REGISTRY = {
  fiber_laser:    { defaultRate: LASER_MHR_INR,           commodityCodes: ['SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K'], processGroupKeywords: ['Laser', 'Sheet Metal'],      machineClassKeywords: ['Fiber Laser', 'Laser Cut', 'CO2 Laser'] },
  press_brake:    { defaultRate: PRESS_BRAKE_MHR_INR,     commodityCodes: ['SM-BRAKE-80T', 'SM-BRAKE-160T', 'SM-BRAKE-320T'], processGroupKeywords: ['Press Brake', 'Bending'], machineClassKeywords: ['Press Brake', 'Bending Machine', 'Press'] },
  turret_punch:   { defaultRate: TURRET_MHR_INR,          commodityCodes: ['SM-PUNCH-CNC'],                              processGroupKeywords: ['Turret', 'Punch'],           machineClassKeywords: ['Turret Punch', 'CNC Punch', 'Punching'] },
  waterjet:       { defaultRate: WATERJET_MHR_INR,        commodityCodes: ['SM-WATERJET'],                               processGroupKeywords: ['Waterjet'],                  machineClassKeywords: ['Waterjet', 'Water Jet', 'Abrasive Jet'] },
  tapping:        { defaultRate: TAPPING_MHR_INR,         commodityCodes: ['SM-TAP-CNC'],                                processGroupKeywords: ['Tapping'],                   machineClassKeywords: ['Tapping', 'Tap', 'CNC Tap'] },
  deburring:      { defaultRate: DEBURRING_MHR_INR,       commodityCodes: ['BENCH-DEBURR'],                              processGroupKeywords: ['Deburr', 'Finishing', 'Vibratory', 'Tumbling'], machineClassKeywords: ['Deburring', 'Bench', 'Deburr', 'Vibratory', 'Tumbl', 'Vibro', 'Finishing Cell'] },
  cmm:            { defaultRate: CMM_MHR_INR,             commodityCodes: ['QA-CMM'],                                    processGroupKeywords: ['Inspection', 'Quality'],     machineClassKeywords: ['CMM', 'Coordinate', 'Video Measuring', 'Vision Measuring', 'Inspection'] },
  cnc_3ax_vmc:    { defaultRate: CNC_3AX_VMC_MHR_INR,    commodityCodes: ['CNC-VMC-3AX'],                               processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['3-Axis', '3 Axis', '3AX', 'VMC 3', '3-axis'] },
  cnc_4ax_vmc:    { defaultRate: CNC_4AX_VMC_MHR_INR,    commodityCodes: ['CNC-VMC-4AX'],                               processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['4-Axis', '4 Axis', '4AX', 'VMC 4', '4-axis'] },
  cnc_5ax_mc:     { defaultRate: CNC_5AX_MC_MHR_INR,     commodityCodes: ['CNC-MC-5AX'],                                processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['5-Axis', '5 Axis', '5AX', '5-axis'] },
  cnc_lathe:      { defaultRate: CNC_LATHE_MHR_INR,       commodityCodes: ['CNC-LATHE-2AX'],                             processGroupKeywords: ['Turning', 'Lathe'],           machineClassKeywords: ['2-Axis Lathe', 'CNC Lathe', '2-Axis', 'Lathe'] },
  cnc_lathe_live: { defaultRate: CNC_LATHE_LIVE_MHR_INR,  commodityCodes: ['CNC-LATHE-LT'],                              processGroupKeywords: ['Turning', 'Lathe'],           machineClassKeywords: ['Live Tool', 'Sub-Spindle', 'Live Tooling'] },
  cnc_mill_turn:  { defaultRate: CNC_MILL_TURN_MHR_INR,   commodityCodes: ['CNC-MILLTURN'],                              processGroupKeywords: ['Mill-Turn', 'Turn-Mill'],     machineClassKeywords: ['Mill-Turn', 'MillTurn', 'Turn Mill', 'Mill Turn'] },
  injection_molding: { defaultRate: INJECTION_MOLDING_MHR_INR, commodityCodes: ['IM-SMALL', 'IM-MED', 'IM-LARGE'],       processGroupKeywords: ['Injection Molding', 'Plastic Molding', 'Injection Mold'], machineClassKeywords: ['Injection Molding', 'Injection Molder', 'IMM', 'Injection Mold'] },
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
  'UK':        { code: 'GBP', symbol: '£', defaultInrRate: 107.0,  materialCol: 'cost_usa'      },
  'Vietnam':   { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_usa'      },
  'Mexico':    { code: 'MXN', symbol: 'MX$', defaultInrRate: 4.77, materialCol: 'cost_mexico'   },
  'Other':     { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_usa'      },
} as const;

// ── Digital Factory — MHR defaults by location ────────────────────────────────
// 2026 industry-standard all-in shop rates (machine depreciation + energy +
// maintenance + overhead + direct labour burden) in local currency per hour.
// Sources: NIST/AMT USA 2025, VDMA Germany 2025, Eurostat 2025, PwC China 2025.
// Calibration bands (fully burdened, mid-market job shop):
//   USA   — 3ax VMC $65-100 → 85; 5ax $120-180 → 145
//   China — 3ax VMC $35-60 (¥250-430) → ¥300; 5ax $60-120 (¥430-870) → ¥580
//   Germany — VMC €70-110 → €85; France sits ~8-10% under Germany (Eurostat
//   labour-cost index); 'W. Europe' is the regional blend (Benelux/Nordics above
//   Germany, Iberia below France) and must stay BETWEEN France and Germany —
//   the three being near-identical or inverted is a seed bug, not a market fact.
//   E. Europe — Poland/Czech 2026 shop rates (€35-55 VMC), not the pre-2015 levels.
// Mexico: scaled from the USA benchmark at ~17.5 MXN/USD using typical nearshoring
// cost ratios (near-parity capital/machine cost, ~20-25% of USA labor cost — matches
// the Mexico defaults already seeded in MHRFormDialog.tsx's per-record form).
// Used as fallback when no mhr_records row exists for a given (location, commodityCode).

// injection_molding mirrors cnc_3ax_vmc's per-location figure — the India value
// (900) is independently anchored to real IMM machine data (see
// INJECTION_MOLDING_MHR_INR), and happens to land almost exactly on the
// existing cnc_3ax_vmc benchmark, so the same cross-location ratios are reused
// rather than inventing a second set of location multipliers for one class.
export const LOCATION_MHR_DEFAULTS = {
  'India':     { fiber_laser:1200, press_brake:600, turret_punch:1350, waterjet:1800, tapping:400,  deburring:300, cmm:450,  cnc_3ax_vmc:900,  cnc_4ax_vmc:1200, cnc_5ax_mc:2200, cnc_lathe:700,  cnc_lathe_live:1100, cnc_mill_turn:1800, injection_molding:900  },
  'USA':       { fiber_laser:95,   press_brake:60,  turret_punch:85,   waterjet:100,  tapping:35,   deburring:30,  cmm:55,   cnc_3ax_vmc:85,   cnc_4ax_vmc:105,  cnc_5ax_mc:145,  cnc_lathe:70,   cnc_lathe_live:95,   cnc_mill_turn:115,  injection_molding:85   },
  'China':     { fiber_laser:320,  press_brake:190, turret_punch:280,  waterjet:350,  tapping:110,  deburring:85,  cmm:170,  cnc_3ax_vmc:300,  cnc_4ax_vmc:400,  cnc_5ax_mc:580,  cnc_lathe:230,  cnc_lathe_live:340,  cnc_mill_turn:460,  injection_molding:300  },
  'Germany':   { fiber_laser:95,   press_brake:60,  turret_punch:85,   waterjet:100,  tapping:32,   deburring:26,  cmm:60,   cnc_3ax_vmc:85,   cnc_4ax_vmc:105,  cnc_5ax_mc:140,  cnc_lathe:68,   cnc_lathe_live:95,   cnc_mill_turn:115,  injection_molding:85   },
  'France':    { fiber_laser:88,   press_brake:55,  turret_punch:78,   waterjet:92,   tapping:29,   deburring:24,  cmm:55,   cnc_3ax_vmc:78,   cnc_4ax_vmc:96,   cnc_5ax_mc:128,  cnc_lathe:62,   cnc_lathe_live:87,   cnc_mill_turn:105,  injection_molding:78   },
  'W. Europe': { fiber_laser:92,   press_brake:58,  turret_punch:82,   waterjet:96,   tapping:30,   deburring:25,  cmm:57,   cnc_3ax_vmc:82,   cnc_4ax_vmc:100,  cnc_5ax_mc:134,  cnc_lathe:65,   cnc_lathe_live:91,   cnc_mill_turn:110,  injection_molding:82   },
  'E. Europe': { fiber_laser:50,   press_brake:32,  turret_punch:45,   waterjet:55,   tapping:17,   deburring:14,  cmm:26,   cnc_3ax_vmc:42,   cnc_4ax_vmc:55,   cnc_5ax_mc:75,   cnc_lathe:34,   cnc_lathe_live:48,   cnc_mill_turn:60,   injection_molding:42   },
  'UK':        { fiber_laser:80,   press_brake:52,  turret_punch:72,   waterjet:88,   tapping:28,   deburring:22,  cmm:48,   cnc_3ax_vmc:72,   cnc_4ax_vmc:90,   cnc_5ax_mc:130,  cnc_lathe:60,   cnc_lathe_live:82,   cnc_mill_turn:100,  injection_molding:68   },
  'Vietnam':   { fiber_laser:20,   press_brake:14,  turret_punch:18,   waterjet:24,   tapping:8,    deburring:6,   cmm:12,   cnc_3ax_vmc:18,   cnc_4ax_vmc:24,   cnc_5ax_mc:32,   cnc_lathe:15,   cnc_lathe_live:20,   cnc_mill_turn:26,   injection_molding:22   },
  'Mexico':    { fiber_laser:860,  press_brake:470, turret_punch:760,  waterjet:920,  tapping:220,  deburring:155, cmm:560,  cnc_3ax_vmc:705,  cnc_4ax_vmc:970,  cnc_5ax_mc:1340, cnc_lathe:545,  cnc_lathe_live:845,  cnc_mill_turn:1045, injection_molding:705  },
} as const satisfies Record<string, Record<MachineClass, number>>;

// ── LHR defaults by location + process group ─────────────────────────────────
// Labour Hour Rate ($/hr or local-currency/hr) — direct operator cost only.
// Used as fallback when no lhr_records exist for the requested location.
// Sources: BLS OES 2025 (USA), Eurostat LCS 2025, CMIE India 2026.
// Groups mirror deriveProcessGroupFromMachineClass() output.
export const LOCATION_LHR_DEFAULTS: Readonly<Record<string, Record<string, number>>> = {
  'India':     { 'Plastics': 95,   'Quality': 80,   'CNC Machining': 110,  'Sheet Metal': 95,   '__default__': 85   },
  'USA':       { 'Plastics': 22,   'Quality': 20,   'CNC Machining': 26,   'Sheet Metal': 23,   '__default__': 20   },
  'China':     { 'Plastics': 28,   'Quality': 24,   'CNC Machining': 32,   'Sheet Metal': 28,   '__default__': 26   },
  'Germany':   { 'Plastics': 30,   'Quality': 28,   'CNC Machining': 35,   'Sheet Metal': 32,   '__default__': 30   },
  'France':    { 'Plastics': 26,   'Quality': 24,   'CNC Machining': 30,   'Sheet Metal': 27,   '__default__': 26   },
  'W. Europe': { 'Plastics': 28,   'Quality': 26,   'CNC Machining': 32,   'Sheet Metal': 29,   '__default__': 27   },
  'E. Europe': { 'Plastics': 10,   'Quality': 9,    'CNC Machining': 12,   'Sheet Metal': 10,   '__default__': 10   },
  'UK':        { 'Plastics': 22,   'Quality': 20,   'CNC Machining': 26,   'Sheet Metal': 22,   '__default__': 20   },
  'Vietnam':   { 'Plastics': 3,    'Quality': 2.5,  'CNC Machining': 3.5,  'Sheet Metal': 3,    '__default__': 3    },
  'Mexico':    { 'Plastics': 280,  'Quality': 230,  'CNC Machining': 340,  'Sheet Metal': 290,  '__default__': 260  },
  '__default__':{ 'Plastics': 22,  'Quality': 20,   'CNC Machining': 26,   'Sheet Metal': 23,   '__default__': 20   },
} as const;

export function defaultLHRRate(location: string, processGroup: string): number {
  const byLocation = (LOCATION_LHR_DEFAULTS[location] ?? LOCATION_LHR_DEFAULTS['__default__'])!;
  return byLocation[processGroup] ?? byLocation['__default__'] ?? 20;
}

// ── Rate plausibility guard ────────────────────────────────────────────────────
// A DB machine rate far outside the location benchmark band almost always means a
// broken import (currency not converted, overhead-only rate, benchmark-sheet noise)
// — the class of bug migration 327 backfilled. The DB stays authoritative (we never
// silently clamp a rate the user entered), but the deviation must be VISIBLE on the
// cost summary so bad data cannot silently reach a quote.

const RATE_WARN_LOW_FRACTION = 0.5;   // below 50% of benchmark → suspicious
const RATE_WARN_HIGH_FRACTION = 3.0;  // above 300% of benchmark → suspicious

export function benchmarkRateWarning(
  machineClass: string, // MachineClass at the engine boundary; plain string on ProcessLineCost
  location: string,
  rate: number,
  machineName: string | null,
): string | null {
  const benchmark = (LOCATION_MHR_DEFAULTS as Record<string, Partial<Record<string, number>>>)[
    location
  ]?.[machineClass];
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
