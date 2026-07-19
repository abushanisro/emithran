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
  IsoGroup,
} from "../interfaces/operation-calculator.interface";

export interface LaserGeometry extends FeatureGeometry {
  thicknessMm: number;
  cutLengthMm: number;         // total cut perimeter (outer profile + internal cutouts)
  pierceCount: number;         // number of pierce starts (holes + 1 outer lead-in)
  laserPowerKw?: number;       // optional override; resolver picks closest available
}

// Fallback laser params when no DB row matches (old 3kW machine data)
const FALLBACK_SPEEDS: Partial<Record<IsoGroup, Record<number, { speed: number; pierce: number }>>> = {
  P: {
    1: { speed: 32000, pierce: 0.2 },
    2: { speed: 16000, pierce: 0.4 },
    3: { speed: 4500,  pierce: 0.6 },
    4: { speed: 3250,  pierce: 1.0 },
    6: { speed: 3750,  pierce: 1.5 },
    8: { speed: 3150,  pierce: 2.0 },
    10:{ speed: 2250,  pierce: 2.8 },
  },
  M: {
    1: { speed: 15000, pierce: 0.2 },
    2: { speed: 7500,  pierce: 0.4 },
    3: { speed: 4250,  pierce: 0.8 },
    4: { speed: 4750,  pierce: 1.2 },
    6: { speed: 3000,  pierce: 2.5 },
  },
  N: {
    1: { speed: 21500, pierce: 0.15 },
    2: { speed: 12000, pierce: 0.3 },
    3: { speed: 7500,  pierce: 0.5 },
    4: { speed: 12000, pierce: 0.6 },
    6: { speed: 6000,  pierce: 1.4 },
  },
};

@Injectable()
export class LaserCuttingCalculator implements IOperationCalculator {
  readonly operationKey = "laser_cutting";
  private readonly logger = new Logger(LaserCuttingCalculator.name);

  constructor(private readonly supabase: SupabaseService) {}

  validate(_params: MachiningParams, geo: FeatureGeometry): ValidationResult {
    const g = geo as LaserGeometry;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (g.thicknessMm <= 0 || g.cutLengthMm <= 0) {
      errors.push(`Laser geometry invalid: thickness=${g.thicknessMm}mm cut_length=${g.cutLengthMm}mm`);
    }
    if (g.thicknessMm > 25) {
      errors.push(`Thickness ${g.thicknessMm}mm exceeds fiber laser capability (max 25mm for standard machines)`);
    }
    if (g.thicknessMm > 12 && (!g.laserPowerKw || g.laserPowerKw < 10)) {
      warnings.push(`Thickness ${g.thicknessMm}mm requires ≥10kW laser; slow cut speeds assumed`);
    }
    if (g.pierceCount > 200) {
      warnings.push(`${g.pierceCount} pierce starts — high pierce time contribution; consider nesting to reduce`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async calculate(params: MachiningParams, geo: FeatureGeometry): Promise<CalculationResult> {
    const g = geo as LaserGeometry;
    const steps: CalculationStep[] = [];
    const targetPower = g.laserPowerKw ?? 6.0;

    const { speedMmMin, pierceSec, actualPowerKw } = await this.lookupLaserParams(
      params.isoGroup,
      g.thicknessMm,
      targetPower,
    );

    steps.push({
      stepName: "laser_parameters_lookup",
      expression: "DB lookup: iso_group × thickness_mm × laser_power_kw → cutting_speed + pierce_time",
      inputs: { thickness_mm: g.thicknessMm, laser_power_kw: actualPowerKw },
      result: speedMmMin,
      units: "mm/min",
    });

    const cuttingTimeSec = (g.cutLengthMm / speedMmMin) * 60;
    steps.push({
      stepName: "cutting_time",
      expression: "(cut_length / cutting_speed) × 60",
      inputs: { cut_length: g.cutLengthMm, cutting_speed: speedMmMin },
      result: cuttingTimeSec,
      units: "sec",
    });

    const totalPierceSec = g.pierceCount * pierceSec;
    steps.push({
      stepName: "pierce_time",
      expression: "pierce_count × pierce_time_sec",
      inputs: { pierce_count: g.pierceCount, pierce_time_sec: pierceSec },
      result: totalPierceSec,
      units: "sec",
    });

    // ~10% of cutting time for traverse + acceleration between parts (typical nesting)
    const positioningSec = cuttingTimeSec * 0.10;
    steps.push({
      stepName: "positioning_overhead",
      expression: "cutting_time × 0.10 (traverse + acceleration)",
      inputs: { cutting_time: cuttingTimeSec },
      result: positioningSec,
      units: "sec",
    });

    const totalSec = cuttingTimeSec + totalPierceSec + positioningSec;
    steps.push({
      stepName: "total_cycle_time",
      expression: "cutting_time + pierce_time + positioning",
      inputs: { cutting_time: cuttingTimeSec, pierce_time: totalPierceSec, positioning: positioningSec },
      result: totalSec,
      units: "sec",
    });

    return {
      totalCycleTimeSec: totalSec,
      perFeatureCycleTimeSec: totalSec,
      featureCount: 1,
      steps,
    };
  }

  machineRequirements(_params: MachiningParams, _result: CalculationResult): MachineRequirements {
    return {
      minPowerKw: 6.0,
      minRpm: 0,
      machineCategoryHint: "laser_6kw",
    };
  }

  toolRequirements(_params: MachiningParams, _geo: FeatureGeometry): ToolRequirements {
    return {
      toolType: "fiber_laser_head",
      coating: "N/A",
      insertGradeIso: "N/A",
    };
  }

  private async lookupLaserParams(
    isoGroup: IsoGroup,
    thicknessMm: number,
    targetPowerKw: number,
  ): Promise<{ speedMmMin: number; pierceSec: number; actualPowerKw: number }> {
    const db = this.supabase.getClient();

    // Find closest matching thickness (DB has discrete steps: 1,2,3,4,5,6,8,10,12,16,20)
    const closestThickness = this.closestValue(
      thicknessMm,
      [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20],
    );

    // Try exact power match first, then closest available
    const { data } = await db
      .from("laser_cutting_parameters")
      .select("cutting_speed_mm_min, pierce_time_sec, laser_power_kw")
      .eq("iso_material_group", isoGroup)
      .eq("thickness_mm", closestThickness)
      .order("laser_power_kw", { ascending: false })
      .limit(5);

    if (data && data.length > 0) {
      const rows = data as { cutting_speed_mm_min: number; pierce_time_sec: number; laser_power_kw: number }[];
      // Pick the row with power closest to targetPowerKw
      const best = rows.reduce((prev, curr) =>
        Math.abs(curr.laser_power_kw - targetPowerKw) < Math.abs(prev.laser_power_kw - targetPowerKw)
          ? curr
          : prev,
      );
      if (best.cutting_speed_mm_min) {
        return {
          speedMmMin: best.cutting_speed_mm_min,
          pierceSec: best.pierce_time_sec,
          actualPowerKw: best.laser_power_kw,
        };
      }
    }

    // Fallback to hardcoded lookup
    this.logger.warn(`[laser] No DB row for ${isoGroup}/t=${thicknessMm}mm — using hardcoded fallback`);
    const group = FALLBACK_SPEEDS[isoGroup] ?? FALLBACK_SPEEDS["P"] ?? {};
    const thickKeys = Object.keys(group).map(Number);
    const closestKey = this.closestValue(thicknessMm, thickKeys);
    const fb = group[closestKey] ?? { speed: 3000, pierce: 1.0 };
    return { speedMmMin: fb.speed, pierceSec: fb.pierce, actualPowerKw: 6.0 };
  }

  private closestValue(target: number, candidates: number[]): number {
    return candidates.reduce((prev, curr) =>
      Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev,
    );
  }
}
