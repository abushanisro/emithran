/**
 * Process Cost Calculation Constants
 *
 * Industry-standard constants and validation rules for manufacturing process costing
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

export const PROCESS_COST_CONSTANTS = {
  /**
   * Precision settings for rounding calculations
   */
  PRECISION: {
    COST: 6,          // 6 decimal places for costs (e.g., 4.154452)
    RATE: 2,          // 2 decimal places for rates (e.g., 102.00)
    TIME: 4,          // 4 decimal places for time calculations
    PERCENTAGE: 4,    // 4 decimal places for percentages
  },

  /**
   * Time conversion constants
   */
  TIME: {
    MINUTES_PER_HOUR: 60,
    SECONDS_PER_HOUR: 3600,
    SECONDS_PER_MINUTE: 60,
    HOURS_PER_DAY: 24,
    DAYS_PER_YEAR: 365,
  },

  /**
   * Validation ranges for input parameters
   */
  VALIDATION: {
    RATES: {
      MIN: 0,
      MAX: 100000,         // Maximum rate per hour (currency/hour)
    },
    MANNING: {
      MIN: 0,
      MAX: 1000,           // Maximum number of workers
    },
    SETUP_TIME: {
      MIN: 0,
      MAX: 100000,         // Maximum setup time in minutes
    },
    BATCH_SIZE: {
      MIN: 1,              // At least 1 part per batch
      MAX: 100000000,      // Maximum batch size
    },
    HEADS: {
      MIN: 0,              // Can be zero for fully automated processes
      MAX: 1000,           // Maximum number of operators/stations
    },
    CYCLE_TIME: {
      // A cycle time is a continuous physical quantity, and the engines derive
      // it as one: roll bending computes rollFeedLengthMm / rollingSpeedMmPerSec
      // + prebendTimeSec, so a short feed at a real rolling speed produces a
      // genuinely sub-second cycle. High-speed presses are the same story at one
      // stroke per part. Nothing in the real physics models has a one-second
      // floor.
      //
      // MIN was 1, which rejected the engines' own output: a real live 3 Roll
      // Bending line persisted at 0.6 s, and every cost preview for it failed
      // validation and rendered as "$0.00" -- the calculator refusing the number
      // the router had just written. The only real lower bound is "greater than
      // zero", so it is expressed as an exclusive bound rather than a magnitude.
      EXCLUSIVE_MIN: 0,
      MAX: 1000000,        // Maximum cycle time in seconds
    },
    PARTS_PER_CYCLE: {
      MIN: 1,              // At least 1 part per cycle
      MAX: 100000,         // Maximum parts per cycle
    },
    SCRAP: {
      MIN: 0,              // Minimum scrap percentage
      MAX: 99.99,          // Maximum scrap percentage (cannot be 100%)
    },
  },

  /**
   * Default values (when not provided)
   */
  DEFAULTS: {
    INDIRECT_RATE: 0,
    FRINGE_RATE: 0,
    MACHINE_RATE: 0,
    CURRENCY: 'USD',
    SHIFT_HOURS_PER_DAY: 8,
  },

  /**
   * Currency definitions
   */
  CURRENCIES: {
    USD: { symbol: '$', name: 'US Dollar' },
    INR: { symbol: '₹', name: 'Indian Rupee' },
    EUR: { symbol: '€', name: 'Euro' },
    GBP: { symbol: '£', name: 'British Pound' },
    JPY: { symbol: '¥', name: 'Japanese Yen' },
    CNY: { symbol: '¥', name: 'Chinese Yuan' },
  },

  /**
   * Shift patterns (hours per day)
   */
  SHIFT_PATTERNS: {
    SINGLE_DAY_SHIFT: 8,          // 8 hours/day, 1 shift
    DOUBLE_DAY_SHIFT: 16,         // 16 hours/day, 2 shifts
    TRIPLE_SHIFT: 24,             // 24 hours/day, 3 shifts
    SINGLE_NIGHT_SHIFT: 8,        // 8 hours/day, night shift
    DOUBLE_WITH_NIGHT: 16,        // 16 hours/day, 2 shifts with night
  },
} as const;
