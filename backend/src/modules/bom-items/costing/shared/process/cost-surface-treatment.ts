import { classifySurfaceTreatment, type SurfaceTreatmentDbRate } from '../core/default-rates.constants';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';

function r2(n: number): number { return Math.round(n * 100) / 100; }

// Surface treatment process line (anodize / plating / powder coat / coating)
// — a Manufacturing Calculator returning area/rate/cost outputs, deliberately
// NOT a cycle-time model (there is no real per-part machine cycle for a
// subcontracted-style area treatment). The actual area×rate vs. amortized
// min-lot arithmetic lives in the real "Post Processing - Surface Treatment"
// calculator now, resolved by BomItemsService.enrichSurfaceTreatmentRate()
// via resolvePhysicsQuantity — this function only assembles the ProcessLineCost
// shape from that already-resolved result, same convention as every other
// migrated process (Deburring/PEM/Burring/...). `dbRate` is resolved by the
// service from surface_treatment_rates table; when null, or when the
// treatment/area can't be classified/measured, the cost is omitted with a
// warning rather than silently using a hardcoded rate.
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

  const totalCost = dbRate.totalCostFromCalculatorLocal;
  if (typeof totalCost !== 'number' || !Number.isFinite(totalCost)) {
    // The calculator couldn't resolve a real cost (no calculator registered
    // for machine_class='surface_treatment', or a formula/config problem) —
    // still emit the line (never silently omit it) with cost 0 and the real
    // structured gap attached, matching every other migrated process.
    const gap = dbRate.gap;
    if (gap) {
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Surface treatment "${trimmed}" (${key}) cost unavailable — ${gap.requiredAction}`
        : `Surface treatment "${trimmed}" (${key}) cost unavailable — ${gap.reason}`);
    } else {
      warnings.push(`Surface treatment "${trimmed}" (${key}) cost unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).`);
    }
    return {
      process: `Surface Treatment (${dbRate.label})`,
      setupCost: 0,
      runCost: 0,
      totalCost: 0,
      cycleTimeMin: 0,
      hourlyRate: 0,
      rateSource: 'mhr_database',
      machineClass: 'surface_treatment',
      machineName: null,
      commodityCode: null,
      ...(dbRate.calculatorId ? { calculatorId: dbRate.calculatorId } : {}),
      ...(dbRate.calculatorVersion != null ? { calculatorVersion: dbRate.calculatorVersion } : {}),
      ...(gap ? { physicsGap: gap } : {}),
      ...(dbRate.confidence ? { confidence: dbRate.confidence } : {}),
    };
  }

  const perPart = r2(totalCost);
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
    ...(dbRate.calculatorId ? { calculatorId: dbRate.calculatorId } : {}),
    ...(dbRate.calculatorVersion != null ? { calculatorVersion: dbRate.calculatorVersion } : {}),
    ...(dbRate.confidence ? { confidence: dbRate.confidence } : {}),
  };
}
