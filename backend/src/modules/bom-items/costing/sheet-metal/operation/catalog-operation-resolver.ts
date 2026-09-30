/**
 * Which catalog operations one sheet-metal process step performs on this part:
 * the part's CAD features (feature_graph_v2) matched to that process's rows of
 * the reference operation catalog (process_taxonomy_operations).
 *
 * Pure: every fact comes in as data.
 *  - catalog rows: the step's process, e.g. Turret Press
 *    "Turret Press:Punching:Punching//SimpleHole:Punching//Edge"
 *  - operationKinds: operation name -> kind        (sm_operation_kinds, migration 842)
 *  - variantKinds:   "Type:variant" -> kinds that make it (sm_feature_variant_kinds)
 *  - punch limits of the selected machine: min punchable Ø (sm_reference_data
 *    minPunchingThicknessFactor x thickness) and max_punch_size_mm (its specs)
 *  - the largest share of a blank perimeter a punch press may nibble
 *    (sm_reference_data turretMaxPercentNibbledPeriemter)
 *
 * Per CAD feature: the step's catalog operations on that feature type whose
 * kind makes the feature's variant. A round hole that a punch and a nibble
 * could both make is split by the machine's real punch range. One operation
 * left = resolved; several = undecided (listed, never guessed); none = the
 * step does not make this feature, and it is left to the step that does.
 */

export interface SheetMetalFeature {
  id: string;
  feature_type: string;
  variant: string;
  diameter_mm?: number | null;
  occurrences: ReadonlyArray<{ face_ids?: ReadonlyArray<number> | null }>;
}

export interface PunchLimits {
  /** Smallest hole Ø the machine may punch; null = not known. */
  minPunchDiameterMm: number | null;
  /** Largest single punch tool; null = not known. */
  maxPunchSizeMm: number | null;
  /** Largest share (0-1) of the blank perimeter that may be nibbled; null = not known. */
  maxNibbledPerimeterFraction: number | null;
}

export interface CatalogOperation {
  /** One name when resolved; the candidates when undecided; empty when infeasible. */
  operations: string[];
  featureType: string;
  variant: string;
  diameterMm: number | null;
  count: number;
  featureIds: string[];
  status: 'resolved' | 'undecided' | 'infeasible';
  /** Catalog child steps of the resolved operation, e.g. Punching // Edge under Punching // Blank. */
  children: Array<{ operation: string; featureType: string }>;
  reason?: string;
}

interface Pair { operation: string; featureType: string }

/** The Operation//Feature pairs of a catalog compound string, outermost first. */
export function catalogPairs(raw: string): Pair[] {
  return raw.split(':').filter((s) => s.includes('//')).map((s) => {
    const [operation, featureType] = s.split('//');
    return { operation: operation!.trim(), featureType: featureType!.trim() };
  });
}

/** Physical holes a more specific variant (perforated, extruded) already accounts for. */
function facesClaimedBySpecificHoles(features: readonly SheetMetalFeature[]): Set<number> {
  const claimed = new Set<number>();
  for (const f of features) {
    if (f.feature_type !== 'SimpleHole' || f.variant === 'through') continue;
    for (const o of f.occurrences) for (const id of o.face_ids ?? []) claimed.add(id);
  }
  return claimed;
}

export function resolveCatalogOperations(input: {
  catalogRaw: readonly string[];
  features: readonly SheetMetalFeature[];
  operationKinds: ReadonlyMap<string, string>;
  variantKinds: ReadonlyMap<string, ReadonlySet<string>>;
  punchLimits: PunchLimits;
}): CatalogOperation[] {
  const { catalogRaw, features, operationKinds, variantKinds, punchLimits } = input;

  // feature type -> operation -> child pairs, from the step's catalog rows.
  const byType = new Map<string, Map<string, Pair[]>>();
  for (const raw of catalogRaw) {
    const [top, child] = catalogPairs(raw);
    if (!top) continue;
    const ops = byType.get(top.featureType) ?? new Map<string, Pair[]>();
    byType.set(top.featureType, ops);
    const children = ops.get(top.operation) ?? [];
    ops.set(top.operation, children);
    if (child && !children.some((c) => c.operation === child.operation && c.featureType === child.featureType)) {
      children.push(child);
    }
  }

  const claimed = facesClaimedBySpecificHoles(features);
  const results: CatalogOperation[] = [];

  for (const f of features) {
    const ops = byType.get(f.feature_type);
    const allowed = variantKinds.get(`${f.feature_type}:${f.variant}`);
    if (!ops || !allowed) continue;

    const occurrences = f.feature_type === 'SimpleHole' && f.variant === 'through'
      ? f.occurrences.filter((o) => !(o.face_ids ?? []).some((id) => claimed.has(id)))
      : f.occurrences;
    if (occurrences.length === 0) continue;

    let candidates = [...ops.keys()].filter((op) => allowed.has(operationKinds.get(op) ?? ''));
    if (candidates.length === 0) continue;

    let reason: string | undefined;
    const d = f.diameter_mm ?? null;
    const kindOf = (op: string) => operationKinds.get(op);
    const hasPunch = candidates.some((op) => kindOf(op) === 'punch');
    const hasNibble = candidates.some((op) => kindOf(op) === 'nibble');
    const onlyPunchAndNibble = candidates.every((op) => kindOf(op) === 'punch' || kindOf(op) === 'nibble');
    const nibbleCap = punchLimits.maxNibbledPerimeterFraction;
    if (f.feature_type === 'Blank' && hasPunch && hasNibble && onlyPunchAndNibble && nibbleCap != null) {
      // A punch press with no cutting head makes the outline with its punch
      // tools; nibbling is capped at a small share of the perimeter.
      candidates = candidates.filter((op) => kindOf(op) === 'punch');
      reason = `Outline punched with the machine tools; at most ${Math.round(nibbleCap * 100)}% of the perimeter may be nibbled (turretMaxPercentNibbledPeriemter).`;
    } else if (d != null && (hasPunch || hasNibble)) {
      const { minPunchDiameterMm: min, maxPunchSizeMm: max } = punchLimits;
      if (min != null && d < min) {
        candidates = candidates.filter((op) => kindOf(op) !== 'punch' && kindOf(op) !== 'nibble');
        reason = `Ø${d} mm is below the smallest punchable hole (${min.toFixed(2)} mm = minPunchingThicknessFactor × thickness).`;
      } else if (max != null && hasPunch && hasNibble) {
        candidates = candidates.filter((op) => kindOf(op) !== (d <= max ? 'nibble' : 'punch'));
        reason = d <= max
          ? `Ø${d} mm fits one punch tool (max punch size ${max} mm): punched, not nibbled.`
          : `Ø${d} mm exceeds the largest punch tool (${max} mm): nibbled.`;
      }
    }

    const status: CatalogOperation['status'] =
      candidates.length === 0 ? 'infeasible' : candidates.length === 1 ? 'resolved' : 'undecided';
    if (status === 'undecided' && !reason) {
      reason = 'The catalog lists several operations for this feature on this process; no data here decides between them.';
    }
    candidates.sort();
    results.push({
      operations: candidates,
      featureType: f.feature_type,
      variant: f.variant,
      diameterMm: d,
      count: occurrences.length,
      featureIds: [f.id],
      status,
      children: status === 'resolved' ? ops.get(candidates[0]!) ?? [] : [],
      ...(reason ? { reason } : {}),
    });
  }

  return results.sort((a, b) =>
    a.featureType.localeCompare(b.featureType) || (a.diameterMm ?? 0) - (b.diameterMm ?? 0));
}
