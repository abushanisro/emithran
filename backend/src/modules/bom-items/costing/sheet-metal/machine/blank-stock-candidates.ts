// Pure, framework-free blank-stock candidate geometry — no NestJS/Supabase
// dependency, so this is directly unit-testable without mocking a Supabase
// client (this project's standing rule against mocked-Supabase spec files).
// BlankOptimizerService (blank-optimizer.service.ts) is the thin DB-fetching
// wrapper around these functions; it owns no geometry of its own.

import { CNC_STOCK_ALLOWANCE_PER_SIDE_MM } from '../../shared/core/default-rates.constants';

export interface BoundingBox {
  length: number; // mm — longest dimension (feed direction)
  width: number; // mm
  height: number; // mm
}

export type StockForm = 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'billet';

export interface BlankResult {
  form: string;
  sizeLabel: string;
  billetVolMm3: number;
  utilizationPct: number | null;
  requestedFormUnavailable?: { requested: StockForm; reason: string };
}

export interface StockProfile {
  form: string;
  size_a_mm: number;
  size_b_mm: number | null;
}

export interface ScoredCandidate {
  form: string;
  sizeLabel: string;
  billetVolMm3: number;
  utilizationPct: number | null;
  score: number;
}

// Facing/parting stock added to bar length (one end face + cutoff groove)
export const BAR_LENGTH_ALLOWANCE_MM = 5;

// Sort bbox so L is always the longest (feed axis)
export function sortedDimensions(bbox: BoundingBox): { L: number; W: number; H: number } {
  const dims = [bbox.length, bbox.width, bbox.height].sort((a, b) => b - a);
  return { L: dims[0]!, W: dims[1]!, H: dims[2]! };
}

export function scoreCandidate(blankVol: number, partVol: number): number {
  if (blankVol <= 0) return -Infinity;
  const util = partVol / blankVol; // higher = better fit
  const oversize = blankVol / Math.max(partVol, 1); // lower = better
  // 70% weight on utilization, 30% on minimising excess material
  return util * 0.7 + (1 / oversize) * 0.3;
}

export function roundBarCandidates(
  profiles: StockProfile[], minDiam: number, barLen: number, partVolMm3: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const p of profiles.filter((p) => p.form === "round_bar")) {
    if (p.size_a_mm < minDiam) continue;
    const r = p.size_a_mm / 2;
    const vol = Math.PI * r * r * barLen;
    const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
    out.push({
      form: "round_bar",
      sizeLabel: `Ø${p.size_a_mm} round bar`,
      billetVolMm3: vol,
      utilizationPct: util !== null ? Math.min(100, util) : null,
      score: scoreCandidate(vol, partVolMm3),
    });
  }
  return out;
}

// Hex bar — real DIN934 across-flats sizes (migration 350), previously
// staged but never queried: FORM_LABELS on the frontend already knew how to
// display 'hex_bar', but nothing ever generated a hex_bar candidate.
// Cross-sectional area of a regular hexagon in terms of its across-flats
// width W is the standard geometric identity (√3⁄2)·W² — not a fitted or
// fabricated constant.
export function hexBarCandidates(
  profiles: StockProfile[], minDiam: number, barLen: number, partVolMm3: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const HEX_AREA_COEFF = Math.sqrt(3) / 2; // area = HEX_AREA_COEFF * acrossFlats^2
  for (const p of profiles.filter((p) => p.form === "hex_bar")) {
    if (p.size_a_mm < minDiam) continue;
    const area = HEX_AREA_COEFF * p.size_a_mm * p.size_a_mm;
    const vol = area * barLen;
    const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
    out.push({
      form: "hex_bar",
      sizeLabel: `${p.size_a_mm} A/F hex bar`,
      billetVolMm3: vol,
      utilizationPct: util !== null ? Math.min(100, util) : null,
      score: scoreCandidate(vol, partVolMm3),
    });
  }
  return out;
}

export function rectangularBarCandidates(
  profiles: StockProfile[], W: number, H: number, barLen: number, partVolMm3: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const p of profiles.filter((p) => p.form === "rectangular_bar" && p.size_b_mm != null)) {
    // Rectangular bar must fit W × H in either orientation
    const fits =
      (p.size_a_mm >= W * 1.03 && p.size_b_mm! >= H * 1.03) ||
      (p.size_a_mm >= H * 1.03 && p.size_b_mm! >= W * 1.03);
    if (!fits) continue;
    const vol = p.size_a_mm * p.size_b_mm! * barLen;
    const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
    out.push({
      form: "rectangular_bar",
      sizeLabel: `${p.size_a_mm}×${p.size_b_mm} rect bar`,
      billetVolMm3: vol,
      utilizationPct: util !== null ? Math.min(100, util) : null,
      score: scoreCandidate(vol, partVolMm3),
    });
  }
  return out;
}

export function billetFallback(bbox: BoundingBox, partVolMm3: number): BlankResult {
  // Real per-side machining stock allowance (CNC_STOCK_ALLOWANCE_PER_SIDE_MM,
  // default-rates.constants.ts) applied on both sides of each dimension —
  // was a separately-hardcoded literal `6` here, duplicating the same
  // constant used elsewhere in this module (selectBestAutoCandidate below)
  // and in cost-cnc-engine.ts, all meant to be the same real number. No real
  // stock-allowance-by-material/machine/process table exists in the
  // reference corpus (checked directly) -- this stays a single, disclosed,
  // class-level constant until one is sourced, not a fabricated table.
  const allow = CNC_STOCK_ALLOWANCE_PER_SIDE_MM * 2;
  const vol = (bbox.length + allow) * (bbox.width + allow) * (bbox.height + allow);
  const util = vol > 0 && partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
  return {
    form: "billet",
    sizeLabel: `${(bbox.length + allow).toFixed(0)}×${(bbox.width + allow).toFixed(0)}×${(bbox.height + allow).toFixed(0)} billet`,
    billetVolMm3: vol,
    utilizationPct: util !== null ? Math.min(100, util) : null,
  };
}

// Auto-decide: score every real candidate the part's family can use and
// pick the best-fitting one that's still smaller than the plain bbox
// billet (so auto-selection can never accidentally pick a WORSE-than-billet
// form). Returns null when no real candidate beats the billet — caller
// falls back to billetFallback().
export function selectBestAutoCandidate(
  candidates: ScoredCandidate[], bbox: BoundingBox,
): ScoredCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const bboxAllow = CNC_STOCK_ALLOWANCE_PER_SIDE_MM * 2;
  const bboxFallbackVol = (bbox.length + bboxAllow) * (bbox.width + bboxAllow) * (bbox.height + bboxAllow);
  return sorted.find((c) => c.billetVolMm3 < bboxFallbackVol) ?? null;
}

// Explicit "Stock Form" override path — the user picked a specific form
// rather than letting the score-based auto-decide choose one. Unlike
// auto-decide, this never rejects a fitting candidate just because it's
// larger than the bbox billet (that guard exists to stop AUTO-selection
// from picking a worse-than-billet form by accident; it doesn't apply once
// the choice is explicit). Falls back to billet only when no real
// stock_profiles size is large enough — a real data limitation, disclosed
// via requestedFormUnavailable, never a fabricated size.
export function selectForcedFormCandidate(
  forcedForm: StockForm,
  profiles: StockProfile[],
  bbox: BoundingBox,
  partVolMm3: number,
  barLen: number,
  minDiam: number,
  W: number,
  H: number,
): BlankResult {
  if (forcedForm === 'billet') return billetFallback(bbox, partVolMm3);

  const candidates =
    forcedForm === 'round_bar' ? roundBarCandidates(profiles, minDiam, barLen, partVolMm3) :
    forcedForm === 'hex_bar' ? hexBarCandidates(profiles, minDiam, barLen, partVolMm3) :
    rectangularBarCandidates(profiles, W, H, barLen, partVolMm3);

  if (candidates.length === 0) {
    const fallback = billetFallback(bbox, partVolMm3);
    fallback.requestedFormUnavailable = {
      requested: forcedForm,
      reason: `No real ${forcedForm.replace('_', ' ')} stock size in the reference catalog is large enough for this part.`,
    };
    return fallback;
  }

  // Smallest real fitting size — least waste among the sizes actually stocked.
  const best = [...candidates].sort((a, b) => a.billetVolMm3 - b.billetVolMm3)[0]!;
  return { form: best.form, sizeLabel: best.sizeLabel, billetVolMm3: best.billetVolMm3, utilizationPct: best.utilizationPct };
}
