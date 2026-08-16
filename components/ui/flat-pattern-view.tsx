'use client';

import React, { useMemo, useState } from 'react';

import { FlatPatternDrawing, normalizeFlatPattern } from '@/components/ui/flat-pattern-drawing';
import { shoelaceAreaMm2 } from '@/lib/geometry/polygon2d';

export interface FlatPatternHole { cx_mm: number; cy_mm: number; diameter_mm: number }

interface FlatPatternViewProps {
  partName?: string | undefined;
  outlinePointsMm?: number[][] | undefined;
  holesMm?: FlatPatternHole[] | undefined;
  outlineSource?: 'wire_walk' | 'unavailable' | undefined;
  boundingLengthMm?: number | undefined;
  boundingWidthMm?: number | undefined;
  // Independently-computed true flat-pattern area (item.flatPatternAreaMm2 --
  // panel-area + bend-allowance mass-property summation, a completely
  // different code path from the wire-walk outline itself). This is the
  // EXACT number cad-engine's own _compute_flat_pattern_outline already
  // reconciled the outline against (10% tolerance) before ever returning
  // outlineSource: 'wire_walk' -- see feature_extractors.py. Showing the
  // real numbers here (not just trusting that pass/fail) is what actually
  // lets the user verify the outline themselves.
  flatPatternAreaMm2?: number | undefined;
  materialLabel?: string | undefined;
  gradeLabel?: string | undefined;
  thicknessMm?: number | undefined;
  cutLengthMm?: number | undefined;
  bendCount?: number | undefined;
  holeCount?: number | undefined;
  pierceCount?: number | undefined;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5 border-b border-white/5">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-right">{value}</span>
    </div>
  );
}

// The single unfolded 2D outline for one part -- a real flat-pattern
// drawing, not a placeholder rectangle. This is the SAME geometry Nest
// places multiple copies of (cad-engine's wire-walk extractor, see
// feature_extractors.py's _compute_flat_pattern_outline); this view just
// shows it on its own, before any sheet/nesting decision is made. Reads
// straight off the already-loaded BOM item's featureGraph -- no true-nest
// (or any other) network call needed, since the outline is CAD-static.
export function FlatPatternView({
  partName, outlinePointsMm, holesMm, outlineSource, boundingLengthMm, boundingWidthMm, flatPatternAreaMm2,
  materialLabel, gradeLabel, thicknessMm, cutLengthMm, bendCount, holeCount, pierceCount,
}: FlatPatternViewProps) {
  const bbox = useMemo(() => normalizeFlatPattern(outlinePointsMm, holesMm), [outlinePointsMm, holesMm]);

  // The same reconciliation cad-engine already performed server-side before
  // ever accepting this outline (see this prop's own doc comment) -- surfaced
  // here as real numbers, not just a pass/fail badge, so the user can verify
  // it themselves rather than trust an opaque "verified" label.
  const areaCheck = useMemo(() => {
    if (!bbox) return null;
    const grossAreaMm2 = shoelaceAreaMm2(bbox.points);
    const totalHoleAreaMm2 = bbox.holes.reduce((sum, h) => sum + Math.PI * (h.diameter_mm / 2) ** 2, 0);
    const netAreaMm2 = grossAreaMm2 - totalHoleAreaMm2;
    const diffPct = typeof flatPatternAreaMm2 === 'number' && flatPatternAreaMm2 > 0
      ? Math.abs(netAreaMm2 - flatPatternAreaMm2) / flatPatternAreaMm2 * 100
      : null;
    return { grossAreaMm2, totalHoleAreaMm2, netAreaMm2, diffPct };
  }, [bbox, flatPatternAreaMm2]);

  const [selectedHoleIdx, setSelectedHoleIdx] = useState<number | null>(null);

  if (!bbox) {
    return (
      <div className="flex flex-1 items-center justify-center text-white/70 text-sm text-center px-6">
        {outlineSource === 'unavailable'
          ? "No real flat-pattern outline is stored for this part. cad-engine's wire-walk extractor could not build a valid boundary for this part's topology on the last analysis. Re-run Reanalyze to retry extraction."
          : 'Real flat-pattern outline unavailable for this part.'}
      </div>
    );
  }

  const selectedHole = selectedHoleIdx !== null ? bbox.holes[selectedHoleIdx] : undefined;

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 bg-[#2b2b2b] relative">
        <FlatPatternDrawing bbox={bbox} selectedHoleIdx={selectedHoleIdx} onHoleClick={setSelectedHoleIdx} />
      </div>

      <div className="w-80 shrink-0 border-l border-[#555555] bg-[#3f3f3f] text-white p-3 overflow-y-auto text-xs space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">Flat pattern</p>
        {partName && <Row label="Part" value={partName} />}
        {materialLabel && <Row label="Material" value={materialLabel} />}
        {gradeLabel && <Row label="Grade" value={gradeLabel} />}
        {typeof thicknessMm === 'number' && <Row label="Thickness" value={`${thicknessMm.toString()} mm`} />}
        <Row label="Width" value={`${bbox.widthMm.toFixed(2)} mm`} />
        <Row label="Length" value={`${bbox.lengthMm.toFixed(2)} mm`} />
        {typeof boundingWidthMm === 'number' && typeof boundingLengthMm === 'number' && (
          <Row label="CAD bounding rect" value={`${boundingWidthMm.toFixed(1)} × ${boundingLengthMm.toFixed(1)} mm`} />
        )}
        {typeof cutLengthMm === 'number' && <Row label="Cut length" value={`${cutLengthMm.toFixed(1)} mm`} />}
        {typeof bendCount === 'number' && <Row label="Bends" value={bendCount} />}
        {typeof holeCount === 'number' && <Row label="Holes" value={holeCount} />}
        {typeof pierceCount === 'number' && <Row label="Pierces" value={pierceCount} />}
        <Row label="Outline source" value={outlineSource === 'wire_walk' ? 'verified geometry' : 'unavailable'} />

        {areaCheck && (
          <div className="mt-3 pt-2 border-t border-white/10">
            <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">Geometry proof</p>
            <Row label="Outline area (gross)" value={`${areaCheck.grossAreaMm2.toFixed(1)} mm²`} />
            <Row label="Hole area (subtracted)" value={`${areaCheck.totalHoleAreaMm2.toFixed(1)} mm²`} />
            <Row label="Outline area (net)" value={`${areaCheck.netAreaMm2.toFixed(1)} mm²`} />
            {typeof flatPatternAreaMm2 === 'number' && flatPatternAreaMm2 > 0 && areaCheck.diffPct !== null && (
              <>
                <Row label="Independently-computed CAD area" value={`${flatPatternAreaMm2.toFixed(1)} mm²`} />
                <div className={`flex items-center gap-1.5 mt-1 rounded px-2 py-1 ${areaCheck.diffPct <= 10 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  <span>{areaCheck.diffPct <= 10 ? '✓' : '⚠'}</span>
                  <span>
                    {areaCheck.diffPct <= 10 ? 'Matches' : 'Differs from'} the independently-computed CAD flat-pattern area
                    within {areaCheck.diffPct.toFixed(1)}%
                  </span>
                </div>
              </>
            )}
            <p className="text-[10px] text-white/40 mt-1.5 leading-snug">
              The outline&apos;s own area (computed here, client-side, from the drawn polygon) is compared against
              flatPatternAreaMm2 -- a completely independent CAD mass-property calculation. cad-engine already
              required this same check to be within 10% before it would return this outline at all (see
              feature_extractors.py) -- this is that same proof, shown with real numbers instead of just trusting a pass/fail.
            </p>
          </div>
        )}

        {bbox.holes.length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/10">
            <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">
              Holes ({bbox.holes.length}) — click a hole to inspect (position is distance from the part&apos;s own bottom-left corner)
            </p>
            {selectedHole && (
              <div className="mb-1.5 rounded bg-blue-600/20 px-2 py-1">
                <Row label={`Hole ${((selectedHoleIdx ?? 0) + 1).toString()} position`} value={`${selectedHole.cx_mm.toFixed(2)}, ${selectedHole.cy_mm.toFixed(2)} mm`} />
                <Row label={`Hole ${((selectedHoleIdx ?? 0) + 1).toString()} diameter`} value={`Ø${selectedHole.diameter_mm.toFixed(2)} mm`} />
              </div>
            )}
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {bbox.holes.map((h, hi) => (
                <button
                  key={hi}
                  onClick={() => { setSelectedHoleIdx(hi); }}
                  className={`w-full text-left flex items-center justify-between px-1.5 py-0.5 rounded ${selectedHoleIdx === hi ? 'bg-blue-600' : 'hover:bg-white/10'}`}
                >
                  <span>#{hi + 1}</span>
                  <span className="font-mono">Ø{h.diameter_mm.toFixed(2)} @ ({h.cx_mm.toFixed(1)}, {h.cy_mm.toFixed(1)})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-white/40 mt-2 leading-snug">
          This is the real unfolded 2D outline (cad-engine&apos;s wire-walk extraction), not a bounding-rectangle placeholder. Open Nest to place multiple copies of this exact shape on a sheet.
        </p>
      </div>
    </div>
  );
}
