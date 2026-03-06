export enum MaterialCategory {
  PLASTIC_RUBBER = 'PLASTIC_RUBBER',
  FERROUS = 'FERROUS',
}

export const MATERIAL_CATEGORY_LABELS = {
  [MaterialCategory.PLASTIC_RUBBER]: 'Plastic & Rubber',
  [MaterialCategory.FERROUS]: 'Ferrous Materials',
} as const;

export const MATERIAL_CATEGORY_DESCRIPTIONS = {
  [MaterialCategory.PLASTIC_RUBBER]: 'Thermoplastic and rubber-based materials including polymers, elastomers, and composites',
  [MaterialCategory.FERROUS]: 'Iron-based materials including steel, cast iron, and ferrous alloys',
} as const;

export const PLASTIC_RUBBER_SUBTYPES = [
  'Thermoplastic',
  'Thermoset',
  'Elastomer',
  'Composite',
  'Bio-plastic',
  'Engineering Plastic',
] as const;

export const FERROUS_SUBTYPES = [
  'Carbon Steel',
  'Alloy Steel',
  'Stainless Steel',
  'Cast Iron',
  'Wrought Iron',
  'Tool Steel',
] as const;

export type PlasticRubberSubtype = typeof PLASTIC_RUBBER_SUBTYPES[number];
export type FerrousSubtype = typeof FERROUS_SUBTYPES[number];