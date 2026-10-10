// =============================================================================
// MATERIAL TYPES & CONSTANTS
// =============================================================================

// Countries/Regions 
export type Country = 'INDIA' | 'US' | 'CHINA' | 'NORTHERN_EUROPE' | 'WESTERN_EUROPE';

// Currencies
export type Currency = 'INR' | 'USD' | 'EUR' | 'CNY' | 'GBP';

// Material Shapes
export type MaterialShape = 
  | 'GRANULES' | 'PELLETS' | 'POWDER' | 'FLAKES' 
  | 'SHEETS' | 'RODS' | 'TUBES' | 'PROFILES'
  | 'INGOTS' | 'BARS' | 'PLATES' | 'COILS' 
  | 'WIRE' | 'FOAM' | 'LIQUID';

// =============================================================================
// DISPLAY LABELS
// =============================================================================

export const COUNTRY_LABELS = {
  INDIA: 'India',
  US: 'United States',
  CHINA: 'China',
  NORTHERN_EUROPE: 'Northern Europe',
  WESTERN_EUROPE: 'Western Europe',
} as const;

export const CURRENCY_SYMBOLS = {
  INR: '$',
  USD: '$',
  EUR: '€',
  CNY: '¥',
  GBP: '£',
} as const;

export const MATERIAL_SHAPE_LABELS = {
  GRANULES: 'Granules',
  PELLETS: 'Pellets',
  POWDER: 'Powder',
  FLAKES: 'Flakes',
  SHEETS: 'Sheets',
  RODS: 'Rods',
  TUBES: 'Tubes',
  PROFILES: 'Profiles',
  INGOTS: 'Ingots',
  BARS: 'Bars',
  PLATES: 'Plates',
  COILS: 'Coils',
  WIRE: 'Wire',
  FOAM: 'Foam',
  LIQUID: 'Liquid',
} as const;

// =============================================================================
// BUSINESS RULES & MAPPINGS
// =============================================================================

export const COUNTRY_DEFAULT_CURRENCY = {
  INDIA: 'INR' as Currency,
  US: 'USD' as Currency,
  CHINA: 'CNY' as Currency,
  NORTHERN_EUROPE: 'EUR' as Currency,
  WESTERN_EUROPE: 'EUR' as Currency,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getCurrencyForCountry(country: Country): Currency {
  return COUNTRY_DEFAULT_CURRENCY[country];
}

