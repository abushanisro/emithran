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

export interface TurningGeometry extends FeatureGeometry {
  diameterMm: number;           // part OD being turned
  lengthMm: number;             // length of cut
  materialRemovalMm: number;    // total radial depth to remove (blank OD - finish OD) / 2
  passCount?: number;           // override number of passes (default: computed from ap)
}

@Injectable()
export class TurningCalculator implements IOperationCalculator {
  readonly operationKey = "turning";

  validate(params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as TurningGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (params.isoGroup === "S" && params.vcRecommended > 80) {
      errors.push(`Vc ${params.vcRecommended} m/min is too high for ISO S superalloy — max 80 m/min`);
    }
    if (g.diameterMm <= 0 || g.lengthMm <= 0) {
      errors.push(`Turning geometry invalid: diameter=${g.diameterMm}mm length=${g.lengthMm}mm`);
    }
    if (g.lengthMm / g.diameterMm > 8) {
      warnings.push(`Slenderness ratio L/D=${(g.lengthMm / g.diameterMm).toFixed(1)} > 8: steady rest or tailstock likely needed`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  calculate(params: MachiningParams, geo: FeatureGeometry): CalculationResult {
    const g = geo as TurningGeometry;
    const steps: CalculationStep[] = [];

    const rpm = (1000 * params.vcRecommended) / (Math.PI * g.diameterMm);
    steps.push({
      stepName: "spindle_rpm",
      expression: "(1000 × Vc) / (π × D)",
      inputs: { Vc: params.vcRecommended, D: g.diameterMm },
      result: rpm,
      units: "rpm",
    });

    const ap = params.apMaxMm;
    const passCount = g.passCount ?? Math.ceil(g.materialRemovalMm / ap);
    steps.push({
      stepName: "pass_count",
      expression: "ceil(material_removal / ap_max)",
      inputs: { material_removal: g.materialRemovalMm, ap_max: ap },
      result: passCount,
      units: "passes",
    });

    // tc = L / (f × N) — standard lathe cycle time formula
    const tcPerPassMin = g.lengthMm / (params.feedRecommended * rpm);
    steps.push({
      stepName: "cycle_time_per_pass",
      expression: "L / (f × N)",
      inputs: { L: g.lengthMm, f: params.feedRecommended, N: rpm },
      result: tcPerPassMin,
      units: "min",
    });

    const totalMin = tcPerPassMin * passCount;
    steps.push({
      stepName: "total_cycle_time",
      expression: "tc_per_pass × pass_count",
      inputs: { tc_per_pass: tcPerPassMin, pass_count: passCount },
      result: totalMin,
      units: "min",
    });

    return {
      totalCycleTimeSec: totalMin * 60,
      perFeatureCycleTimeSec: tcPerPassMin * 60,
      featureCount: passCount,
      steps,
    };
  }

  machineRequirements(params: MachiningParams, result: CalculationResult): MachineRequirements {
    const rpmStep = result.steps.find((s) => s.stepName === "spindle_rpm");
    const requiredRpm = (rpmStep?.result ?? 2000) * 1.1;
    return {
      minPowerKw: 7.5,
      minRpm: Math.ceil(requiredRpm),
      machineCategoryHint: "cnc_lathe",
    };
  }

  toolRequirements(params: MachiningParams, _geo: FeatureGeometry): ToolRequirements {
    return {
      toolType: "turning_insert",
      coating: params.isoGroup === "N" ? "Uncoated" : "CVD TiCN/Al2O3",
      insertGradeIso: params.insertGradeIso,
    };
  }
}
