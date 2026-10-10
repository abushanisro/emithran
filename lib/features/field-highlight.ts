import type { FeatureGraphV2, FeatureNodeV2, MeasurementKey } from '@/lib/types/manufacturing';

import { cutLengthHighlight } from './cut-length-highlight';
import { isBend } from './feature-graph';

export interface FieldHighlight {
  /** What the viewer highlights. */
  node: FeatureNodeV2;
  /** What the CAD engine measured on those faces, for the engineer to compare with the field. */
  measured: { value: number; unit: string; label: string };
  /** False when the faces do not account for the number (engine-side) or for the input's current value. */
  reconciles: boolean;
  /** Why it does not reconcile, for the engineer. */
  note?: string;
}

type Source =
  | { kind: 'cut' }
  | { kind: 'measurement'; key: MeasurementKey; label: string }
  | { kind: 'bends' }
  | { kind: 'longest_bend' };

// Evidence key (declared by the backend on the input's trace step, see
// backend costing/shared/cad-evidence.ts) -> how to read its faces from the part.
const SOURCE_BY_EVIDENCE: Record<string, Source> = {
  cut_length: { kind: 'cut' },
  pierce_count: { kind: 'measurement', key: 'pierce_count', label: 'pierces' },
  bend_line_length: { kind: 'longest_bend' },
  bend_count: { kind: 'bends' },
  flat_pattern_area: { kind: 'measurement', key: 'flat_pattern_area', label: 'flat pattern area' },
};

/**
 * The faces behind a CAD-derived calculator input, or null when this part's
 * analysis did not record them (analysed before the engine emitted that set):
 * the field then stays plain, never highlights a guess.
 */
export function resolveFieldHighlight(
  evidenceKey: string | undefined,
  graph: FeatureGraphV2 | null | undefined,
): FieldHighlight | null {
  const source = evidenceKey ? SOURCE_BY_EVIDENCE[evidenceKey] : undefined;
  if (!source || !graph) return null;

  if (source.kind === 'cut') {
    const cut = cutLengthHighlight(graph.features);
    if (!cut) return null;
    const value = cut.parts.reduce((s, p) => s + p.lengthMm, 0);
    return { node: cut.all, measured: { value, unit: 'mm', label: 'cut length' }, reconciles: true };
  }

  if (source.kind === 'longest_bend') {
    // "Bending Line Length" is the length of ONE bend (press-brake tonnage is per
    // bend), so compare the longest bend, not the sum of all of them.
    // The engine's recorded bend lines when present; an older analysis has the same
    // bends (faces + length) on its bend features, so it needs no re-analysis.
    const m = graph.measurements?.bend_line_length;
    const fromFeatures = graph.features.filter(isBend).flatMap((f) => f.occurrences)
      .map((o) => ({ face_ids: o.face_ids, length_mm: o.bend_length_mm }));
    const bends = (m?.occurrences ?? fromFeatures)
      .filter((o) => o.face_ids.length > 0 && typeof o.length_mm === 'number' && o.length_mm > 0);
    if (bends.length === 0) return null;
    const longest = bends.reduce((a, b) => ((b.length_mm ?? 0) > (a.length_mm ?? 0) ? b : a));
    return {
      node: { id: 'longest_bend', feature_type: 'StraightBend', occurrences: [{ centroid: [0, 0, 0], face_ids: longest.face_ids }] },
      measured: { value: longest.length_mm ?? 0, unit: 'mm', label: `longest of ${bends.length} bends` },
      reconciles: m?.reconciles ?? true,
    };
  }

  if (source.kind === 'bends') {
    const bends = graph.features.filter(isBend).flatMap((f) => f.occurrences);
    if (bends.length === 0) return null;
    return {
      node: {
        id: 'bends_all', feature_type: 'StraightBend',
        occurrences: bends.map((o) => ({ centroid: o.centroid, face_ids: o.face_ids })),
      },
      measured: { value: bends.length, unit: 'count', label: 'bends' },
      reconciles: true,
    };
  }

  const m = graph.measurements?.[source.key];
  const occurrences = m?.occurrences.filter((o) => o.face_ids.length > 0) ?? [];
  if (!m || occurrences.length === 0) return null;
  return {
    node: {
      id: `measurement_${source.key}`, feature_type: 'Blank',
      occurrences: occurrences.map((o) => ({ centroid: [0, 0, 0], face_ids: o.face_ids })),
    },
    measured: { value: m.value, unit: m.unit, label: source.label },
    reconciles: m.reconciles,
  };
}

/**
 * Check the faces' measured value against what the input currently holds, so a
 * stale or edited value is flagged instead of silently shown as verified.
 * Counts must match exactly; lengths and areas within rounding (0.2%, at least 0.5).
 */
export function checkAgainstInput(highlight: FieldHighlight, inputValue: unknown): FieldHighlight {
  const value = typeof inputValue === 'number' ? inputValue : Number(inputValue);
  if (!Number.isFinite(value) || inputValue === '' || inputValue === null) return highlight;
  const { value: measured, unit } = highlight.measured;
  const tolerance = unit === 'count' ? 0 : Math.max(0.5, Math.abs(value) * 0.002);
  if (Math.abs(measured - value) <= tolerance) return highlight;
  const shown = (n: number) => Math.round(n * 10) / 10;
  return {
    ...highlight,
    reconciles: false,
    note: `the input holds ${shown(value)} but these faces measure ${shown(measured)} ${unit}`,
  };
}
