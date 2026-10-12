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
};
