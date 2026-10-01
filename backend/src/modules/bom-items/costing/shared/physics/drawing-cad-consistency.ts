/**
 * Does the part's 2D drawing describe the SAME object as its 3D CAD model?
 *
 * Not a manufacturing/DFM tolerance check — a data-integrity check. The two
 * files were authored (or extracted) independently; this answers "did the
 * right files get uploaded, did OCR misread a number", never "is the part
 * in-tolerance". No ISO 2768 or similar general-tolerance table exists
 * anywhere in memory/ (checked) — none is invented here. Each comparator's
 * own small match epsilon is a disclosed extraction/rounding-noise
 * allowance, never presented as a sourced manufacturing tolerance.
 *
 * One table-driven shape, not N bespoke reconciliations: a new fact pair is
 * one new FactSpec row plus a comparator reuse, never new control flow.
 * Generalizes the one place this codebase already does this well —
 * resolveEffectiveFamily (material-resolution.service.ts) comparing a
 * material-implied family against the geometry-classified one and
 * surfacing a real warning on disagreement, never silently picking one.
 */

export type MismatchStatus = 'match' | 'mismatch' | 'drawing_only' | 'cad_only';
export type MismatchSeverity = 'critical' | 'warning' | 'info';

export interface FactMismatch {
  fact: string;
  label: string;
  drawingValue: string;
  cadValue: string;
  status: MismatchStatus;
  severity: MismatchSeverity;
  message: string;
  /** CAD features to highlight on click — only when the fact has real ones. */
  v2FeatureIds?: string[];
}

/** Rounding/extraction-noise allowance (title-block OCR, not a manufacturing
 *  tolerance) — values within epsilonMm of each other are the same fact.
 *  The tiny added margin absorbs binary floating-point subtraction error
 *  (e.g. 2.1 - 2.0 === 0.10000000000000009 in IEEE 754 double), not a second
 *  real tolerance — a value exactly at the stated epsilon must count as a
 *  match, not fail by less than a billionth of a millimetre. */
function numericMatch(epsilonMm: number) {
  return (drawing: number, cad: number) => Math.abs(drawing - cad) <= epsilonMm + 1e-9;
}

/** Counts must agree exactly — there is no rounding reason for a real part
 *  to have a different number of bends or threads between its own 2D and 3D. */
function exactIntMatch(drawing: number, cad: number): boolean {
  return Math.round(drawing) === Math.round(cad);
}

function buildNumeric(args: {
  fact: string; label: string; severity: MismatchSeverity;
  drawing: number | null; cad: number | null;
  compare: (drawing: number, cad: number) => boolean;
  unit: string; v2FeatureIds?: string[];
}): FactMismatch {
  const { fact, label, severity, drawing, cad, compare, unit, v2FeatureIds } = args;
  const fmt = (v: number) => `${v} ${unit}`;
  if (drawing == null && cad == null) {
    return { fact, label, drawingValue: '—', cadValue: '—', status: 'match', severity: 'info', message: `${label}: not present in either source.` };
  }
  if (drawing == null) {
    return { fact, label, drawingValue: '—', cadValue: fmt(cad!), status: 'cad_only', severity: 'info', message: `${label}: only the 3D model has this (${fmt(cad!)}) — the drawing carries no value.` };
  }
  if (cad == null) {
    return { fact, label, drawingValue: fmt(drawing), cadValue: '—', status: 'drawing_only', severity: 'info', message: `${label}: only the drawing has this (${fmt(drawing)}) — the 3D model carries no value.` };
  }
  const match = compare(drawing, cad);
  return {
    fact, label, drawingValue: fmt(drawing), cadValue: fmt(cad),
    status: match ? 'match' : 'mismatch',
    severity,
    message: match
      ? `${label}: drawing (${fmt(drawing)}) and 3D model (${fmt(cad)}) agree.`
      : `${label}: drawing says ${fmt(drawing)}, the 3D model measures ${fmt(cad)} — these should be the same part.`,
    ...(v2FeatureIds ? { v2FeatureIds } : {}),
  };
}

export interface DrawingFacts {
  bendCount: number | null;
  sheetThicknessMm: number | null;
  threadCount: number | null;
  dimensionsMm: [number, number, number] | null;
}

export interface CadFacts {
  bendCount: number | null;
  sheetThicknessMm: number | null;
  /** Only meaningful for machining parts — see module doc on why sheet metal has none. */
  threadCount: number | null;
  dimensionsMm: [number, number, number] | null;
  bendFeatureIds?: string[];
  threadFeatureIds?: string[];
}

export function detectDrawingCadMismatches(drawing: DrawingFacts, cad: CadFacts): FactMismatch[] {
  const results: FactMismatch[] = [];

  results.push(buildNumeric({
    fact: 'bendCount', label: 'Bend count', severity: 'critical',
    drawing: drawing.bendCount, cad: cad.bendCount, compare: exactIntMatch, unit: 'bends',
    v2FeatureIds: cad.bendFeatureIds,
  }));

  results.push(buildNumeric({
    fact: 'sheetThicknessMm', label: 'Sheet thickness', severity: 'warning',
    drawing: drawing.sheetThicknessMm, cad: cad.sheetThicknessMm,
    compare: numericMatch(0.1), unit: 'mm',
  }));

  // Thread count is only ever populated on the CAD side for machining parts
  // (geometric pilot-hole inference, machining_geometry.py); sheet-metal
  // tapped holes are themselves synthesized FROM the drawing's own thread
  // callouts (catalog-operations.service.ts) — comparing those would be
  // circular. Callers pass cad.threadCount: null for sheet metal, which
  // correctly yields drawing_only/match-on-absence, never a fabricated check.
  results.push(buildNumeric({
    fact: 'threadCount', label: 'Thread count', severity: 'critical',
    drawing: drawing.threadCount, cad: cad.threadCount, compare: exactIntMatch, unit: 'threads',
    v2FeatureIds: cad.threadFeatureIds,
  }));

  // Overall dimensions: compare the SORTED triplet, not positional L-vs-L.
  // Which real edge is called "length" vs "width" is an orientation
  // convention the drawing and the CAD model have no reason to agree on —
  // comparing positionally would manufacture false mismatches purely from
  // axis labeling, not a real difference in the part.
  const dLabel = 'Overall dimensions';
  if (drawing.dimensionsMm == null && cad.dimensionsMm == null) {
    results.push({ fact: 'dimensionsMm', label: dLabel, drawingValue: '—', cadValue: '—', status: 'match', severity: 'info', message: `${dLabel}: not present in either source.` });
  } else if (drawing.dimensionsMm == null) {
    const c = [...cad.dimensionsMm!].sort((a, b) => a - b);
    results.push({ fact: 'dimensionsMm', label: dLabel, drawingValue: '—', cadValue: c.join(' × '), status: 'cad_only', severity: 'info', message: `${dLabel}: only the 3D model has this (${c.join(' × ')} mm).` });
  } else if (cad.dimensionsMm == null) {
    const d = [...drawing.dimensionsMm].sort((a, b) => a - b);
    results.push({ fact: 'dimensionsMm', label: dLabel, drawingValue: d.join(' × '), cadValue: '—', status: 'drawing_only', severity: 'info', message: `${dLabel}: only the drawing has this (${d.join(' × ')} mm).` });
  } else {
    const d = [...drawing.dimensionsMm].sort((a, b) => a - b);
    const c = [...cad.dimensionsMm].sort((a, b) => a - b);
    const eps = numericMatch(0.5); // mm — same rounding-noise allowance as thickness, scaled for larger numbers
    const match = d.every((v, i) => eps(v, c[i]!));
    results.push({
      fact: 'dimensionsMm', label: dLabel,
      drawingValue: `${d.join(' × ')} mm`, cadValue: `${c.join(' × ')} mm`,
      status: match ? 'match' : 'mismatch', severity: 'warning',
      message: match
        ? `${dLabel}: drawing (${d.join(' × ')} mm) and 3D model (${c.join(' × ')} mm) agree.`
        : `${dLabel}: drawing says ${d.join(' × ')} mm, the 3D model measures ${c.join(' × ')} mm — these should be the same part.`,
    });
  }

  return results;
}
