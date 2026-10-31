/**
 * BOM cost report data, taken only from the backend's authoritative
 * GET /cost-analysis/bom-item/:id response (CostAggregationService).
 *
 * Nothing here estimates or fills in a cost: a field the backend did not
 * return as a finite number is null, and the UI renders it as "—". Totals over
 * several items are null as soon as one item's value is unknown, because a sum
 * with a missing term is not a real total.
 */

export interface CostBreakdown {
  rawMaterialCost: number | null;
  processCost: number | null;
  toolingCost: number | null;
  packagingLogisticsCost: number | null;
  procuredPartsCost: number | null;
  sgaCost: number | null;
  profitAmount: number | null;
  /** The backend's manufacturingCost. */
  totalCost: number | null;
  sellingPrice: number | null;
}

export interface CostCalculationResult {
  itemId: string;
  breakdown: CostBreakdown;
}

/** The fields of the backend's BomItemCostDto this report reads. */
export interface BomItemCostAnalysis {
  rawMaterialCost?: unknown;
  processCost?: unknown;
  toolingCost?: unknown;
  packagingCost?: unknown;
  procuredPartCost?: unknown;
  manufacturingCost?: unknown;
  sgaCost?: unknown;
  profitCost?: unknown;
  sellingPrice?: unknown;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function costResultFromAnalysis(
  itemId: string,
  analysis: BomItemCostAnalysis,
): CostCalculationResult {
  return {
    itemId,
    breakdown: {
      rawMaterialCost: num(analysis.rawMaterialCost),
      processCost: num(analysis.processCost),
      toolingCost: num(analysis.toolingCost),
      packagingLogisticsCost: num(analysis.packagingCost),
      procuredPartsCost: num(analysis.procuredPartCost),
      sgaCost: num(analysis.sgaCost),
      profitAmount: num(analysis.profitCost),
      totalCost: num(analysis.manufacturingCost),
      sellingPrice: num(analysis.sellingPrice),
    },
  };
}

export interface AggregatedBomCosts {
  totalRawMaterials: number | null;
  totalProcessCosts: number | null;
  totalToolingCosts: number | null;
  totalPackagingLogistics: number | null;
  totalProcuredParts: number | null;
  totalCost: number | null;
  totalSellingPrice: number | null;
  totalSgaCost: number | null;
  totalProfitAmount: number | null;
  /** SG&A as a percentage of manufacturing cost. */
  averageSgaPercentage: number | null;
  /** Profit as a percentage of selling price. */
  averageProfitPercentage: number | null;
  /** Selling price minus manufacturing cost. */
  totalMargin: number | null;
  itemCount: number;
}

const sumOf = (items: CostCalculationResult[], key: keyof CostBreakdown): number | null => {
  let total = 0;
  for (const item of items) {
    const v = item.breakdown[key];
    if (v === null) return null;
    total += v;
  }
  return total;
};

const ratioPct = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole === 0 ? null : (part / whole) * 100;

export function aggregateBomCosts(itemCosts: CostCalculationResult[]): AggregatedBomCosts {
  const totalCost = sumOf(itemCosts, 'totalCost');
  const totalSellingPrice = sumOf(itemCosts, 'sellingPrice');
  const totalSgaCost = sumOf(itemCosts, 'sgaCost');
  const totalProfitAmount = sumOf(itemCosts, 'profitAmount');
  return {
    totalRawMaterials: sumOf(itemCosts, 'rawMaterialCost'),
    totalProcessCosts: sumOf(itemCosts, 'processCost'),
    totalToolingCosts: sumOf(itemCosts, 'toolingCost'),
    totalPackagingLogistics: sumOf(itemCosts, 'packagingLogisticsCost'),
    totalProcuredParts: sumOf(itemCosts, 'procuredPartsCost'),
    totalCost,
    totalSellingPrice,
    totalSgaCost,
    totalProfitAmount,
    averageSgaPercentage: ratioPct(totalSgaCost, totalCost),
    averageProfitPercentage: ratioPct(totalProfitAmount, totalSellingPrice),
    totalMargin:
      totalSellingPrice === null || totalCost === null ? null : totalSellingPrice - totalCost,
    itemCount: itemCosts.length,
  };
}
