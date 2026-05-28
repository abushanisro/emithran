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
  INR: 'Indian Rupee (₹)',
  USD: 'US Dollar ($)',
  EUR: 'Euro (€)',
  CNY: 'Chinese Yuan (¥)',
  GBP: 'British Pound (£)',
} as const;

export const CURRENCY_SYMBOLS = {
  INR: '₹',
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

export const MATERIAL_SUBCATEGORIES = {
  PLASTIC_RUBBER: [
    'Thermoplastic',
    'Thermoset',
    'Elastomer',
    'Composite',
    'Bio-plastic',
    'Engineering Plastic',
  ],
  FERROUS_NON_FERROUS: [
    'Carbon Steel',
    'Alloy Steel',
    'Stainless Steel',
    'Cast Iron',
    'Wrought Iron',
    'Tool Steel',
    'Aluminum Alloy',
    'Copper Alloy',
    'Titanium Alloy',
    'Magnesium Alloy',
    'Zinc Alloy',
    'Nickel Alloy',
  ],
} as const;

// Chemical composition fields for ferrous and non-ferrous materials
export const CHEMICAL_COMPOSITION_FIELDS = [
  'iron_fe',
  'carbon_c',
  'chromium_cr',
  'manganese_mn',
  'molybdenum_mo',
  'phosphorous_p',
  'silicon_si',
  'sulfur_s',
  'nickel_ni',
  'aluminum_al',
  'copper_cu',
  'vanadium_v',
  'titanium_ti',
  'nitrogen_n',
  'zinc_zn',
  'magnesium_mg',
  'lead_pb',
  'tin_sn',
  'bismuth_bi',
  'cobalt_co',
  'tungsten_w',
  'silver_ag',
  'gold_au',
  'platinum_pt',
  'oxygen_o',
  'hydrogen_h',
  'palladium_pd',
  'niobium_nb',
  'beryllium_be',
  'antimony_sb',
  'residuals'
] as const;

// Chemical composition field labels
export const CHEMICAL_COMPOSITION_LABELS = {
  iron_fe: 'Iron, Fe',
  carbon_c: 'Carbon, C',
  chromium_cr: 'Chromium, Cr',
  manganese_mn: 'Manganese, Mn',
  molybdenum_mo: 'Molybdenum, Mo',
  phosphorous_p: 'Phosphorous, P',
  silicon_si: 'Silicon, Si',
  sulfur_s: 'Sulfur, S',
  nickel_ni: 'Nickel, Ni',
  aluminum_al: 'Aluminum, Al',
  copper_cu: 'Copper, Cu',
  vanadium_v: 'Vanadium, V',
  titanium_ti: 'Titanium, Ti',
  nitrogen_n: 'Nitrogen, N',
  zinc_zn: 'Zinc, Zn',
  magnesium_mg: 'Magnesium, Mg',
  lead_pb: 'Lead, Pb',
  tin_sn: 'Tin, Sn',
  bismuth_bi: 'Bismuth, Bi',
  cobalt_co: 'Cobalt, Co',
  tungsten_w: 'Tungsten, W',
  silver_ag: 'Silver, Ag',
  gold_au: 'Gold, Au',
  platinum_pt: 'Platinum, Pt',
  oxygen_o: 'Oxygen, O',
  hydrogen_h: 'Hydrogen, H',
  palladium_pd: 'Palladium, Pd',
  niobium_nb: 'Niobium, Nb',
  beryllium_be: 'Beryllium, Be',
  antimony_sb: 'Antimony, Sb',
  residuals: 'Residuals'
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

export function getCompatibleShapes(category: MaterialCategory): MaterialShape[] {
  return Object.entries(SHAPE_CATEGORY_MAPPING)
    .filter(([_, categories]) => (categories as readonly string[]).includes(category))
    .map(([shape]) => shape as MaterialShape);
}

export function isShapeCompatibleWithCategory(shape: MaterialShape, category: MaterialCategory): boolean {
  const compatibleCategories = SHAPE_CATEGORY_MAPPING[shape];
  return (compatibleCategories as readonly string[]).includes(category);
}

export function formatCurrency(amount: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  return `${symbol}${amount.toFixed(2)}`;
}