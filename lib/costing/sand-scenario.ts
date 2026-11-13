// The Cost Guide choices of a sand casting. The keys and the process names are the backend's (sand/sand-cost.ts, sand-route.ts): a name
// that is not one of these is ignored by the engine, so the lists below are the whole vocabulary.

export const SAND_SCENARIO_KEYS = {
  mouldingProcess: 'sandMouldingProcess',
  coreProcess: 'sandCoreProcess',
  energyPrice: 'energyPriceUsdPerKwh',
  cavities: 'cavityCount',
  hotBoxCoreboxTemp: 'hotBoxCoreboxTempC',
  hotBoxCureTemp: 'hotBoxCureTempC',
  hotBoxCuredDepth: 'hotBoxCuredDepthMm',
  refractoryCoat: 'sandRefractoryCoat',
  refractoryDryMethod: 'sandRefractoryDryMethod',
  refractoryDryMinutes: 'sandRefractoryDryMinutes',
  refractoryCoatPrice: 'refractoryCoatingUsdPerKg',
} as const;

/** What can be coated (backend sand-refractory.ts): nothing unless chosen. The values are the backend's. */
export const REFRACTORY_COAT_CHOICES = [
  { value: 'none', label: 'Not coated' },
  { value: 'mould', label: 'The mould' },
  { value: 'cores', label: 'The cores' },
  { value: 'both', label: 'The mould and the cores' },
] as const;

export const REFRACTORY_DRY_METHODS = [
  { value: 'oven', label: 'Oven' },
  { value: 'air', label: 'Air dry' },
] as const;

/**
 * What the coating takes from the plant: the data defines the coating (method, rate, output, density, preparation, beds) and its drying times
 * (defaultOvenDryAndCoolTime 19 min, defaultAirDryAndCoolTime 60 min), used unless set here; it has no coating price, so none is assumed. The ranges are published guidance shown beside
 * the fields, never applied for the user (Foundry Management & Technology, "Innovations Enhance Mold Drying Effectiveness": core and mould drying ovens run
 * about 95-205 C and dry in 10-30 minutes, against 10-20 hours drying passively in the shop; solvent-based coatings can also be ignited for a very short dry).
 */
export const REFRACTORY_GUIDANCE = {
  dryMinutes: "A load's drying time in minutes. Empty: the plant's (oven 19, air 60: defaultOvenDryAndCoolTime, defaultAirDryAndCoolTime). Published: ovens at about 95-205 C dry coated moulds and cores in 10-30 minutes; passive drying in the shop takes 10-20 hours; solvent-based coatings can be burned off in very little time. Take it from the coating's datasheet.",
  price: "The coating's price per kg. It is not in the reference data, so nothing is assumed: until you set it, the coating is costed for time and drying only.",
} as const;

/**
 * What the hot box physics needs from the plant (backend sand-cores.ts): no dataset holds these three settings, so none is assumed; without them the hot box
 * core is not costed and the route says what to set. The ranges are published guidance shown beside the fields, never applied for the user
 * (US patents 5,365,995 and 5,368,087: core box 230-260 C, 10-40 s cure, a skin of 1/4 to 1/2 inch on massive cores).
 */
export const HOT_BOX_GUIDANCE = {
  coreboxTemp: 'The core box set point. Published range 230-260 C.',
  cureTemp: "The temperature at which the binder cures: from the resin's datasheet.",
  curedDepth: "The depth of core that must be cured before it is stripped (mm), the plant's strip criterion. Published: a few mm for fast cycles; 6-13 mm on massive cores takes minutes.",
} as const;

export const SAND_MOULDING_PROCESSES = [
  'Horizontal Automatic',
  'Vertical Automatic',
  'Manual Std Moldmaking',
  'Manual Floor Moldmaking',
  'Manual Pit Moldmaking',
] as const;

/** The coremaking processes the route costs (isocure and manual coremaking are not modelled). */
export const SAND_CORE_PROCESSES = ['Hot Box', 'CO2 Cured', 'No Bake', 'Oil Core', 'Shell'] as const;

/** What a number field commits: a value, null (clear the choice) or 'invalid' (the text is not a usable number: keep the field, change nothing). */
export type FieldCommit = number | null | 'invalid';

/** A positive number, or an empty field (clears the choice). */
export function parsePositive(text: string): FieldCommit {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 'invalid';
}

/** A positive whole number of cavities, or an empty field (the most that fit). */
export function parseCavities(text: string): FieldCommit {
  const n = parsePositive(text);
  return n === 'invalid' || n === null ? n : Number.isInteger(n) ? n : 'invalid';
}

/** A select value as a choice: the empty option clears it. */
export const choiceOf = (value: string): string | null => (value === '' ? null : value);
