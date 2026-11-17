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
  forged: 'Forging',
  powder_metal: 'Powder Metal',
  composite: 'Composites',
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
  return Object.entries(FAMILY_HINT_TO_PROCESS_GROUP).find(([, g]) => g === group)?.[0] ?? COSTED_AS_FAMILY[group];
}

/**
 * Process groups with no CAD family of their own, and the family their CAD analysis runs as (the first of the backend's COSTED_AS_FAMILIES,
 * part-family-process-group.ts): a hydroformed part is a sheet-metal part; a Casting part is analysed as a die casting and priced by every
 * casting process.
 */
const COSTED_AS_FAMILY: Readonly<Record<string, string>> = { 'Sheet Metal - Hydroforming': 'sheet_metal', Casting: 'die_cast' };

/**
 * Whether a process group has a cost model (the backend's familiesOfProcessGroup, part-family-process-group.ts). A part whose Process has none
 * is not costed, so the Process fields say so on the option instead of letting it be chosen blind.
 */
export function isCostedProcessGroup(group: string | null | undefined): boolean {
  return !!group && (Object.values(FAMILY_HINT_TO_PROCESS_GROUP).includes(group) || group in COSTED_AS_FAMILY);
}

/** A process group as an option of a Process field: marked when it has no cost model. */
export function processGroupOptionLabel(group: string): string {
  return isCostedProcessGroup(group) ? group : `${group} (not costed yet)`;
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

/**
 * When the item's chosen process and its geometry disagree (the CAD engine reports the family it analysed the part as and,
 * separately, what the shape alone reads as), the sentence to show, naming the Process to set. Null when they agree or
 * either is unknown; families of one process group (milled / turned) never conflict. Same words as the backend's
 * processChoiceConflict (part-family-process-group.ts).
 */
export function processChoiceConflict(
  classification: { family?: string | null; geometricFamily?: string | null } | null | undefined,
): string | null {
  const chosenGroup = familyToProcessGroupLabel(classification?.family);
  const geometricGroup = familyToProcessGroupLabel(classification?.geometricFamily);
  if (!chosenGroup || !geometricGroup || chosenGroup === geometricGroup) return null;
  return `This part's Process is ${chosenGroup}, but its geometry reads as ${geometricGroup} (${classification?.geometricFamily ?? ''}). Set its Process to ${geometricGroup}; reanalyzing as ${chosenGroup} will not change this.`;
}
