/**
 * MHR Calculation Constants
 * Industry-standard constants following manufacturing cost engineering best practices
 * Based on ISO 31000 and APQP guidelines
 */

// FX conversion for MHR/LSR pricing is sourced live from the `exchange_rates`
// table via common/exchange-rate/exchange-rate.service.ts (ExchangeRateService),
// not a hardcoded constant here — a hardcoded rate table drifts out of date and
// was the root cause of a currency-conversion bug that silently mispriced
// machines by the FX factor. Rates are admin-maintained in that table.

/** Infers currency code and symbol from a free-text location string. Defaults to USD. */
export function getCurrencyForLocation(location: string): { currency: string; symbol: string } {
  const loc = (location || '').toLowerCase();
  if (loc.includes('india') || loc.includes('bangalore') || loc.includes('chennai')
    || loc.includes('pune') || loc.includes('mumbai') || loc.includes('delhi')
    || loc.includes('hyderabad') || loc.includes('ahmedabad') || loc.includes('kolkata')) {
    return { currency: 'INR', symbol: '₹' };
  }
  if (loc.includes('china') || loc.includes('shanghai') || loc.includes('beijing')
    || loc.includes('shenzhen') || loc.includes('guangzhou') || loc.includes('chengdu')) {
    return { currency: 'CNY', symbol: '¥' };
  }
  if (loc.includes('germany') || loc.includes('france') || loc.includes('spain')
    || loc.includes('italy') || loc.includes('netherlands') || loc.includes('europe')
    || loc.includes('austria') || loc.includes('belgium') || loc.includes('portugal')
    || loc.includes('finland') || loc.includes('denmark') || loc.includes('sweden')
    || loc.includes('norway') || loc.includes('poland') || loc.includes('czech')
    || loc.includes('romania') || loc.includes('hungary') || loc.includes('slovakia')
    || loc.includes('w. europe') || loc.includes('e. europe') || loc.includes('eastern europe')
    || loc.includes('western europe')) {
    return { currency: 'EUR', symbol: '€' };
  }
  if (loc.includes('usa') || loc.includes('united states') || loc.includes('us -')
    || loc.includes('u.s.') || loc.includes('america')) {
    return { currency: 'USD', symbol: '$' };
  }
  if (loc.includes('uk') || loc.includes('united kingdom') || loc.includes('britain')
    || loc.includes('england') || loc.includes('scotland')) {
    return { currency: 'GBP', symbol: '£' };
  }
  if (loc.includes('japan')) return { currency: 'JPY', symbol: '¥' };
  if (loc.includes('mexico')) return { currency: 'MXN', symbol: 'MX$' };
  if (loc.includes('taiwan')) return { currency: 'TWD', symbol: 'NT$' };
  if (loc.includes('korea')) return { currency: 'KRW', symbol: '₩' };
  if (loc.includes('australia')) return { currency: 'AUD', symbol: 'A$' };
  if (loc.includes('canada')) return { currency: 'CAD', symbol: 'CA$' };
  if (loc.includes('brazil')) return { currency: 'BRL', symbol: 'R$' };
  if (loc.includes('turkey')) return { currency: 'TRY', symbol: '₺' };
  if (loc.includes('russia')) return { currency: 'RUB', symbol: '₽' };
  if (loc.includes('indonesia')) return { currency: 'IDR', symbol: 'Rp' };
  if (loc.includes('vietnam')) return { currency: 'VND', symbol: '₫' };
  if (loc.includes('thailand')) return { currency: 'THB', symbol: '฿' };
  if (loc.includes('malaysia')) return { currency: 'MYR', symbol: 'RM' };
  if (loc.includes('singapore')) return { currency: 'SGD', symbol: 'S$' };
  if (loc.includes('south africa')) return { currency: 'ZAR', symbol: 'R' };
  if (loc.includes('saudi') || loc.includes('riyadh')) return { currency: 'SAR', symbol: 'SR' };
  if (loc.includes('uae') || loc.includes('dubai') || loc.includes('abu dhabi')) return { currency: 'AED', symbol: 'AED' };
  return { currency: 'USD', symbol: '$' };
}

export const MHR_CALCULATION_CONSTANTS = {
  /**
   * Precision standards for financial calculations
   * Following standard accounting practices
   */
  PRECISION: {
    CURRENCY: 2, // Indian Rupees - 2 decimal places
    PERCENTAGE: 2, // Percentages - 2 decimal places
    HOURS: 2, // Hours - 2 decimal places
    RATE: 2, // Rates per hour - 2 decimal places
  },

  /**
   * Default values based on industry standards
   * Source: Manufacturing Industry Standards (India)
   */
  DEFAULTS: {
    SHIFTS_PER_DAY: 3,
    HOURS_PER_SHIFT: 8,
    WORKING_DAYS_PER_YEAR: 260, // Excluding Sundays and national holidays
    CAPACITY_UTILIZATION_RATE: 85, // Conservative industry average
    PAYBACK_PERIOD_YEARS: 15,    // 15yr aligns with Companies Act Sch-II for CNC/production machinery
    INTEREST_RATE: 8,            // Current MCLR + spread
    INSURANCE_RATE: 0.5,         // Standard industrial insurance (0.5% is typical for CNC)
    ACCESSORIES_COST_PERCENTAGE: 5,
    INSTALLATION_COST_PERCENTAGE: 12, // 12% realistic for domestic; use 18-20% for imports manually
    MAINTENANCE_COST_PERCENTAGE: 4,   // 4% aligns with Indian tool-room benchmarks (MSME/CMTI)
  },

  /**
   * Validation ranges based on manufacturing standards
   */
  VALIDATION_RANGES: {
    SHIFTS_PER_DAY: { min: 1, max: 3, message: 'Shifts must be between 1 and 3' },
    HOURS_PER_SHIFT: { min: 4, max: 12, message: 'Hours per shift must be between 4 and 12' },
    WORKING_DAYS_PER_YEAR: { min: 200, max: 365, message: 'Working days must be between 200 and 365' },
    CAPACITY_UTILIZATION_RATE: { min: 50, max: 100, message: 'Capacity utilization must be between 50% and 100%' },
    PAYBACK_PERIOD_YEARS: { min: 3, max: 25, message: 'Payback period must be between 3 and 25 years' },
    INTEREST_RATE: { min: 0, max: 30, message: 'Interest rate must be between 0% and 30%' },
    INSURANCE_RATE: { min: 0, max: 5, message: 'Insurance rate must be between 0% and 5%' },
    ACCESSORIES_COST_PERCENTAGE: { min: 0, max: 20, message: 'Accessories cost must be between 0% and 20%' },
    INSTALLATION_COST_PERCENTAGE: { min: 0, max: 40, message: 'Installation cost must be between 0% and 40%' },
    MAINTENANCE_COST_PERCENTAGE: { min: 1, max: 15, message: 'Maintenance cost must be between 1% and 15%' },
    ADMIN_OVERHEAD_PERCENTAGE: { min: 0, max: 30, message: 'Admin overhead must be between 0% and 30%' },
    PROFIT_MARGIN_PERCENTAGE: { min: 0, max: 50, message: 'Profit margin must be between 0% and 50%' },
  },

  /**
   * Cost category classifications
   * Following standard cost accounting principles
   */
  COST_CATEGORIES: {
    FIXED: {
      DEPRECIATION: 'Depreciation & Amortization',
      INTEREST: 'Interest on Capital Invested',
      INSURANCE: 'Insurance of Assets',
      RENT: 'Rent of Land & Building',
      MAINTENANCE: 'MRO & Consumables',
    },
    VARIABLE: {
      ELECTRICITY: 'Electricity Cost',
    },
    OVERHEAD: {
      ADMIN: 'General Admin Overhead',
    },
    MARGIN: {
      PROFIT: 'Profit Margin',
    },
  },

  /**
   * Calculation method identifiers
   */
  CALCULATION_METHODS: {
    DEPRECIATION: 'STRAIGHT_LINE', // As per Companies Act
    INTEREST: 'ON_DEPRECIATION', // Interest on annual depreciation amount
    INSTALLATION: 'ON_BASE_PLUS_ACCESSORIES', // Installation on (Landed + Accessories)
    MAINTENANCE: 'ON_TOTAL_CAPITAL', // Maintenance on total capital investment
  },

  /**
   * Error tolerance for floating point calculations
   */
  EPSILON: 0.01,

  /**
   * Time constants
   */
  TIME: {
    MONTHS_PER_YEAR: 12,
    WEEKS_PER_YEAR: 52,
  },
} as const;

/**
 * Type definitions for better type safety
 */
export type CostCategory = keyof typeof MHR_CALCULATION_CONSTANTS.COST_CATEGORIES;
export type FixedCostType = keyof typeof MHR_CALCULATION_CONSTANTS.COST_CATEGORIES.FIXED;
export type VariableCostType = keyof typeof MHR_CALCULATION_CONSTANTS.COST_CATEGORIES.VARIABLE;
