/**
 * Real process_group label for a raw cad-engine family string
 * (cad-engine/shared/part_family.py's ALL_FAMILIES) — the single source of
 * truth both Create/Edit BOM Item's Process dropdown (BOMItemDialog.tsx) and
 * the manufacturing-intelligence page's own "Process Group" display resolve
 * through, so the identical underlying classification never shows different
 * text ("Milled" vs "Machining") in two different places.
 *
 * Only families with a real process_taxonomy group are mapped. 'Machining'
 * collapses milled/turned/mill_turn into one label — a group-level display
 * has no finer signal to pick between the three real families underneath it
 * (see BOMItemDialog.tsx's PROCESS_GROUP_TO_FAMILY_HINT, the forward
 * direction of this same mapping, for the full rationale). A family with no
 * entry here (every family outside sheet_metal/plastic_molded/milled/
 * turned/mill_turn/die_cast) has no real process_group counterpart yet —
 * callers fall back to their own generic family label, never a fabricated
 * group name.
 */
export const FAMILY_HINT_TO_PROCESS_GROUP: Record<string, string> = {
  sheet_metal: 'Sheet Metal',
  plastic_molded: 'Plastic Molding',
  milled: 'Machining',
  turned: 'Machining',
  mill_turn: 'Machining',
  die_cast: 'Die Casting',
  sand_cast: 'Sand Casting',
  investment_cast: 'Casting Investment',
};

export function familyToProcessGroupLabel(family: string | null | undefined): string | null {
  return (family && FAMILY_HINT_TO_PROCESS_GROUP[family]) || null;
}

/**
 * The forward direction: a chosen process group -> the cad-engine family_hint
 * that runs its extractor. Derived from FAMILY_HINT_TO_PROCESS_GROUP (first
 * family per group, so Machining -> milled, the general machining family), so
 * the two directions cannot drift. Undefined = no extractor for that group.
 */
export function processGroupToFamilyHint(group: string | null | undefined): string | undefined {
  if (!group) return undefined;
  return Object.entries(FAMILY_HINT_TO_PROCESS_GROUP).find(([, g]) => g === group)?.[0];
}

/** A family whose process group is a casting process (die, sand, investment). */
export function isCastingFamily(family: string | null | undefined): boolean {
  return isCastingProcessGroup(familyToProcessGroupLabel(family));
}

/**
 * Cross-cutting secondary/post-processing groups — applied on top of any
 * route, never a part's primary process, so never offered as one.
 */
export const PROCESS_GROUP_EXCLUDE = new Set(['Surface Treatment', 'Heat Treatment', 'Other Secondary Processes']);

/** Primary process_group options from the live process catalog rows. */
export function processGroupOptionsFrom(mappings: { processGroup: string }[] | undefined): string[] {
  const groups = new Set<string>();
  for (const m of mappings ?? []) {
    if (!PROCESS_GROUP_EXCLUDE.has(m.processGroup)) groups.add(m.processGroup);
  }
  return Array.from(groups).sort((a, b) => a.localeCompare(b));
}

/** True when a process group is a casting process (Die Casting, Sand Casting, Casting Investment, ...). */
export function isCastingProcessGroup(group: string | null | undefined): boolean {
  return !!group && /casting/i.test(group);
}

/**
 * The processes a material can be made by: every process group linked to one
 * of the material's groups (process_material_groups, migration 879), among the
 * selectable ones. A die-casting alloy (group Die Casting) gives exactly one,
 * Die Casting; a grade in Ferrous & Non-Ferrous gives several (Machining,
 * Sheet Metal, ...), and the engineer picks. Sorted, unique.
 */
export function processesForMaterialGroups(
  materialGroups: readonly string[],
  links: ReadonlyArray<{ processGroup: string; materialGroup: string }>,
  selectable: readonly string[],
): string[] {
  const groups = new Set(materialGroups);
  const allowed = new Set(selectable);
  return [...new Set(links.filter((l) => groups.has(l.materialGroup) && allowed.has(l.processGroup)).map((l) => l.processGroup))].sort();
}
