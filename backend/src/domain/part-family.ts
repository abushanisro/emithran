// The CAD part families, mirroring cad-engine/shared/part_family.py (the one
// vocabulary the engine emits). A backend test keeps the two in step; extend
// the Python file first, then this one.

export const MACHINING_FAMILIES = ['milled', 'turned', 'mill_turn'] as const;
export type MachiningFamily = (typeof MACHINING_FAMILIES)[number];

/** Machining families recognized around a rotation axis (lathe-based). */
export const TURNED_FAMILIES = ['turned', 'mill_turn'] as const;

/** The part is machined (milled, turned or mill-turn). */
export function isMachiningFamily(family: string | null | undefined): family is MachiningFamily {
  return (MACHINING_FAMILIES as readonly string[]).includes(family ?? '');
}

/** The part is turned on a lathe (turned or mill-turn). */
export function isTurnedFamily(family: string | null | undefined): boolean {
  return (TURNED_FAMILIES as readonly string[]).includes(family ?? '');
}
