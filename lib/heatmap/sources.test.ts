import { describe, it, expect } from 'vitest';
import { buildManufacturingRiskSources } from './sources';
import type { DFMScoresResponse, FeatureGraph } from '@/lib/types/manufacturing';

// P0.3 — dfm-scoring.service.ts (the backend) is the single DFM authority.
// This proves the heatmap's "manufacturing_risk" layer is now presentation-only:
// its amplitude comes solely from the backend's riskScore, so the same CAD/DFM
// input can never disagree between the API result and what the heatmap draws —
// the exact defect found in the P0.3 audit (the heatmap used to also re-derive
// edge-clearance/bend-proximity/springback amplitude from raw geometry with
// different thresholds than the backend).

function fg(overrides: { edge_clearance_mm?: number | null; nearest_bend_distance_mm?: number | null; bend_angle_deg?: number | null } = {}): FeatureGraph {
  return {
    extractedAt: '2026-01-01T00:00:00Z',
    classification: { family: 'sheet_metal', confidence: 1 } as FeatureGraph['classification'],
    features: [],
    processRecommendations: [],
    feature_graph_v2: {
      metadata: { face_map: [] },
      features: [
        {
          id: 'hole_d5',
          feature_type: 'hole',
          occurrences: [
            {
              centroid: [10, 20, 0],
              face_ids: [1],
              edge_clearance_mm: overrides.edge_clearance_mm ?? null,
              nearest_bend_distance_mm: overrides.nearest_bend_distance_mm ?? null,
              bend_angle_deg: overrides.bend_angle_deg ?? null,
            },
          ],
        },
      ],
    },
  } as unknown as FeatureGraph;
}

function dfmScores(riskScore: number): DFMScoresResponse {
  return {
    bomItemId: 'item-1',
    sheetThicknessMm: 2,
    scoredAt: '2026-01-01T00:00:00Z',
    features: [
      {
        featureId: 'hole_d5',
        featureType: 'hole',
        occurrences: [
          { occurrenceIndex: 0, riskScore, riskLevel: 'low', riskFactors: [] },
        ],
      },
    ],
  };
}

describe('buildManufacturingRiskSources — presentation-only, single DFM authority (P0.3)', () => {
  it('amplitude tracks the backend riskScore exactly, with no independent geometry-based bump', () => {
    // Raw geometry here (tight edge clearance) would previously have pushed
    // amplitude up to 0.95 via the heatmap's own recomputation, REGARDLESS of
    // what the backend actually scored. The backend is the authority: a real
    // edge-clearance value of 0.1mm on a 2mm-thick part is a genuine
    // EDGE_TEAR_CRITICAL case, but the backend's OWN riskScore (not the raw
    // geometry) must be what drives the heatmap.
    const geometry = fg({ edge_clearance_mm: 0.1 });
    const lowRisk = buildManufacturingRiskSources(dfmScores(15), geometry);
    expect(lowRisk).toHaveLength(1);
    expect(lowRisk[0]!.amplitude).toBeCloseTo(0.15, 5);

    const highRisk = buildManufacturingRiskSources(dfmScores(90), geometry);
    expect(highRisk[0]!.amplitude).toBeCloseTo(0.90, 5);
  });

  it('produces the identical amplitude regardless of raw geometry, for the same riskScore', () => {
    // Same backend riskScore, wildly different raw geometry (tight vs. generous
    // edge clearance, bend proximity, bend angle) -- presentation-only means
    // none of that raw geometry should change the drawn amplitude any more.
    const tight = fg({ edge_clearance_mm: 0.05, nearest_bend_distance_mm: 0.5, bend_angle_deg: 179 });
    const generous = fg({ edge_clearance_mm: 50, nearest_bend_distance_mm: 50, bend_angle_deg: 10 });

    const a = buildManufacturingRiskSources(dfmScores(42), tight);
    const b = buildManufacturingRiskSources(dfmScores(42), generous);
    expect(a[0]!.amplitude).toBe(b[0]!.amplitude);
  });

  it('a riskScore at or below the 10-point rendering cutoff draws nothing, matching the API result of "not worth flagging"', () => {
    const geometry = fg({ edge_clearance_mm: 0.1 }); // previously would have forced amplitude=0.95 regardless
    const sources = buildManufacturingRiskSources(dfmScores(10), geometry);
    expect(sources).toHaveLength(0);
  });

  it('carries the real featureId/occurrenceIndex through unchanged, so the heatmap and the DFM panel point at the same occurrence', () => {
    const sources = buildManufacturingRiskSources(dfmScores(80), fg());
    expect(sources[0]!.featureId).toBe('hole_d5');
    expect(sources[0]!.occurrenceIndex).toBe(0);
  });
});
