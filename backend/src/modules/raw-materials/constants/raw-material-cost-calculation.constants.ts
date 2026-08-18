/**
 * Raw Material Cost Calculation Constants (INR-Native)
 *
 * Industry-standard constants and validation rules for material costing
 * All monetary values in INR (₹)
 *
 * @author Manufacturing Cost Engineering Team
 * @version 2.0.0 (INR-Native)
 */

export const RAW_MATERIAL_COST_CONSTANTS = {
  /**
   * Precision settings for rounding calculations
   */
  PRECISION: {
    // 6 decimal places: costs are stored in USD per the engine's actual callers
    // (raw-material-cost.service.ts always resolves unitCost to USD before
    // calling calculate()). A cheap per-kg material in a low-value-currency
    // location (e.g. India, ~$0.0137/kg) produces sub-cent intermediate costs
    // (overheadCost ~$0.00005) that collapse to exactly 0 at 3-4 decimal
    // places — 6 keeps them representable. Matches the widened DECIMAL(18,6)
    // columns from migration 476.
    COST: 6,
    RATE: 6,
    USAGE: 2,           // 2 decimal places for usage amounts (e.g., 247.28 KG)
    PERCENTAGE: 2,      // 2 decimal places for percentages (e.g., 36.70%)
  },

  /**
   * Validation ranges for input parameters
   */
  VALIDATION: {
    UNIT_COST: {
      MIN: 0,
      MAX: 10000000,       // Maximum unit cost in INR (₹1 crore)
    },
    USAGE: {
      MIN: 0,
      MAX: 1000000000,    // Maximum usage amount
    },
    SCRAP: {
      MIN: 0,
      MAX: 100,           // Scrap percentage (0-100%)
    },
    OVERHEAD: {
      MIN: 0,
      MAX: 500,           // Overhead percentage (0-500%)
    },
    RECLAIM_RATE: {
      MIN: 0,
      MAX: 10000000,      // Maximum reclaim rate in INR
    },
  },

  /**
   * Default values
   */
  DEFAULTS: {
    RECLAIM_RATE: 0,
    UOM: 'KG',
    SCRAP: 0,
    OVERHEAD: 0,
  },

  /**
   * Common units of measure for Indian manufacturing
   */
  UNITS_OF_MEASURE: {
    // Weight (Mass)
    KG: 'Kilogram',
    G: 'Gram',
    MT: 'Metric Ton',      // Common in Indian industry
    QUINTAL: 'Quintal',    // 100 KG - common in India
    TON: 'Tonne',

    // Length
    M: 'Meter',
    CM: 'Centimeter',
    MM: 'Millimeter',
    FT: 'Foot',
    IN: 'Inch',

    // Area
    SQM: 'Square Meter',
    SQFT: 'Square Foot',

    // Volume
    L: 'Liter',
    ML: 'Milliliter',
    CUM: 'Cubic Meter',

    // Count
    EA: 'Each',
    PC: 'Piece',
    NOS: 'Numbers',        // Common in Indian industry
  } as const,

  /**
   * Material categories for Indian manufacturing
   */
  MATERIAL_CATEGORIES: {
    METALS_FERROUS: 'Metals - Ferrous',
    METALS_NON_FERROUS: 'Metals - Non Ferrous',
    PLASTICS: 'Plastics',
    COMPOSITES: 'Composites',
    RUBBER: 'Rubber',
    PAINT: 'Paint & Coatings',
    WOOD: 'Wood & Timber',
    CERAMICS: 'Ceramics',
    GLASS: 'Glass',
    TEXTILES: 'Textiles & Fabrics',
    CHEMICALS: 'Chemicals',
    ELECTRONICS: 'Electronic Components',
  } as const,

  /**
   * Common ferrous material types in India
   */
  FERROUS_TYPES: {
    STEEL_BILLET: 'Steel - Billet',
    STEEL_HOT_WORKED: 'Steel - Hot Worked',
    STEEL_COLD_DRAWN: 'Steel - Cold Drawn Bright',
    STAINLESS_STEEL: 'Stainless Steel',
    CAST_IRON: 'Cast Iron',
    MILD_STEEL: 'Mild Steel',
  } as const,

  /**
   * Common non-ferrous material types in India
   */
  NON_FERROUS_TYPES: {
    ALUMINUM: 'Aluminum',
    COPPER: 'Copper',
    BRASS: 'Brass',
    BRONZE: 'Bronze',
    ZINC: 'Zinc',
  } as const,
} as const;

/**
 * Helper function to format INR currency
 * Uses Indian numbering system with lakhs and crores
 *
 * @param amount Amount in INR
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string with ₹ symbol
 *
 * @example
 * formatINR(1234567.89) // "₹12,34,567.89"
 * formatINR(100000) // "₹1,00,000.00"
 */
export function formatINR(amount: number, decimals: number = 2): string {
  const absoluteAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  // Convert to string with specified decimals
  const fixedAmount = absoluteAmount.toFixed(decimals);
  const [integerPart, decimalPart] = fixedAmount.split('.');

  // Apply Indian number formatting (lakhs and crores)
  // Pattern: XX,XX,XXX.XX
  let formattedInteger: string;

  if (integerPart.length <= 3) {
    formattedInteger = integerPart;
  } else if (integerPart.length <= 5) {
    // Thousands: X,XXX
    formattedInteger = integerPart.slice(0, -3) + ',' + integerPart.slice(-3);
  } else if (integerPart.length <= 7) {
    // Lakhs: XX,XXX
    formattedInteger =
      integerPart.slice(0, -5) +
      ',' +
      integerPart.slice(-5, -3) +
      ',' +
      integerPart.slice(-3);
  } else {
    // Crores and above: X,XX,XX,XXX
    const lastThree = integerPart.slice(-3);
    const remaining = integerPart.slice(0, -3);
    const groups: string[] = [];

    // Add pairs from right to left
    for (let i = remaining.length; i > 0; i -= 2) {
      const start = Math.max(0, i - 2);
      groups.unshift(remaining.slice(start, i));
    }

    formattedInteger = groups.join(',') + ',' + lastThree;
  }

  return `${sign}₹${formattedInteger}.${decimalPart}`;
}

/**
 * Helper function to format percentage
 *
 * @param value Percentage value
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string with % symbol
 *
 * @example
 * formatPercentage(36.7) // "36.70%"
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Helper function to format unit of measure display
 *
 * @param value Amount value
 * @param uom Unit of measure
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted string with UOM
 *
 * @example
 * formatUOM(247.28, 'KG') // "247.28 KG"
 */
export function formatUOM(value: number, uom: string, decimals: number = 2): string {
  return `${value.toFixed(decimals)} ${uom}`;
}

/**
 * Helper function to get UOM full name
 *
 * @param uom Unit of measure code
 * @returns Full name of unit
 *
 * @example
 * getUOMName('KG') // "Kilogram"
 */
export function getUOMName(uom: string): string {
  const uoms = RAW_MATERIAL_COST_CONSTANTS.UNITS_OF_MEASURE;
  return uoms[uom as keyof typeof uoms] ?? uom;
}
