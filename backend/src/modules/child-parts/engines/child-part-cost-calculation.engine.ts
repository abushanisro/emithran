/**
 * Child Part Cost Calculation Engine
 *
 * Implements child part cost calculations following manufacturing cost accounting principles:
 * - Purchased Parts (Buy): Unit cost with freight, duty, overhead adjustments
 * - Manufactured Parts (Make): Sum of raw materials and manufacturing processes
 * - Quality Adjustments: Scrap and defect rate calculations
 * - Quantity Economics: MOQ and volume-based pricing
 *
 * This engine separates calculation logic from business logic and provides
 * clean, testable, and maintainable code following SOLID principles.
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import {
  CHILD_PART_COST_PRECISION,
  CHILD_PART_COST_DEFAULTS,
  CHILD_PART_COST_VALIDATION,
  CHILD_PART_COST_ERROR_MESSAGES,
  MAKE_BUY_OPTIONS,
} from '../constants/child-part-cost-calculation.constants';

/**
 * Input parameters for child part cost calculation
 */
export interface ChildPartCostInput {
  // Part Identification
  partNumber?: string;
  partName?: string;
  description?: string;

  // Make/Buy Decision
  makeBuy: 'make' | 'buy';

  // For Purchased Parts (makeBuy = 'buy')
  unitCost?: number; // Base unit cost from supplier
  freight?: number; // Freight as percentage (0-100)
  duty?: number; // Import duty as percentage (0-100)
  overhead?: number; // Overhead allocation as percentage (0-500)

  // For Manufactured Parts (makeBuy = 'make')
  rawMaterialCost?: number; // Cost of raw materials
  processCost?: number; // Sum of all manufacturing process costs

  // Quality Parameters (both buy and make)
  scrap?: number; // Scrap percentage (0-50)
  defectRate?: number; // Defect rate percentage (0-50)

  // Quantity Parameters
  quantity?: number; // Quantity per parent assembly
  moq?: number; // Minimum order quantity
  leadTimeDays?: number; // Lead time in days

  // Currency
  currency?: string;

  // Additional Metadata
  supplierId?: string;
  supplierName?: string;
  supplierLocation?: string;
  notes?: string;
}

/**
 * Detailed cost breakdown result for child parts
 */
interface ChildPartCostResult {
  // Input Summary
  partNumber: string;
  partName: string;
  makeBuy: 'make' | 'buy';
  currency: string;

  // Base Cost Calculation
  baseCost: number; // Unit cost (buy) or raw+process (make)

  // Cost Additions (for purchased parts)
  freightCost: number; // Freight addition
  dutyCost: number; // Duty addition
  overheadCost: number; // Overhead addition
  costBeforeQuality: number; // Base + Freight + Duty + Overhead

  // Quality Adjustments
  scrapPercentage: number;
  defectRatePercentage: number;
  scrapAdjustment: number; // Additional cost due to scrap
  defectAdjustment: number; // Additional cost due to defects
  qualityFactor: number; // Combined quality adjustment factor

  // Final Cost
  totalCostPerPart: number; // Final cost per part after all adjustments
  extendedCost: number; // Total cost × quantity

  // Quantity Economics
  quantity: number;
  moq: number;
  leadTimeDays: number;
  moqExtendedCost: number; // Cost if ordering MOQ

  // Cost Breakdown Percentages
  freightPercentage: number; // Freight as % of total cost
  dutyPercentage: number; // Duty as % of total cost
  overheadPercentage: number; // Overhead as % of total cost
  scrapCostPercentage: number; // Scrap as % of total cost
  defectCostPercentage: number; // Defect as % of total cost

  // For Manufactured Parts Breakdown
  rawMaterialCost?: number;
  processCost?: number;
  rawMaterialPercentage?: number;
  processCostPercentage?: number;
}

/**
 * Child Part Cost Calculation Engine
 *
 * Calculation Formulas:
 *
 * 1. Purchased Parts (makeBuy = 'buy'):
 *    - Base Cost = Unit Cost
 *    - Freight Cost = Base Cost × (Freight% / 100)
 *    - Duty Cost = (Base Cost + Freight Cost) × (Duty% / 100)
 *    - Overhead Cost = (Base + Freight + Duty) × (Overhead% / 100)
 *    - Cost Before Quality = Base + Freight + Duty + Overhead
 *
 * 2. Manufactured Parts (makeBuy = 'make'):
 *    - Base Cost = Raw Material Cost + Process Cost
 *    - No freight/duty/overhead (these are in raw materials and processes)
 *    - Cost Before Quality = Base Cost
 *
 * 3. Quality Adjustments (both):
 *    - Scrap Factor = 1 / (1 - Scrap% / 100)
 *    - Defect Factor = 1 / (1 - Defect% / 100)
 *    - Quality Factor = Scrap Factor × Defect Factor
 *    - Total Cost = Cost Before Quality × Quality Factor
 *
 * Example: If scrap is 2% and defect rate is 3%:
 * - Need to produce 102 parts to get 100 after scrap
 * - Of those 100, only 97 will pass inspection
 * - So need 102 / 0.97 = 105.15 parts total
 * - Cost increases by factor of 1.0515
 */
export class ChildPartCostCalculationEngine {
  private readonly precision = CHILD_PART_COST_PRECISION;
  private readonly defaults = CHILD_PART_COST_DEFAULTS;
  private readonly validation = CHILD_PART_COST_VALIDATION;

  /**
   * Main calculation method for child part cost engineering
   *
   * @param input Child part cost input parameters
   * @returns Complete child part cost calculation result
   */
  calculate(input: ChildPartCostInput): ChildPartCostResult {
    // Validate input
    this.validateInput(input);

    // Normalize input with defaults
    const normalized = this.normalizeInput(input);

    // Calculate base cost based on make/buy decision
    const baseCalc = this.calculateBaseCost(normalized);

    // Calculate logistics costs (for purchased parts only)
    const logisticsCalc = this.calculateLogisticsCosts(
      baseCalc.baseCost,
      normalized.makeBuy,
      normalized.freight,
      normalized.duty,
      normalized.overhead
    );

    // Calculate quality adjustments
    const qualityCalc = this.calculateQualityAdjustments(
      logisticsCalc.costBeforeQuality,
      normalized.scrap,
      normalized.defectRate
    );

    // Calculate quantity economics
    const quantityCalc = this.calculateQuantityEconomics(
      qualityCalc.totalCostPerPart,
      normalized.quantity,
      normalized.moq
    );

    // Calculate breakdown percentages
    const percentages = this.calculateCostBreakdownPercentages(
      logisticsCalc,
      qualityCalc,
      baseCalc,
      normalized.makeBuy
    );

    // Build and return final result
    return this.buildResult(
      normalized,
      baseCalc,
      logisticsCalc,
      qualityCalc,
      quantityCalc,
      percentages
    );
  }

  /**
   * Validate input parameters
   */
  private validateInput(input: ChildPartCostInput): void {
    // Validate make/buy decision
    if (input.makeBuy !== MAKE_BUY_OPTIONS.BUY && input.makeBuy !== MAKE_BUY_OPTIONS.MAKE) {
      throw new Error(`makeBuy must be either '${MAKE_BUY_OPTIONS.BUY}' or '${MAKE_BUY_OPTIONS.MAKE}'`);
    }

    // Validate based on make/buy decision
    if (input.makeBuy === MAKE_BUY_OPTIONS.BUY) {
      // For purchased parts, unit cost is required
      if (input.unitCost === undefined || input.unitCost === null) {
        throw new Error(CHILD_PART_COST_ERROR_MESSAGES.MISSING_COST_INPUT);
      }

      if (
        input.unitCost < this.validation.UNIT_COST.MIN ||
        input.unitCost > this.validation.UNIT_COST.MAX
      ) {
        throw new Error(this.validation.UNIT_COST.DESCRIPTION);
      }
    } else if (input.makeBuy === MAKE_BUY_OPTIONS.MAKE) {
      // For manufactured parts, at least one cost component should be provided
      if (
        (input.rawMaterialCost === undefined || input.rawMaterialCost === null) &&
        (input.processCost === undefined || input.processCost === null)
      ) {
        throw new Error(CHILD_PART_COST_ERROR_MESSAGES.MISSING_COST_INPUT);
      }
    }

    // Validate optional numeric parameters
    if (input.freight !== undefined) {
      if (input.freight < this.validation.FREIGHT.MIN || input.freight > this.validation.FREIGHT.MAX) {
        throw new Error(this.validation.FREIGHT.DESCRIPTION);
      }
    }

    if (input.duty !== undefined) {
      if (input.duty < this.validation.DUTY.MIN || input.duty > this.validation.DUTY.MAX) {
        throw new Error(this.validation.DUTY.DESCRIPTION);
      }
    }

    if (input.overhead !== undefined) {
      if (input.overhead < this.validation.OVERHEAD.MIN || input.overhead > this.validation.OVERHEAD.MAX) {
        throw new Error(this.validation.OVERHEAD.DESCRIPTION);
      }
    }

    if (input.scrap !== undefined) {
      if (input.scrap < this.validation.SCRAP.MIN || input.scrap > this.validation.SCRAP.MAX) {
        throw new Error(this.validation.SCRAP.DESCRIPTION);
      }
    }

    if (input.defectRate !== undefined) {
      if (input.defectRate < this.validation.DEFECT_RATE.MIN || input.defectRate > this.validation.DEFECT_RATE.MAX) {
        throw new Error(this.validation.DEFECT_RATE.DESCRIPTION);
      }
    }

    if (input.quantity !== undefined) {
      if (input.quantity < this.validation.QUANTITY.MIN || input.quantity > this.validation.QUANTITY.MAX) {
        throw new Error(this.validation.QUANTITY.DESCRIPTION);
      }
    }

    if (input.moq !== undefined) {
      if (input.moq < this.validation.MOQ.MIN || input.moq > this.validation.MOQ.MAX) {
        throw new Error(this.validation.MOQ.DESCRIPTION);
      }
    }

    if (input.leadTimeDays !== undefined) {
      if (input.leadTimeDays < this.validation.LEAD_TIME.MIN || input.leadTimeDays > this.validation.LEAD_TIME.MAX) {
        throw new Error(this.validation.LEAD_TIME.DESCRIPTION);
      }
    }
  }

  /**
   * Normalize input values with defaults
   */
  private normalizeInput(input: ChildPartCostInput) {
    return {
      partNumber: input.partNumber ?? '',
      partName: input.partName ?? '',
      description: input.description ?? '',
      makeBuy: input.makeBuy,
      unitCost: input.unitCost ?? 0,
      freight: input.freight ?? this.defaults.FREIGHT,
      duty: input.duty ?? this.defaults.DUTY,
      overhead: input.overhead ?? this.defaults.OVERHEAD,
      rawMaterialCost: input.rawMaterialCost ?? 0,
      processCost: input.processCost ?? 0,
      scrap: input.scrap ?? this.defaults.SCRAP,
      defectRate: input.defectRate ?? this.defaults.DEFECT_RATE,
      quantity: input.quantity ?? this.defaults.QUANTITY,
      moq: input.moq ?? this.defaults.MOQ,
      leadTimeDays: input.leadTimeDays ?? this.defaults.LEAD_TIME,
      currency: input.currency ?? this.defaults.CURRENCY,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      supplierLocation: input.supplierLocation,
      notes: input.notes,
    };
  }

  /**
   * Calculate base cost depending on make/buy decision
   */
  private calculateBaseCost(normalized: ReturnType<typeof this.normalizeInput>) {
    let baseCost = 0;
    let rawMaterialCost: number | undefined;
    let processCost: number | undefined;

    if (normalized.makeBuy === MAKE_BUY_OPTIONS.BUY) {
      // For purchased parts, base cost is the unit cost
      baseCost = normalized.unitCost;
    } else {
      // For manufactured parts, base cost is sum of raw materials and processes
      rawMaterialCost = normalized.rawMaterialCost;
      processCost = normalized.processCost;
      baseCost = rawMaterialCost + processCost;
    }

    return {
      baseCost: this.round(baseCost, this.precision.COST),
      rawMaterialCost,
      processCost,
    };
  }

  /**
   * Calculate logistics costs (freight, duty, overhead)
   * Only applicable for purchased parts
   */
  private calculateLogisticsCosts(
    baseCost: number,
    makeBuy: 'make' | 'buy',
    freightPercentage: number,
    dutyPercentage: number,
    overheadPercentage: number
  ) {
    let freightCost = 0;
    let dutyCost = 0;
    let overheadCost = 0;

    if (makeBuy === MAKE_BUY_OPTIONS.BUY) {
      // Freight is applied to base cost
      freightCost = baseCost * (freightPercentage / 100);

      // Duty is applied to base + freight (landed cost)
      const costWithFreight = baseCost + freightCost;
      dutyCost = costWithFreight * (dutyPercentage / 100);

      // Overhead is applied to base + freight + duty
      const costWithFreightAndDuty = costWithFreight + dutyCost;
      overheadCost = costWithFreightAndDuty * (overheadPercentage / 100);
    }

    const costBeforeQuality = baseCost + freightCost + dutyCost + overheadCost;

    return {
      freightCost: this.round(freightCost, this.precision.COST),
      dutyCost: this.round(dutyCost, this.precision.COST),
      overheadCost: this.round(overheadCost, this.precision.COST),
      costBeforeQuality: this.round(costBeforeQuality, this.precision.COST),
    };
  }

  /**
   * Calculate quality adjustments (scrap and defect rate)
   *
   * Scrap: Parts lost during handling/installation
   * Defect: Parts that fail quality inspection
   *
   * Both increase the quantity needed to get good parts
   */
  private calculateQualityAdjustments(
    costBeforeQuality: number,
    scrapPercentage: number,
    defectRatePercentage: number
  ) {
    // Calculate scrap factor
    // If scrap is 2%, need to order 102 parts to get 100 usable
    const scrapFactor = scrapPercentage > 0 ? 1 / (1 - scrapPercentage / 100) : 1;

    // Calculate defect factor
    // If defect rate is 3%, only 97 out of 100 pass inspection
    const defectFactor = defectRatePercentage > 0 ? 1 / (1 - defectRatePercentage / 100) : 1;

    // Combined quality factor
    const qualityFactor = scrapFactor * defectFactor;

    // Final cost per part
    const totalCostPerPart = costBeforeQuality * qualityFactor;

    // Adjustment amounts
    const scrapAdjustment = costBeforeQuality * (scrapFactor - 1);
    const defectAdjustment = (costBeforeQuality + scrapAdjustment) * (defectFactor - 1);

    return {
      scrapFactor: this.round(scrapFactor, this.precision.PERCENTAGE),
      defectFactor: this.round(defectFactor, this.precision.PERCENTAGE),
      qualityFactor: this.round(qualityFactor, this.precision.PERCENTAGE),
      scrapAdjustment: this.round(scrapAdjustment, this.precision.COST),
      defectAdjustment: this.round(defectAdjustment, this.precision.COST),
      totalCostPerPart: this.round(totalCostPerPart, this.precision.COST),
    };
  }

  /**
   * Calculate quantity economics
   */
  private calculateQuantityEconomics(totalCostPerPart: number, quantity: number, moq: number) {
    const extendedCost = totalCostPerPart * quantity;
    const moqExtendedCost = totalCostPerPart * moq;

    return {
      extendedCost: this.round(extendedCost, this.precision.COST),
      moqExtendedCost: this.round(moqExtendedCost, this.precision.COST),
    };
  }

  /**
   * Calculate cost breakdown percentages for analysis
   */
  private calculateCostBreakdownPercentages(
    logisticsCalc: ReturnType<typeof this.calculateLogisticsCosts>,
    qualityCalc: ReturnType<typeof this.calculateQualityAdjustments>,
    baseCalc: ReturnType<typeof this.calculateBaseCost>,
    makeBuy: 'make' | 'buy'
  ) {
    const total = qualityCalc.totalCostPerPart;

    // Prevent division by zero
    if (total === 0) {
      return {
        freightPercentage: 0,
        dutyPercentage: 0,
        overheadPercentage: 0,
        scrapCostPercentage: 0,
        defectCostPercentage: 0,
        rawMaterialPercentage: 0,
        processCostPercentage: 0,
      };
    }

    const freightPercentage = (logisticsCalc.freightCost / total) * 100;
    const dutyPercentage = (logisticsCalc.dutyCost / total) * 100;
    const overheadPercentage = (logisticsCalc.overheadCost / total) * 100;
    const scrapCostPercentage = (qualityCalc.scrapAdjustment / total) * 100;
    const defectCostPercentage = (qualityCalc.defectAdjustment / total) * 100;

    let rawMaterialPercentage = 0;
    let processCostPercentage = 0;

    if (makeBuy === MAKE_BUY_OPTIONS.MAKE && baseCalc.rawMaterialCost !== undefined && baseCalc.processCost !== undefined) {
      rawMaterialPercentage = (baseCalc.rawMaterialCost / total) * 100;
      processCostPercentage = (baseCalc.processCost / total) * 100;
    }

    return {
      freightPercentage: this.round(freightPercentage, this.precision.PERCENTAGE),
      dutyPercentage: this.round(dutyPercentage, this.precision.PERCENTAGE),
      overheadPercentage: this.round(overheadPercentage, this.precision.PERCENTAGE),
      scrapCostPercentage: this.round(scrapCostPercentage, this.precision.PERCENTAGE),
      defectCostPercentage: this.round(defectCostPercentage, this.precision.PERCENTAGE),
      rawMaterialPercentage: this.round(rawMaterialPercentage, this.precision.PERCENTAGE),
      processCostPercentage: this.round(processCostPercentage, this.precision.PERCENTAGE),
    };
  }

  /**
   * Build final calculation result
   */
  private buildResult(
    normalized: ReturnType<typeof this.normalizeInput>,
    baseCalc: ReturnType<typeof this.calculateBaseCost>,
    logisticsCalc: ReturnType<typeof this.calculateLogisticsCosts>,
    qualityCalc: ReturnType<typeof this.calculateQualityAdjustments>,
    quantityCalc: ReturnType<typeof this.calculateQuantityEconomics>,
    percentages: ReturnType<typeof this.calculateCostBreakdownPercentages>
  ): ChildPartCostResult {
    const result: ChildPartCostResult = {
      // Input Summary
      partNumber: normalized.partNumber,
      partName: normalized.partName,
      makeBuy: normalized.makeBuy,
      currency: normalized.currency,

      // Base Cost
      baseCost: baseCalc.baseCost,

      // Logistics Costs
      freightCost: logisticsCalc.freightCost,
      dutyCost: logisticsCalc.dutyCost,
      overheadCost: logisticsCalc.overheadCost,
      costBeforeQuality: logisticsCalc.costBeforeQuality,

      // Quality Adjustments
      scrapPercentage: normalized.scrap,
      defectRatePercentage: normalized.defectRate,
      scrapAdjustment: qualityCalc.scrapAdjustment,
      defectAdjustment: qualityCalc.defectAdjustment,
      qualityFactor: qualityCalc.qualityFactor,

      // Final Costs
      totalCostPerPart: qualityCalc.totalCostPerPart,
      extendedCost: quantityCalc.extendedCost,

      // Quantity Economics
      quantity: normalized.quantity,
      moq: normalized.moq,
      leadTimeDays: normalized.leadTimeDays,
      moqExtendedCost: quantityCalc.moqExtendedCost,

      // Cost Breakdown Percentages
      freightPercentage: percentages.freightPercentage,
      dutyPercentage: percentages.dutyPercentage,
      overheadPercentage: percentages.overheadPercentage,
      scrapCostPercentage: percentages.scrapCostPercentage,
      defectCostPercentage: percentages.defectCostPercentage,
    };

    // Add manufactured part breakdowns if applicable
    if (normalized.makeBuy === MAKE_BUY_OPTIONS.MAKE) {
      result.rawMaterialCost = baseCalc.rawMaterialCost;
      result.processCost = baseCalc.processCost;
      result.rawMaterialPercentage = percentages.rawMaterialPercentage;
      result.processCostPercentage = percentages.processCostPercentage;
    }

    return result;
  }

  /**
   * Round number to specified decimal places
   * Using standard rounding for financial accuracy
   */
  private round(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }
}
