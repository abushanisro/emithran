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
  CRCA:    { costPerKg: 68,  densityKgM3: 7850 },
  IS2062:  { costPerKg: 65,  densityKgM3: 7850 },
  MS:      { costPerKg: 62,  densityKgM3: 7850 },
  SS304:   { costPerKg: 220, densityKgM3: 7930 },
  SS316:   { costPerKg: 280, densityKgM3: 8000 },
  AL6061:  { costPerKg: 350, densityKgM3: 2700 },
  __default__: { costPerKg: 68, densityKgM3: 7850 },
};

export const RATES_SOURCE_LABEL = 'Default rates v1 (India 2026)';

// ── Machine Registry ──────────────────────────────────────────────────────────
// Maps each cost-engine process to the exact commodity codes that belong to it.
// The Capability Engine (future sprint) will extend each entry with machine limits
// (maxThicknessMm, maxTonnage, maxBendLengthMm, etc.) and use them for selection.
// For this sprint, resolveMHRRates() picks the lowest-rate DB record per class.

export interface MachineRegistryEntry {
  defaultRate: number;
  commodityCodes: readonly string[];
}

export const MACHINE_REGISTRY = {
  fiber_laser:  { defaultRate: LASER_MHR_INR,       commodityCodes: ['SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K'] },
  press_brake:  { defaultRate: PRESS_BRAKE_MHR_INR, commodityCodes: ['SM-BRAKE-80T', 'SM-BRAKE-160T', 'SM-BRAKE-320T'] },
  turret_punch: { defaultRate: TURRET_MHR_INR,      commodityCodes: ['SM-PUNCH-CNC'] },
  waterjet:     { defaultRate: WATERJET_MHR_INR,    commodityCodes: ['SM-WATERJET'] },
  tapping:      { defaultRate: TAPPING_MHR_INR,     commodityCodes: ['SM-TAP-CNC'] },
  deburring:    { defaultRate: DEBURRING_MHR_INR,   commodityCodes: ['BENCH-DEBURR'] },
} as const satisfies Record<string, MachineRegistryEntry>;

export type MachineClass = keyof typeof MACHINE_REGISTRY;
