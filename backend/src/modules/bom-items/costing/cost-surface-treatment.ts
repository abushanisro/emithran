import { classifySurfaceTreatment, type SurfaceTreatmentDbRate } from './default-rates';
import type { ProcessLineCost } from '../dto/cost-breakdown.dto';

function r2(n: number): number { return Math.round(n * 100) / 100; }

// Surface treatment process line (anodize / plating / powder coat / coating).
// perPart = max(area × rate/m², min-lot charge / batch).
// dbRate is resolved by the service from surface_treatment_rates table; when null
// the cost is omitted with a warning rather than silently using a hardcoded rate.
export function computeSurfaceTreatmentLine(
  surfaceTreatment: string | null,
  surfaceAreaMm2: number,
  batchSize: number,
  location: string,
  warnings: string[],
  dbRate?: SurfaceTreatmentDbRate | null,
): ProcessLineCost | null {
  const trimmed = surfaceTreatment?.trim() ?? '';
  const key = classifySurfaceTreatment(surfaceTreatment);
  if (!key) {
    if (trimmed && !/^(none|n\/a|na|nil|no|-|as.?required)$/i.test(trimmed)) {
      warnings.push(
        `Surface treatment callout "${trimmed}" not recognized — treatment cost NOT included; verify before quoting.`,
      );
    }
    return null;
  }
  if (surfaceAreaMm2 <= 0) {
    warnings.push(
      `Drawing calls out surface treatment "${trimmed}" but part surface area is unknown — treatment cost NOT included; re-run CAD analysis.`,
    );
    return null;
  }
  if (!dbRate) {
    warnings.push(
      `Surface treatment "${trimmed}" (${key}) has no rate in ${location} — add a row to surface_treatment_rates table to cost this operation.`,
    );
    return null;
  }

  const areaCost = (surfaceAreaMm2 / 1e6) * dbRate.ratePerM2Local;
  const minLotPerPart = dbRate.minLotChargeLocal / Math.max(batchSize, 1);
  const perPart = r2(Math.max(areaCost, minLotPerPart));
  return {
    process: `Surface Treatment (${dbRate.label})`,
    setupCost: 0,
    runCost: perPart,
    totalCost: perPart,
    cycleTimeMin: 0,
    hourlyRate: 0,
    rateSource: 'mhr_database',
    machineClass: 'surface_treatment',
    machineName: null,
    commodityCode: null,
  };
}
