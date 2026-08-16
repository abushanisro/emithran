'use client';

import { useSvgPanZoom } from '@/components/ui/use-svg-pan-zoom';
import { boundingBoxMm } from '@/lib/geometry/polygon2d';

export interface NormalizedHole { cx_mm: number; cy_mm: number; diameter_mm: number }
export interface NormalizedFlatPattern { widthMm: number; lengthMm: number; points: number[][]; holes: NormalizedHole[] }

// cad-engine's wire-walk outline is anchored at whichever panel's own bbox
// corner became the root of its unfold frame (see
// feature_extractors.py's _compute_flat_pattern_outline) -- NOT guaranteed
// to start at (0,0), and can have negative coordinates. Shifting both the
// outline and every hole by the outline's own (minXMm, minYMm) here, once,
// is what makes rendering/dimension-lines consistent everywhere this is
// used -- confirmed live: without this, a flat-pattern drawing's dimension
// line cut through the middle of the shape instead of framing it. As a
// side benefit, hole positions read as "distance from the part's own edge"
// afterward, a real, checkable dimension.
export function normalizeFlatPattern(
  outlinePointsMm: number[][] | undefined,
  holesMm: { cx_mm: number; cy_mm: number; diameter_mm: number }[] | undefined,
): NormalizedFlatPattern | null {
  if (!Array.isArray(outlinePointsMm) || outlinePointsMm.length < 3) return null;
  const { widthMm, lengthMm, minXMm, minYMm } = boundingBoxMm(outlinePointsMm);
  const points = outlinePointsMm.map(([x, y]) => [(x ?? 0) - minXMm, (y ?? 0) - minYMm]);
  const holes = (holesMm ?? []).map((h) => ({ ...h, cx_mm: h.cx_mm - minXMm, cy_mm: h.cy_mm - minYMm }));
  return { widthMm, lengthMm, points, holes };
}

function polygonToPoints(pts: number[][]): string {
  return pts
    .filter((p): p is [number, number] => p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
    .map(([x, y]) => `${x.toString()},${y.toString()}`)
    .join(' ');
}

interface FlatPatternDrawingProps {
  bbox: NormalizedFlatPattern;
  selectedHoleIdx?: number | null | undefined;
  onHoleClick?: ((index: number) => void) | undefined;
  showDimensions?: boolean | undefined;
}

// Pure SVG rendering of one already-normalized flat-pattern outline -- shared
// by flat-pattern-view.tsx (full standalone view) and nest-view.tsx's
// per-part detail panel (so clicking a placed part shows its own real
// dimensions/holes right there, without leaving Nest to open Flat Pattern
// separately).
export function FlatPatternDrawing({ bbox, selectedHoleIdx = null, onHoleClick, showDimensions = true }: FlatPatternDrawingProps) {
  const { svgRef, effectiveViewBox, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } =
    useSvgPanZoom(bbox.widthMm, bbox.lengthMm);

  const dimOffsetMm = Math.max(bbox.widthMm, bbox.lengthMm) * 0.08;

  return (
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      viewBox={effectiveViewBox ? [effectiveViewBox.x, effectiveViewBox.y, effectiveViewBox.w, effectiveViewBox.h].join(' ') : undefined}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Flip Y so mm-space (Y-up, matches cad-engine's 2D frame) renders top-down like a real flat-pattern drawing. */}
      <g transform={`translate(0 ${bbox.lengthMm.toString()}) scale(1 -1)`}>
        <polygon
          points={polygonToPoints(bbox.points)}
          fill="#8ecae6" fillOpacity={0.55} stroke="#2a6f97"
          strokeWidth={Math.max(bbox.widthMm, bbox.lengthMm) * 0.0015}
        />
        {bbox.holes.map((h, hi) => (
          <circle
            key={hi} cx={h.cx_mm} cy={h.cy_mm} r={h.diameter_mm / 2}
            fill={selectedHoleIdx === hi ? '#4f9dff' : '#2b2b2b'}
            stroke={selectedHoleIdx === hi ? '#fff' : 'none'}
            strokeWidth={Math.max(bbox.widthMm, bbox.lengthMm) * 0.0015}
            className={onHoleClick ? 'cursor-pointer' : undefined}
            onClick={onHoleClick ? (e) => { e.stopPropagation(); onHoleClick(hi); } : undefined}
          />
        ))}
        {showDimensions && (
          <>
            {/* Width dimension line, below the part */}
            <g stroke="#aaa" strokeWidth={Math.max(bbox.widthMm, bbox.lengthMm) * 0.001} fill="none">
              <line x1={0} y1={-dimOffsetMm} x2={bbox.widthMm} y2={-dimOffsetMm} />
              <line x1={0} y1={-dimOffsetMm * 0.6} x2={0} y2={-dimOffsetMm * 1.2} />
              <line x1={bbox.widthMm} y1={-dimOffsetMm * 0.6} x2={bbox.widthMm} y2={-dimOffsetMm * 1.2} />
            </g>
            {/* Nested group un-flips just the text glyphs (scale(1 -1) again
                cancels the parent's Y-flip) while staying positioned inside
                the already-flipped parent frame -- otherwise the label text
                itself would render mirrored/upside-down. */}
            <g transform={`translate(${(bbox.widthMm / 2).toString()} ${(-dimOffsetMm * 1.4).toString()}) scale(1 -1)`}>
              <text x={0} y={0} fill="#ccc" fontSize={Math.max(bbox.widthMm, bbox.lengthMm) * 0.035} textAnchor="middle">
                {bbox.widthMm.toFixed(1)} mm
              </text>
            </g>
            {/* Length dimension line, left of the part */}
            <g stroke="#aaa" strokeWidth={Math.max(bbox.widthMm, bbox.lengthMm) * 0.001} fill="none">
              <line x1={-dimOffsetMm} y1={0} x2={-dimOffsetMm} y2={bbox.lengthMm} />
              <line x1={-dimOffsetMm * 0.6} y1={0} x2={-dimOffsetMm * 1.2} y2={0} />
              <line x1={-dimOffsetMm * 0.6} y1={bbox.lengthMm} x2={-dimOffsetMm * 1.2} y2={bbox.lengthMm} />
            </g>
            <g transform={`translate(${(-dimOffsetMm * 1.6).toString()} ${(bbox.lengthMm / 2).toString()}) scale(1 -1)`}>
              <text x={0} y={0} fill="#ccc" fontSize={Math.max(bbox.widthMm, bbox.lengthMm) * 0.035} textAnchor="middle">
                {bbox.lengthMm.toFixed(1)} mm
              </text>
            </g>
          </>
        )}
      </g>
    </svg>
  );
}
