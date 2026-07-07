// Pure physics — no I/O. Each function converts part geometry + material into the
// physical minimum a machine must meet (MachineRequirement) for one process.
// Formulas: press brake tonnage per Diebold/Bosch air-bend formula; envelope and
// lathe margins per the ×1.2 rule; laser thickness limits are material-specific
// and resolved against the machine's per-material columns by the selector.

// ── Material factor tables ────────────────────────────────────────────────────
// Press brake K factor (material tensile strength relative to mild steel)
export const MATERIAL_K: Record<string, number> = {
  MS: 1.42,
  SS: 1.75,
  AL: 1.0,
  CU: 1.2,
  OTHER: 1.42, // unknown → treat as mild steel (most common sheet stock)
};

// Baseline MRR (cm³/min) at 100% rigidity — used to size VMC spindle demand
export const MATERIAL_MRR_CM3_MIN: Record<string, number> = {
  MS: 60,
  SS: 30,
  AL: 150,
  CU: 45,
  OTHER: 60,
};

export type LaserMaterialFamily = 'MS' | 'SS' | 'AL' | 'CU' | 'OTHER';

// Envelope safety margin: machine axis must exceed part dimension by 20%
// (fixturing, clamp clearance, tool approach). Bed margin for flat stock is 10%.
export const ENVELOPE_MARGIN = 1.2;
export const BED_MARGIN = 1.1;
export const TONNAGE_MARGIN = 1.15;

// IM tie-bar clearance: part footprint + runner allowance + platen-edge clearance.
// Additive (not proportional) — a 20mm runner is 20mm regardless of part size.
export const IM_TIEBAR_RUNNER_ALLOWANCE_MM = 20;  // cold-runner edge on mold face
export const IM_TIEBAR_PLATEN_CLEARANCE_MM = 25;  // platen edge to tie-bar inner face
export const IM_TIEBAR_ADDEND_MM = IM_TIEBAR_RUNNER_ALLOWANCE_MM + IM_TIEBAR_PLATEN_CLEARANCE_MM; // = 45mm

export function classifyLaserMaterial(grade: string | null): LaserMaterialFamily {
  if (!grade) return 'OTHER';
  // Split letter/digit boundaries so compact codes tokenize: "SS304" → "SS 304",
  // "AL6061-T6" → "AL 6061 T 6", "IS2062" → "IS 2062"
  const tokens = new Set(
    grade
      .toUpperCase()
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
  const has = (...keys: string[]) => keys.some((k) => tokens.has(k));

  if (has('SS', 'STAINLESS', 'INOX', '304', '316', '321', '410', '430')) return 'SS';
  if (has('AL', 'ALU', 'ALUMINIUM', 'ALUMINUM', '6061', '6063', '5052', '7075', '2024')) return 'AL';
  if (has('CU', 'COPPER', 'BRASS', 'BRONZE') || /C\s?(110|260)/.test(grade.toUpperCase())) return 'CU';
  if (has('MS', 'CRCA', 'HRC', 'HR', 'CR', 'SPCC', 'MILD', 'STEEL', '2062', '513') ||
      /IS\s?(2062|513)|EN\s?(8|1A)|Q\s?235|S\s?(235|355)/.test(grade.toUpperCase())) return 'MS';
  return 'OTHER';
}

// ── Requirement types ─────────────────────────────────────────────────────────

export interface PressBrakeRequirement {
  kind: 'press_brake';
  tonnage: number;        // tons required incl. no margin (selector applies TONNAGE_MARGIN)
  bendLengthMm: number;
  thicknessMm: number;
}

export interface LaserRequirement {
  kind: 'laser';
  thicknessMm: number;
  materialFamily: LaserMaterialFamily;
  materialGrade: string | null;  // raw grade, checked against cuttable_materials
  bedLengthMm: number;           // flat pattern length
  bedWidthMm: number;            // flat pattern width
}

export interface VmcRequirement {
  kind: 'vmc';
  xMm: number;            // part bbox — selector applies ENVELOPE_MARGIN
  yMm: number;
  zMm: number;
  weightKg: number;
  mrrCm3PerMin: number;
}

export interface LatheRequirement {
  kind: 'lathe';
  diameterMm: number;     // part max diameter — selector applies ENVELOPE_MARGIN
  lengthMm: number;
}

export interface GenericRequirement {
  kind: 'generic';        // deburring, tapping — no dimensional gate
}

export interface InjectionMoldingRequirement {
  kind: 'injection_molding';
  clampTonnageRequired: number;  // selector applies TONNAGE_MARGIN
  projectedAreaMm2: number;
  // Full IMM sizing criteria: clamp force, shot weight, tie-bar spacing vs
  // part dims. Only clamp tonnage has capability data in mhr_records today
  // (max_tonnage, migration 324); shot weight and part dims are carried on
  // the requirement so the selector can gate on them the day shot-capacity /
  // tie-bar columns exist — and can already explain them in reasons.
  shotWeightG: number | null;    // part + runner mass per shot; null = volume/density unknown
  partLengthMm: number;          // largest bbox dim — future tie-bar spacing check
  partWidthMm: number;           // second bbox dim
}

export type MachineRequirement =
  | PressBrakeRequirement
  | LaserRequirement
  | VmcRequirement
  | LatheRequirement
  | GenericRequirement
  | InjectionMoldingRequirement;

// ── Requirement builders ──────────────────────────────────────────────────────

// Air-bend tonnage: T (tons) = K × C × (t² / V) × L, with die opening V = 8t (mid-range).
// C calibrated to standard press-brake charts: 3 mm mild steel, V = 24 mm → ~22 t/m
// (Amada/Trumpf air-bend tables). K = MATERIAL_K (MS = 1.42 baseline).
const TONNAGE_COEF = 41.3; // tons per metre per (t²/V), t and V in mm

export function pressBrakeRequirement(input: {
  bendLengthMm: number;
  thicknessMm: number;
  materialK: number;
}): PressBrakeRequirement {
  const { bendLengthMm, thicknessMm, materialK } = input;
  const t = Math.max(thicknessMm, 0);
  const lMetres = Math.max(bendLengthMm, 0) / 1000;
  const dieOpening = 8 * t;
  const tonnage = dieOpening > 0 ? materialK * TONNAGE_COEF * ((t * t) / dieOpening) * lMetres : 0;
  return { kind: 'press_brake', tonnage, bendLengthMm, thicknessMm: t };
}

export function laserRequirement(input: {
  thicknessMm: number;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
}): LaserRequirement {
  return {
    kind: 'laser',
    thicknessMm: Math.max(input.thicknessMm, 0),
    materialFamily: classifyLaserMaterial(input.materialGrade),
    materialGrade: input.materialGrade,
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function vmcRequirement(input: {
  bboxXMm: number;
  bboxYMm: number;
  bboxZMm: number;
  finishedWeightKg: number;
  materialMrrCm3PerMin: number;
}): VmcRequirement {
  // Normalise bbox so X ≥ Y (part can be rotated on the table; Z is fixed)
  const [x, y] = [Math.max(input.bboxXMm, input.bboxYMm), Math.min(input.bboxXMm, input.bboxYMm)];
  return {
    kind: 'vmc',
    xMm: Math.max(x, 0),
    yMm: Math.max(y, 0),
    zMm: Math.max(input.bboxZMm, 0),
    weightKg: Math.max(input.finishedWeightKg, 0),
    mrrCm3PerMin: Math.max(input.materialMrrCm3PerMin, 0),
  };
}

export function latheRequirement(input: {
  maxDiameterMm: number;
  maxLengthMm: number;
}): LatheRequirement {
  return {
    kind: 'lathe',
    diameterMm: Math.max(input.maxDiameterMm, 0),
    lengthMm: Math.max(input.maxLengthMm, 0),
  };
}

// ── Injection molding ──────────────────────────────────────────────────────────
// Clamp tonnage = projected area × material-specific cavity pressure factor —
// the standard shop-floor sizing rule (aPriori/industry convention). Phase 1
// approximates projected area with the part's bbox footprint (the true
// projected-area-in-mold-opening-direction is a Phase 2 refinement — see the
// injection-molding plan doc). Keyed by the SAME resin-family strings already
// used for material cost lookup (MATERIAL_DEFAULTS in default-rates.ts) so
// there is one resin classification scheme, not two.
// Reference bands (converted from the common tons/in² shop convention,
// 1 in² = 6.4516 cm²): easy-flow commodity resins ~2-3 tons/in² (0.31-0.47
// tons/cm²), general engineering resins (nylon/PA, acetal/POM) ~4-6 tons/in²
// (0.62-0.93 tons/cm²), higher-viscosity/glass-filled resins ~6-8 tons/in²
// (0.93-1.24 tons/cm²).
export const MATERIAL_PRESSURE_FACTOR_TON_CM2: Record<string, number> = {
  ABS: 0.55,
  PLASTIC: 0.65, // generic/unknown thermoplastic — mid-band
  NYLON: 0.75,
  PA6: 0.75,
  PA66: 0.75,
  POM: 0.8,
  ACETAL: 0.8,
  DELRIN: 0.8,
  PEEK: 1.1, // high-viscosity engineering resin
  __default__: 0.65,
};

export function classifyResinFamily(grade: string | null): string {
  if (!grade) return '__default__';
  const gradeUpper = grade.toUpperCase();
  return (
    Object.keys(MATERIAL_PRESSURE_FACTOR_TON_CM2).find(
      (k) => k !== '__default__' && gradeUpper.includes(k),
    ) ?? '__default__'
  );
}

export function injectionMoldingRequirement(input: {
  projectedAreaMm2: number;
  materialGrade: string | null;
  shotWeightG?: number | null;
  partLengthMm?: number;
  partWidthMm?: number;
}): InjectionMoldingRequirement {
  const resinFamily = classifyResinFamily(input.materialGrade);
  const pressureFactor =
    MATERIAL_PRESSURE_FACTOR_TON_CM2[resinFamily] ?? MATERIAL_PRESSURE_FACTOR_TON_CM2.__default__;
  const projectedAreaMm2 = Math.max(input.projectedAreaMm2, 0);
  const projectedAreaCm2 = projectedAreaMm2 / 100; // 1 cm² = 100 mm²
  const clampTonnageRequired = projectedAreaCm2 * pressureFactor;
  return {
    kind: 'injection_molding',
    clampTonnageRequired,
    projectedAreaMm2,
    shotWeightG: input.shotWeightG ?? null,
    partLengthMm: Math.max(input.partLengthMm ?? 0, 0),
    partWidthMm: Math.max(input.partWidthMm ?? 0, 0),
  };
}
