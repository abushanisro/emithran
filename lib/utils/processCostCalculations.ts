/**
 * Process Cost Calculations (Frontend Mirror)
 *
 * Client-side implementation of process cost calculations
 * Mirrors backend logic for real-time UI updates
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

/**
 * Constants for calculations
 */
const PRECISION = {
  COST: 6,
  RATE: 2,
  TIME: 4,
  PERCENTAGE: 4,
};

const TIME_CONSTANTS = {
  MINUTES_PER_HOUR: 60,
  SECONDS_PER_HOUR: 3600,
};

/**
 * Input parameters for process cost calculation
 */
export interface ProcessCostInput {
  // Facility Rates
  directRate: number;
  indirectRate?: number;
  fringeRate?: number;
  machineRate?: number;
  machineValue?: number;
  currency?: string;

  // Setup Parameters
  setupManning: number;
  setupTime: number; // minutes

  // Production Parameters
  batchSize: number;
  heads: number;
  cycleTime: number; // seconds
  partsPerCycle: number;

  // Quality Parameters
  scrap: number; // percentage
}

/**
 * Complete calculation result
 */
export interface ProcessCostResult {
  // Input Summary
  currency: string;
  directRate: number;
  indirectRate: number;
  fringeRate: number;
  machineRate: number;
  machineValue: number;
  totalLaborRate: number;

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
  scrapFactor: number;
  scrapAdjustment: number;
  totalCostPerPart: number;

  // Batch Economics
  batchSize: number;
  totalBatchCost: number;

  // Efficiency Metrics
  setupTimePercentage: number;
  cycleTimePercentage: number;
  scrapCostPercentage: number;
  laborCostPercentage: number;
  machineCostPercentage: number;
}

/**
 * Round number to specified decimal places
 */
function round(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Calculate time-related values
 */
function calculateTimeValues(
  setupTimeMinutes: number,
  cycleTimeSeconds: number,
  partsPerCycle: number
) {
  // Convert setup time from minutes to hours
  const setupTimeHours = setupTimeMinutes / TIME_CONSTANTS.MINUTES_PER_HOUR;

  // Convert cycle time from seconds to hours per part
  const cycleTimePerPartHours = (cycleTimeSeconds / TIME_CONSTANTS.SECONDS_PER_HOUR) / partsPerCycle;
  const cycleTimePerPartSeconds = cycleTimeSeconds / partsPerCycle;

  return {
    setupTimeHours: round(setupTimeHours, PRECISION.TIME),
    cycleTimePerPartHours: round(cycleTimePerPartHours, PRECISION.TIME),
    cycleTimePerPartSeconds: round(cycleTimePerPartSeconds, PRECISION.TIME),
  };
}

/**
 * Calculate setup costs
 */
function calculateSetupCosts(
  setupTimeHours: number,
  setupManning: number,
  directRate: number,
  indirectRate: number,
  fringeRate: number,
  machineRate: number,
  batchSize: number
) {
  // Labor cost during setup
  const setupLaborCost = setupTimeHours * setupManning * directRate;

  // Overhead costs during setup
  const setupOverheadCost = setupTimeHours * setupManning * (indirectRate + fringeRate);

  // Machine cost during setup
  const setupMachineCost = setupTimeHours * machineRate;

  // Total setup cost for batch
  const totalSetupCost = setupLaborCost + setupOverheadCost + setupMachineCost;

  // Allocate setup cost to each part
  const setupCostPerPart = totalSetupCost / batchSize;

  return {
    setupLaborCost: round(setupLaborCost, PRECISION.COST),
    setupOverheadCost: round(setupOverheadCost, PRECISION.COST),
    setupMachineCost: round(setupMachineCost, PRECISION.COST),
    totalSetupCost: round(totalSetupCost, PRECISION.COST),
    setupCostPerPart: round(setupCostPerPart, PRECISION.COST),
  };
}

/**
 * Calculate cycle costs (production run costs per part)
 */
function calculateCycleCosts(
  cycleTimePerPartHours: number,
  heads: number,
  directRate: number,
  indirectRate: number,
  fringeRate: number,
  machineRate: number
) {
  // Labor cost per part
  const cycleLaborCostPerPart = cycleTimePerPartHours * heads * directRate;

  // Overhead cost per part
  const cycleOverheadCostPerPart = cycleTimePerPartHours * heads * (indirectRate + fringeRate);

  // Machine cost per part
  const cycleMachineCostPerPart = cycleTimePerPartHours * machineRate;

  // Total cycle cost per part
  const totalCycleCostPerPart = cycleLaborCostPerPart + cycleOverheadCostPerPart + cycleMachineCostPerPart;

  return {
    cycleLaborCostPerPart: round(cycleLaborCostPerPart, PRECISION.COST),
    cycleOverheadCostPerPart: round(cycleOverheadCostPerPart, PRECISION.COST),
    cycleMachineCostPerPart: round(cycleMachineCostPerPart, PRECISION.COST),
    totalCycleCostPerPart: round(totalCycleCostPerPart, PRECISION.COST),
  };
}

/**
 * Calculate total cost with scrap adjustment
 */
function calculateTotalCosts(
  setupCostPerPart: number,
  cycleCostPerPart: number,
  scrapPercentage: number,
  batchSize: number
) {
  // Cost before scrap adjustment
  const totalCostBeforeScrap = setupCostPerPart + cycleCostPerPart;

  // Scrap factor
  const scrapFactor = 1 - (scrapPercentage / 100);

  // Prevent division by zero
  if (scrapFactor <= 0) {
    throw new Error('Scrap percentage cannot be 100% or greater');
  }

  // Final cost per part adjusted for scrap
  const totalCostPerPart = totalCostBeforeScrap / scrapFactor;

  // Additional cost due to scrap
  const scrapAdjustment = totalCostPerPart - totalCostBeforeScrap;

  // Total batch cost
  const totalBatchCost = totalCostPerPart * batchSize;

  return {
    totalCostBeforeScrap: round(totalCostBeforeScrap, PRECISION.COST),
    scrapFactor: round(scrapFactor, PRECISION.PERCENTAGE),
    scrapAdjustment: round(scrapAdjustment, PRECISION.COST),
    totalCostPerPart: round(totalCostPerPart, PRECISION.COST),
    totalBatchCost: round(totalBatchCost, PRECISION.COST),
  };
}

/**
 * Calculate efficiency metrics
 */
function calculateEfficiencyMetrics(
  setupCosts: ReturnType<typeof calculateSetupCosts>,
  cycleCosts: ReturnType<typeof calculateCycleCosts>,
  totalCosts: ReturnType<typeof calculateTotalCosts>
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

  // Cost breakdown percentages
  const setupTimePercentage = (setupCosts.setupCostPerPart / total) * 100;
  const cycleTimePercentage = (cycleCosts.totalCycleCostPerPart / total) * 100;
  const scrapCostPercentage = (totalCosts.scrapAdjustment / total) * 100;

  // Calculate total labor and machine costs
  const totalLaborCost = setupCosts.setupLaborCost + setupCosts.setupOverheadCost +
                        cycleCosts.cycleLaborCostPerPart + cycleCosts.cycleOverheadCostPerPart;
  const totalMachineCost = setupCosts.setupMachineCost + cycleCosts.cycleMachineCostPerPart;

  const laborCostPercentage = (totalLaborCost / total) * 100;
  const machineCostPercentage = (totalMachineCost / total) * 100;

  return {
    setupTimePercentage: round(setupTimePercentage, PRECISION.PERCENTAGE),
    cycleTimePercentage: round(cycleTimePercentage, PRECISION.PERCENTAGE),
    scrapCostPercentage: round(scrapCostPercentage, PRECISION.PERCENTAGE),
    laborCostPercentage: round(laborCostPercentage, PRECISION.PERCENTAGE),
    machineCostPercentage: round(machineCostPercentage, PRECISION.PERCENTAGE),
  };
}

/**
 * Main calculation function
 *
 * Calculates complete process cost breakdown
 *
 * @param input Process cost input parameters
 * @returns Complete process cost calculation result
 */
export function calculateProcessCost(input: ProcessCostInput): ProcessCostResult {
  // Normalize input with defaults
  const normalized = {
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

  // Step 1: Calculate time values
  const timeCalcs = calculateTimeValues(
    normalized.setupTime,
    normalized.cycleTime,
    normalized.partsPerCycle
  );

  // Step 2: Calculate setup costs
  const setupCosts = calculateSetupCosts(
    timeCalcs.setupTimeHours,
    normalized.setupManning,
    normalized.directRate,
    normalized.indirectRate,
    normalized.fringeRate,
    normalized.machineRate,
    normalized.batchSize
  );

  // Step 3: Calculate cycle costs
  const cycleCosts = calculateCycleCosts(
    timeCalcs.cycleTimePerPartHours,
    normalized.heads,
    normalized.directRate,
    normalized.indirectRate,
    normalized.fringeRate,
    normalized.machineRate
  );

  // Step 4: Calculate total costs with scrap
  const totalCosts = calculateTotalCosts(
    setupCosts.setupCostPerPart,
    cycleCosts.totalCycleCostPerPart,
    normalized.scrap,
    normalized.batchSize
  );

  // Step 5: Calculate efficiency metrics
  const metrics = calculateEfficiencyMetrics(setupCosts, cycleCosts, totalCosts);

  // Build final result
  const totalLaborRate = normalized.directRate + normalized.indirectRate + normalized.fringeRate;

  return {
    // Input Summary
    currency: normalized.currency,
    directRate: round(normalized.directRate, PRECISION.RATE),
    indirectRate: round(normalized.indirectRate, PRECISION.RATE),
    fringeRate: round(normalized.fringeRate, PRECISION.RATE),
    machineRate: round(normalized.machineRate, PRECISION.RATE),
    machineValue: round(normalized.machineValue, PRECISION.RATE),
    totalLaborRate: round(totalLaborRate, PRECISION.RATE),

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
 * Validate process cost input
 */
export function validateProcessCostInput(input: Partial<ProcessCostInput>): string[] {
  const errors: string[] = [];

  if (input.directRate !== undefined && (input.directRate < 0 || input.directRate > 100000)) {
    errors.push('Direct Rate must be between 0 and 100,000');
  }

  if (input.setupManning !== undefined && (input.setupManning < 0 || input.setupManning > 1000)) {
    errors.push('Setup Manning must be between 0 and 1,000');
  }

  if (input.setupTime !== undefined && (input.setupTime < 0 || input.setupTime > 100000)) {
    errors.push('Setup Time must be between 0 and 100,000 minutes');
  }

  if (input.batchSize !== undefined && (input.batchSize < 1 || input.batchSize > 100000000)) {
    errors.push('Batch Size must be between 1 and 100,000,000');
  }

  if (input.heads !== undefined && (input.heads < 0 || input.heads > 1000)) {
    errors.push('Heads must be between 0 and 1,000');
  }

  if (input.cycleTime !== undefined && (input.cycleTime < 1 || input.cycleTime > 1000000)) {
    errors.push('Cycle Time must be between 1 and 1,000,000 seconds');
  }

  if (input.partsPerCycle !== undefined && (input.partsPerCycle < 1 || input.partsPerCycle > 100000)) {
    errors.push('Parts Per Cycle must be between 1 and 100,000');
  }

  if (input.scrap !== undefined && (input.scrap < 0 || input.scrap >= 100)) {
    errors.push('Scrap % must be between 0 and 99.99');
  }

  return errors;
}

/**
 * Format currency value
 */
export function formatCurrency(value: number, currency: string = 'USD', decimals: number = 6): string {
  const currencySymbols: Record<string, string> = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
  };

  const symbol = currencySymbols[currency] || currency;
  return `${symbol}${value.toFixed(decimals)}`;
}

/**
 * Format percentage value
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}
