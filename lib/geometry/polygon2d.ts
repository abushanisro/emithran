// Plain 2D polygon math shared by nest-view.tsx and flat-pattern-view.tsx --
// both work with the same real flat-pattern outline (cad-engine's wire-walk
// extraction, an array of [x_mm, y_mm] points), just for different purposes
// (nesting placement vs. a standalone single-part drawing).

export function shoelaceAreaMm2(pts: number[][]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b || typeof a[0] !== 'number' || typeof a[1] !== 'number' || typeof b[0] !== 'number' || typeof b[1] !== 'number') continue;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

// minXMm/minYMm are included because the real outline (cad-engine's wire-walk
// frame, anchored at whichever panel's own bbox corner became the root -- see
// feature_extractors.py's _compute_flat_pattern_outline) is NOT guaranteed to
// start at (0,0) or even have all-positive coordinates. Callers that draw
// this polygon (rather than just needing its size, like nest-view.tsx's
// rectangle-yield estimate) must subtract these before rendering, or shapes
// end up positioned arbitrarily relative to a (0,0)-assuming viewBox/dimension
// lines -- confirmed live: this exact gap made a flat-pattern drawing's
// dimension line cut through the middle of the shape instead of framing it.
export function boundingBoxMm(pts: number[][]): { widthMm: number; lengthMm: number; minXMm: number; minYMm: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of pts) {
    if (typeof p[0] === 'number' && typeof p[1] === 'number') {
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  const minXMm = Math.min(...xs);
  const minYMm = Math.min(...ys);
  return { widthMm: Math.max(...xs) - minXMm, lengthMm: Math.max(...ys) - minYMm, minXMm, minYMm };
}
