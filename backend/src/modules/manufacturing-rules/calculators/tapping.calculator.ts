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

export interface TappingGeometry extends FeatureGeometry {
  threadSpec: string;          // 'M8×1.25', 'M12×1.75', 'UNC 3/8-16'
  pitchMm: number;             // 1.25 for M8×1.25; must be > 0
  majorDiameterMm: number;
  depthMm: number;             // thread depth
  holeCount: number;
}

@Injectable()
export class TappingCalculator implements IOperationCalculator {
  readonly operationKey = "tapping";

  validate(params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as TappingGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (g.pitchMm <= 0) {
      errors.push(`Thread pitch must be > 0 (got ${g.pitchMm}mm)`);
    }
    if (g.majorDiameterMm <= 0 || g.depthMm <= 0) {
      errors.push(`Tapping geometry invalid: dia=${g.majorDiameterMm}mm depth=${g.depthMm}mm`);
    }
    // M3 and under in SS/Ti are very high risk
    if (g.majorDiameterMm <= 3 && ["M", "S"].includes(params.isoGroup)) {
      warnings.push(`Tapping M${g.majorDiameterMm.toFixed(0)} or smaller in ${params.isoGroup}-group material — high breakage risk; use thread milling or form taps`);
    }
    // Through-holes are safer but blind holes need chip clearance
    const threadEngagement = g.depthMm / (g.majorDiameterMm || 1);
    if (threadEngagement > 2.5) {
      warnings.push(`Thread engagement depth/dia=${threadEngagement.toFixed(1)} > 2.5: spiral flute tap or chip flushing required`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  calculate(params: MachiningParams, geo: FeatureGeometry): CalculationResult {
    const g = geo as TappingGeometry;
    const steps: CalculationStep[] = [];

    const rpm = (1000 * params.vcRecommended) / (Math.PI * g.majorDiameterMm);
    steps.push({
      stepName: "spindle_rpm",
      expression: "(1000 × Vc) / (π × D)",
      inputs: { Vc: params.vcRecommended, D: g.majorDiameterMm },
      result: rpm,
      units: "rpm",
    });

    // For rigid tapping, feed = pitch exactly — not an adjustable parameter
    steps.push({
      stepName: "feed_per_rev",
      expression: "pitch (thread geometry — not adjustable for rigid tapping)",
      inputs: { pitch: g.pitchMm },
      result: g.pitchMm,
      units: "mm/rev",
    });

    // Forward pass + synchronized reversal; reversal speed matches forward
    const tcForwardMin = g.depthMm / (g.pitchMm * rpm);
    const tcPerHoleMin = tcForwardMin * 2;
    steps.push({
      stepName: "cycle_time_per_hole",
      expression: "2 × (depth / (pitch × N))",
      inputs: { depth: g.depthMm, pitch: g.pitchMm, N: rpm },
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
    const requiredRpm = (rpmStep?.result ?? 500) * 1.1;
    return {
      minPowerKw: 1.5,
      minRpm: Math.ceil(requiredRpm),
      machineCategoryHint: "vmc_3ax",
    };
  }

  toolRequirements(params: MachiningParams, geo: FeatureGeometry): ToolRequirements {
    const g = geo as TappingGeometry;
    const isHardMaterial = ["M", "S", "H"].includes(params.isoGroup);
    return {
      toolType: isHardMaterial ? "spiral_flute_tap" : "straight_flute_tap",
      diameterMm: g.majorDiameterMm,
      coating: params.isoGroup === "N" ? "Uncoated" : "TiN",
      insertGradeIso: params.insertGradeIso,
    };
  }
}
