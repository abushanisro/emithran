// What the route says about the speed of the metal in the gating, and where its limits come from. The velocities are physics (the calculator's flow over
// the area it passes through); a limit is applied only where a published one is held here with its source. Pure.

/** A published limit on the metal's velocity in the ingates, by the material type of the staged materials. */
export interface VelocityLimit {
  materialType: string;
  limitMetresPerSecond: number;
  /** What exceeding it causes. */
  basis: string;
  source: string;
}

/**
 * The limits that have a source. Only aluminium has one: Campbell's critical velocity, 0.5 m/s, above which the surface of liquid aluminium turbulently folds
 * its oxide film into the metal (Baghani et al., Archives of Metallurgy and Materials, 2021, citing Campbell). A research pass found no limit for iron or
 * steel, so none is applied to them. Removal condition: move these to staged reference variables once the plant or a dataset supplies limits per alloy.
 */
export const PUBLISHED_INGATE_VELOCITY_LIMITS: readonly VelocityLimit[] = [
  {
    materialType: 'Aluminum',
    limitMetresPerSecond: 0.5,
    basis: 'surface turbulence that folds the oxide film into the metal',
    source: "Campbell's critical velocity for liquid aluminium, as cited by Baghani et al., Archives of Metallurgy and Materials, 2021",
  },
];

/** The route's note on the ingate velocity: the number, and whether it is judged. */
export function ingateVelocityNote(materialType: string | null, ingateMetresPerSecond: number, chokeMetresPerSecond: number): string {
  const head = `Metal enters the casting at ${ingateMetresPerSecond.toFixed(2)} m/s through the ingates (${chokeMetresPerSecond.toFixed(2)} m/s at the choke).`;
  const limit = PUBLISHED_INGATE_VELOCITY_LIMITS.find((l) => l.materialType === materialType);
  if (!limit) return `${head} No published limit is held for ${materialType ?? 'this material'}, so it is not judged.`;
  const over = ingateMetresPerSecond > limit.limitMetresPerSecond;
  return over
    ? `${head} That is above ${limit.limitMetresPerSecond} m/s (${limit.source}): ${limit.basis} is likely; larger ingates would slow it.`
    : `${head} Within ${limit.limitMetresPerSecond} m/s (${limit.source}).`;
}

/** The standing note on the riser sizing: its feeding efficiency has no source that could be verified. */
export const RISER_EFFICIENCY_NOTE =
  'Riser sizing uses a 14 % feeding efficiency, a rule with no published source that could be verified (the modulus factor 1.2 and the height-to-diameter ratio 1.5 are standard rules): check it before relying on the riser weights.';
