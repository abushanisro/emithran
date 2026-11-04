/**
 * The wall thickness over the surface, from the worker's rays (casting.wall_mm.points, worker 0.17.0): each vertex of a face's mesh takes the thickness of
 * the nearest rays of that same face (inverse-distance weighted over the four nearest), so a face whose wall changes across it shows a gradient, not one
 * colour. A face with no ray keeps the plain body colour. The ramp's ends are the worker's own wall_mm.min and wall_mm.max (its 5th and 95th area-weighted
 * percentiles), so a few single-ray extremes at edges do not stretch it. No threshold is applied: this is the measurement. Pure, so it is tested.
 */
import { toGlbFrame, type Xyz } from '@/lib/casting/viewer-model';

/** One ray of the result: the face it started from, where (the part's Z-up mm) and how far it ran through the metal. */
export interface WallRay {
  face: number;
  at: Xyz;
  mm: number;
}

/** A ray's point in the GLB frame (Y-up metres) with its thickness. */
export interface Sample {
  p: readonly [number, number, number];
  mm: number;
}

export interface ThicknessField {
  byFace: Map<number, Sample[]>;
  range: { min: number; max: number };
}

/** The rays by face, in the viewer's frame; null when there are none or the range is not usable. */
export function thicknessField(rays: readonly WallRay[], range: { min: number; max: number } | null): ThicknessField | null {
  if (!range || !(range.min > 0) || !(range.max >= range.min)) return null;
  const byFace = new Map<number, Sample[]>();
  for (const r of rays) {
    if (!Number.isFinite(r.mm) || r.mm <= 0) continue;
    const list = byFace.get(r.face) ?? [];
    list.push({ p: toGlbFrame(r.at), mm: r.mm });
    byFace.set(r.face, list);
  }
  return byFace.size === 0 ? null : { byFace, range };
}

/**
 * The thickness at each vertex (positions are flat x y z in the GLB frame): the inverse-square-distance weighted mean of the `k` nearest samples. A vertex on
 * a sample takes its value exactly.
 */
export function vertexThickness(positions: ArrayLike<number>, samples: readonly Sample[], k = 4): Float32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n);
  if (samples.length === 0) return out;
  const nearest: { d2: number; mm: number }[] = [];
  for (let v = 0; v < n; v++) {
    const x = positions[3 * v] ?? 0;
    const y = positions[3 * v + 1] ?? 0;
    const z = positions[3 * v + 2] ?? 0;
    nearest.length = 0;
    for (const s of samples) {
      const d2 = (s.p[0] - x) ** 2 + (s.p[1] - y) ** 2 + (s.p[2] - z) ** 2;
      if (nearest.length < k) {
        nearest.push({ d2, mm: s.mm });
        nearest.sort((a, b) => a.d2 - b.d2);
      } else if (d2 < (nearest[k - 1]?.d2 ?? Infinity)) {
        nearest[k - 1] = { d2, mm: s.mm };
        nearest.sort((a, b) => a.d2 - b.d2);
      }
    }
    const exact = nearest.find((s) => s.d2 < 1e-18);
    if (exact) {
      out[v] = exact.mm;
      continue;
    }
    let sum = 0;
    let weights = 0;
    for (const s of nearest) {
      const w = 1 / s.d2;
      sum += w * s.mm;
      weights += w;
    }
    out[v] = sum / weights;
  }
  return out;
}

/** The ramp of thickness-map.ts (hue 0 thinnest to 240 thickest, 80 % saturation, 50 % lightness) as red, green, blue in 0..1. */
export function thicknessRgb(t: number, range: { min: number; max: number }): [number, number, number] {
  const span = range.max - range.min;
  const x = span > 0 ? Math.min(1, Math.max(0, (t - range.min) / span)) : 0.5;
  const hue = (240 * x) / 60;
  const c = 0.8;
  const m = 0.5 - c / 2;
  const q = c * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] = hue < 1 ? [c, q, 0] : hue < 2 ? [q, c, 0] : hue < 3 ? [0, c, q] : hue < 4 ? [0, q, c] : [q, 0, c];
  return [r + m, g + m, b + m];
}

/** Flat red, green, blue per vertex for a mesh's thicknesses. */
export function vertexColors(thickness: Float32Array, range: { min: number; max: number }): Float32Array {
  const out = new Float32Array(thickness.length * 3);
  thickness.forEach((t, i) => {
    const [r, g, b] = thicknessRgb(t, range);
    out.set([r, g, b], 3 * i);
  });
  return out;
}
