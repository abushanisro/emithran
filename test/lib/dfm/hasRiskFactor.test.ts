import { describe, it, expect } from 'vitest';
import { hasDfmRiskFactor } from '@/lib/dfm/hasRiskFactor';
import type { DFMScoresResponse } from '@/lib/types/manufacturing';

// P0.3 — ManufacturingFeaturesTab.holeRisk and .springbackRisk used to
// independently recompute "is this hole undersized" (flat 1.5x thickness)
// and "is this bend radius too tight" (flat 2.0x thickness), which could
// disagree with the authoritative backend scorer (dfm-scoring.service.ts's
// material/UTS-bracketed UNDERSIZED_HOLE and CRACK_RISK checks). These tests
// prove the tab now reflects the backend's own finding instead.

function scoresWith(featureType: string, code: string | null): DFMScoresResponse {
  return {
    bomItemId: 'item-1',
    sheetThicknessMm: 2,
    scoredAt: '2026-01-01T00:00:00Z',
    features: [
      {
        featureId: 'feat-1',
        featureType,
        occurrences: [
          {
            occurrenceIndex: 0,
            riskScore: code ? 60 : 0,
            riskLevel: code ? 'high' : 'low',
            riskFactors: code ? [{ code, label: 'test' }] : [],
          },
        ],
      },
    ],
  };
}

describe('hasDfmRiskFactor — single DFM authority, presentation-only lookup (P0.3)', () => {
  it('holeRisk case: true only when the backend actually flagged UNDERSIZED_HOLE on a hole occurrence', () => {
    expect(hasDfmRiskFactor(scoresWith('hole', 'UNDERSIZED_HOLE'), 'hole', 'UNDERSIZED_HOLE')).toBe(true);
    expect(hasDfmRiskFactor(scoresWith('hole', null), 'hole', 'UNDERSIZED_HOLE')).toBe(false);
  });

  it('holeRisk case: a real hole below the old flat 1.5x-thickness heuristic but NOT flagged by the material/UTS-bracketed backend check reports false, not true', () => {
    // This is the exact scenario the old independent judgment got wrong: a
    // hole a naive flat threshold would call "undersized," but the real
    // material-specific backend rule (which knows the actual UTS) did not
    // flag. The tab must defer to the backend, not re-derive its own answer.
    const scores = scoresWith('hole', null);
    expect(hasDfmRiskFactor(scores, 'hole', 'UNDERSIZED_HOLE')).toBe(false);
  });

  it('springbackRisk case: true only when the backend flagged CRACK_RISK on a bend occurrence', () => {
    expect(hasDfmRiskFactor(scoresWith('bend', 'CRACK_RISK'), 'bend', 'CRACK_RISK')).toBe(true);
    expect(hasDfmRiskFactor(scoresWith('bend', null), 'bend', 'CRACK_RISK')).toBe(false);
  });

  it('does not cross-contaminate feature types — a CRACK_RISK on a bend must not flip holeRisk, and vice versa', () => {
    const bendOnly = scoresWith('bend', 'CRACK_RISK');
    expect(hasDfmRiskFactor(bendOnly, 'hole', 'UNDERSIZED_HOLE')).toBe(false);

    const holeOnly = scoresWith('hole', 'UNDERSIZED_HOLE');
    expect(hasDfmRiskFactor(holeOnly, 'bend', 'CRACK_RISK')).toBe(false);
  });

  it('is false, not a crash, when dfmScores has not resolved yet', () => {
    expect(hasDfmRiskFactor(undefined, 'hole', 'UNDERSIZED_HOLE')).toBe(false);
    expect(hasDfmRiskFactor(undefined, 'bend', 'CRACK_RISK')).toBe(false);
  });

  it('aggregates across ALL hole occurrences, not just the first — one flagged hole among several is enough', () => {
    // A real part has many holes; the tab's old flat-threshold logic only
    // ever looked at the single smallest diameter in the part. The backend
    // scorer evaluates every occurrence, so the aggregation here must too.
    const manyHoles: DFMScoresResponse = {
      bomItemId: 'item-1',
      sheetThicknessMm: 2,
      scoredAt: '2026-01-01T00:00:00Z',
      features: [
        {
          featureId: 'feat-holes',
          featureType: 'hole',
          occurrences: [
            { occurrenceIndex: 0, riskScore: 0, riskLevel: 'low', riskFactors: [] },
            { occurrenceIndex: 1, riskScore: 0, riskLevel: 'low', riskFactors: [] },
            { occurrenceIndex: 2, riskScore: 25, riskLevel: 'medium', riskFactors: [{ code: 'UNDERSIZED_HOLE', label: 'test' }] },
          ],
        },
      ],
    };
    expect(hasDfmRiskFactor(manyHoles, 'hole', 'UNDERSIZED_HOLE')).toBe(true);
  });

  it('a part with many bends but no CRACK_RISK on any of them reports false — no false positive from aggregation', () => {
    const manyCleanBends: DFMScoresResponse = {
      bomItemId: 'item-1',
      sheetThicknessMm: 2,
      scoredAt: '2026-01-01T00:00:00Z',
      features: [
        {
          featureId: 'feat-bends',
          featureType: 'bend',
          occurrences: [
            { occurrenceIndex: 0, riskScore: 0, riskLevel: 'low', riskFactors: [] },
            { occurrenceIndex: 1, riskScore: 0, riskLevel: 'low', riskFactors: [] },
            { occurrenceIndex: 2, riskScore: 0, riskLevel: 'low', riskFactors: [] },
          ],
        },
      ],
    };
    expect(hasDfmRiskFactor(manyCleanBends, 'bend', 'CRACK_RISK')).toBe(false);
  });
});
