/**
 * Maps a CNC-detected feature (feature_graph_v2's bucketed `feature_type` —
 * see cad-engine/machining/cnc_feature_recognizer.py's build_feature_graph_v2_from_cnc,
 * which is the only function that ever produces these 10 values) to the real
 * "Operation // FeatureType" string it corresponds to in the canonical
 * reference catalog (memory/machining/operations_full.json / the DB mirror
 * process_taxonomy_operations, migration 609/691).
 *
 * Every string below was verified present in operations_full.json for the
 * relevant route family before being added here — never fabricated. Known,
 * disclosed scoping decision: the real catalog also carries deeper 3-level
 * compound operations (e.g. "MillTurn:Multistep Holemaking//MultiStepHole:
 * Counterboring//SimpleHole" — a counterbore cut as part of one multi-step
 * hole cycle, not a standalone pass). This table maps to the real child
 * operation name in that compound ("Counterboring // SimpleHole") without
 * modeling the multi-step-cycle grouping itself — that finer fidelity is a
 * real gap, not something to fabricate a value for.
 *
 * external_diameter, fillet, groove, pcd_hole_pattern, radial_slot are real
 * CNCFeature types the CAD engine can detect but build_feature_graph_v2_from_cnc
 * does not currently bucket into feature_graph_v2 (radial_slot folds into
 * "slot"; the rest never reach this payload today) — no entry is fabricated
 * for them here.
 */

export type MachiningRouteFamily = 'milling' | 'turning';

const MILLING_OPERATION_BY_FEATURE_TYPE: Readonly<Record<string, string>> = {
  through_hole: 'Drilling // SimpleHole',
  blind_hole: 'Drilling // SimpleHole',
  tapped_hole: 'Tapping // SimpleHole',
  cross_hole: 'Drilling // SimpleHole',
  counterbore: 'Counterboring // SimpleHole',
  countersink: 'Countersinking // SimpleHole',
  chamfer: 'Chamfering // SimpleHole',
  pocket: 'Rough Milling // PocketV2',
  slot: 'Slot Milling // Slot',
  keyway: 'Rough Milling // Keyway',
};

// Turning routes (2/3 Axis Lathe, bar-feed variants, MillTurn) cut chamfers
// with a live chamfer-milling tool, not the milling-only "Chamfering"
// operation name — verified against operations_full.json: "3 Axis Lathe" and
// "MillTurn" both carry "Chamfer Milling // SimpleHole" and neither carries
// "Chamfering // SimpleHole". Every other feature type resolves identically
// across families.
const TURNING_OPERATION_BY_FEATURE_TYPE: Readonly<Record<string, string>> = {
  ...MILLING_OPERATION_BY_FEATURE_TYPE,
  chamfer: 'Chamfer Milling // SimpleHole',
};

export function machiningRouteFamilyOf(cadFamily: string | null | undefined): MachiningRouteFamily {
  return cadFamily === 'cnc_turned' || cadFamily === 'mill_turn' ? 'turning' : 'milling';
}

/** Returns null (not a fallback guess) when featureType isn't one of the 10 real values above. */
export function resolveCanonicalOperation(
  featureType: string,
  family: MachiningRouteFamily,
): string | null {
  const table = family === 'turning' ? TURNING_OPERATION_BY_FEATURE_TYPE : MILLING_OPERATION_BY_FEATURE_TYPE;
  return table[featureType] ?? null;
}
