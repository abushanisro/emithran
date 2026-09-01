import { Injectable } from '@nestjs/common';
import { resolveBendRadiusMinFactor, resolveMinHoleDiameterRatio } from '../costing/shared/core/default-rates.constants';

// Real, sourced minimum hole-to-bend distance factor (radius/thickness) —
// see sm_reference_data category='lookup_table',
// key='InsufficientHoleToBendDistance'. Single threshold replaces a
// previous two-tier 1.0x/2.0x split that predated this reconciliation and
// had no citation of its own; this is also the same factor
// scoreSheetMetalHole() uses from the hole's own perspective, so both
// checks agree on one real number instead of two different uncited ones.
const HOLE_TO_BEND_MIN_FACTOR = 1.5;

interface FeatureOccurrence {
  edge_clearance_mm?: number | null;
  nearest_hole_distance_mm?: number | null;
  nearest_bend_distance_mm?: number | null;
  local_feature_density?: number | null;
  bend_angle_deg?: number | null;
  edge_to_bend_distance_mm?: number | null;
  // Real per-occurrence bend length, already computed by the cad-engine
  // (feature_extractors.py) and already present on every bend occurrence —
  // was simply never declared/read here until the InsufficientBendLength
  // check below was added.
  bend_length_mm?: number | null;
  // CNC fields
  ld_ratio?: number | null;
  tapped?: boolean | null;
  spec?: string | null;
}

// Real, sourced minimum bend length for a press-brake bend (mm) — below
// this, the brake's own tooling/gripping geometry can't reliably form the
// bend. See sm_reference_data category='lookup_table',
// key='InsufficientBendLength:Bend Brake'.
const MIN_BEND_LENGTH_MM = 10;

interface RiskFactor {
  code: string;
  label: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface OccurrenceScore {
  occurrenceIndex: number;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
}

export interface FeatureDFMScores {
  featureId: string;
  featureType: string;
  occurrences: OccurrenceScore[];
}

@Injectable()
export class DFMScoringService {
  score(
    features: any[],
    // null/undefined means "not extracted" — distinct from 0, which is the
    // existing CNC-part signal (isCNC below). Previously both a missing
    // value and a CNC part collapsed onto the same `sheetThicknessMm > 0 ?
    // ... : 1` fallback, so a sheet-metal part with a genuinely unknown
    // thickness got scored against a silently fabricated 1mm with no trace
    // of that assumption anywhere in the result.
    sheetThicknessMm: number | null | undefined,
    materialGrade?: string | null,
    utsMpa?: number | null,
  ): FeatureDFMScores[] {
    const isCNC = sheetThicknessMm === 0;
    const thicknessKnown = !isCNC && sheetThicknessMm != null && sheetThicknessMm > 0;
    const t = thicknessKnown ? (sheetThicknessMm as number) : 1;
    return features.map((f) => ({
      featureId: f.id as string,
      featureType: f.feature_type as string,
      occurrences: ((f.occurrences ?? []) as FeatureOccurrence[]).map((occ, i) => {
        const missing: string[] = [];
        if (!isCNC && !thicknessKnown) missing.push('sheet thickness');

        if (f.feature_type === 'hole') {
          const diameterKnown = typeof f.diameter_mm === 'number' && f.diameter_mm > 0;
          if (!diameterKnown) missing.push('hole diameter');
          const diameter = diameterKnown ? (f.diameter_mm as number) : 5;
          const result = isCNC
            ? this.scoreCNCHole(occ, i, diameter)
            : this.scoreSheetMetalHole(occ, i, diameter, t, utsMpa);
          return missing.length ? this.flagIncompleteGeometry(result, missing) : result;
        }
        if (f.feature_type === 'bend') {
          const radiusKnown = typeof f.radius_mm === 'number' && f.radius_mm > 0;
          if (!radiusKnown) missing.push('bend radius');
          const radius = radiusKnown ? (f.radius_mm as number) : t;
          const result = this.scoreBend(occ, i, radius, t, materialGrade);
          return missing.length ? this.flagIncompleteGeometry(result, missing) : result;
        }
        return { occurrenceIndex: i, riskScore: 0, riskLevel: 'low' as RiskLevel, riskFactors: [] };
      }),
    }));
  }

  // Real geometry is missing for this occurrence — the score below was
  // still computed (using a documented placeholder) so the UI has
  // *something* to render, but every such result carries an explicit
  // marker instead of looking identical to a score computed from real
  // measured geometry. Never silently substitute without this flag.
  private flagIncompleteGeometry(result: OccurrenceScore, missing: string[]): OccurrenceScore {
    return {
      ...result,
      riskFactors: [
        ...result.riskFactors,
        {
          code: 'INCOMPLETE_GEOMETRY_DATA',
          label: `DFM score is provisional — real ${missing.join(' and ')} not available from CAD extraction; a placeholder value was used.`,
        },
      ],
    };
  }

  private scoreCNCHole(occ: FeatureOccurrence, i: number, diameter: number): OccurrenceScore {
    let score = 0;
    const factors: RiskFactor[] = [];

    const ldRatio = occ.ld_ratio ?? null;
    if (ldRatio != null) {
      if (ldRatio > 8) {
        score += 75;
        factors.push({ code: 'LD_CRITICAL', label: `L/D ${ldRatio.toFixed(1)} > 8 — very deep, chip evacuation critical` });
      } else if (ldRatio > 5) {
        score += 55;
        factors.push({ code: 'LD_HIGH', label: `L/D ${ldRatio.toFixed(1)} > 5 — deep hole, peck drilling required` });
      } else if (ldRatio > 3) {
        score += 35;
        factors.push({ code: 'LD_MEDIUM', label: `L/D ${ldRatio.toFixed(1)} > 3 — moderate depth` });
      } else {
        score += 10;
      }
    }

    if (occ.tapped) {
      score += 20;
      const spec = occ.spec ? ` (${occ.spec})` : '';
      factors.push({ code: 'TAPPED', label: `Tapped hole${spec} — tap breakage risk increases with L/D` });
    }

    if (diameter < 3) {
      score += 15;
      factors.push({ code: 'SMALL_BORE', label: `Ø${diameter.toFixed(1)} mm — fragile drill, slow feed required` });
    }

    score = Math.min(100, score);
    return { occurrenceIndex: i, riskScore: score, riskLevel: this.toLevel(score), riskFactors: factors };
  }

  private scoreSheetMetalHole(occ: FeatureOccurrence, i: number, diameter: number, t: number, utsMpa?: number | null): OccurrenceScore {
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

    if (occ.nearest_bend_distance_mm != null && occ.nearest_bend_distance_mm < HOLE_TO_BEND_MIN_FACTOR * t) {
      score += 30;
      factors.push({ code: 'BEND_PROXIMITY_WARNING', label: `Nearest bend ${occ.nearest_bend_distance_mm.toFixed(2)} mm (< ${HOLE_TO_BEND_MIN_FACTOR}t = ${(HOLE_TO_BEND_MIN_FACTOR * t).toFixed(2)} mm)` });
    }

    if (occ.local_feature_density != null && occ.local_feature_density > 8) {
      score += 20;
      factors.push({ code: 'CLUSTER_DENSE', label: `Dense cluster: ${occ.local_feature_density} holes within 30 mm` });
    }

    if (occ.nearest_hole_distance_mm != null && occ.nearest_hole_distance_mm < 2 * diameter) {
      score += 15;
      factors.push({ code: 'PUNCH_INTERFERENCE', label: `Holes close: ${occ.nearest_hole_distance_mm.toFixed(2)} mm (< 2× diameter)` });
    }

    // Real punch-tooling physics — see resolveMinHoleDiameterRatio's own doc
    // comment for sourcing. Only checked when UTS is actually known (never
    // guessed): an unresolved material silently skips this check rather than
    // assuming a ratio.
    if (utsMpa != null && utsMpa > 0) {
      const minRatio = resolveMinHoleDiameterRatio(utsMpa);
      if (diameter < minRatio * t) {
        score += 25;
        factors.push({ code: 'UNDERSIZED_HOLE', label: `Hole Ø${diameter.toFixed(2)} mm (< ${minRatio}t = ${(minRatio * t).toFixed(2)} mm) — punch may fail on this material` });
      }
    }

    score = Math.min(100, score);
    return { occurrenceIndex: i, riskScore: score, riskLevel: this.toLevel(score), riskFactors: factors };
  }

  private scoreBend(occ: FeatureOccurrence, i: number, radius: number, t: number, materialGrade?: string | null): OccurrenceScore {
    let score = 0;
    const factors: RiskFactor[] = [];

    // Real, per-material, per-thickness-bracket minimum radius factor — see
    // resolveBendRadiusMinFactor's own doc comment for sourcing. Previously
    // a flat, uncited 0.8t applied to every material at every thickness,
    // which only happened to be correct for mild steel at <=6mm.
    const minFactor = resolveBendRadiusMinFactor(materialGrade, t);
    if (radius < minFactor * t) {
      score += 60;
      factors.push({ code: 'CRACK_RISK', label: `Bend radius ${radius.toFixed(2)} mm (< ${minFactor}t = ${(minFactor * t).toFixed(2)} mm)` });
    }

    if (occ.edge_to_bend_distance_mm != null && occ.edge_to_bend_distance_mm < t) {
      score += 30;
      factors.push({ code: 'FLANGE_TEAR', label: `Flange-edge clearance ${occ.edge_to_bend_distance_mm.toFixed(2)} mm (< 1.0t)` });
    }

    if (occ.bend_angle_deg != null && occ.bend_angle_deg > 135) {
      score += 25;
      factors.push({ code: 'SPRINGBACK_COMPOUND', label: `Bend angle ${occ.bend_angle_deg.toFixed(1)}° > 135°` });
    }

    if (occ.nearest_hole_distance_mm != null && occ.nearest_hole_distance_mm < HOLE_TO_BEND_MIN_FACTOR * t) {
      score += 20;
      factors.push({ code: 'BEND_HOLE_PROXIMITY', label: `Hole near bend: ${occ.nearest_hole_distance_mm.toFixed(2)} mm (< ${HOLE_TO_BEND_MIN_FACTOR}t)` });
    }

    if (occ.bend_length_mm != null && occ.bend_length_mm < MIN_BEND_LENGTH_MM) {
      score += 25;
      factors.push({ code: 'INSUFFICIENT_BEND_LENGTH', label: `Bend length ${occ.bend_length_mm.toFixed(2)} mm (< ${MIN_BEND_LENGTH_MM} mm minimum for press-brake forming)` });
    }

    score = Math.min(100, score);
    return { occurrenceIndex: i, riskScore: score, riskLevel: this.toLevel(score), riskFactors: factors };
  }

  private toLevel(score: number): RiskLevel {
    if (score <= 20) return 'low';
    if (score <= 50) return 'medium';
    if (score <= 75) return 'high';
    return 'critical';
  }
}
