// Whether a forging's hole is made in the dies or drilled afterwards. A die half pierces only along the die direction, and only a hole at least
// minForgeableHoleDiameter wide; any other hole is machined after forging. Pure.

export interface ForgedHole {
  featureType: string;
  /** Hole diameter (mm); null when not measured. */
  sizeMm: number | null;
  /** Hole axis (unit vector); null when not measured. */
  axis: readonly number[] | null | undefined;
}

export type ForgedHoleFormability = { formable: true | false | null; detail: string };

/** How close to the die direction a hole's axis must be for a die half to pierce it. */
const PIERCE_ANGLE_DEG = 5;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Null for a feature that is not a hole (judged by its tolerances alone). */
export function forgedHoleFormability(hole: ForgedHole, minHoleMm: number | null, dieDirection: readonly number[] | null): ForgedHoleFormability | null {
  if (hole.featureType !== 'SimpleHole' && hole.featureType !== 'MultiStepHole') return null;
  if (minHoleMm == null || !Number.isFinite(minHoleMm) || minHoleMm <= 0) return { formable: null, detail: 'minForgeableHoleDiameter is not staged (forging reference data)' };
  const size = hole.sizeMm;
  if (size == null) return { formable: null, detail: 'hole diameter not measured' };
  if (size < minHoleMm) return { formable: false, detail: `Ø${size} mm is under the least forgeable hole (minForgeableHoleDiameter ${minHoleMm} mm): drilled after forging` };
  if (!dieDirection || !hole.axis) return { formable: null, detail: 'the die direction or the hole axis is not measured (Refresh analysis): whether it can be pierced is not known' };
  return Math.abs(dot(dieDirection, hole.axis)) >= Math.cos((PIERCE_ANGLE_DEG * Math.PI) / 180)
    ? { formable: true, detail: `pierced along the die direction (Ø${size} mm, at least ${minHoleMm} mm)` }
    : { formable: false, detail: 'across the die direction: no die half can pierce it, it is drilled after forging' };
}
