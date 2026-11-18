// A CAD-detected family (detect_part_family()'s literal output) is not a
// process/route id anywhere else in this platform — it maps to the real
// process_taxonomy.process_group it belongs to. One map for every consumer:
// auto-fill (process selection) and material resolution (which material
// groups a family's parts draw from, process_material_groups, migration 879).
export const CAD_FAMILY_TO_PROCESS_GROUP: Readonly<Record<string, string>> = {
  sheet_metal: 'Sheet Metal',
  plastic_molded: 'Plastic Molding',
  milled: 'Machining',
  turned: 'Machining',
  mill_turn: 'Machining',
  // Die Casting Phase 1 (2026-10): detection + highlighting only, no cost
  // engine yet — process_taxonomy's real "Die Casting" rows are all seeded
  // roadmap_status='not_modeled' (migration 844).
  die_cast: 'Die Casting',
  // Same casting extractor, validated against each process's own catalog
  // (cad-engine shared/part_family.py CASTING_FAMILY_DOMAIN).
  sand_cast: 'Sand Casting',
  investment_cast: 'Casting Investment',
  // Closed-die forging: the cad-engine measures the part along its die direction (forging/feature_extractor.py).
  forged: 'Forging',
  // Press and sinter: measured along its press direction by the same die-direction measurements as a forging.
  powder_metal: 'Powder Metal',
  // A laid-up composite: the cad-engine measures it as a laminate on its tool (composites/feature_extractor.py).
  composite: 'Composites',
  // A finished part machined from a source component, another item of its BOM (memory/"2 Mold Molding"): analysed as a machined part
  // (cad-engine family_hint two_model) and compared with its source (two_model/compare.py).
  two_model: '2-Model Machining',
};

/** The generic casting process: the part is analysed as a casting and priced by every casting process, the cheapest feasible one quoted. */
/**
 * The families a CAD analysis run with a family hint may store. A hint names an extractor, and the analysis stores that family, except a
 * 2-Model Machining part: the cad-engine analyses it as the machined part it is (milled, turned or mill-turn; memory_optimizer.py), so
 * its features are machining features under a machining family.
 */
export function familiesAnalysedForHint(hint: string): readonly string[] {
  return hint === 'two_model' ? ['milled', 'turned', 'mill_turn'] : [hint];
}

export const CASTING_PROCESS_GROUP = 'Casting';

/**
 * Process groups with no CAD family of their own, and the families they are costed as. A hydroformed part is a sheet-metal part. A Casting part
 * is priced as each casting family (casting-process-choice.ts); the first is the one its CAD analysis runs as, die casting, whose feature
 * catalog holds every feature type the sand catalog has, and slides.
 */
const COSTED_AS_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  'Sheet Metal - Hydroforming': ['sheet_metal'],
  [CASTING_PROCESS_GROUP]: ['die_cast', 'sand_cast', 'investment_cast'],
};

/**
 * The CAD families a process group is costed as, the general one first (Machining: milled); empty when the group has no cost model (Forging,
 * Powder Metal, ...): a part whose Process is one of those is not costed, never priced as another process.
 */
export function familiesOfProcessGroup(processGroup: string): string[] {
  const own = Object.keys(CAD_FAMILY_TO_PROCESS_GROUP).filter((family) => CAD_FAMILY_TO_PROCESS_GROUP[family] === processGroup);
  return own.length > 0 ? own : [...(COSTED_AS_FAMILIES[processGroup] ?? [])];
}

/**
 * The casting family a Casting part was applied as: the family of the process group its saved operations are in (Sand Casting, Die Casting,
 * Casting Investment); null when none is. A Casting part is analysed as a die casting and quoted on the cheapest casting process, so what the
 * part is made by is known only from what was applied.
 */
export function appliedCastingFamily(appliedGroups: readonly string[]): string | null {
  return (COSTED_AS_FAMILIES[CASTING_PROCESS_GROUP] ?? []).find((family) => appliedGroups.includes(CAD_FAMILY_TO_PROCESS_GROUP[family]!)) ?? null;
}

/** The process groups that have a cost model, as the Process field names them. */
export function costedProcessGroups(): string[] {
  return [...new Set([...Object.values(CAD_FAMILY_TO_PROCESS_GROUP), ...Object.keys(COSTED_AS_FAMILIES)])].sort();
}

/**
 * When the process the user chose and the part's geometry disagree (cad-engine reports both: the family it analysed the
 * part as, and `geometric_family`, what the shape alone reads as), the sentence to tell them, naming the Process to set.
 * Null when they agree or either is unknown; families of one process group (milled / turned) never conflict.
 */
export function processChoiceConflict(
  classification: { family?: string | null; geometricFamily?: string | null } | null | undefined,
): string | null {
  const chosen = classification?.family;
  const geometric = classification?.geometricFamily;
  if (!chosen || !geometric) return null;
  const chosenGroup = CAD_FAMILY_TO_PROCESS_GROUP[chosen];
  const geometricGroup = CAD_FAMILY_TO_PROCESS_GROUP[geometric];
  if (!chosenGroup || !geometricGroup || chosenGroup === geometricGroup) return null;
  return `This part's Process is ${chosenGroup}, but its geometry reads as ${geometricGroup} (${geometric}). Set its Process to ${geometricGroup}; reanalyzing as ${chosenGroup} will not change this.`;
}
