// The holes and threads of a machined part as the CAD engine's machining recognizer reports them (cad-engine
// machining/machining_feature_recognizer.py). Pure: the caller passes the features, and how a feature's faces map to the feature_graph_v2
// occurrences its calculator inputs light.
//
// A bolt circle is one feature for all its holes: the recognizer absorbs the member holes into a SimpleHole of variant pcd_pattern whose
// params give their diameter (hole_diameter_mm), number (hole_count) and depth (depth_mm) and, when every member is tapped, their thread
// (tap_spec, hole_type "tapped"). Read like a single hole (diameter_mm, spec), such a pattern was neither drilled nor tapped.
import { OFF_AXIS_MM } from './capability/live-tooling';

import type { FeatureOccurrenceRef } from './feature-occurrences';

/** A feature of machining_features.features. */
export interface MachiningFeatureLike {
  type?: unknown;
  variant?: unknown;
  params?: Record<string, unknown> | null;
  face_ids?: unknown;
}

/** The faces of a feature as the occurrences they belong to (feature-occurrences.ts occurrencesOfFaces over the part's graph). */
export type OccurrencesOf = (faceIds: readonly unknown[] | null | undefined) => FeatureOccurrenceRef[];

export interface HoleGroup {
  diameter_mm: number;
  count: number;
  depth_mm?: number;
  occurrences?: FeatureOccurrenceRef[];
}

export interface ThreadEntry {
  size: string;
  count: number;
  pitchMm?: number;
  depthMm?: number;
  isThrough?: boolean;
  occurrences?: FeatureOccurrenceRef[];
  /** Of `count`, the threads off the turning centreline: on a lathe they are tapped with a live (driven) tool. */
  liveCount?: number;
}

/** A thread as the drawing or the CAD gives it: a drawing's may name its size `spec`, and its count may arrive as text. */
export interface ThreadInput {
  size?: string;
  spec?: string;
  count: number | string;
  pitchMm?: number;
  depthMm?: number;
  isThrough?: boolean;
  occurrences?: FeatureOccurrenceRef[];
  liveCount?: number;
}

/** Hole variants drilled at their own diameter (a threaded hole at its tap drill, then tapped). */
const DRILLED: ReadonlySet<string> = new Set(['through', 'blind', 'threaded', 'cross', 'pcd_pattern']);

const isPattern = (f: MachiningFeatureLike) => f.variant === 'pcd_pattern';
const holesOf = (f: MachiningFeatureLike) => (isPattern(f) ? Math.max(1, Number(f.params?.hole_count) || 1) : 1);
const faceIdsOf = (f: MachiningFeatureLike): readonly unknown[] | undefined => (Array.isArray(f.face_ids) ? f.face_ids : undefined);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The drilled holes by diameter (to 0.1 mm): how many, the deepest, and the occurrences they light. */
export function holeGroupsOfFeatures(features: readonly MachiningFeatureLike[], occurrencesOf: OccurrencesOf): HoleGroup[] {
  const groups = new Map<number, HoleGroup>();
  for (const f of features) {
    if (f.type !== 'SimpleHole' || !DRILLED.has(String(f.variant))) continue;
    const diameter = Number(isPattern(f) ? f.params?.hole_diameter_mm : f.params?.diameter_mm);
    if (!(diameter > 0)) continue;
    const key = Math.round(diameter * 10) / 10;
    const depth = Number(f.params?.depth_mm);
    const g = groups.get(key) ?? { diameter_mm: key, count: 0 };
    g.count += holesOf(f);
    if (depth > 0) g.depth_mm = Math.max(g.depth_mm ?? 0, depth);
    const occ = occurrencesOf(faceIdsOf(f));
    if (occ.length > 0) g.occurrences = [...(g.occurrences ?? []), ...occ];
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** The tapped holes, one entry per feature: a threaded hole, or a tapped bolt circle (always off the centreline, round the axis). */
export function tappedHolesOfFeatures(features: readonly MachiningFeatureLike[], occurrencesOf: OccurrencesOf): ThreadEntry[] {
  return features
    .filter((f) => f.type === 'SimpleHole' && (f.variant === 'threaded' || (isPattern(f) && f.params?.hole_type === 'tapped')))
    .map((f) => {
      const count = holesOf(f);
      const depth = Number(f.params?.depth_mm) || 0;
      const offAxis = isPattern(f) || (Number(f.params?.distance_from_axis_mm) || 0) > OFF_AXIS_MM;
      return {
        // No thread spec on the feature: the size is unknown, and tapping names it as a missing input rather than pricing an assumed one.
        size: text(isPattern(f) ? f.params?.tap_spec : f.params?.spec),
        count,
        ...(depth > 0 ? { depthMm: depth } : {}),
        isThrough: Boolean(f.params?.through),
        occurrences: occurrencesOf(faceIdsOf(f)),
        liveCount: offAxis ? count : 0,
      };
    });
}

/**
 * Threads by size: "M4×0.7" / "M4x0.7 - 6H" -> "M4", so the tapping lookups hit the size key instead of silently falling back to a default.
 * Merges duplicate sizes: the count and the live-tool count add up, the depth is averaged, and through only when every merged hole is.
 */
export function normalizeThreadSpecs(threads: readonly ThreadInput[]): ThreadEntry[] {
  interface Group { count: number; liveCount: number; pitchMm?: number; depthSum: number; depthCount: number; throughCount: number; occurrences: FeatureOccurrenceRef[] }
  const groups: Record<string, Group> = {};
  for (const t of threads) {
    const raw = (t.size ?? t.spec ?? '').trim().toUpperCase();
    // "M2×0.4": the pitch the CAD engine or the drawing wrote into the size itself.
    const metric = /^M\s*(\d+(?:\.\d+)?)(?:\s*[×X*]\s*(\d+(?:\.\d+)?))?/.exec(raw);
    const key = metric ? `M${metric[1]}` : (raw || 'size not given');
    const count = Number(t.count) || 0;
    if (count <= 0) continue;
    const pitchMm = t.pitchMm ?? (metric?.[2] ? Number(metric[2]) : undefined);
    const g: Group = groups[key] ?? { count: 0, liveCount: 0, pitchMm, depthSum: 0, depthCount: 0, throughCount: 0, occurrences: [] };
    g.occurrences.push(...(t.occurrences ?? []));
    g.count += count;
    g.liveCount += Math.min(count, Math.max(0, t.liveCount ?? 0));
    if (g.pitchMm == null && pitchMm != null) g.pitchMm = pitchMm;
    if (t.depthMm != null) { g.depthSum += t.depthMm * count; g.depthCount += count; }
    if (t.isThrough) g.throughCount += count;
    groups[key] = g;
  }
  return Object.entries(groups).map(([size, g]) => ({
    size,
    count: g.count,
    ...(g.pitchMm != null ? { pitchMm: g.pitchMm } : {}),
    ...(g.depthCount > 0 ? { depthMm: Math.round((g.depthSum / g.depthCount) * 100) / 100 } : {}),
    ...(g.depthCount > 0 ? { isThrough: g.throughCount === g.depthCount } : {}),
    ...(g.occurrences.length > 0 ? { occurrences: g.occurrences } : {}),
    ...(g.liveCount > 0 ? { liveCount: g.liveCount } : {}),
  }));
}
