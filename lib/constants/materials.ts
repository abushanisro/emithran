// =============================================================================
// MATERIAL TYPES & CONSTANTS
// =============================================================================

// Material Categories
export type MaterialCategory = 'PLASTIC_RUBBER' | 'FERROUS_NON_FERROUS';

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

export const MATERIAL_CATEGORY_LABELS = {
  PLASTIC_RUBBER: 'Plastic & Rubber',
  FERROUS_NON_FERROUS: 'Ferrous & Non-Ferrous',
} as const;

export const COUNTRY_LABELS = {
  INDIA: 'India',
  US: 'United States',
  CHINA: 'China',
  NORTHERN_EUROPE: 'Northern Europe',
  WESTERN_EUROPE: 'Western Europe',
} as const;

export const CURRENCY_LABELS = {
  INR: 'Indian Rupee ($)',
  USD: 'US Dollar ($)',
  EUR: 'Euro (€)',
  CNY: 'Chinese Yuan (¥)',
  GBP: 'British Pound (£)',
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

export const SHAPE_CATEGORY_MAPPING = {
  GRANULES: ['PLASTIC_RUBBER'],
  PELLETS: ['PLASTIC_RUBBER'],
  POWDER: ['FERROUS_NON_FERROUS'],
  FLAKES: ['PLASTIC_RUBBER', 'FERROUS_NON_FERROUS'],
  SHEETS: ['PLASTIC_RUBBER', 'FERROUS_NON_FERROUS'],
  RODS: ['FERROUS_NON_FERROUS'],
  TUBES: ['FERROUS_NON_FERROUS'],
  PROFILES: ['FERROUS_NON_FERROUS'],
  INGOTS: ['FERROUS_NON_FERROUS'],
  BARS: ['FERROUS_NON_FERROUS'],
  PLATES: ['FERROUS_NON_FERROUS'],
  COILS: ['FERROUS_NON_FERROUS'],
  WIRE: ['FERROUS_NON_FERROUS'],
  FOAM: ['PLASTIC_RUBBER'],
  LIQUID: ['PLASTIC_RUBBER'],
} as const;

// Material property labels
export const MATERIAL_PROPERTY_LABELS = {
  density: 'Density (g/cm³)',
  ultimate_tensile_strength: 'Ultimate Tensile Strength (MPa)',
  yield_tensile_strength: 'Yield Tensile Strength (MPa)',
  shearing_strength: 'Shearing Strength (MPa)'
} as const;

// Standards labels
export const MATERIAL_STANDARDS_LABELS = {
  astm_standard: 'ASTM Standard',
  din_standard: 'DIN Standard',
  en_standard: 'EN Standard',
  jis_standard: 'JIS Standard'
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getCurrencyForCountry(country: Country): Currency {
  return COUNTRY_DEFAULT_CURRENCY[country];
}

