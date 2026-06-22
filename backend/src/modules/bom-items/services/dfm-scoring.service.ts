import { Injectable } from '@nestjs/common';

interface FeatureOccurrence {
  edge_clearance_mm?: number | null;
  nearest_hole_distance_mm?: number | null;
  nearest_bend_distance_mm?: number | null;
  local_feature_density?: number | null;
  bend_angle_deg?: number | null;
  edge_to_bend_distance_mm?: number | null;
}

interface RiskFactor {
  code: string;
  label: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface OccurrenceScore {
  occurrenceIndex: number;
  risk_score: number;
  risk_level: RiskLevel;
  risk_factors: RiskFactor[];
}

export interface FeatureDFMScores {
  feature_id: string;
  feature_type: string;
  occurrences: OccurrenceScore[];
}

@Injectable()
export class DFMScoringService {
  score(features: any[], sheetThicknessMm: number): FeatureDFMScores[] {
    const t = sheetThicknessMm > 0 ? sheetThicknessMm : 1;
    return features.map((f) => ({
      feature_id: f.id as string,
      feature_type: f.feature_type as string,
      occurrences: ((f.occurrences ?? []) as FeatureOccurrence[]).map((occ, i) => {
        if (f.feature_type === 'hole') return this.scoreHole(occ, i, (f.diameter_mm as number) ?? 5, t);
        if (f.feature_type === 'bend') return this.scoreBend(occ, i, (f.radius_mm as number) ?? t, t);
        return { occurrenceIndex: i, risk_score: 0, risk_level: 'low' as RiskLevel, risk_factors: [] };
      }),
    }));
  }

  private scoreHole(occ: FeatureOccurrence, i: number, diameter: number, t: number): OccurrenceScore {
    let score = 0;
    const factors: RiskFactor[] = [];

    if (occ.edge_clearance_mm != null) {
      if (occ.edge_clearance_mm < 0.5 * t) {
        score += 60;
        factors.push({ code: 'EDGE_TEAR_CRITICAL', label: `Edge clearance ${occ.edge_clearance_mm.toFixed(2)} mm (< 0.5t = ${(0.5 * t).toFixed(2)} mm)` });
      } else if (occ.edge_clearance_mm < t) {
        score += 40;
        factors.push({ code: 'EDGE_TEAR_HIGH', label: `Edge clearance ${occ.edge_clearance_mm.toFixed(2)} mm (< 1.0t = ${t.toFixed(2)} mm)` });
      }
    }

    if (occ.nearest_bend_distance_mm != null) {
      if (occ.nearest_bend_distance_mm < t) {
        score += 35;
        factors.push({ code: 'BEND_PROXIMITY_HIGH', label: `Nearest bend ${occ.nearest_bend_distance_mm.toFixed(2)} mm (< 1.0t)` });
      } else if (occ.nearest_bend_distance_mm < 2 * t) {
        score += 25;
        factors.push({ code: 'BEND_PROXIMITY_WARNING', label: `Nearest bend ${occ.nearest_bend_distance_mm.toFixed(2)} mm (< 2.0t)` });
      }
    }

    if (occ.local_feature_density != null && occ.local_feature_density > 8) {
      score += 20;
      factors.push({ code: 'CLUSTER_DENSE', label: `Dense cluster: ${occ.local_feature_density} holes within 30 mm` });
    }

    if (occ.nearest_hole_distance_mm != null && occ.nearest_hole_distance_mm < 2 * diameter) {
      score += 15;
      factors.push({ code: 'PUNCH_INTERFERENCE', label: `Holes close: ${occ.nearest_hole_distance_mm.toFixed(2)} mm (< 2× diameter)` });
    }

    score = Math.min(100, score);
    return { occurrenceIndex: i, risk_score: score, risk_level: this.toLevel(score), risk_factors: factors };
  }

  private scoreBend(occ: FeatureOccurrence, i: number, radius: number, t: number): OccurrenceScore {
    let score = 0;
    const factors: RiskFactor[] = [];

    if (radius < 0.8 * t) {
      score += 60;
      factors.push({ code: 'CRACK_RISK', label: `Bend radius ${radius.toFixed(2)} mm (< 0.8t = ${(0.8 * t).toFixed(2)} mm)` });
    }

    if (occ.edge_to_bend_distance_mm != null && occ.edge_to_bend_distance_mm < t) {
      score += 30;
      factors.push({ code: 'FLANGE_TEAR', label: `Flange-edge clearance ${occ.edge_to_bend_distance_mm.toFixed(2)} mm (< 1.0t)` });
    }

    if (occ.bend_angle_deg != null && occ.bend_angle_deg > 135) {
      score += 25;
      factors.push({ code: 'SPRINGBACK_COMPOUND', label: `Bend angle ${occ.bend_angle_deg.toFixed(1)}° > 135°` });
    }

    if (occ.nearest_hole_distance_mm != null && occ.nearest_hole_distance_mm < 2 * t) {
      score += 20;
      factors.push({ code: 'BEND_HOLE_PROXIMITY', label: `Hole near bend: ${occ.nearest_hole_distance_mm.toFixed(2)} mm (< 2.0t)` });
    }

    score = Math.min(100, score);
    return { occurrenceIndex: i, risk_score: score, risk_level: this.toLevel(score), risk_factors: factors };
  }

  private toLevel(score: number): RiskLevel {
    if (score <= 20) return 'low';
    if (score <= 50) return 'medium';
    if (score <= 75) return 'high';
    return 'critical';
  }
}
