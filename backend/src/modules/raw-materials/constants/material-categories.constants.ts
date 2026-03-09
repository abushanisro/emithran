export enum MaterialCategory {
  PLASTIC_RUBBER = 'PLASTIC_RUBBER',
  FERROUS_NON_FERROUS = 'FERROUS_NON_FERROUS',
}

export const MATERIAL_CATEGORY_LABELS = {
  [MaterialCategory.PLASTIC_RUBBER]: 'Plastic & Rubber',
  [MaterialCategory.FERROUS_NON_FERROUS]: 'Ferrous & Non-Ferrous',
} as const;

export const MATERIAL_CATEGORY_DESCRIPTIONS = {
  [MaterialCategory.PLASTIC_RUBBER]: 'Thermoplastic and rubber-based materials including polymers, elastomers, and composites',
  [MaterialCategory.FERROUS_NON_FERROUS]: 'All metallic materials including iron-based materials (steel, cast iron, ferrous alloys) and non-iron metals (aluminum, copper, titanium, and their alloys)',
} as const;

export const PLASTIC_RUBBER_SUBTYPES = [
  'Thermoplastic',
  'Thermoset',
  'Elastomer',
  'Composite',
  'Bio-plastic',
  'Engineering Plastic',
] as const;

export const FERROUS_NON_FERROUS_SUBTYPES = [
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
] as const;

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

// Material property fields
export const MATERIAL_PROPERTY_FIELDS = [
  'density',
  'ultimate_tensile_strength',
  'yield_tensile_strength',
  'shearing_strength'
] as const;

// Standards fields
export const MATERIAL_STANDARDS_FIELDS = [
  'astm_standard',
  'din_standard',
  'en_standard',
  'jis_standard'
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

// Country filter constants
export enum Country {
  INDIA = 'INDIA',
  US = 'US',
  CHINA = 'CHINA',
  NORTHERN_EUROPE = 'NORTHERN_EUROPE',
  WESTERN_EUROPE = 'WESTERN_EUROPE',
}

export const COUNTRY_LABELS = {
  [Country.INDIA]: 'India',
  [Country.US]: 'United States',
  [Country.CHINA]: 'China',
  [Country.NORTHERN_EUROPE]: 'Northern Europe',
  [Country.WESTERN_EUROPE]: 'Western Europe',
} as const;

export const COUNTRY_REGIONS = {
  [Country.NORTHERN_EUROPE]: ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'],
  [Country.WESTERN_EUROPE]: ['Germany', 'France', 'Netherlands', 'Belgium', 'Switzerland', 'Austria'],
} as const;

// Shape filter constants
export enum MaterialShape {
  GRANULES = 'GRANULES',
  PELLETS = 'PELLETS',
  POWDER = 'POWDER',
  FLAKES = 'FLAKES',
  SHEETS = 'SHEETS',
  RODS = 'RODS',
  TUBES = 'TUBES',
  PROFILES = 'PROFILES',
  INGOTS = 'INGOTS',
  BARS = 'BARS',
  PLATES = 'PLATES',
  COILS = 'COILS',
  WIRE = 'WIRE',
  FOAM = 'FOAM',
  LIQUID = 'LIQUID',
}

export const MATERIAL_SHAPE_LABELS = {
  [MaterialShape.GRANULES]: 'Granules',
  [MaterialShape.PELLETS]: 'Pellets',
  [MaterialShape.POWDER]: 'Powder',
  [MaterialShape.FLAKES]: 'Flakes',
  [MaterialShape.SHEETS]: 'Sheets',
  [MaterialShape.RODS]: 'Rods',
  [MaterialShape.TUBES]: 'Tubes',
  [MaterialShape.PROFILES]: 'Profiles',
  [MaterialShape.INGOTS]: 'Ingots',
  [MaterialShape.BARS]: 'Bars',
  [MaterialShape.PLATES]: 'Plates',
  [MaterialShape.COILS]: 'Coils',
  [MaterialShape.WIRE]: 'Wire',
  [MaterialShape.FOAM]: 'Foam',
  [MaterialShape.LIQUID]: 'Liquid',
} as const;

// Material shape to category mapping
export const SHAPE_CATEGORY_MAPPING: Record<MaterialShape, MaterialCategory[]> = {
  [MaterialShape.GRANULES]: [MaterialCategory.PLASTIC_RUBBER],
  [MaterialShape.PELLETS]: [MaterialCategory.PLASTIC_RUBBER],
  [MaterialShape.POWDER]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.FLAKES]: [MaterialCategory.PLASTIC_RUBBER, MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.SHEETS]: [MaterialCategory.PLASTIC_RUBBER, MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.RODS]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.TUBES]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.PROFILES]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.INGOTS]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.BARS]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.PLATES]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.COILS]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.WIRE]: [MaterialCategory.FERROUS_NON_FERROUS],
  [MaterialShape.FOAM]: [MaterialCategory.PLASTIC_RUBBER],
  [MaterialShape.LIQUID]: [MaterialCategory.PLASTIC_RUBBER],
} as const;

// Currency constants
export enum Currency {
  INR = 'INR',
  USD = 'USD',
  EUR = 'EUR',
  CNY = 'CNY',
  GBP = 'GBP',
}

export const CURRENCY_LABELS = {
  [Currency.INR]: 'Indian Rupee (₹)',
  [Currency.USD]: 'US Dollar ($)',
  [Currency.EUR]: 'Euro (€)',
  [Currency.CNY]: 'Chinese Yuan (¥)',
  [Currency.GBP]: 'British Pound (£)',
} as const;

export const CURRENCY_SYMBOLS = {
  [Currency.INR]: '₹',
  [Currency.USD]: '$',
  [Currency.EUR]: '€',
  [Currency.CNY]: '¥',
  [Currency.GBP]: '£',
} as const;

// Default currency per country
export const COUNTRY_DEFAULT_CURRENCY = {
  [Country.INDIA]: Currency.INR,
  [Country.US]: Currency.USD,
  [Country.CHINA]: Currency.CNY,
  [Country.NORTHERN_EUROPE]: Currency.EUR,
  [Country.WESTERN_EUROPE]: Currency.EUR,
} as const;

export type PlasticRubberSubtype = typeof PLASTIC_RUBBER_SUBTYPES[number];
export type FerrousNonFerrousSubtype = typeof FERROUS_NON_FERROUS_SUBTYPES[number];
export type ChemicalCompositionField = typeof CHEMICAL_COMPOSITION_FIELDS[number];
export type MaterialPropertyField = typeof MATERIAL_PROPERTY_FIELDS[number];
export type MaterialStandardField = typeof MATERIAL_STANDARDS_FIELDS[number];
export type CountryType = keyof typeof COUNTRY_LABELS;
export type MaterialShapeType = keyof typeof MATERIAL_SHAPE_LABELS;
export type CurrencyType = keyof typeof CURRENCY_LABELS;

// Chemical composition range interface
export interface ChemicalCompositionRange {
  min?: number;
  max?: number;
}

// Complete chemical composition interface
export interface ChemicalComposition {
  iron_fe?: ChemicalCompositionRange;
  carbon_c?: ChemicalCompositionRange;
  chromium_cr?: ChemicalCompositionRange;
  manganese_mn?: ChemicalCompositionRange;
  molybdenum_mo?: ChemicalCompositionRange;
  phosphorous_p?: ChemicalCompositionRange;
  silicon_si?: ChemicalCompositionRange;
  sulfur_s?: ChemicalCompositionRange;
  nickel_ni?: ChemicalCompositionRange;
  aluminum_al?: ChemicalCompositionRange;
  copper_cu?: ChemicalCompositionRange;
  vanadium_v?: ChemicalCompositionRange;
  titanium_ti?: ChemicalCompositionRange;
  nitrogen_n?: ChemicalCompositionRange;
  zinc_zn?: ChemicalCompositionRange;
  magnesium_mg?: ChemicalCompositionRange;
  lead_pb?: ChemicalCompositionRange;
  tin_sn?: ChemicalCompositionRange;
  bismuth_bi?: ChemicalCompositionRange;
  cobalt_co?: ChemicalCompositionRange;
  tungsten_w?: ChemicalCompositionRange;
  silver_ag?: ChemicalCompositionRange;
  gold_au?: ChemicalCompositionRange;
  platinum_pt?: ChemicalCompositionRange;
  oxygen_o?: ChemicalCompositionRange;
  hydrogen_h?: ChemicalCompositionRange;
  palladium_pd?: ChemicalCompositionRange;
  niobium_nb?: ChemicalCompositionRange;
  beryllium_be?: ChemicalCompositionRange;
  antimony_sb?: ChemicalCompositionRange;
  residuals?: ChemicalCompositionRange;
}

// Material properties interface
export interface MaterialProperties {
  density?: number;
  ultimate_tensile_strength?: number;
  yield_tensile_strength?: number;
  shearing_strength?: number;
}

// Material standards interface
export interface MaterialStandards {
  astm_standard?: string;
  din_standard?: string;
  en_standard?: string;
  jis_standard?: string;
}