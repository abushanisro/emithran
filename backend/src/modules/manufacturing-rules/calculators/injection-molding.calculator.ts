import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../../common/supabase/supabase.service";
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

export interface InjectionMoldingGeometry extends FeatureGeometry {
  polymerId: string;            // 'PP' | 'ABS' | 'PA66' | etc. — matches polymer_name in DB
  wallThicknessMm: number;      // nominal wall thickness (controls cooling time)
  projectedAreaMm2: number;     // projected area in clamp direction (controls clamp force)
  shotVolumeCm3: number;        // part volume + runner + gate
  injectionRateCm3Sec?: number; // defaults to 100 cm³/s (typical reciprocating screw)
  cavities?: number;            // number of cavities (defaults to 1)
}

// Polymer thermal property defaults (used if DB lookup fails)
const POLYMER_FALLBACK: Record<string, { alpha: number; meltTemp: number; ejectTemp: number; moldTemp: number; cavityPressure: number }> = {
  PP:   { alpha: 0.077, meltTemp: 230, ejectTemp: 100, moldTemp: 30,  cavityPressure: 30 },
  ABS:  { alpha: 0.100, meltTemp: 240, ejectTemp: 85,  moldTemp: 50,  cavityPressure: 40 },
  PA66: { alpha: 0.120, meltTemp: 275, ejectTemp: 100, moldTemp: 80,  cavityPressure: 40 },
  PC:   { alpha: 0.130, meltTemp: 300, ejectTemp: 120, moldTemp: 80,  cavityPressure: 50 },
  POM:  { alpha: 0.080, meltTemp: 205, ejectTemp: 120, moldTemp: 70,  cavityPressure: 40 },
  default: { alpha: 0.095, meltTemp: 240, ejectTemp: 85, moldTemp: 50, cavityPressure: 40 },
};

@Injectable()
export class InjectionMoldingCalculator implements IOperationCalculator {
  readonly operationKey = "injection_molding";
  private readonly logger = new Logger(InjectionMoldingCalculator.name);

  constructor(private readonly supabase: SupabaseService) {}

  validate(_params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as InjectionMoldingGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (g.wallThicknessMm <= 0 || g.projectedAreaMm2 <= 0) {
      errors.push(`Geometry invalid: wall=${g.wallThicknessMm}mm projected_area=${g.projectedAreaMm2}mm²`);
    }
    if (g.wallThicknessMm > 6) {
      warnings.push(`Wall thickness ${g.wallThicknessMm}mm > 6mm: cooling time increases quadratically; consider coring out`);
    }
    if (!g.polymerId) {
      errors.push("polymerId is required for injection molding calculation (e.g. 'PP', 'ABS', 'PA66')");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async calculate(_params: MachiningParams, geo: FeatureGeometry): Promise<CalculationResult> {
    const g = geo as InjectionMoldingGeometry;
    const steps: CalculationStep[] = [];
    const cavities = g.cavities ?? 1;
    const injRate = g.injectionRateCm3Sec ?? 100;

    const polymer = await this.lookupPolymer(g.polymerId);

    // Rosato's cooling formula: tc = (t² / (π²·α)) × ln[(4/π) × (Tm−Tc) / (Te−Tc)]
    const alpha = polymer.alpha; // mm²/s — thermal diffusivity from polymer DB
    const t = g.wallThicknessMm;
    const lnTerm = Math.log((4 / Math.PI) * (polymer.meltTemp - polymer.moldTemp) / (polymer.ejectTemp - polymer.moldTemp));
    const coolingTimeSec = (t * t) / (Math.PI * Math.PI * alpha) * lnTerm;
    steps.push({
      stepName: "cooling_time",
      expression: "(t² / (π² × α)) × ln[(4/π) × (Tm−Tc) / (Te−Tc)]",
      inputs: { t, alpha, Tm: polymer.meltTemp, Tc: polymer.moldTemp, Te: polymer.ejectTemp },
      result: coolingTimeSec,
      units: "sec",
    });

    const injectionTimeSec = g.shotVolumeCm3 / injRate;
    steps.push({
      stepName: "injection_time",
      expression: "shot_volume / injection_rate",
      inputs: { shot_volume: g.shotVolumeCm3, injection_rate: injRate },
      result: injectionTimeSec,
      units: "sec",
    });

    const ejectTimeSec = 4; // 4s for automated ejection; 8s for manual (conservative)
    steps.push({
      stepName: "eject_time",
      expression: "fixed 4s for automated ejection",
      inputs: {},
      result: ejectTimeSec,
      units: "sec",
    });

    const cyclePerShotSec = coolingTimeSec + injectionTimeSec + ejectTimeSec;
    steps.push({
      stepName: "cycle_time_per_shot",
      expression: "cooling + injection + eject",
      inputs: { cooling: coolingTimeSec, injection: injectionTimeSec, eject: ejectTimeSec },
      result: cyclePerShotSec,
      units: "sec",
    });

    // F(kN) = projected_area × cavity_pressure / 1000
    const clampForceKn = (g.projectedAreaMm2 * polymer.cavityPressure) / 1000;
    steps.push({
      stepName: "clamp_force",
      expression: "projected_area × cavity_pressure / 1000",
      inputs: { projected_area: g.projectedAreaMm2, cavity_pressure: polymer.cavityPressure },
      result: clampForceKn,
      units: "kN",
    });

    const partsPerHour = (3600 / cyclePerShotSec) * cavities;
    steps.push({
      stepName: "parts_per_hour",
      expression: "(3600 / cycle_time) × cavities",
      inputs: { cycle_time: cyclePerShotSec, cavities },
      result: partsPerHour,
      units: "parts/hr",
    });

    return {
      totalCycleTimeSec: cyclePerShotSec,
      perFeatureCycleTimeSec: cyclePerShotSec / cavities,
      featureCount: cavities,
      steps,
    };
  }

  machineRequirements(_params: MachiningParams, result: CalculationResult): MachineRequirements {
    const clampStep = result.steps.find((s) => s.stepName === "clamp_force");
    const requiredClamp = (clampStep?.result ?? 1000) * 1.25; // 25% safety margin
    return {
      minPowerKw: 15.0,
      minRpm: 0,
      minClampingKn: requiredClamp,
      machineCategoryHint: "im_100t",
    };
  }

  toolRequirements(_params: MachiningParams, geo: FeatureGeometry): ToolRequirements {
    const g = geo as InjectionMoldingGeometry;
    return {
      toolType: "injection_mold",
      coating: "N/A",
      insertGradeIso: `cavity_count:${g.cavities ?? 1}`,
    };
  }

  private async lookupPolymer(polymerId: string): Promise<{
    alpha: number;
    meltTemp: number;
    ejectTemp: number;
    moldTemp: number;
    cavityPressure: number;
  }> {
    const db = this.supabase.getClient();
    const { data } = await db
      .from("injection_molding_materials")
      .select("thermal_diffusivity_mm2_s, melt_temp_c, ejection_temp_c, recommended_mold_temp_c, cavity_pressure_mpa")
      .ilike("polymer_name", polymerId)
      .limit(1)
      .maybeSingle();

    if (data) {
      const row = data as Record<string, unknown>;
      return {
        alpha: Number(row.thermal_diffusivity_mm2_s),
        meltTemp: Number(row.melt_temp_c),
        ejectTemp: Number(row.ejection_temp_c),
        moldTemp: Number(row.recommended_mold_temp_c),
        cavityPressure: Number(row.cavity_pressure_mpa),
      };
    }

    this.logger.warn(`[im-calc] No DB polymer record for "${polymerId}" — using fallback`);
    return POLYMER_FALLBACK[polymerId.toUpperCase()] ?? POLYMER_FALLBACK["default"];
  }
}
