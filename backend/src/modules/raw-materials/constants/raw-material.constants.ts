/**
 * A raw material's class (raw_materials.material_class, migration 897): the
 * same three values as that column's CHECK constraint. The class of each
 * material_type lives in the material_type_classes table, never in code.
 */
export const MATERIAL_CLASSES = ['Ferrous', 'Non-Ferrous', 'Plastic & Rubber'] as const;
export type MaterialClass = (typeof MATERIAL_CLASSES)[number];

/** Stock shapes a raw material can be supplied in (CreateRawMaterialDto.shape). */
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

/** Currencies a raw material cost can be entered in (CreateRawMaterialDto.currency). */
export enum Currency {
  INR = 'INR',
  USD = 'USD',
  EUR = 'EUR',
  CNY = 'CNY',
  GBP = 'GBP',
}
