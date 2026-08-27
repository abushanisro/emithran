import type { DFMScoresResponse } from '@/lib/types/manufacturing';

// P0.3 — dfm-scoring.service.ts is the single DFM authority. This is not a
// second scorer: it decides nothing about manufacturability itself, it only
// asks "did the backend already flag this risk factor code anywhere in the
// part's occurrences of this feature type" — a thin presence check over
// already-computed backend data, reused wherever a UI surface needs a
// part-level yes/no instead of the backend's own per-occurrence detail.
export function hasDfmRiskFactor(
  dfmScores: DFMScoresResponse | undefined,
  featureType: string,
  code: string,
): boolean {
  return (dfmScores?.features ?? []).some(
    (f) => f.featureType === featureType && f.occurrences.some(
      (occ) => occ.riskFactors.some((rf) => rf.code === code),
    ),
  );
}
