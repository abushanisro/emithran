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

export function buildToolWearSources(): HeatmapSource[] { return []; }
export function buildThermalSources(): HeatmapSource[] { return []; }
export function buildCostDensitySources(): HeatmapSource[] { return []; }
export function buildToleranceSources(): HeatmapSource[] { return []; }
export function buildSustainabilitySources(): HeatmapSource[] { return []; }
