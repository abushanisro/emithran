import type { SurfaceTreatmentDbRate } from '../core/default-rates.constants';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';

function r2(n: number): number { return Math.round(n * 100) / 100; }

// Surface treatment process line for the drawing's treatment callout. The
// callout has already been matched to a reference process from
// memory/SurfaceTreatment and costed by the surface-treatment engine
// (BomItemsService.resolveSurfaceTreatmentDbRate -> SecondaryProcessService):
// a per-area price for plating/e-coat, or machine time x the reference
// machine rate for the timed processes. This function only assembles the
// ProcessLineCost shape. Nothing here chooses a rate: an unmatched callout or
// a process the reference cannot cost is a warning, never a default price.
export function computeSurfaceTreatmentLine(
  surfaceTreatment: string | null,
  surfaceAreaMm2: number,
  batchSize: number,
  location: string,
  warnings: string[],
  dbRate?: SurfaceTreatmentDbRate | null,
): ProcessLineCost | null {
  const trimmed = surfaceTreatment?.trim() ?? '';
  if (!trimmed || /^(none|n\/a|na|nil|no|-|as.?required)$/i.test(trimmed)) return null;
  if (!dbRate) {
    warnings.push(
      `Surface treatment callout "${trimmed}" does not name a reference surface-treatment process (memory/SurfaceTreatment) — treatment cost NOT included; verify before quoting.`,
    );
    return null;
  }
  if (surfaceAreaMm2 <= 0) {
    warnings.push(
      `Drawing calls out surface treatment "${trimmed}" but part surface area is unknown — treatment cost NOT included; re-run CAD analysis.`,
    );
    return null;
  }

  const base = {
    process: `Surface Treatment (${dbRate.label})`,
    // No machine setup is charged here: a priced plating/e-coat service has
    // none, and a timed process's setup is spread into its per-part cost.
    setupTimeMin: 0,
    setupTimeSource: 'none' as const,
    setupCost: 0,
    rateSource: 'mhr_database' as const,
    machineClass: dbRate.treatmentType,
    machineName: dbRate.machineName,
    commodityCode: null,
    ...(dbRate.confidence ? { confidence: dbRate.confidence } : {}),
  };

  const totalCost = dbRate.totalCostFromCalculatorLocal;
  if (typeof totalCost !== 'number' || !Number.isFinite(totalCost)) {
    const gap = dbRate.gap;
    warnings.push(gap
      ? `Surface treatment "${trimmed}" (${dbRate.label}) cost unavailable — ${gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason}`
      : `Surface treatment "${trimmed}" (${dbRate.label}) cost unavailable.`);
    return {
      ...base,
      runCost: 0,
      totalCost: 0,
      cycleTimeMin: 0,
      hourlyRate: 0,
      ...(gap ? { physicsGap: gap } : {}),
    };
  }

  const perPart = r2(totalCost);
  return {
    ...base,
    runCost: perPart,
    totalCost: perPart,
    cycleTimeMin: dbRate.cycleTimeMin ?? 0,
    hourlyRate: dbRate.hourlyRateLocal ?? 0,
  };
}
