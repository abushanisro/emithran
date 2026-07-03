/**
 * Child Part Cost Calculation Constants
 *
 * Industry-standard constants and validation rules for child part cost calculations.
 * Following manufacturing cost accounting principles for purchased and manufactured child parts.
 */

/**
 * Precision constants for decimal places in calculations
 */
export const CHILD_PART_COST_PRECISION = {
  COST: 6,           // Cost values (₹123.456789)
  RATE: 2,           // Rates and unit costs (₹12.34)
  PERCENTAGE: 4,     // Percentages (12.3456%)
  QUANTITY: 4,       // Quantities (123.4567 units)
  TIME: 2,           // Lead time in days (15.50 days)
} as const;

/**
 * Default values for optional parameters
 */
export const CHILD_PART_COST_DEFAULTS = {
  CURRENCY: 'USD',
  FREIGHT: 0,
  DUTY: 0,
  OVERHEAD: 0,
  SCRAP: 0,
  DEFECT_RATE: 0,
  QUANTITY: 1,
  LEAD_TIME: 0,
  MOQ: 1,
} as const;

/**
 * Validation ranges for input parameters
 */
export const CHILD_PART_COST_VALIDATION = {
  // Cost ranges
  UNIT_COST: {
    MIN: 0,
    MAX: 1000000,
    DESCRIPTION: 'Unit cost must be between ₹0 and ₹1,000,000',
  },

  // Quantity ranges
  QUANTITY: {
    MIN: 0.0001,
    MAX: 1000000,
    DESCRIPTION: 'Quantity must be between 0.0001 and 1,000,000 units',
  },

  // Percentage ranges (0-100%)
  PERCENTAGE: {
    MIN: 0,
    MAX: 100,
    DESCRIPTION: 'Percentage must be between 0% and 100%',
  },

  // Freight and duty
  FREIGHT: {
    MIN: 0,
    MAX: 100,
    DESCRIPTION: 'Freight percentage must be between 0% and 100%',
  },

  DUTY: {
    MIN: 0,
    MAX: 100,
    DESCRIPTION: 'Duty percentage must be between 0% and 100%',
  },

  // Overhead
  OVERHEAD: {
    MIN: 0,
    MAX: 500,
    DESCRIPTION: 'Overhead percentage must be between 0% and 500%',
  },

  // Quality parameters
  SCRAP: {
    MIN: 0,
    MAX: 50,
    DESCRIPTION: 'Scrap percentage must be between 0% and 50%',
  },

  DEFECT_RATE: {
    MIN: 0,
    MAX: 50,
    DESCRIPTION: 'Defect rate must be between 0% and 50%',
  },

  // Lead time
  LEAD_TIME: {
    MIN: 0,
    MAX: 365,
    DESCRIPTION: 'Lead time must be between 0 and 365 days',
  },

  // Minimum order quantity
  MOQ: {
    MIN: 1,
    MAX: 1000000,
    DESCRIPTION: 'MOQ must be between 1 and 1,000,000 units',
  },
} as const;

/**
 * Error messages for validation failures
 */
export const CHILD_PART_COST_ERROR_MESSAGES = {
  INVALID_UNIT_COST: 'Invalid unit cost value',
  INVALID_QUANTITY: 'Invalid quantity value',
  INVALID_FREIGHT: 'Invalid freight percentage',
  INVALID_DUTY: 'Invalid duty percentage',
  INVALID_OVERHEAD: 'Invalid overhead percentage',
  INVALID_SCRAP: 'Invalid scrap percentage',
  INVALID_DEFECT_RATE: 'Invalid defect rate',
  INVALID_LEAD_TIME: 'Invalid lead time',
  INVALID_MOQ: 'Invalid minimum order quantity',
  MISSING_COST_INPUT: 'Either unitCost (for purchased parts) or rawMaterialCost + processCost (for manufactured parts) must be provided',
  NEGATIVE_COST: 'Calculated cost cannot be negative',
} as const;

/**
 * Supported currencies
 */
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'] as const;

/**
 * Supported unit of measure
 */
export const SUPPORTED_UOM = [
  'EA',    // Each (default for child parts)
  'SET',   // Set
  'KIT',   // Kit
  'ASSY',  // Assembly
  'PC',    // Piece
] as const;

/**
 * Make/Buy options
 */
export const MAKE_BUY_OPTIONS = {
  BUY: 'buy',
  MAKE: 'make',
} as const;

/**
 * Cost component identifiers
 */
export const COST_COMPONENTS = {
  BASE_COST: 'baseCost',
  FREIGHT_COST: 'freightCost',
  DUTY_COST: 'dutyCost',
  OVERHEAD_COST: 'overheadCost',
  SCRAP_ADJUSTMENT: 'scrapAdjustment',
  DEFECT_ADJUSTMENT: 'defectAdjustment',
  TOTAL_COST: 'totalCost',
} as const;
