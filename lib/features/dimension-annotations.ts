/**
 * Diameter and radius callouts for the 3D viewer, read from the feature
 * records the CAD engine already stored on the part (bom_items.feature_graph).
 *
 * Nothing is measured here: every value is a diameter or radius the engine
 * took from the B-Rep, and every face id is one the engine attached to that
 * feature (the face_map turns them into triangles in the viewer). What this
 * module adds is the policy the engine leaves open:
 *   - a physical hole is ONE callout even when the engine reports its split
 *     cylinder faces as several features (same size, same position or a shared face);
 *   - a counterbored or stepped hole is one callout listing its diameters
 *     (the stored record unions its faces, so a diameter cannot be tied to a
 *     single face, and none is guessed);
 *   - a feature the engine could not size (no diameter, no face) gets no callout.
 *
 * Source: machining_features (canonical reference types) when the part has
 * them, else the sheet-metal feature_graph_v2 (holes and bends).
 */

export type AnnotationKind = 'diameter' | 'radius';

export interface DimensionTolerance {
  lowerMm: number;
  upperMm: number;
  /** The CAD's own label of the PMI dimension, e.g. "Radius1@Cylinder2(45.75)". */
  callout: string | null;
}

/** One dimension from the STEP's PMI (cad-engine shared/step_pmi_dimensions.py). */
export interface PmiDimension {
  callout?: string | null | undefined;
  kind?: string | undefined;
  nominal_mm?: number | undefined;
  lower_mm?: number | null | undefined;
  upper_mm?: number | null | undefined;
  basic?: boolean | undefined;
}
export type AnnotationMode = 'off' | 'diameter' | 'radius' | 'all';

export interface DimensionAnnotation {
  /** Stable for the same stored analysis: kind, value and the smallest face id. */
  id: string;
  kind: AnnotationKind;
  /** The largest diameter / the radius, mm. */
  valueMm: number;
  /** Text shown on the callout, e.g. "Ø10", "4× R0.5", "Ø27.6 / Ø24.8". */
  label: string;
  /** B-Rep faces of every feature the callout stands for, ascending (what a click highlights). */
  faceIds: number[];
  /** How many physical features share this size ("4×"); 1 for a single feature. */
  count: number;
  /** The faces of each feature, in order; the callout is drawn on the first. */
  instances: number[][];
  /** The +/- tolerance the STEP's PMI states for this size, or null (none stored, or not one-to-one). */
  tolerance: DimensionTolerance | null;
  /** Engine feature type it came from (SimpleHole, MultiStepHole, Edge, Ring, StraightBend). */
  featureType: string;
}

// Loose on purpose: the stored records are JSON and the callouts read only what they name.
interface StoredFeature {
  type?: string | undefined;
  variant?: string | null | undefined;
  params?: Record<string, unknown> | undefined;
  face_ids?: unknown;
}
interface StoredV2Feature {
  feature_type?: string | undefined;
  diameter_mm?: unknown;
  radius_mm?: unknown;
  occurrences?: ReadonlyArray<{ centroid?: unknown; face_ids?: unknown; radius_mm?: unknown }> | undefined;
}
export interface AnnotationSource {
  machining_features?: { features?: ReadonlyArray<StoredFeature> | undefined } | null | undefined;
  feature_graph_v2?: { features?: ReadonlyArray<StoredV2Feature> | undefined } | null | undefined;
  pmi?: { dimensions?: ReadonlyArray<PmiDimension> | undefined } | null | undefined;
}

const SAME_SIZE_MM = 0.01;
const SAME_POSITION_MM = 0.05;

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const faces = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b) : [];
const point = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as [number, number, number]) : null;

export function formatDimension(mm: number): string {
  return String(Number(mm.toFixed(2)));
}

interface Candidate {
  kind: AnnotationKind;
  valueMm: number;
  diameters?: number[];
  faceIds: number[];
  featureType: string;
  centroid: [number, number, number] | null;
}

function fromMachining(features: ReadonlyArray<StoredFeature>): Candidate[] {
  const out: Candidate[] = [];
  for (const f of features) {
    const p = f.params ?? {};
    const faceIds = faces(f.face_ids);
    if (faceIds.length === 0) continue;
    const centroid = point(p['centroid']);
    if (f.type === 'SimpleHole' && f.variant !== 'pcd_pattern') {
      // A pattern record absorbs its member bores and anchors at the part centre: not one hole.
      const d = pos(p['diameter_mm']);
      if (d) out.push({ kind: 'diameter', valueMm: d, faceIds, featureType: f.type, centroid });
    } else if (f.type === 'MultiStepHole') {
      const steps = Array.isArray(p['steps']) ? (p['steps'] as Array<{ diameter_mm?: unknown }>).map((s) => pos(s.diameter_mm)) : [];
      const ds = (steps.length > 0 ? steps : [pos(p['counterbore_diameter_mm']), pos(p['bore_diameter_mm'])])
        .filter((d): d is number => d != null)
        .sort((a, b) => b - a);
      if (ds.length > 0) out.push({ kind: 'diameter', valueMm: ds[0]!, diameters: ds, faceIds, featureType: f.type, centroid });
    } else if (f.type === 'Edge' && f.variant === 'countersink') {
      const d = pos(p['entry_diameter_mm']);
      if (d) out.push({ kind: 'diameter', valueMm: d, faceIds, featureType: f.type, centroid });
    } else if (f.type === 'Edge' && f.variant === 'round') {
      const r = pos(p['radius_mm']);
      if (r) out.push({ kind: 'radius', valueMm: r, faceIds, featureType: f.type, centroid });
    } else if (f.type === 'Ring' && f.variant === 'outer_diameter') {
      const d = pos(p['diameter_mm']);
      if (d) out.push({ kind: 'diameter', valueMm: d, faceIds, featureType: f.type, centroid });
    }
  }
  return out;
}

function fromSheetMetal(features: ReadonlyArray<StoredV2Feature>): Candidate[] {
  const out: Candidate[] = [];
  for (const f of features) {
    const kind: AnnotationKind | null = f.feature_type === 'SimpleHole' ? 'diameter' : f.feature_type === 'StraightBend' ? 'radius' : null;
    if (!kind) continue;
    for (const o of f.occurrences ?? []) {
      const value = pos(kind === 'diameter' ? f.diameter_mm : o.radius_mm ?? f.radius_mm);
      const faceIds = faces(o.face_ids);
      if (value && faceIds.length > 0) out.push({ kind, valueMm: value, faceIds, featureType: f.feature_type!, centroid: point(o.centroid) });
    }
  }
  return out;
}

const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The same physical feature reported twice: same kind and size, and a shared face or the same position. */
function samePhysicalFeature(a: Candidate, b: Candidate): boolean {
  if (a.kind !== b.kind || Math.abs(a.valueMm - b.valueMm) > SAME_SIZE_MM) return false;
  if (a.faceIds.some((id) => b.faceIds.includes(id))) return true;
  return a.centroid != null && b.centroid != null && dist(a.centroid, b.centroid) <= SAME_POSITION_MM;
}

function merge(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const c of candidates) {
    const into = merged.find((m) => samePhysicalFeature(m, c));
    if (!into) { merged.push({ ...c, faceIds: [...c.faceIds] }); continue; }
    into.faceIds = [...new Set([...into.faceIds, ...c.faceIds])].sort((x, y) => x - y);
  }
  // A merge can bridge two earlier groups through a shared face; run until stable.
  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      if (samePhysicalFeature(merged[i]!, merged[j]!)) {
        merged[i]!.faceIds = [...new Set([...merged[i]!.faceIds, ...merged[j]!.faceIds])].sort((x, y) => x - y);
        merged.splice(j, 1);
        j = i;
      }
    }
  }
  return merged;
}

export function buildDimensionAnnotations(source: AnnotationSource | null | undefined): DimensionAnnotation[] {
  const machining = source?.machining_features?.features ?? [];
  const candidates = machining.length > 0
    ? fromMachining(machining)
    : fromSheetMetal(source?.feature_graph_v2?.features ?? []);

  // Identical features share one callout, as a drawing writes "4x R1.5": same kind and the same
  // label. Each keeps its own faces, so the label sits on the first and a click lights all.
  const groups = new Map<string, Candidate[]>();
  for (const c of merge(candidates)) {
    const key = `${c.kind}|${labelOf(c)}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].map((members) => {
    const first = members[0]!;
    const faceIds = [...new Set(members.flatMap((m) => m.faceIds))].sort((a, b) => a - b);
    const label = labelOf(first);
    const tolerance = members.length > 0 && !first.diameters ? toleranceFor(first.kind, first.valueMm, source?.pmi?.dimensions) : null;
    return {
      id: `${first.kind === 'diameter' ? 'd' : 'r'}${formatDimension(first.valueMm)}-f${String(first.faceIds[0])}`,
      kind: first.kind,
      valueMm: first.valueMm,
      label: `${members.length > 1 ? `${members.length}× ` : ''}${label}${tolerance ? ` ${formatTolerance(tolerance)}` : ''}`,
      faceIds,
      count: members.length,
      instances: members.map((m) => m.faceIds),
      tolerance,
      featureType: first.featureType,
    };
  });
}

const SAME_NOMINAL_MM = 0.005;

/**
 * The tolerance the PMI states for a radius or diameter of this size. The STEP ties a dimension
 * to its CAD feature by name only (its shape aspects carry no faces), so the match is by kind and
 * nominal value, and only when it is one-to-one: two PMI dimensions of the same size are ambiguous,
 * and a basic or tolerance-free dimension has nothing to show.
 */
export function toleranceFor(
  kind: AnnotationKind, valueMm: number, dimensions: ReadonlyArray<PmiDimension> | undefined,
): DimensionTolerance | null {
  const same = (dimensions ?? []).filter((d) => d.kind === kind && d.nominal_mm != null && Math.abs(d.nominal_mm - valueMm) <= SAME_NOMINAL_MM);
  const only = same.length === 1 ? same[0]! : null;
  if (!only || only.basic || only.lower_mm == null || only.upper_mm == null) return null;
  return { lowerMm: only.lower_mm, upperMm: only.upper_mm, callout: only.callout ?? null };
}

export function formatTolerance(t: DimensionTolerance): string {
  if (Math.abs(t.upperMm + t.lowerMm) < 1e-9) return `±${formatDimension(t.upperMm)}`;
  const sign = (v: number) => (v >= 0 ? '+' : '−');
  return `${sign(t.upperMm)}${formatDimension(Math.abs(t.upperMm))}/${sign(t.lowerMm)}${formatDimension(Math.abs(t.lowerMm))}`;
}

function labelOf(c: Candidate): string {
  const prefix = c.kind === 'diameter' ? 'Ø' : 'R';
  return c.diameters && c.diameters.length > 1
    ? c.diameters.map((d) => `Ø${formatDimension(d)}`).join(' / ')
    : `${prefix}${formatDimension(c.valueMm)}`;
}

export function visibleAnnotations(all: readonly DimensionAnnotation[], mode: AnnotationMode): DimensionAnnotation[] {
  if (mode === 'off') return [];
  return mode === 'all' ? [...all] : all.filter((a) => a.kind === mode);
}
