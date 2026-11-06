// Which molding processes a material can be run on, as the staged dataset records it (raw_material_properties: process_compatibility_can_im_sfm,
// _can_rim, _can_cm). A route is offered for a material only when its flag says so: a thermoplastic such as ABS is injection / structural foam
// only, so a compression or reaction-injection press is never a real alternative for it. A material with no flag on file is not assumed
// compatible; the reason names the missing flag.

export type MoldingProcess = 'injection_or_foam' | 'reaction_injection' | 'compression';

export interface ProcessCompatibility {
  injection_or_foam: boolean | null;
  reaction_injection: boolean | null;
  compression: boolean | null;
}

const KEY_TO_PROCESS: Record<string, MoldingProcess> = {
  process_compatibility_can_im_sfm: 'injection_or_foam',
  process_compatibility_can_rim: 'reaction_injection',
  process_compatibility_can_cm: 'compression',
};

export const PROCESS_COMPATIBILITY_KEYS = Object.keys(KEY_TO_PROCESS);

const PROCESS_LABEL: Record<MoldingProcess, string> = {
  injection_or_foam: 'injection or structural foam molding',
  reaction_injection: 'reaction injection molding',
  compression: 'compression molding',
};

export function parseProcessCompatibility(rows: ReadonlyArray<{ property_key: string; value_text: string | null }>): ProcessCompatibility {
  const out: ProcessCompatibility = { injection_or_foam: null, reaction_injection: null, compression: null };
  for (const r of rows) {
    const process = KEY_TO_PROCESS[r.property_key];
    const text = (r.value_text ?? '').trim().toLowerCase();
    if (process && (text === 'true' || text === 'false')) out[process] = text === 'true';
  }
  return out;
}

/** Why this material cannot be run on the process, or null when the dataset says it can. */
export function processCompatibilityGap(compat: ProcessCompatibility, process: MoldingProcess, grade: string | null): string | null {
  const label = grade ? `"${grade}"` : 'This material';
  const flag = compat[process];
  if (flag === true) return null;
  if (flag === false) return `${label} is not a ${PROCESS_LABEL[process]} material (its process-compatibility data excludes it). Not offered as a route.`;
  return `No process-compatibility data is on file for ${label}, so ${PROCESS_LABEL[process]} is not assessed. Not offered as a route.`;
}
