// The Cost Guide choices of a sand casting. The keys and the process names are the backend's (sand/sand-cost.ts, sand-route.ts): a name
// that is not one of these is ignored by the engine, so the lists below are the whole vocabulary.

export const SAND_SCENARIO_KEYS = {
  mouldingProcess: 'sandMouldingProcess',
  coreProcess: 'sandCoreProcess',
  energyPrice: 'energyPriceUsdPerKwh',
  cavities: 'cavityCount',
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
