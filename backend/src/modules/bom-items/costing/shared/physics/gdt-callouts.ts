/**
 * The part's GD&T callouts — one resolver for every consumer (machining and
 * sheet-metal inspection, route complexity, the GD&T analysis endpoint).
 *
 * Two real sources, never merged (both describe the same design intent, so
 * adding them would double-count the same tolerance):
 *   1. step_pmi — semantic tolerances carried in the STEP model itself,
 *      feature graph `pmi` (cad-engine shared/step_pmi.py). Exact type and
 *      magnitude in mm, so it wins whenever the model carries any.
 *   2. drawing — drawingIntelligence.gdt_callouts from drawing analysis,
 *      contract {type, tolerance, datum, confidence}.
 *
 * GD&T is never inferred from geometry: a part with neither source has none.
 * Previously the machining count read feature_summary.gdt_features, a key the
 * CAD engine never produced (always 0), and the sheet-metal readers guessed
 * `toleranceMm`/`tolerance_mm`, keys no producer ever wrote.
 */
export type GdtCalloutSource = 'step_pmi' | 'drawing';

export interface GdtCallout {
  type: string;
  toleranceMm: number;
  datum: string;
  confidence: number | null;
  source: GdtCalloutSource;
}

interface RawCallout { type?: unknown; tolerance?: unknown; datum?: unknown; confidence?: unknown }

function toCallout(c: RawCallout, source: GdtCalloutSource): GdtCallout | null {
  const type = typeof c?.type === 'string' ? c.type.trim().toLowerCase() : '';
  const tolerance = Number(c?.tolerance);
  if (!type || !Number.isFinite(tolerance) || tolerance <= 0) return null;
  return {
    type,
    toleranceMm: tolerance,
    datum: typeof c.datum === 'string' ? c.datum : '',
    confidence: typeof c.confidence === 'number' ? c.confidence : null,
    source,
  };
}

export function resolveGdtCallouts(featureGraph: unknown, drawingIntelligence: unknown): GdtCallout[] {
  const pmi = (featureGraph as { pmi?: { status?: string; gdt_callouts?: RawCallout[] } } | null)?.pmi;
  if (pmi?.status === 'read' && Array.isArray(pmi.gdt_callouts)) {
    const fromModel = pmi.gdt_callouts.map((c) => toCallout(c, 'step_pmi')).filter((c): c is GdtCallout => c !== null);
    if (fromModel.length > 0) return fromModel;
  }
  const drawing = (drawingIntelligence as { gdt_callouts?: RawCallout[] } | null)?.gdt_callouts;
  return Array.isArray(drawing)
    ? drawing.map((c) => toCallout(c, 'drawing')).filter((c): c is GdtCallout => c !== null)
    : [];
}
