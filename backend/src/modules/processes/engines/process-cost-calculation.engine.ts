/**
 * Process Cost Calculation Engine
 *
 * Implements manufacturing process cost calculations following industry best practices:
 * - Standard Cost Accounting Principles
 * - Manufacturing Operations Cost Engineering
 * - Setup Cost Allocation
 * - Cycle Time Costing
 * - Scrap Factor Adjustments
 *
 * This engine separates calculation logic from business logic and provides
 * clean, testable, and maintainable code following SOLID principles.
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { PROCESS_COST_CONSTANTS } from '../constants/process-cost-calculation.constants';
import { eMithranTerms } from '../../bom-items/costing/shared/core/cost-engine';

/**
 * Input parameters for process cost calculation
 */
export interface ProcessCostInput {
  // Operation Identification
  opNbr?: number;

  // Facility Rate Information
  directRate: number;          // Labor cost per hour (currency/hour)
  indirectRate?: number;        // Indirect costs per hour (currency/hour)
  fringeRate?: number;          // Fringe benefits per hour (currency/hour)
  machineRate?: number;         // Machine/equipment cost per hour (currency/hour)
  machineValue?: number;        // Machine/equipment value (currency)
  currency?: string;            // Currency code (e.g., 'INR', 'USD')

  // Shift Pattern (affects available hours)
  shiftPatternHoursPerDay?: number;   // Hours per day based on shift pattern

  // Setup Parameters
  setupManning: number;         // Number of workers during setup
  setupTime: number;            // Setup time in minutes

  // Production Parameters
  batchSize: number;            // Number of parts in batch
  heads: number;                // Number of operators/stations during production
  cycleTime: number;            // Cycle time in seconds
  partsPerCycle: number;        // Parts produced per cycle

  // Quality Parameters
  scrap: number;                // Scrap percentage (0-100)

  // Optional Facility Information
  facilityCategory?: string;
  facilityType?: string;
  supplierName?: string;
  supplierLocation?: string;
  facilityId?: string;
  facilityRateId?: string;
  shiftPatternId?: string;
}

/**
 * Detailed cost breakdown result
 */
export interface ProcessCostResult {
  // Input Summary
  operationNumber: number;
  currency: string;

  // Facility Rate Summary
  directRate: number;
  indirectRate: number;
  fringeRate: number;
  machineRate: number;
  machineValue: number;
  totalLaborRate: number;       // Direct + Indirect + Fringe

  // Time Calculations
  setupTimeHours: number;
  cycleTimePerPartHours: number;
  cycleTimePerPartSeconds: number;

  // Setup Cost Breakdown
  setupLaborCost: number;
  setupOverheadCost: number;
  setupMachineCost: number;
  totalSetupCost: number;
  setupCostPerPart: number;

  // Cycle Cost Breakdown
  cycleLaborCostPerPart: number;
  cycleOverheadCostPerPart: number;
  cycleMachineCostPerPart: number;
  totalCycleCostPerPart: number;

  // Total Cost Calculations
  totalCostBeforeScrap: number;
  scrapFactor: number;          // Divisor: (1 - scrap% / 100)
  scrapAdjustment: number;      // Additional cost due to scrap
  totalCostPerPart: number;     // Final cost per part

  // Batch Economics
  batchSize: number;
  totalBatchCost: number;       // Total cost for entire batch

  // Efficiency Metrics
  setupTimePercentage: number;  // Setup cost as % of total
  cycleTimePercentage: number;  // Cycle cost as % of total
  scrapCostPercentage: number;  // Scrap cost as % of total
  laborCostPercentage: number;  // Labor cost as % of total
  machineCostPercentage: number; // Machine cost as % of total
}

/**
 * Process Cost Calculation Engine
 *
 * Implements simplified manufacturing cost formulas:
 *
 * 1. Setup Cost:
 *    - Setup Cost = (Setup time in hr × (MHR + LHR)) / Batch Size
 *    - Where: LHR = Labor Hour Rate, MHR = Machine Hour Rate
 *
 * 2. Labour Cost:
 *    - Labour Cost = LHR × Cycle time in hr
 *
 * 3. Machine Cost:
 *    - Machine Cost = MHR × Cycle Time in hr
 *
 * 4. Total Cost:
 *    - Total Cost = Setup Cost + Labour Cost + Machine Cost
 */
export class ProcessCostCalculationEngine {
  private readonly precision = PROCESS_COST_CONSTANTS.PRECISION;
  private readonly time = PROCESS_COST_CONSTANTS.TIME;

  /**
   * Main calculation method for process cost engineering
   *
   * @param input Process cost input parameters
   * @returns Complete process cost calculation result
   */
  calculate(input: ProcessCostInput): ProcessCostResult {
    // Validate input
    this.validateInput(input);

    // Step 1: Extract and normalize input values
    const normalized = this.normalizeInput(input);

    // Step 2: Calculate time values
    const timeCalcs = this.calculateTimeValues(
      normalized.setupTime,
      normalized.cycleTime,
      normalized.partsPerCycle
    );

    // Steps 3-5: Setup / cycle / total cost, all via the shared eMithranTerms() kernel —
    // the same arithmetic the automated (CAD-geometry-driven) cost engine uses, so
    // setupManning, heads, and scrap% actually drive the total instead of being
    // validated-but-unused inputs.
    const { setupCosts, cycleCosts, totalCosts } = this.calculateCosts(normalized, timeCalcs);

    // Step 6: Calculate efficiency metrics
    const metrics = this.calculateEfficiencyMetrics(
      setupCosts,
      cycleCosts,
      totalCosts,
      normalized.directRate,
      normalized.indirectRate,
      normalized.fringeRate,
      normalized.machineRate
    );

    // Step 7: Build and return final result
    return this.buildResult(
      normalized,
      timeCalcs,
      setupCosts,
      cycleCosts,
      totalCosts,
      metrics
    );
  }

  /**
   * Validate input parameters
   */
  private validateInput(input: ProcessCostInput): void {
    const validation = PROCESS_COST_CONSTANTS.VALIDATION;

    if (input.directRate < validation.RATES.MIN || input.directRate > validation.RATES.MAX) {
      throw new Error(`Direct Rate must be between ${validation.RATES.MIN} and ${validation.RATES.MAX}`);
    }

    if (input.setupManning < validation.MANNING.MIN || input.setupManning > validation.MANNING.MAX) {
      throw new Error(`Setup Manning must be between ${validation.MANNING.MIN} and ${validation.MANNING.MAX}`);
    }

    if (input.setupTime < validation.SETUP_TIME.MIN || input.setupTime > validation.SETUP_TIME.MAX) {
      throw new Error(`Setup Time must be between ${validation.SETUP_TIME.MIN} and ${validation.SETUP_TIME.MAX} minutes`);
    }

    if (input.batchSize < validation.BATCH_SIZE.MIN || input.batchSize > validation.BATCH_SIZE.MAX) {
      throw new Error(`Batch Size must be between ${validation.BATCH_SIZE.MIN} and ${validation.BATCH_SIZE.MAX}`);
    }

    if (input.heads < validation.HEADS.MIN || input.heads > validation.HEADS.MAX) {
      throw new Error(`Heads must be between ${validation.HEADS.MIN} and ${validation.HEADS.MAX}`);
    }

    if (input.cycleTime < validation.CYCLE_TIME.MIN || input.cycleTime > validation.CYCLE_TIME.MAX) {
      throw new Error(`Cycle Time must be between ${validation.CYCLE_TIME.MIN} and ${validation.CYCLE_TIME.MAX} seconds`);
    }

    if (input.partsPerCycle < validation.PARTS_PER_CYCLE.MIN || input.partsPerCycle > validation.PARTS_PER_CYCLE.MAX) {
      throw new Error(`Parts Per Cycle must be between ${validation.PARTS_PER_CYCLE.MIN} and ${validation.PARTS_PER_CYCLE.MAX}`);
    }

    if (input.scrap < validation.SCRAP.MIN || input.scrap > validation.SCRAP.MAX) {
      throw new Error(`Scrap % must be between ${validation.SCRAP.MIN} and ${validation.SCRAP.MAX}`);
    }
  }

  /**
   * Normalize input values with defaults
   */
  private normalizeInput(input: ProcessCostInput) {
    return {
      opNbr: input.opNbr ?? 0,
      directRate: input.directRate,
      indirectRate: input.indirectRate ?? 0,
      fringeRate: input.fringeRate ?? 0,
      machineRate: input.machineRate ?? 0,
      machineValue: input.machineValue ?? 0,
      currency: input.currency ?? 'USD',
      setupManning: input.setupManning,
      setupTime: input.setupTime,
      batchSize: input.batchSize,
      heads: input.heads,
      cycleTime: input.cycleTime,
      partsPerCycle: input.partsPerCycle,
      scrap: input.scrap,
    };
  }

  /**
   * Calculate time-related values
   *
   * Conversions:
   * - Setup Time: minutes → hours
   * - Cycle Time: seconds → hours per part
   */
  private calculateTimeValues(
    setupTimeMinutes: number,
    cycleTimeSeconds: number,
    partsPerCycle: number
  ) {
    // Convert setup time from minutes to hours
    const setupTimeHours = setupTimeMinutes / this.time.MINUTES_PER_HOUR;

    // Convert cycle time from seconds to hours per part
    const cycleTimePerPartHours = (cycleTimeSeconds / this.time.SECONDS_PER_HOUR) / partsPerCycle;
    const cycleTimePerPartSeconds = cycleTimeSeconds / partsPerCycle;

    return {
      setupTimeHours: this.round(setupTimeHours, this.precision.TIME),
      cycleTimePerPartHours: this.round(cycleTimePerPartHours, this.precision.TIME),
      cycleTimePerPartSeconds: this.round(cycleTimePerPartSeconds, this.precision.TIME),
    };
  }

  /**
   * Setup / cycle / total cost — all via eMithranTerms(), the same kernel the
   * automated (CAD-geometry-driven) cost engine uses. setupManning and heads are
   * distinct, real headcounts (setup crew vs. run crew) mapped onto eMithranTerms'
   * setupNDL/cycleNDL; scrap% inflates the effective process cost per good part
   * (no material cost is tracked at this line level — that belongs to the BOM's
   * overall material costing) instead of being a validated-but-silent no-op.
   */
  private calculateCosts(
    normalized: ReturnType<typeof this.normalizeInput>,
    timeCalcs: ReturnType<typeof this.calculateTimeValues>,
  ) {
    const MHR = normalized.machineRate;
    // Total burdened labor rate — direct + indirect + fringe, all real cost components.
    const LHR = normalized.directRate + normalized.indirectRate + normalized.fringeRate;

    const setupTimeMinPerPart = normalized.setupTime / Math.max(normalized.batchSize, 1);
    const cycleTimeMinPerPart = timeCalcs.cycleTimePerPartHours * this.time.MINUTES_PER_HOUR;

    const terms = eMithranTerms({
      mhrPerHr: MHR,
      dlrPerHr: LHR,
      qairPerHr: 0,
      setupNDL: normalized.setupManning,
      cycleNDL: normalized.heads,
      cycleTimeMin: cycleTimeMinPerPart,
      setupTimeMin: setupTimeMinPerPart,
      inspTimeMin: 0,
      samplingRate: 0,
      yieldPct: 1 - normalized.scrap / 100,
      netMatCost: 0,
      netWeightKg: 0,
      scrapPricePerKg: 0,
    });

    const mhrMin = MHR / 60;
    const dlrMin = LHR / 60;

    const setupCosts = {
      setupLaborCost: this.round(dlrMin * normalized.setupManning * setupTimeMinPerPart, this.precision.COST),
      setupOverheadCost: 0,
      setupMachineCost: this.round(mhrMin * setupTimeMinPerPart, this.precision.COST),
      totalSetupCost: this.round(terms.setupCost, this.precision.COST),
      setupCostPerPart: this.round(terms.setupCost, this.precision.COST),
    };

    const cycleCosts = {
      cycleLaborCostPerPart: this.round(dlrMin * normalized.heads * cycleTimeMinPerPart, this.precision.COST),
      cycleOverheadCostPerPart: 0,
      cycleMachineCostPerPart: this.round(mhrMin * cycleTimeMinPerPart, this.precision.COST),
      totalCycleCostPerPart: this.round(terms.machineCost + terms.laborCost, this.precision.COST),
    };

    const totalCostPerPart = this.round(terms.total, this.precision.COST);
    const scrapAdjustment = this.round(terms.yieldCost, this.precision.COST);
    const totalCosts = {
      totalCostBeforeScrap: this.round(terms.total - terms.yieldCost, this.precision.COST),
      scrapFactor: this.round(normalized.scrap > 0 ? 1 / (1 - normalized.scrap / 100) : 1, this.precision.PERCENTAGE),
      scrapAdjustment,
      totalCostPerPart,
      totalBatchCost: this.round(totalCostPerPart * normalized.batchSize, this.precision.COST),
    };

    return { setupCosts, cycleCosts, totalCosts };
  }

  /**
   * Calculate efficiency metrics for analysis (simplified approach)
   */
  private calculateEfficiencyMetrics(
    setupCosts: ReturnType<typeof this.calculateCosts>['setupCosts'],
    cycleCosts: ReturnType<typeof this.calculateCosts>['cycleCosts'],
    totalCosts: ReturnType<typeof this.calculateCosts>['totalCosts'],
    directRate: number,
    indirectRate: number,
    fringeRate: number,
    machineRate: number
  ) {
    const total = totalCosts.totalCostPerPart;

    // Prevent division by zero
    if (total === 0) {
      return {
        setupTimePercentage: 0,
        cycleTimePercentage: 0,
        scrapCostPercentage: 0,
        laborCostPercentage: 0,
        machineCostPercentage: 0,
      };
    }

    // Cost breakdown percentages for simplified formula
    const setupTimePercentage = (setupCosts.setupCostPerPart / total) * 100;
    const cycleTimePercentage = (cycleCosts.totalCycleCostPerPart / total) * 100;
    const scrapCostPercentage = (totalCosts.scrapAdjustment / total) * 100;

    // Calculate labor and machine costs based on simplified approach
    const totalLaborCost = cycleCosts.cycleLaborCostPerPart; // Only cycle labor cost  
    const totalMachineCost = cycleCosts.cycleMachineCostPerPart; // Only cycle machine cost

    const laborCostPercentage = (totalLaborCost / total) * 100;
    const machineCostPercentage = (totalMachineCost / total) * 100;

    return {
      setupTimePercentage: this.round(setupTimePercentage, this.precision.PERCENTAGE),
      cycleTimePercentage: this.round(cycleTimePercentage, this.precision.PERCENTAGE),
      scrapCostPercentage: this.round(scrapCostPercentage, this.precision.PERCENTAGE),
      laborCostPercentage: this.round(laborCostPercentage, this.precision.PERCENTAGE),
      machineCostPercentage: this.round(machineCostPercentage, this.precision.PERCENTAGE),
    };
  }

  /**
   * Build final calculation result
   */
  private buildResult(
    normalized: ReturnType<typeof this.normalizeInput>,
    timeCalcs: ReturnType<typeof this.calculateTimeValues>,
    setupCosts: ReturnType<typeof this.calculateCosts>['setupCosts'],
    cycleCosts: ReturnType<typeof this.calculateCosts>['cycleCosts'],
    totalCosts: ReturnType<typeof this.calculateCosts>['totalCosts'],
    metrics: ReturnType<typeof this.calculateEfficiencyMetrics>
  ): ProcessCostResult {
    const totalLaborRate = normalized.directRate + normalized.indirectRate + normalized.fringeRate;

    return {
      // Input Summary
      operationNumber: normalized.opNbr,
      currency: normalized.currency,

      // Facility Rate Summary
      directRate: this.round(normalized.directRate, this.precision.RATE),
      indirectRate: this.round(normalized.indirectRate, this.precision.RATE),
      fringeRate: this.round(normalized.fringeRate, this.precision.RATE),
      machineRate: this.round(normalized.machineRate, this.precision.RATE),
      machineValue: this.round(normalized.machineValue, this.precision.RATE),
      totalLaborRate: this.round(totalLaborRate, this.precision.RATE),

      // Time Calculations
      setupTimeHours: timeCalcs.setupTimeHours,
      cycleTimePerPartHours: timeCalcs.cycleTimePerPartHours,
      cycleTimePerPartSeconds: timeCalcs.cycleTimePerPartSeconds,

      // Setup Cost Breakdown
      setupLaborCost: setupCosts.setupLaborCost,
      setupOverheadCost: setupCosts.setupOverheadCost,
      setupMachineCost: setupCosts.setupMachineCost,
      totalSetupCost: setupCosts.totalSetupCost,
      setupCostPerPart: setupCosts.setupCostPerPart,

      // Cycle Cost Breakdown
      cycleLaborCostPerPart: cycleCosts.cycleLaborCostPerPart,
      cycleOverheadCostPerPart: cycleCosts.cycleOverheadCostPerPart,
      cycleMachineCostPerPart: cycleCosts.cycleMachineCostPerPart,
      totalCycleCostPerPart: cycleCosts.totalCycleCostPerPart,

      // Total Cost Calculations
      totalCostBeforeScrap: totalCosts.totalCostBeforeScrap,
      scrapFactor: totalCosts.scrapFactor,
      scrapAdjustment: totalCosts.scrapAdjustment,
      totalCostPerPart: totalCosts.totalCostPerPart,

      // Batch Economics
      batchSize: normalized.batchSize,
      totalBatchCost: totalCosts.totalBatchCost,

      // Efficiency Metrics
      setupTimePercentage: metrics.setupTimePercentage,
      cycleTimePercentage: metrics.cycleTimePercentage,
      scrapCostPercentage: metrics.scrapCostPercentage,
      laborCostPercentage: metrics.laborCostPercentage,
      machineCostPercentage: metrics.machineCostPercentage,
    };
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
