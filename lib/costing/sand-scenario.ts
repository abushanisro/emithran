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
  { value: 'mould', label: 'The mould' },
  { value: 'cores', label: 'The cores' },
  { value: 'both', label: 'The mould and the cores' },
] as const;

export const REFRACTORY_DRY_METHODS = [
  { value: 'oven', label: 'Oven' },
  { value: 'air', label: 'Air dry' },
] as const;

/**
 * What the coating needs from the plant: the data defines the coating (method, rate, output, density, preparation, beds) but no drying time and no price, so
 * neither is assumed; a coating chosen without a drying time is not costed and the route says what to set. The ranges are published guidance shown beside
 * the fields, never applied for the user (Foundry Management & Technology, "Innovations Enhance Mold Drying Effectiveness": core and mould drying ovens run
 * about 95-205 C and dry in 10-30 minutes, against 10-20 hours drying passively in the shop; solvent-based coatings can also be ignited for a very short dry).
 */
export const REFRACTORY_GUIDANCE = {
  dryMinutes: "The plant's time for a load in the oven (or on the air-dry area), in minutes. Published: ovens at about 95-205 C dry coated moulds and cores in 10-30 minutes; passive drying in the shop takes 10-20 hours; solvent-based coatings can be burned off in very little time. Take it from the coating's datasheet.",
  price: "The coating's price per kg. It is not in the reference data, so nothing is assumed: until you set it, the coating is costed for time and drying only.",
} as const;

/**
 * The hot box settings (backend sand-cores.ts): empty, the published values of US 5,365,995 (Ford, "Method of curing hot box sand cores") are used, the box
 * at the range's lower bound and the skin at its upper bound (the slower cure); a value set here wins.
 */
export const HOT_BOX_GUIDANCE = {
  coreboxTemp: 'The core box set point. Empty: 232 °C, the lower bound of the published 450-550 °F (US 5,365,995).',
  cureTemp: "The binder's cure temperature. Empty: 48.9 °C, the published 120 °F critical cure temperature (US 5,365,995); your resin's datasheet value wins.",
  curedDepth: "The depth of core cured before it is stripped (mm). Empty: 12.7 mm, the upper bound of the published 1/4-1/2 inch skin on massive cores (US 5,365,995); capped at half the core's section.",
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
