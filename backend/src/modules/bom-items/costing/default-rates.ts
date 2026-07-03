// All rates in INR. Fiber laser 6kW, India 2026 baseline.
// Replace with DB-driven MHR lookup in a future sprint.

export const LASER_MHR_INR = 1_200;     // ₹/hr — machine + operator
export const PRESS_BRAKE_MHR_INR = 600;
export const DEBURRING_MHR_INR = 300;
export const TAPPING_MHR_INR = 400;

export const LASER_SETUP_MIN = 15;       // minutes per batch
export const PRESS_BRAKE_SETUP_MIN = 20;
export const TAPPING_SETUP_MIN = 10;

export const MATERIAL_OVERHEAD_PCT = 5;  // nesting skeleton + handling scrap
export const SCRAP_PCT = 3;              // process scrap

// Fiber laser cutting speed (mm/min) by sheet thickness — mild steel (CRCA / IS2062)
export const LASER_SPEED_MM_PER_MIN: Record<number, number> = {
  0.8: 8000, 1.0: 6000, 1.2: 5000, 1.5: 4000,
  2.0: 3000, 2.5: 2500, 3.0: 2000, 4.0: 1500,
  5.0: 1200, 6.0: 1000, 8.0: 700,  10.0: 500,
};

// Pierce time (sec) by sheet thickness — stabilisation after piercing
export const LASER_PIERCE_SEC: Record<number, number> = {
  0.8: 0.5, 1.0: 0.8, 1.2: 1.0, 1.5: 1.2,
  2.0: 1.5, 2.5: 1.8, 3.0: 2.2, 4.0: 3.0,
  5.0: 4.0, 6.0: 5.0, 8.0: 7.0, 10.0: 9.0,
};

// Press brake: seconds per bend by sheet thickness — consistent-radius CNC press brake
export const PRESS_BRAKE_SEC_PER_BEND: Record<number, number> = {
  1.0: 10, 1.5: 13, 2.0: 15, 2.5: 18,
  3.0: 20, 4.0: 25, 5.0: 30, 6.0: 38,
};

// Tapping: cycle time (sec per hole) — ISO 965-1, rigid tapping
export const TAP_CYCLE_SEC: Record<string, number> = {
  'M2': 4, 'M2.5': 5, 'M3': 6, 'M4': 7, 'M5': 8,
  'M6': 10, 'M8': 14, 'M10': 18, 'M12': 22, 'M16': 28,
};

// Deburring: time constants
export const DEBURR_SEC_PER_METRE = 60;   // per metre of cut edge
export const DEBURR_SEC_PER_PIERCE = 0.5; // per pierce (hole cleanup)

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
export const WATERJET_ABRASIVE_INR_PER_KG = 40;  // ₹/kg garnet abrasive

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

export const RATES_SOURCE_LABEL = 'Default rates v1 (India 2026)';

// ── CNC default rates (INR/hr) ────────────────────────────────────────────────
export const CNC_3AX_VMC_MHR_INR   =   900;
export const CNC_4AX_VMC_MHR_INR   = 1_200;
export const CNC_5AX_MC_MHR_INR    = 2_200;
export const CNC_LATHE_MHR_INR     =   700;
export const CNC_LATHE_LIVE_MHR_INR = 1_100;
export const CNC_MILL_TURN_MHR_INR = 1_800;

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
  deburring:      { defaultRate: DEBURRING_MHR_INR,       commodityCodes: ['BENCH-DEBURR'],                              processGroupKeywords: ['Deburr', 'Finishing'],        machineClassKeywords: ['Deburring', 'Bench', 'Deburr'] },
  cnc_3ax_vmc:    { defaultRate: CNC_3AX_VMC_MHR_INR,    commodityCodes: ['CNC-VMC-3AX'],                               processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['3-Axis', '3 Axis', '3AX', 'VMC 3', '3-axis'] },
  cnc_4ax_vmc:    { defaultRate: CNC_4AX_VMC_MHR_INR,    commodityCodes: ['CNC-VMC-4AX'],                               processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['4-Axis', '4 Axis', '4AX', 'VMC 4', '4-axis'] },
  cnc_5ax_mc:     { defaultRate: CNC_5AX_MC_MHR_INR,     commodityCodes: ['CNC-MC-5AX'],                                processGroupKeywords: ['CNC Machining', 'Milling'],   machineClassKeywords: ['5-Axis', '5 Axis', '5AX', '5-axis'] },
  cnc_lathe:      { defaultRate: CNC_LATHE_MHR_INR,       commodityCodes: ['CNC-LATHE-2AX'],                             processGroupKeywords: ['Turning', 'Lathe'],           machineClassKeywords: ['2-Axis Lathe', 'CNC Lathe', '2-Axis', 'Lathe'] },
  cnc_lathe_live: { defaultRate: CNC_LATHE_LIVE_MHR_INR,  commodityCodes: ['CNC-LATHE-LT'],                              processGroupKeywords: ['Turning', 'Lathe'],           machineClassKeywords: ['Live Tool', 'Sub-Spindle', 'Live Tooling'] },
  cnc_mill_turn:  { defaultRate: CNC_MILL_TURN_MHR_INR,   commodityCodes: ['CNC-MILLTURN'],                              processGroupKeywords: ['Mill-Turn', 'Turn-Mill'],     machineClassKeywords: ['Mill-Turn', 'MillTurn', 'Turn Mill', 'Mill Turn'] },
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
  'Other':     { code: 'USD', symbol: '$', defaultInrRate: 83.5,   materialCol: 'cost_usa'      },
} as const;

// ── Digital Factory — MHR defaults by location ────────────────────────────────
// 2026 industry-standard all-in shop rates (machine depreciation + energy +
// maintenance + overhead + direct labour burden) in local currency per hour.
// Sources: NIST/AMT USA 2025, VDMA Germany 2025, Eurostat 2025, PwC China 2025.
// Used as fallback when no mhr_records row exists for a given (location, commodityCode).

export const LOCATION_MHR_DEFAULTS = {
  'India':     { fiber_laser:1200, press_brake:600, turret_punch:1350, waterjet:1800, tapping:400,  deburring:300, cnc_3ax_vmc:900,  cnc_4ax_vmc:1200, cnc_5ax_mc:2200, cnc_lathe:700,  cnc_lathe_live:1100, cnc_mill_turn:1800 },
  'USA':       { fiber_laser:82,   press_brake:49,  turret_punch:75,   waterjet:85,   tapping:28,   deburring:22,  cnc_3ax_vmc:65,   cnc_4ax_vmc:88,   cnc_5ax_mc:118,  cnc_lathe:52,   cnc_lathe_live:78,   cnc_mill_turn:95   },
  'China':     { fiber_laser:200,  press_brake:115, turret_punch:180,  waterjet:220,  tapping:60,   deburring:50,  cnc_3ax_vmc:155,  cnc_4ax_vmc:210,  cnc_5ax_mc:330,  cnc_lathe:125,  cnc_lathe_live:190,  cnc_mill_turn:250  },
  'Germany':   { fiber_laser:74,   press_brake:45,  turret_punch:68,   waterjet:78,   tapping:24,   deburring:20,  cnc_3ax_vmc:58,   cnc_4ax_vmc:78,   cnc_5ax_mc:108,  cnc_lathe:46,   cnc_lathe_live:70,   cnc_mill_turn:88   },
  'France':    { fiber_laser:70,   press_brake:43,  turret_punch:65,   waterjet:74,   tapping:22,   deburring:18,  cnc_3ax_vmc:55,   cnc_4ax_vmc:74,   cnc_5ax_mc:102,  cnc_lathe:44,   cnc_lathe_live:66,   cnc_mill_turn:84   },
  'W. Europe': { fiber_laser:72,   press_brake:43,  turret_punch:67,   waterjet:76,   tapping:22,   deburring:18,  cnc_3ax_vmc:56,   cnc_4ax_vmc:76,   cnc_5ax_mc:104,  cnc_lathe:44,   cnc_lathe_live:68,   cnc_mill_turn:82   },
  'E. Europe': { fiber_laser:26,   press_brake:16,  turret_punch:25,   waterjet:28,   tapping:9,    deburring:7,   cnc_3ax_vmc:20,   cnc_4ax_vmc:28,   cnc_5ax_mc:32,   cnc_lathe:16,   cnc_lathe_live:25,   cnc_mill_turn:28   },
} as const satisfies Record<string, Record<MachineClass, number>>;
