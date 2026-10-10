// Ranks candidate stock sheets for a part and recommends the best three —
// memory/Sheetmetal/laser_cutting_costing_params (1).md §6: "pick the sheet
// size that gives the lowest input weight per part". For one part, material
// and thickness, the highest yield (utilization) is that same sheet.
// Parts per sheet is the §6a kerf-adjusted rectangle count — only to rank;
// the nest itself always uses the real part silhouette.
export interface CandidateSheet { widthMm: number; lengthMm: number; source: string }
export interface RankedSheet extends CandidateSheet {
  partsPerSheet: number | null;   // null until the part outline is known
  utilizationPct: number | null;
  recommended: boolean;
}

export function estimateRectPartsPerSheet(
  sheetWidthMm: number, sheetLengthMm: number,
  partWidthMm: number, partLengthMm: number,
  kerfMm: number, edgeMarginMm: number,
): number {
  const usableW = sheetWidthMm - 2 * edgeMarginMm;
  const usableL = sheetLengthMm - 2 * edgeMarginMm;
  if (usableW <= 0 || usableL <= 0 || partWidthMm <= 0 || partLengthMm <= 0) return 0;
  const a = Math.floor((usableW + kerfMm) / (partWidthMm + kerfMm)) * Math.floor((usableL + kerfMm) / (partLengthMm + kerfMm));
  const b = Math.floor((usableW + kerfMm) / (partLengthMm + kerfMm)) * Math.floor((usableL + kerfMm) / (partWidthMm + kerfMm));
  return Math.max(a, b, 0);
}

/** Top `limit` sheets, best yield first; the first that fits is "recommended". */
export function recommendSheets(
  candidates: readonly CandidateSheet[],
  part: { widthMm: number; lengthMm: number; areaMm2: number } | null,
  kerfMm: number, edgeMarginMm: number, limit = 3,
): RankedSheet[] {
  if (!part) {
    // Part size unknown yet: smallest sheets first, nothing recommended.
    return [...candidates]
      .sort((x, y) => x.widthMm * x.lengthMm - y.widthMm * y.lengthMm)
      .slice(0, limit)
      .map((c) => ({ ...c, partsPerSheet: null, utilizationPct: null, recommended: false }));
  }
  const ranked = candidates.map((c) => {
    const partsPerSheet = estimateRectPartsPerSheet(c.widthMm, c.lengthMm, part.widthMm, part.lengthMm, kerfMm, edgeMarginMm);
    const utilizationPct = partsPerSheet > 0 ? (partsPerSheet * part.areaMm2) / (c.widthMm * c.lengthMm) * 100 : 0;
    return { ...c, partsPerSheet, utilizationPct, recommended: false };
  }).sort((x, y) => (y.utilizationPct - x.utilizationPct) || (x.widthMm * x.lengthMm - y.widthMm * y.lengthMm));
  const top = ranked.slice(0, limit);
  if (top[0] && top[0].partsPerSheet > 0) top[0].recommended = true;
  return top;
}
