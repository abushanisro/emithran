// What the CAD engine's draft analysis (cad-engine/shared/draft_angle_geometry.py) tells the molding router, read from the part's feature-graph summary.
//
// The analysis answers with zeros when it cannot run (its fallback has every count 0 and parting complexity null), and with real counts, possibly
// zero, when it ran. A count of 0 therefore cannot say "not run"; the parting complexity can: it is a ratio when the analysis ran and null in
// the fallback. Reading `count > 0 ? count : null` told the router that a part analysed with no undercuts was never analysed, and the cost view
// warned "Undercut detection not run" on exactly the parts whose undrafted faces and parting complexity it was showing.

interface DraftSummary {
  undercutFaceCount?: unknown;
  partingComplexity?: unknown;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The undercut faces the draft analysis found (0 when it ran and found none), or null when it did not run. */
export function undercutCountFromDraftSummary(summary: DraftSummary | null | undefined): number | null {
  if (!summary || !finite(summary.partingComplexity)) return null;
  return finite(summary.undercutFaceCount) && summary.undercutFaceCount > 0 ? summary.undercutFaceCount : 0;
}
