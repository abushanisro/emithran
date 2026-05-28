/**
 * Raw Material Cost Calculation Engine (INR-Native)
 *
 * Implements accurate material cost calculations for Indian manufacturing:
 * - Gross/Net usage tracking
 * - Scrap material recovery (reclaim value)
 * - Additional scrap/waste percentage
 * - Overhead application
 * - All costs in INR (₹)
 *
 * This engine follows cost accounting principles for material costing
 *
 * @author Manufacturing Cost Engineering Team
 * @version 2.0.0 (INR-Native)
 */

import { RAW_MATERIAL_COST_CONSTANTS } from '../constants/raw-material-cost-calculation.constants';

/**
 * Input parameters for raw material cost calculation
 * All monetary values in INR (₹)
 */
export interface RawMaterialCostInput {
  // Material Information
  materialId?: string;
  materialName?: string;
  materialCategory?: string;
  materialType?: string;

  // Cost Information (All in INR)
  materialCostId?: string;
  costName?: string;
  unitCost: number;               // Cost per unit of material (₹/unit)
  reclaimRate?: number;           // Recovery value for scrap (₹/unit)
  uom?: string;                   // Unit of measure (KG, LB, M, etc.)

  // Usage Parameters
  grossUsage: number;             // Total material required (including scrap)
  netUsage: number;               // Actual material in finished part
  scrap: number;                  // Additional scrap/waste percentage (0-100)
  overhead: number;               // Overhead percentage (0-100)
}

/**
 * Detailed cost breakdown result
 * All monetary values in INR (₹)
 */
export interface RawMaterialCostResult {
  // Input Summary
  materialName: string;
  costName: string;
  uom: string;

  // Material Costs (INR)
  unitCost: number;               // ₹/unit
  reclaimRate: number;            // ₹/unit
  grossUsage: number;             // units
  netUsage: number;               // units
  scrapAmount: number;            // Gross - Net (units)

  // Cost Calculations (INR)
  grossMaterialCost: number;      // Gross Usage × Unit Cost (₹)
  reclaimValue: number;           // Scrap Amount × Reclaim Rate (₹)
  netMaterialCost: number;        // Gross Cost - Reclaim Value (₹)

  // Adjustments (INR)
  scrapPercentage: number;        // Additional waste % (0-100)
  scrapAdjustment: number;        // Additional waste cost (₹)
  subtotalBeforeOverhead: number; // Net + Scrap Adjustment (₹)

  overheadPercentage: number;     // Overhead % (0-100)
  overheadCost: number;           // Overhead amount (₹)

  // Total Cost (INR)
  totalCost: number;              // Final total cost (₹)
  totalCostPerUnit: number;       // Total / Gross Usage (₹/unit)

  // Efficiency Metrics
  materialUtilizationRate: number;  // Net / Gross × 100 (%)
  scrapRate: number;                 // (Gross - Net) / Gross × 100 (%)
  effectiveCostPerUnit: number;      // Total / Net Usage (₹/unit)
  materialCostPercentage: number;    // Material as % of total
  reclaimPercentage: number;         // Reclaim as % of gross cost
  overheadPercentage_ofTotal: number;// Overhead as % of total
}

/**
 * Raw Material Cost Calculation Engine (INR-Native)
 *
 * Formula (all calculations in INR):
 * 1. Gross Material Cost = Gross Usage × Unit Cost
 * 2. Scrap Amount = Gross Usage - Net Usage
 * 3. Reclaim Value = Scrap Amount × Reclaim Rate
 * 4. Net Material Cost = Gross Material Cost - Reclaim Value
 * 5. Scrap Adjustment = Net Material Cost × (Scrap% / 100)
 * 6. Subtotal = Net Material Cost + Scrap Adjustment
 * 7. Overhead Cost = Subtotal × (Overhead% / 100)
 * 8. Total Cost = Subtotal + Overhead Cost
 */
export class RawMaterialCostCalculationEngine {
  private readonly precision = RAW_MATERIAL_COST_CONSTANTS.PRECISION;
  private readonly defaults = RAW_MATERIAL_COST_CONSTANTS.DEFAULTS;

  /**
   * Main calculation method for raw material costing
   * All calculations performed in INR
   *
   * @param input Raw material cost input parameters
   * @returns Complete raw material cost calculation result in INR
   */
  calculate(input: RawMaterialCostInput): RawMaterialCostResult {
    // Validate input
    this.validateInput(input);

    // Normalize input with defaults
    const normalized = this.normalizeInput(input);

    // Step 1: Calculate material costs
    const materialCosts = this.calculateMaterialCosts(
      normalized.grossUsage,
      normalized.netUsage,
      normalized.unitCost,
      normalized.reclaimRate
    );

    // Step 2: Apply scrap adjustment
    const scrapAdjusted = this.applyScrapAdjustment(
      materialCosts.netMaterialCost,
      normalized.scrap
    );

    // Step 3: Apply overhead
    const withOverhead = this.applyOverhead(
      scrapAdjusted.subtotal,
      normalized.overhead
    );

    // Step 4: Calculate per-unit costs
    const perUnit = this.calculatePerUnitCosts(
      withOverhead.totalCost,
      normalized.netUsage,
      normalized.grossUsage
    );

    // Step 5: Calculate efficiency metrics
    const metrics = this.calculateEfficiencyMetrics(
      normalized.grossUsage,
      normalized.netUsage,
      materialCosts.grossMaterialCost,
      materialCosts.reclaimValue,
      withOverhead.overheadCost,
      withOverhead.totalCost
    );

    // Build and return final result
    return this.buildResult(
      normalized,
      materialCosts,
      scrapAdjusted,
      withOverhead,
      perUnit,
      metrics
    );
  }

  /**
   * Validate input parameters
   */
  private validateInput(input: RawMaterialCostInput): void {
    const validation = RAW_MATERIAL_COST_CONSTANTS.VALIDATION;

    if (input.unitCost < validation.UNIT_COST.MIN || input.unitCost > validation.UNIT_COST.MAX) {
      throw new Error(`Unit Cost must be between ₹${validation.UNIT_COST.MIN} and ₹${validation.UNIT_COST.MAX}`);
    }

    if (input.grossUsage < validation.USAGE.MIN || input.grossUsage > validation.USAGE.MAX) {
      throw new Error(`Gross Usage must be between ${validation.USAGE.MIN} and ${validation.USAGE.MAX}`);
    }

    if (input.scrap < validation.SCRAP.MIN || input.scrap > validation.SCRAP.MAX) {
      throw new Error(`Scrap % must be between ${validation.SCRAP.MIN} and ${validation.SCRAP.MAX}`);
    }

    if (input.overhead < validation.OVERHEAD.MIN || input.overhead > validation.OVERHEAD.MAX) {
      throw new Error(`Overhead % must be between ${validation.OVERHEAD.MIN} and ${validation.OVERHEAD.MAX}`);
    }

    if (input.reclaimRate !== undefined && (input.reclaimRate < 0 || input.reclaimRate > input.unitCost)) {
      throw new Error('Reclaim Rate must be between ₹0 and Unit Cost');
    }
  }

  /**
   * Normalize input values with defaults
   */
  private normalizeInput(input: RawMaterialCostInput) {
    return {
      materialId: input.materialId ?? '',
      materialName: input.materialName ?? '',
      materialCategory: input.materialCategory ?? '',
      materialType: input.materialType ?? '',
      materialCostId: input.materialCostId ?? '',
      costName: input.costName ?? '',
      unitCost: input.unitCost,
      reclaimRate: input.reclaimRate ?? 0,
      uom: input.uom ?? 'KG',
      grossUsage: input.grossUsage,
      netUsage: input.netUsage,
      scrap: input.scrap,
      overhead: input.overhead,
    };
  }

  /**
   * Calculate material costs with reclaim value
   *
   * The difference between gross and net usage represents scrap material
   * that can potentially be recovered/recycled at the reclaim rate
   */
  private calculateMaterialCosts(
    grossUsage: number,
    netUsage: number,
    unitCost: number,
    reclaimRate: number
  ) {
    // Total material cost based on gross usage (₹)
    const grossMaterialCost = grossUsage * unitCost;

    // Calculate scrap amount (material that doesn't end up in finished part)
    const scrapAmount = grossUsage - netUsage;

    // Calculate value recovered from scrap material (₹)
    const reclaimValue = scrapAmount * reclaimRate;

    // Net material cost after reclaim (₹)
    const netMaterialCost = grossMaterialCost - reclaimValue;

    return {
      grossMaterialCost: this.round(grossMaterialCost, this.precision.COST),
      scrapAmount: this.round(scrapAmount, this.precision.USAGE),
      reclaimValue: this.round(reclaimValue, this.precision.COST),
      netMaterialCost: this.round(netMaterialCost, this.precision.COST),
    };
  }

  /**
   * Apply scrap adjustment for additional waste/defects
   *
   * This is waste beyond the gross/net difference (e.g., defects, handling loss)
   */
  private applyScrapAdjustment(
    netMaterialCost: number,
    scrapPercentage: number
  ) {
    const scrapAdjustment = netMaterialCost * (scrapPercentage / 100);
    const subtotal = netMaterialCost + scrapAdjustment;

    return {
      scrapAdjustment: this.round(scrapAdjustment, this.precision.COST),
      subtotal: this.round(subtotal, this.precision.COST),
    };
  }

  /**
   * Apply overhead percentage
   *
   * Overhead covers material handling, storage, purchasing, etc.
   */
  private applyOverhead(
    subtotal: number,
    overheadPercentage: number
  ) {
    const overheadCost = subtotal * (overheadPercentage / 100);
    const totalCost = subtotal + overheadCost;

    return {
      overheadCost: this.round(overheadCost, this.precision.COST),
      totalCost: this.round(totalCost, this.precision.COST),
    };
  }

  /**
   * Calculate per-unit costs
   */
  private calculatePerUnitCosts(
    totalCost: number,
    netUsage: number,
    grossUsage: number
  ) {
    // Cost per unit of gross usage (₹/unit)
    const totalCostPerUnit = grossUsage > 0 ? totalCost / grossUsage : 0;

    // Effective cost per unit of net usage - finished part (₹/unit)
    const effectiveCostPerUnit = netUsage > 0 ? totalCost / netUsage : 0;

    return {
      totalCostPerUnit: this.round(totalCostPerUnit, this.precision.COST),
      effectiveCostPerUnit: this.round(effectiveCostPerUnit, this.precision.COST),
    };
  }

  /**
   * Calculate efficiency metrics
   */
  private calculateEfficiencyMetrics(
    grossUsage: number,
    netUsage: number,
    grossMaterialCost: number,
    reclaimValue: number,
    overheadCost: number,
    totalCost: number
  ) {
    // Material utilization rate (how much of gross material ends up in part)
    const materialUtilizationRate = grossUsage > 0 ? (netUsage / grossUsage) * 100 : 0;

    // Scrap rate (how much material is wasted)
    const scrapRate = grossUsage > 0 ? ((grossUsage - netUsage) / grossUsage) * 100 : 0;

    // Cost breakdowns
    const materialCostPercentage = totalCost > 0 ? (grossMaterialCost / totalCost) * 100 : 0;
    const reclaimPercentage = grossMaterialCost > 0 ? (reclaimValue / grossMaterialCost) * 100 : 0;
    const overheadPercentage_ofTotal = totalCost > 0 ? (overheadCost / totalCost) * 100 : 0;

    return {
      materialUtilizationRate: this.round(materialUtilizationRate, this.precision.PERCENTAGE),
      scrapRate: this.round(scrapRate, this.precision.PERCENTAGE),
      materialCostPercentage: this.round(materialCostPercentage, this.precision.PERCENTAGE),
      reclaimPercentage: this.round(reclaimPercentage, this.precision.PERCENTAGE),
      overheadPercentage_ofTotal: this.round(overheadPercentage_ofTotal, this.precision.PERCENTAGE),
    };
  }

  /**
   * Build final calculation result
   */
  private buildResult(
    normalized: ReturnType<typeof this.normalizeInput>,
    materialCosts: ReturnType<typeof this.calculateMaterialCosts>,
    scrapAdjusted: ReturnType<typeof this.applyScrapAdjustment>,
    withOverhead: ReturnType<typeof this.applyOverhead>,
    perUnit: ReturnType<typeof this.calculatePerUnitCosts>,
    metrics: ReturnType<typeof this.calculateEfficiencyMetrics>
  ): RawMaterialCostResult {
    return {
      // Input Summary
      materialName: normalized.materialName,
      costName: normalized.costName,
      uom: normalized.uom,

      // Material Costs
      unitCost: this.round(normalized.unitCost, this.precision.RATE),
      reclaimRate: this.round(normalized.reclaimRate, this.precision.RATE),
      grossUsage: this.round(normalized.grossUsage, this.precision.USAGE),
      netUsage: this.round(normalized.netUsage, this.precision.USAGE),
      scrapAmount: materialCosts.scrapAmount,

      // Cost Calculations
      grossMaterialCost: materialCosts.grossMaterialCost,
      reclaimValue: materialCosts.reclaimValue,
      netMaterialCost: materialCosts.netMaterialCost,

      // Adjustments
      scrapPercentage: this.round(normalized.scrap, this.precision.PERCENTAGE),
      scrapAdjustment: scrapAdjusted.scrapAdjustment,
      subtotalBeforeOverhead: scrapAdjusted.subtotal,

      overheadPercentage: this.round(normalized.overhead, this.precision.PERCENTAGE),
      overheadCost: withOverhead.overheadCost,

      // Total Cost
      totalCost: withOverhead.totalCost,
      totalCostPerUnit: perUnit.totalCostPerUnit,

      // Efficiency Metrics
      materialUtilizationRate: metrics.materialUtilizationRate,
      scrapRate: metrics.scrapRate,
      effectiveCostPerUnit: perUnit.effectiveCostPerUnit,
      materialCostPercentage: metrics.materialCostPercentage,
      reclaimPercentage: metrics.reclaimPercentage,
      overheadPercentage_ofTotal: metrics.overheadPercentage_ofTotal,
    };
  }

  /**
   * Round number to specified decimal places
   */
  private round(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }
}
