// Phase-1 fallback: specs are hardcoded here by commodity code.
// Future sprint: source MACHINE_CAPABILITY_REGISTRY from the Digital Factory
// machine database so shop-specific limits (customer's actual 60T brake, etc.)
// override these benchmark defaults without a code deployment.

import type { MachineClass } from "./default-rates";

export interface MachineCapabilitySpec {
  maxThicknessMm?: number;
  maxBedLengthMm?: number;
  maxBedWidthMm?: number;
  maxTonnage?: number;
}

export interface MachineCapabilityEntry {
  machineClass: MachineClass;
  spec: MachineCapabilitySpec;
}

export const MACHINE_CAPABILITY_REGISTRY: Readonly<
  Record<string, MachineCapabilityEntry>
> = {
  // Fiber Laser
  "SM-LASER-2K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 8,   maxBedLengthMm: 3000, maxBedWidthMm: 1500 } },
  "SM-LASER-4K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 16,  maxBedLengthMm: 4000, maxBedWidthMm: 2000 } },
  "SM-LASER-6K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 25,  maxBedLengthMm: 6000, maxBedWidthMm: 2000 } },
  // Press Brake
  "SM-BRAKE-80T":  { machineClass: "press_brake", spec: { maxThicknessMm: 8,  maxBedLengthMm: 2500, maxTonnage: 80  } },
  "SM-BRAKE-160T": { machineClass: "press_brake", spec: { maxThicknessMm: 12, maxBedLengthMm: 3200, maxTonnage: 160 } },
  "SM-BRAKE-320T": { machineClass: "press_brake", spec: { maxThicknessMm: 20, maxBedLengthMm: 4000, maxTonnage: 320 } },
  // Turret Punch
  "SM-PUNCH-CNC": { machineClass: "turret_punch", spec: { maxThicknessMm: 6, maxBedLengthMm: 2500, maxBedWidthMm: 1250 } },
  // Waterjet — effectively unconstrained for sheet metal range
  "SM-WATERJET":  { machineClass: "waterjet", spec: { maxThicknessMm: 100, maxBedLengthMm: 6000, maxBedWidthMm: 3000 } },
  // Tapping + Deburring — no dimensional constraints
  "SM-TAP-CNC":   { machineClass: "tapping",   spec: {} },
  "BENCH-DEBURR": { machineClass: "deburring",  spec: {} },
};

export interface PartGeometryForCapability {
  sheetThicknessMm: number;
  flatPatternLengthMm: number | null;
  flatPatternWidthMm: number | null;
}

export type CapabilityReasonCode =
  | "DIMENSIONS_UNAVAILABLE"
  | "NO_MACHINE_SELECTED"
  | "SPEC_NOT_ON_FILE"
  | "CLASS_THICKNESS_LIMIT"
  | "THICKNESS_EXCEEDED"
  | "BED_LENGTH_EXCEEDED"
  | "BED_WIDTH_EXCEEDED";

export interface CapabilityCheck {
  capable: boolean;
  confidence: "high" | "medium" | "low";
  reasonCodes: CapabilityReasonCode[];
  reasons: string[];
  estimatedTonnage: number | null;
}

// Class-level constraints — enforced regardless of which instance is selected
const CLASS_CONSTRAINTS: Partial<
  Record<string, (g: PartGeometryForCapability) => Array<{ code: CapabilityReasonCode; message: string }>>
> = {
  turret_punch: (g) =>
    g.sheetThicknessMm > 6
      ? [{ code: "CLASS_THICKNESS_LIMIT", message: `Thickness ${g.sheetThicknessMm}mm exceeds turret punch limit (6mm)` }]
      : [],
};

export function checkMachineCapability(
  machineClass: string,
  commodityCode: string | null,
  geometry: PartGeometryForCapability,
): CapabilityCheck {
  // NULL dimensions — assume capable, low confidence
  if (geometry.flatPatternLengthMm == null || geometry.flatPatternWidthMm == null) {
    return {
      capable: true,
      confidence: "low",
      reasonCodes: ["DIMENSIONS_UNAVAILABLE"],
      reasons: ["Dimensions unavailable — capability assumed"],
      estimatedTonnage: null,
    };
  }

  const failures: Array<{ code: CapabilityReasonCode; message: string }> = [];

  // Class-level constraints (e.g. turret ≤ 6mm)
  const classCheck = CLASS_CONSTRAINTS[machineClass];
  if (classCheck) failures.push(...classCheck(geometry));

  // No commodity code → specific machine unknown
  if (!commodityCode) {
    return {
      capable: failures.length === 0,
      confidence: "low",
      reasonCodes: failures.length > 0
        ? failures.map((f) => f.code)
        : ["NO_MACHINE_SELECTED"],
      reasons: failures.length > 0
        ? failures.map((f) => f.message)
        : ["No specific machine selected — assumed capable"],
      estimatedTonnage: null,
    };
  }

  const entry = MACHINE_CAPABILITY_REGISTRY[commodityCode];

  // Code not in registry — geometry available but no spec on file
  if (!entry) {
    return {
      capable: failures.length === 0,
      confidence: "medium",
      reasonCodes: failures.length > 0
        ? failures.map((f) => f.code)
        : ["SPEC_NOT_ON_FILE"],
      reasons: failures.length > 0
        ? failures.map((f) => f.message)
        : ["Machine spec not on file — assumed capable"],
      estimatedTonnage: null,
    };
  }

  const { spec } = entry;
  if (spec.maxThicknessMm != null && geometry.sheetThicknessMm > spec.maxThicknessMm) {
    failures.push({ code: "THICKNESS_EXCEEDED", message: `Thickness ${geometry.sheetThicknessMm}mm exceeds machine limit (${spec.maxThicknessMm}mm)` });
  }
  if (spec.maxBedLengthMm != null && geometry.flatPatternLengthMm > spec.maxBedLengthMm) {
    failures.push({ code: "BED_LENGTH_EXCEEDED", message: `Part length ${geometry.flatPatternLengthMm}mm exceeds machine bed (${spec.maxBedLengthMm}mm)` });
  }
  if (spec.maxBedWidthMm != null && geometry.flatPatternWidthMm > spec.maxBedWidthMm) {
    failures.push({ code: "BED_WIDTH_EXCEEDED", message: `Part width ${geometry.flatPatternWidthMm}mm exceeds machine bed (${spec.maxBedWidthMm}mm)` });
  }

  return {
    capable: failures.length === 0,
    confidence: "high",
    reasonCodes: failures.map((f) => f.code),
    reasons: failures.map((f) => f.message),
    estimatedTonnage: null, // Phase 2: (material × thickness² × bend_length) / die_opening
  };
}
