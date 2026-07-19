import { Injectable } from "@nestjs/common";
import type {
  IOperationCalculator,
  MachiningParams,
  FeatureGeometry,
  CalculationResult,
  CalculationStep,
  ValidationResult,
  MachineRequirements,
  ToolRequirements,
} from "../interfaces/operation-calculator.interface";

export interface PressBrakeGeometry extends FeatureGeometry {
  bendCount: number;
  materialThicknessMm: number;
  bendLengthMm: number;         // length of each bend (usually sheet width)
  tensileStrengthMpa: number;   // Rm — pulled from material group record
  vDieWidthMm?: number;         // V-die opening (default: 8× thickness per DIN/ISO)
}

// WS Bressers & ESA Bending study (2022): positioning + back-gauge + clamp per bend
const SETUP_SEC_PER_BEND = 12;
const STROKE_TIME_SEC = 4; // hydraulic ram at standard 10 mm/s

@Injectable()
export class PressBrakeCalculator implements IOperationCalculator {
  readonly operationKey = "press_brake";

  validate(params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as PressBrakeGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (g.bendCount <= 0) {
      errors.push("Bend count must be > 0");
    }
    if (g.materialThicknessMm <= 0) {
      errors.push(`Material thickness invalid: ${g.materialThicknessMm}mm`);
    }
    if (g.tensileStrengthMpa <= 0) {
      errors.push(`Tensile strength invalid: ${g.tensileStrengthMpa} MPa`);
    }

    if (params.isoGroup === "S") {
      warnings.push(`Titanium/superalloy bending: minimum bend radius = 3×t = ${(3 * g.materialThicknessMm).toFixed(1)}mm to prevent cracking`);
    } else if (params.isoGroup === "H") {
      warnings.push(`Hardened steel bending: likely to crack; heat may be required — quote as special process`);
    }

    // Heavy gauge warning
    if (g.materialThicknessMm > 8 && g.bendLengthMm > 1500) {
      warnings.push(`Heavy gauge ${g.materialThicknessMm}mm × ${g.bendLengthMm}mm bend requires 200T+ press brake and 2-operator handling`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  calculate(_params: MachiningParams, geo: FeatureGeometry): CalculationResult {
    const g = geo as PressBrakeGeometry;
    const steps: CalculationStep[] = [];

    // Wiegel formula: F = (1.33 × Rm × t² × L) / (V × 1000)
    // V-die width defaults to 8×t per DIN/ISO sheet metal bending standard
    const v = g.vDieWidthMm ?? g.materialThicknessMm * 8;
    const forcekN =
      (1.33 * g.tensileStrengthMpa * g.materialThicknessMm ** 2 * g.bendLengthMm) /
      (v * 1000);
    steps.push({
      stepName: "bending_force",
      expression: "(1.33 × Rm × t² × L) / (V × 1000)",
      inputs: {
        Rm: g.tensileStrengthMpa,
        t: g.materialThicknessMm,
        L: g.bendLengthMm,
        V: v,
      },
      result: forcekN,
      units: "kN",
    });

    const tcPerBendSec = SETUP_SEC_PER_BEND + STROKE_TIME_SEC;
    steps.push({
      stepName: "cycle_time_per_bend",
      expression: "setup_time_per_bend + stroke_time",
      inputs: { setup_time_per_bend: SETUP_SEC_PER_BEND, stroke_time: STROKE_TIME_SEC },
      result: tcPerBendSec,
      units: "sec",
    });

    const totalSec = tcPerBendSec * g.bendCount;
    steps.push({
      stepName: "total_cycle_time",
      expression: "tc_per_bend × bend_count",
      inputs: { tc_per_bend: tcPerBendSec, bend_count: g.bendCount },
      result: totalSec,
      units: "sec",
    });

    return {
      totalCycleTimeSec: totalSec,
      perFeatureCycleTimeSec: tcPerBendSec,
      featureCount: g.bendCount,
      steps,
    };
  }

  machineRequirements(_params: MachiningParams, result: CalculationResult): MachineRequirements {
    const forceStep = result.steps.find((s) => s.stepName === "bending_force");
    const requiredTonnage = (forceStep?.result ?? 100) * 1.25; // 25% safety factor
    return {
      minPowerKw: 15.0,
      minRpm: 0,
      minClampingKn: requiredTonnage,
      machineCategoryHint: "press_brake",
    };
  }

  toolRequirements(_params: MachiningParams, geo: FeatureGeometry): ToolRequirements {
    const g = geo as PressBrakeGeometry;
    return {
      toolType: "press_brake_tooling",
      diameterMm: g.materialThicknessMm,  // proxy for die opening selection
      coating: "Uncoated",
      insertGradeIso: "N/A",
    };
  }
}
