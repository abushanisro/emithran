// The plant's baseline metal yield by alloy family (variables materialYield*: net weight as a percentage of the metal poured), set beside the yield
// this casting's own gating and risers give. The route designs the gating, so its yield is computed, never taken from the baseline; the baseline only
// tells the reader whether the design is in the usual range for the alloy. No threshold is applied: how far apart is too far is the plant's to say.

import type { SandReference } from './sand-reference';

/** The plant variable that holds the baseline yield of a staged material type; a type with none gets no comparison. */
const YIELD_VARIABLE: Readonly<Record<string, string>> = {
  'Gray Iron': 'materialYieldGray',
  'Ductile Iron': 'materialYieldDuctile',
  Steel: 'materialYieldSteel',
  'Stainless Steel': 'materialYieldSteel',
  Aluminum: 'materialYieldAluminum',
  Zinc: 'materialYieldZinc',
};

export function yieldVariableFor(materialType: string | null): string | null {
  return (materialType != null && YIELD_VARIABLE[materialType]) || null;
}

/** The note for the route: the designed yield against the plant's baseline for the alloy, or null when the plant holds no baseline for it. */
export function referenceYieldNote(ref: SandReference, materialType: string | null, designedYieldPct: number): string | null {
  const name = yieldVariableFor(materialType);
  const baseline = name ? ref.number(name) : null;
  if (name == null || baseline == null) return null;
  return `Metal yield: ${designedYieldPct.toFixed(1)} % from this casting's designed gating and risers; the plant's baseline for ${materialType} is ${baseline} % (${name}).`;
}
