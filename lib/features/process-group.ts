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
  two_model: '2-Model Machining',
  additive: 'Additive Manufacturing',
  // A length of bar, tube or profile (cad-engine bar_tube): costed by the bar and tube engine (backend costing/bar-tube).
  bar_tube: 'Bar and Tube Fabrication',
  // A blow molded or rotomolded hollow shell (cad-engine roto_blow): costed by the Roto & Blow Molding engine (backend costing/roto-blow).
  roto_blow: 'Roto & Blow Molding',
  // An assembly's own work, costed from its BOM children (backend costing/assembly): a costed group with no CAD extractor.
  assembly: 'Assembly',
  // A weldment's welding, costed from its BOM children and the Cost Guide's weld table (backend costing/part-assembly): no CAD extractor either.
  part_assembly: 'Part Assembly',
};

/** Families the cad-engine has no extractor for: an assembly and a weldment are costed from their BOM children and the Cost Guide. */
const NO_CAD_EXTRACTOR: ReadonlySet<string> = new Set(['assembly', 'part_assembly'])

export function familyToProcessGroupLabel(family: string | null | undefined): string | null {
  return (family && FAMILY_HINT_TO_PROCESS_GROUP[family]) || null;
}

/**
 * Processes whose routes are complete alternatives inside a CAD family that has a builder of its own: a hydroformed part is analysed as sheet
 * metal, but its routes (Hydroform Deep Draw, Hydroform Fluid Cell, each an offline blank then the press) are not cut-then-form routes.
 */
const ROUTES_AS_FAMILY: Readonly<Record<string, string>> = {
  'Sheet Metal - Hydroforming': 'hydroforming',
};

/**
 * The family a part's routes are listed for (the Workflow Builder): its Process's when that process lists complete routes inside its CAD
 * family (a hydroformed part); the one it is costed as when that family has no CAD extractor (an assembly, a weldment: costed from the BOM and
 * the Cost Guide, so its CAD family is none, or one from an analysis as another process); else its CAD family.
 */
export function routingFamilyOf(cadFamily: string | null | undefined, costedFamily: string | null | undefined, processGroup?: unknown): string | null {
  if (typeof processGroup === 'string' && processGroup in ROUTES_AS_FAMILY) return ROUTES_AS_FAMILY[processGroup] ?? null;
  return costedFamily && NO_CAD_EXTRACTOR.has(costedFamily) ? costedFamily : cadFamily ?? null;
}

/**
 * The forward direction: a chosen process group -> the cad-engine family_hint
 * that runs its extractor. Derived from FAMILY_HINT_TO_PROCESS_GROUP (first
 * family per group, so Machining -> milled, the general machining family), so
 * the two directions cannot drift. Undefined = no extractor for that group.
 */
export function processGroupToFamilyHint(group: string | null | undefined): string | undefined {
  if (!group) return undefined;
  return Object.entries(FAMILY_HINT_TO_PROCESS_GROUP).find(([f, g]) => g === group && !NO_CAD_EXTRACTOR.has(f))?.[0] ?? COSTED_AS_FAMILY[group];
}

/**
 * Process groups with no CAD family of their own, and the family their CAD analysis runs as (the first of the backend's COSTED_AS_FAMILIES,
 * part-family-process-group.ts): a hydroformed part is a sheet-metal part; a Casting part is analysed as a die casting and priced by every
 * casting process.
 */
const COSTED_AS_FAMILY: Readonly<Record<string, string>> = {
  'Sheet Metal - Hydroforming': 'sheet_metal',
  Casting: 'die_cast',
  // Insert molding: a molded plastic part on the insert presses (backend plastic-molding/insert).
  'Assembly Molding': 'plastic_molded',
  // Multi-shot molding: a molded plastic part, each shot on a multi-shot press (backend plastic-molding/multi-shot).
  'Assembly Plastic Molding': 'plastic_molded',
  // Multi-spindle machining: a turned part made from bar on a CNC multi-spindle or twin-spindle turning center (backend multi-spindle).
  'Multi-Spindle Machining': 'turned',
  // Rapid prototyping: analysed for its build as an additive part, priced in its own domain (backend additive/additive-domain.ts).
  'Rapid Prototyping': 'additive',
};

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
