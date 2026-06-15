import type { LabourCandidate } from '../dto/candidate-set.dto';

/**
 * Scores LSR (Labour Standard Rate) rows for fit.
 *
 * We return all available labour bands ranked by location fit + rate
 * sanity, since the LLM may pick different bands per operation
 * (e.g., Skilled for turning, Semi-Skilled for deburring).
 */

interface LsrRow {
  id: string;
  labour_type: string | null;
  labour_code: string | null;
  lhr: number | string | null;      // raw DB value (may be USD)
  lhr_inr?: number | null;          // pre-converted to INR by retrieval service
  location?: string | null;
}

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function locationFitScore(row: LsrRow, orgLocation: string): number {
  const orgLoc = norm(orgLocation);
  const rowLoc = norm(row.location);
  if (!rowLoc) return 0.6;
  if (rowLoc === orgLoc) return 1;
  if (orgLoc.includes('india') && rowLoc.includes('india')) return 0.9;
  return 0.4;
}

function rateSanityScore(row: LsrRow): number {
  // Prefer lhr_inr (already converted) — fall back to raw value.
  const rate = row.lhr_inr ?? toNumber(row.lhr);
  if (rate <= 0) return 0;
  // INR thresholds: ₹20–₹500/hr is typical Indian labour band range
  if (rate > 5_000) return 0.4;
  if (rate >= 20) return 1;
  return 0.6;
}

export function rankLabour(
  rows: LsrRow[],
  orgLocation: string,
  topN: number,
): LabourCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const scored = rows.map((row) => {
    const lScore = locationFitScore(row, orgLocation);
    const rScore = rateSanityScore(row);
    const score = 0.55 * lScore + 0.45 * rScore;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `lb-${idx + 1}`,
    dbId: row.id,
    labourType: row.labour_type ?? '',
    labourCode: row.labour_code ?? null,
    lhrInrPerHour: row.lhr_inr ?? toNumber(row.lhr),
    location: row.location ?? null,
    score: Number(score.toFixed(3)),
  }));
}
