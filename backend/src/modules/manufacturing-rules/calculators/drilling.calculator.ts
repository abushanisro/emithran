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

export interface DrillGeometry extends FeatureGeometry {
  diameterMm: number;
  depthMm: number;
  holeCount: number;
}

@Injectable()
export class DrillingCalculator implements IOperationCalculator {
  readonly operationKey = "drilling";

  validate(params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as DrillGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Physics guard: Vc > 60 m/min is thermal death for Ti/Ni (ISO S)
    if (params.isoGroup === "S" && params.vcRecommended > 60) {
      errors.push(`Vc ${params.vcRecommended} m/min exceeds Ti/Ni alloy max of 60 m/min — tool will melt`);
    }

    if (g.diameterMm <= 0 || g.depthMm <= 0) {
      errors.push(`Drill geometry invalid: diameter=${g.diameterMm}mm depth=${g.depthMm}mm`);
    }

    const ld = g.depthMm / (g.diameterMm || 1);
    if (ld > 5) {
      warnings.push(`L/D=${ld.toFixed(1)} > 5: peck drilling required — cycle time ×1.4`);
    } else if (ld > 3) {
      warnings.push(`L/D=${ld.toFixed(1)} > 3: peck cycles recommended`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  calculate(params: MachiningParams, geo: FeatureGeometry): CalculationResult {
    const g = geo as DrillGeometry;
    const steps: CalculationStep[] = [];

    const rpm = (1000 * params.vcRecommended) / (Math.PI * g.diameterMm);
    steps.push({
      stepName: "spindle_rpm",
      expression: "(1000 × Vc) / (π × D)",
      inputs: { Vc: params.vcRecommended, D: g.diameterMm },
      result: rpm,
      units: "rpm",
    });

    // 118° standard drill tip angle → approach = 0.30×D
    const approach = 0.3 * g.diameterMm;
    steps.push({
      stepName: "drill_point_approach",
      expression: "0.30 × D",
      inputs: { D: g.diameterMm },
      result: approach,
      units: "mm",
    });

    const ld = g.depthMm / g.diameterMm;
    const peckFactor = ld > 5 ? 1.4 : 1.0;
    if (peckFactor > 1) {
      steps.push({
        stepName: "peck_drilling_factor",
        expression: "L/D > 5 → ×1.4 (peck cycle overhead)",
        inputs: { L_D_ratio: ld },
        result: peckFactor,
        units: "×",
      });
    }

    const tcPerHoleMin = ((g.depthMm + approach) / (params.feedRecommended * rpm)) * peckFactor;
    steps.push({
      stepName: "cycle_time_per_hole",
      expression: "((L + approach) / (f × N)) × peckFactor",
      inputs: { L: g.depthMm, approach, f: params.feedRecommended, N: rpm, peckFactor },
      result: tcPerHoleMin,
      units: "min",
    });

    const totalMin = tcPerHoleMin * g.holeCount;
    steps.push({
      stepName: "total_cycle_time",
      expression: "tc_per_hole × hole_count",
      inputs: { tc_per_hole: tcPerHoleMin, hole_count: g.holeCount },
      result: totalMin,
      units: "min",
    });

    return {
      totalCycleTimeSec: totalMin * 60,
      perFeatureCycleTimeSec: tcPerHoleMin * 60,
      featureCount: g.holeCount,
      steps,
    };
  }

  machineRequirements(params: MachiningParams, result: CalculationResult): MachineRequirements {
    const rpmStep = result.steps.find((s) => s.stepName === "spindle_rpm");
    const requiredRpm = (rpmStep?.result ?? 3000) * 1.1;
    return {
      minPowerKw: 1.5,
      minRpm: Math.ceil(requiredRpm),
      machineCategoryHint: "vmc_3ax",
    };
  }

  toolRequirements(params: MachiningParams, geo: FeatureGeometry): ToolRequirements {
    const g = geo as DrillGeometry;
    return {
      toolType: params.toolMaterial === "hss" ? "hss_twist_drill" : "solid_carbide_drill",
      diameterMm: g.diameterMm,
      coating: params.isoGroup === "M" ? "AlCrN" : params.isoGroup === "N" ? "Uncoated" : "TiAlN",
      insertGradeIso: params.insertGradeIso,
    };
  }
}
