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
  // A finished part machined from a cast blank derived from its own model (memory/"2 Mold Molding"): analysed as a machined part
  // (cad-engine family_hint two_model).
  two_model: '2-Model Machining',
  // Built layer by layer (DMLS, SLS, material jetting, SLA): measured for its build (cad-engine additive/feature_extractor.py).
  additive: 'Additive Manufacturing',
  // A length of bar, tube or profile, cut, punched, formed and bent (cad-engine bar_tube/feature_extractor.py: section, centreline, ends).
  bar_tube: 'Bar and Tube Fabrication',
  // A blow molded or rotomolded hollow shell (cad-engine roto_blow/feature_extractor.py: wall, inside, spout, parting line, envelope).
  roto_blow: 'Roto & Blow Molding',
  // An assembly's own work: its BOM children loaded and joined (costing/assembly). An assembly has no model of its own to analyse.
  assembly: 'Assembly',
  // A weldment's welding (memory/Part Assembly): its BOM children (or the part itself) loaded and welded by the Cost Guide's weld table
  // (costing/part-assembly). Nothing of it is read from a model: no extractor analyses a part as one.
  part_assembly: 'Part Assembly',
};

/** An assembly's family: its own work (loading and joining its BOM children), costed by costing/assembly. */
export const ASSEMBLY_FAMILY = 'assembly';

/** A weldment's family: its welding (memory/Part Assembly), costed by costing/part-assembly. */
export const PART_ASSEMBLY_FAMILY = 'part_assembly';

/** The families costed from the BOM and the Cost Guide alone: the cad-engine has no extractor for them, so no analysis is run as one. */
export const NO_CAD_EXTRACTOR_FAMILIES: ReadonlySet<string> = new Set([ASSEMBLY_FAMILY, PART_ASSEMBLY_FAMILY]);

/** Insert molding (memory/Assembly molding): costed as a plastic molded part on the insert presses. */
export const INSERT_MOLDING_PROCESS_GROUP = 'Assembly Molding';

/** Multi-shot molding (memory/Assembly plastic molding): costed as a plastic molded part, each shot on a 2K/3K multi-shot press. */
export const MULTI_SHOT_PROCESS_GROUP = 'Assembly Plastic Molding';

/** Multi-spindle machining (memory/Multi-Spindle Maching, memory/Machining Simultaneous Turning): a turned part, made from bar on a CNC multi-spindle or twin-spindle turning center. */
export const MULTI_SPINDLE_PROCESS_GROUP = 'Multi-Spindle Machining';

/** Rapid prototyping (memory/Rapid prototyping): a part built layer by layer (laser sintering, 3D printing, stereolithography), priced by the additive engine in its own domain. */
export const RAPID_PROTOTYPING_PROCESS_GROUP = 'Rapid Prototyping';

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
/** A hydroformed part: a sheet-metal part (its CAD analysis is sheet metal's), priced by costing/hydroforming. */
export const HYDROFORMING_PROCESS_GROUP = 'Sheet Metal - Hydroforming';

/**
 * Process groups with no CAD family of their own, and the families they are costed as. A hydroformed part is a sheet-metal part. A Casting part
 * is priced as each casting family (casting-process-choice.ts); the first is the one its CAD analysis runs as, die casting, whose feature
 * catalog holds every feature type the sand catalog has, and slides.
 */
const COSTED_AS_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  [HYDROFORMING_PROCESS_GROUP]: ['sheet_metal'],
  [CASTING_PROCESS_GROUP]: ['die_cast', 'sand_cast', 'investment_cast'],
  // Insert molding: a molded plastic part, analysed and priced as one, on the insert presses with its inserts loaded (plastic-molding/insert).
  [INSERT_MOLDING_PROCESS_GROUP]: ['plastic_molded'],
  // Multi-shot molding: a molded plastic part, each shot priced on a multi-shot press (plastic-molding/multi-shot).
  [MULTI_SHOT_PROCESS_GROUP]: ['plastic_molded'],
  // Multi-spindle machining: a turned part, its operations laid out over a multi-spindle's stations (multi-spindle/).
  [MULTI_SPINDLE_PROCESS_GROUP]: ['turned'],
  // Rapid prototyping: a part built layer by layer, analysed for its build as an additive part and priced in the Rapid Prototyping domain
  // (additive/additive-domain.ts: its own machines, materials, reference data and per-feature cleaning).
  [RAPID_PROTOTYPING_PROCESS_GROUP]: ['additive'],
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
