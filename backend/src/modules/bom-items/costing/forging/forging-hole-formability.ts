// Whether a hole of a part made in closing dies (a forging) or between punches (a powder metal part) is made by them or drilled afterwards. The
// tooling makes a hole only along the direction it closes in, and only a hole at least the process's least diameter wide; any other hole is
// machined after. Pure.

export interface ForgedHole {
  featureType: string;
  /** Hole diameter (mm); null when not measured. */
  sizeMm: number | null;
  /** Hole axis (unit vector); null when not measured. */
  axis: readonly number[] | null | undefined;
}

export type ForgedHoleFormability = { formable: true | false | null; detail: string };

/** How a process makes a hole, in its own words: its least-diameter variable, what the tooling does to a hole, and its closing direction. */
export interface DirectionalHoleRule {
  minHoleVariable: string;
  /** "Ø… mm is under the least <least> hole". */
  least: string;
  /** "<made> along the <direction>". */
  made: string;
  direction: string;
  /** "no <tool> can <verb> it". */
  tool: string;
  verb: string;
  /** "it is drilled after <after>". */
  after: string;
}

export const FORGED_HOLES: DirectionalHoleRule = {
  minHoleVariable: 'minForgeableHoleDiameter', least: 'forgeable', made: 'pierced', direction: 'die direction', tool: 'die half', verb: 'pierce', after: 'forging',
};
export const PRESSED_HOLES: DirectionalHoleRule = {
  minHoleVariable: 'minPressableHoleDiameter', least: 'pressable', made: 'pressed by a core rod', direction: 'press direction', tool: 'core rod', verb: 'form', after: 'pressing',
};

/** How close to the closing direction a hole's axis must be for the tooling to make it. */
const ALONG_ANGLE_DEG = 5;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Null for a feature that is not a hole (judged by its tolerances alone). */
export function directionalHoleFormability(
  rule: DirectionalHoleRule, hole: ForgedHole, minHoleMm: number | null, direction: readonly number[] | null,
): ForgedHoleFormability | null {
  if (hole.featureType !== 'SimpleHole' && hole.featureType !== 'MultiStepHole') return null;
  if (minHoleMm == null || !Number.isFinite(minHoleMm) || minHoleMm <= 0) return { formable: null, detail: `${rule.minHoleVariable} is not staged (${rule.after} reference data)` };
  const size = hole.sizeMm;
  if (size == null) return { formable: null, detail: 'hole diameter not measured' };
  if (size < minHoleMm) return { formable: false, detail: `Ø${size} mm is under the least ${rule.least} hole (${rule.minHoleVariable} ${minHoleMm} mm): drilled after ${rule.after}` };
  if (!direction || !hole.axis) return { formable: null, detail: `the ${rule.direction} or the hole axis is not measured (Refresh analysis): whether it can be ${rule.made.split(' ')[0]} is not known` };
  return Math.abs(dot(direction, hole.axis)) >= Math.cos((ALONG_ANGLE_DEG * Math.PI) / 180)
    ? { formable: true, detail: `${rule.made} along the ${rule.direction} (Ø${size} mm, at least ${minHoleMm} mm)` }
    : { formable: false, detail: `across the ${rule.direction}: no ${rule.tool} can ${rule.verb} it, it is drilled after ${rule.after}` };
}

/** A forging's hole: pierced along the die direction, at least minForgeableHoleDiameter wide. */
export const forgedHoleFormability = (hole: ForgedHole, minHoleMm: number | null, dieDirection: readonly number[] | null) =>
  directionalHoleFormability(FORGED_HOLES, hole, minHoleMm, dieDirection);
