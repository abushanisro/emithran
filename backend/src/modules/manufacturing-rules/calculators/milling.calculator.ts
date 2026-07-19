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

export interface MillingGeometry extends FeatureGeometry {
  cutterDiameterMm: number;
  cuttingLengthMm: number;    // total tool path length
  widthMm: number;             // feature width (pocket or surface width)
  depthMm: number;             // total depth to remove
  flutes?: number;             // defaults to 4
}

@Injectable()
export class MillingCalculator implements IOperationCalculator {
  readonly operationKey = "milling";

  validate(params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as MillingGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (params.isoGroup === "S" && params.vcRecommended > 70) {
      errors.push(`Vc ${params.vcRecommended} m/min exceeds superalloy milling limit of 70 m/min`);
    }
    if (g.cutterDiameterMm <= 0 || g.depthMm <= 0) {
      errors.push(`Milling geometry invalid: cutter_dia=${g.cutterDiameterMm}mm depth=${g.depthMm}mm`);
    }
    const ap = params.apMaxMm;
    const passCount = Math.ceil(g.depthMm / ap);
    if (passCount > 20) {
      warnings.push(`${passCount} Z-passes required — consider roughing with larger ap first`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  calculate(params: MachiningParams, geo: FeatureGeometry): CalculationResult {
    const g = geo as MillingGeometry;
    const steps: CalculationStep[] = [];
    const flutes = g.flutes ?? 4;

    const rpm = (1000 * params.vcRecommended) / (Math.PI * g.cutterDiameterMm);
    steps.push({
      stepName: "spindle_rpm",
      expression: "(1000 × Vc) / (π × D)",
      inputs: { Vc: params.vcRecommended, D: g.cutterDiameterMm },
      result: rpm,
      units: "rpm",
    });

    // fz × z × N — feed per tooth × flute count × rpm
    const feedMmMin = params.feedRecommended * flutes * rpm;
    steps.push({
      stepName: "feed_rate",
      expression: "fz × flutes × N",
      inputs: { fz: params.feedRecommended, flutes, N: rpm },
      result: feedMmMin,
      units: "mm/min",
    });

    const ap = params.apMaxMm;
    const passCount = Math.ceil(g.depthMm / ap);
    steps.push({
      stepName: "z_pass_count",
      expression: "ceil(depth / ap_max)",
      inputs: { depth: g.depthMm, ap_max: ap },
      result: passCount,
      units: "passes",
    });

    const tcPerPassMin = g.cuttingLengthMm / feedMmMin;
    steps.push({
      stepName: "cycle_time_per_pass",
      expression: "cutting_length / feed_rate",
      inputs: { cutting_length: g.cuttingLengthMm, feed_rate: feedMmMin },
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
    const requiredRpm = (rpmStep?.result ?? 5000) * 1.1;
    return {
      minPowerKw: 11.0,
      minRpm: Math.ceil(requiredRpm),
      machineCategoryHint: "vmc_3ax",
    };
  }

  toolRequirements(params: MachiningParams, geo: FeatureGeometry): ToolRequirements {
    const g = geo as MillingGeometry;
    return {
      toolType: params.toolMaterial === "hss" ? "hss_end_mill" : "solid_carbide_end_mill",
      diameterMm: g.cutterDiameterMm,
      coating: params.isoGroup === "N" ? "Uncoated" : "PVD TiAlN",
      insertGradeIso: params.insertGradeIso,
    };
  }
}
