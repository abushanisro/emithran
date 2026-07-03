import type { HeatmapSource, HeatmapLayerType } from './types';
import type { DFMScoresResponse, FeatureGraph } from '@/lib/types/manufacturing';

type RawSignal = {
  centroid: [number, number, number];
  amplitude: number;
  featureId: string;
  occurrenceIndex: number;
  bendLen?: number; // bends only — needed for extent-based sigma
};

/**
 * Grid-based spatial clustering with spread-based sigma.
 *
 * Sigma is computed from the amplitude-weighted RMS distance of points within
 * the cluster (clusterSpread), NOT from cell geometry or individual feature sigma.
 * This makes sigma part-size-independent and decouples zone width from feature count.
 *
 * Hole cap 20mm → 3.5σ = 70mm: stays inside a manufacturing zone.
 * Bend cap 30mm → 3.5σ = 105mm: covers a full bend line without blanketing the part.
 */
function gridCluster(
  signals: RawSignal[],
  targetClusters: number,
  layer: HeatmapLayerType,
  featureType: 'hole' | 'bend',
): HeatmapSource[] {
  if (!signals.length) return [];
  if (signals.length <= 3) {
    return signals.map((s) => {
      const sigma =
        featureType === 'hole'
          ? 8
          : Math.min(Math.max((s.bendLen ?? 20) * 0.30, 10), 30);
      return {
        centroid: s.centroid,
        amplitude: s.amplitude,
        sigma,
        layer,
        featureId: s.featureId,
        occurrenceIndex: s.occurrenceIndex,
      };
    });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of signals) {
    if (s.centroid[0] < minX) minX = s.centroid[0];
    if (s.centroid[0] > maxX) maxX = s.centroid[0];
    if (s.centroid[1] < minY) minY = s.centroid[1];
    if (s.centroid[1] > maxY) maxY = s.centroid[1];
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const aspect = spanX / spanY;
  const cellsX = Math.max(1, Math.round(Math.sqrt(targetClusters * aspect)));
  const cellsY = Math.max(1, Math.round(targetClusters / cellsX));

  const cells = new Map<string, RawSignal[]>();
  for (const s of signals) {
    const ix = Math.min(Math.floor(((s.centroid[0] - minX) / spanX) * cellsX), cellsX - 1);
    const iy = Math.min(Math.floor(((s.centroid[1] - minY) / spanY) * cellsY), cellsY - 1);
    const key = `${ix}:${iy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(s);
    else cells.set(key, [s]);
  }

  const out: HeatmapSource[] = [];

  for (const group of cells.values()) {
    // Pass 1: amplitude-weighted centroid + dominant occurrence + maxBendLen
    let totalWeight = 0, wx = 0, wy = 0, wz = 0, maxAmp = 0, maxBendLen = 0;
    let dominant = group[0]!;

    for (const s of group) {
      totalWeight += s.amplitude;
      wx += s.centroid[0] * s.amplitude;
      wy += s.centroid[1] * s.amplitude;
      wz += s.centroid[2] * s.amplitude;
      if (s.amplitude > maxAmp) { maxAmp = s.amplitude; dominant = s; }
      if ((s.bendLen ?? 0) > maxBendLen) maxBendLen = s.bendLen ?? 0;
    }

    if (totalWeight > 0) { wx /= totalWeight; wy /= totalWeight; wz /= totalWeight; }

    // Pass 2: amplitude-weighted RMS spread from centroid (XY only — sheet metal is flat)
    let spreadSq = 0;
    for (const s of group) {
      const dx = s.centroid[0] - wx;
      const dy = s.centroid[1] - wy;
      spreadSq += (dx * dx + dy * dy) * s.amplitude;
    }
    const clusterSpread = Math.sqrt(totalWeight > 0 ? spreadSq / totalWeight : 0);

    // Sigma: spread-based, feature-type caps
    // Holes: localized point features — cap at 20mm (3.5σ = 70mm)
    // Bends: line features — include bend extent term, cap at 30mm (3.5σ = 105mm)
    const sigma =
      featureType === 'hole'
        ? Math.min(Math.max(clusterSpread * 1.5, 8), 20)
        : Math.min(Math.max(clusterSpread * 1.5, maxBendLen * 0.30, 10), 30);

    // Density bonus: log2 scale, capped at +0.25 so amplitude stays interpretable
    const densityBonus = Math.min(Math.log2(group.length) / 8, 0.25);
    const amplitude = Math.min(maxAmp + densityBonus, 1.0);

    out.push({
      centroid: [wx, wy, wz],
      amplitude,
      sigma,
      layer,
      featureId: dominant.featureId,
      occurrenceIndex: dominant.occurrenceIndex,
    });
  }

  return out;
}

export function buildManufacturingRiskSources(
  dfmScores: DFMScoresResponse,
  fg: FeatureGraph,
  sheetThicknessMm: number,
): HeatmapSource[] {
  const t = Math.max(sheetThicknessMm, 0.5);

  const holeSignals: RawSignal[] = [];
  const bendSignals: RawSignal[] = [];

  for (const feat of dfmScores.features) {
    const v2 = fg.feature_graph_v2?.features.find((f) => f.id === feat.featureId);
    if (!v2) continue;
    const isHole = v2.feature_type === 'hole';

    for (const score of feat.occurrences) {
      const v2Occ = v2.occurrences[score.occurrenceIndex];
      if (!v2Occ?.centroid) continue;

      const {
        centroid,
        edge_clearance_mm: ec,
        nearest_bend_distance_mm: nearBend,
        bend_angle_deg: bendAngle,
        bend_length_mm: bendLen,
      } = v2Occ;

      // Fold all risk components into a single amplitude per occurrence.
      // max() not sum(): amplitude represents the dominant hazard at this location,
      // not a compound score. Density is expressed at the cluster level via densityBonus.
      let amplitude = score.riskScore > 10 ? score.riskScore / 100 : 0;

      if (ec != null) {
        const ratio = ec / t;
        const ecAmp =
          ratio < 0.5 ? 0.95
          : ratio < 1.0 ? 0.75
          : ratio < 1.5 ? 0.50
          : ratio < 2.0 ? 0.25
          : 0;
        if (ecAmp > amplitude) amplitude = ecAmp;
      }

      if (isHole && nearBend != null && nearBend < 3 * t) {
        const nearAmp = Math.min(1 - nearBend / (3 * t), 0.70);
        if (nearAmp > amplitude) amplitude = nearAmp;
      }

      if (!isHole && bendAngle != null && bendAngle > 90) {
        const springAmp = Math.min((bendAngle - 90) / 90, 0.80);
        if (springAmp > amplitude) amplitude = springAmp;
      }

      if (amplitude <= 0) continue;

      const signal: RawSignal = {
        centroid,
        amplitude,
        featureId: feat.featureId,
        occurrenceIndex: score.occurrenceIndex,
        ...(isHole ? {} : { bendLen: bendLen ?? 20 }),
      };

      if (isHole) holeSignals.push(signal);
      else bendSignals.push(signal);
    }
  }

  return [
    ...gridCluster(holeSignals, 20, 'manufacturing_risk', 'hole'),
    ...gridCluster(bendSignals, 10, 'manufacturing_risk', 'bend'),
  ];
}

// Tolerance tightest value (mm) from drawing intelligence — null if drawing not analysed.
export interface ToleranceHeatmapWeights {
  tightestToleranceMm: number | null;
}

export function buildToleranceSources(fg: FeatureGraph, weights: ToleranceHeatmapWeights): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];

  // Tighter tolerance → heavier inspection burden → higher amplitude
  const t = weights.tightestToleranceMm;
  const baseAmp = t == null ? 0.4
    : t <= 0.02 ? 1.0
    : t <= 0.05 ? 0.85
    : t <= 0.10 ? 0.65
    : t <= 0.25 ? 0.45
    : t <= 0.50 ? 0.25
    : 0.15;

  const holeSignals: RawSignal[] = [];
  const bendSignals: RawSignal[] = [];

  for (const feat of v2.features) {
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;
      if (feat.feature_type === 'hole') {
        // Holes < 4mm diameter more likely to carry tight position/size call-outs
        const amp = feat.diameter_mm != null && feat.diameter_mm < 4
          ? Math.min(baseAmp + 0.2, 1.0) : baseAmp;
        holeSignals.push({ centroid: occ.centroid, amplitude: amp, featureId: feat.id, occurrenceIndex: i });
      } else if (feat.feature_type === 'bend') {
        // Bends usually carry angle tolerance only — lower amplitude
        bendSignals.push({ centroid: occ.centroid, amplitude: baseAmp * 0.5, featureId: feat.id, occurrenceIndex: i, bendLen: occ.bend_length_mm ?? 50 });
      }
    }
  }

  return [
    ...gridCluster(holeSignals, 20, 'tolerance_risk', 'hole'),
    ...gridCluster(bendSignals, 10, 'tolerance_risk', 'bend'),
  ];
}

// Per-operation CO₂ (kg) from the backend sustainability engine.
export interface SustainabilityHeatmapWeights {
  laserCo2PerPierce: number | null;
  brakeCo2PerBend: number | null;
}

export function buildSustainabilitySources(fg: FeatureGraph, weights: SustainabilityHeatmapWeights): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];

  const maxUnit = Math.max(weights.laserCo2PerPierce ?? 0, weights.brakeCo2PerBend ?? 0, 0.0001);
  const pierceBase = weights.laserCo2PerPierce != null ? weights.laserCo2PerPierce / maxUnit : 0.5;
  const bendBase   = weights.brakeCo2PerBend   != null ? weights.brakeCo2PerBend   / maxUnit : 0.5;

  const holeSignals: RawSignal[] = [];
  const bendSignals: RawSignal[] = [];

  for (const feat of v2.features) {
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;
      if (feat.feature_type === 'hole') {
        holeSignals.push({ centroid: occ.centroid, amplitude: Math.min(pierceBase, 1.0), featureId: feat.id, occurrenceIndex: i });
      } else if (feat.feature_type === 'bend') {
        const len = occ.bend_length_mm ?? 50;
        bendSignals.push({ centroid: occ.centroid, amplitude: Math.min(bendBase + Math.min(len / 200, 0.5) * 0.2, 1.0), featureId: feat.id, occurrenceIndex: i, bendLen: len });
      }
    }
  }

  return [
    ...gridCluster(holeSignals, 20, 'sustainability', 'hole'),
    ...gridCluster(bendSignals, 10, 'sustainability', 'bend'),
  ];
}

// Thermal distortion proxy — derived from hole density and size relative to thickness.
// Not FEA: amplitude represents estimated heat-accumulation risk from pierce sequencing.
export function buildThermalSources(fg: FeatureGraph, sheetThicknessMm: number): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];

  const t = Math.max(sheetThicknessMm, 0.5);
  const holeSignals: RawSignal[] = [];

  for (const feat of v2.features) {
    if (feat.feature_type !== 'hole') continue;
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;
      // Dense clusters accumulate heat; small holes require more laser dwell per mm
      const densityAmp = Math.min((occ.local_feature_density ?? 1) / 10, 0.6);
      const sizeAmp = feat.diameter_mm != null && feat.diameter_mm < 2 * t ? 0.3 : 0.1;
      holeSignals.push({ centroid: occ.centroid, amplitude: Math.min(densityAmp + sizeAmp, 1.0), featureId: feat.id, occurrenceIndex: i });
    }
  }

  return gridCluster(holeSignals, 20, 'thermal', 'hole');
}

// Tool wear proxy — small holes and high-density clusters wear tooling fastest.
// Amplitude represents relative tooling fatigue, not actual tool life hours.
export function buildToolWearSources(fg: FeatureGraph, sheetThicknessMm: number): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];

  const isCNC = sheetThicknessMm === 0;
  const t = Math.max(sheetThicknessMm, 0.5);
  const holeSignals: RawSignal[] = [];

  for (const feat of v2.features) {
    if (feat.feature_type !== 'hole') continue;
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;
      let amplitude = 0.35;
      if (isCNC) {
        const ld = occ.ld_ratio ?? 0;
        if (ld > 8)      amplitude += 0.50;
        else if (ld > 5) amplitude += 0.35;
        else if (ld > 3) amplitude += 0.20;
        if (occ.tapped) amplitude += 0.15;
      } else {
        // Holes < 2t use smallest-bore / most fragile nozzle focus — highest wear
        if (feat.diameter_mm != null && feat.diameter_mm < 2 * t) {
          amplitude += (1 - feat.diameter_mm / (2 * t)) * 0.45;
        }
      }
      // High local density = many rapid repositioning moves = faster tooling wear
      if ((occ.local_feature_density ?? 0) > 5) amplitude += 0.15;
      holeSignals.push({ centroid: occ.centroid, amplitude: Math.min(amplitude, 1.0), featureId: feat.id, occurrenceIndex: i });
    }
  }

  return gridCluster(holeSignals, 20, 'tool_wear', 'hole');
}

// Per-unit costs from the backend cost engine (INR). Null when cost summary hasn't been run.
// Used only for normalizing heatmap amplitudes — not for reporting cost figures.
export interface CostHeatmapWeights {
  laserCostPerPierce: number | null;
  brakeCostPerBend: number | null;
}

export function buildCostDensitySources(
  fg: FeatureGraph,
  sheetThicknessMm: number,
  weights: CostHeatmapWeights,
): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];

  const isCNC = sheetThicknessMm === 0;
  const t = Math.max(sheetThicknessMm, 0.5);

  // Normalise: find the max per-unit cost to scale amplitudes 0→1.
  // If no cost data, treat both types as equal weight (0.5 base).
  const maxUnit = Math.max(weights.laserCostPerPierce ?? 0, weights.brakeCostPerBend ?? 0, 0.01);
  const pierceBase = weights.laserCostPerPierce != null ? weights.laserCostPerPierce / maxUnit : 0.5;
  const bendBase   = weights.brakeCostPerBend   != null ? weights.brakeCostPerBend   / maxUnit : 0.5;

  const holeSignals: RawSignal[] = [];
  const bendSignals: RawSignal[] = [];

  for (const feat of v2.features) {
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;

      if (feat.feature_type === 'hole') {
        let amplitude: number;
        if (isCNC) {
          const ld = occ.ld_ratio ?? 0;
          amplitude = pierceBase + Math.min(ld / 15, 0.4);
          if (occ.tapped) amplitude += 0.15;
        } else {
          amplitude = pierceBase;
          // Small holes (diameter < 2t) pierce slower — geometry penalty
          if (feat.diameter_mm != null && feat.diameter_mm < 2 * t) {
            amplitude += (1 - feat.diameter_mm / (2 * t)) * 0.3;
          }
        }
        holeSignals.push({ centroid: occ.centroid, amplitude: Math.min(amplitude, 1.0), featureId: feat.id, occurrenceIndex: i });
      } else if (feat.feature_type === 'bend') {
        const len = occ.bend_length_mm ?? 50;
        // Longer bends = more handling — pure geometry ratio, no constant duplication
        const lenBonus = Math.min(len / 200, 0.5) * 0.3;
        bendSignals.push({ centroid: occ.centroid, amplitude: Math.min(bendBase + lenBonus, 1.0), featureId: feat.id, occurrenceIndex: i, bendLen: len });
      }
    }
  }

  return [
    ...gridCluster(holeSignals, 20, 'cost_density', 'hole'),
    ...gridCluster(bendSignals, 10, 'cost_density', 'bend'),
  ];
}
