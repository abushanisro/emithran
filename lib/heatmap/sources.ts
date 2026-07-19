import type {
  HeatmapSource,
  HeatmapLayerType,
  IMHeatmapFeatures,
  IMHeatmapSignals,
} from './types';
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

// ─── Injection Molding Heatmap Sources ────────────────────────────────────────
//
// Each layer emits per-feature Gaussian blobs anchored at the physical centroid
// of the contributing feature (boss, rib, wall sample, draft face). When per-
// feature data is absent (old cached CAD analysis), layers fall back to a single
// low-amplitude globalBlob so the layer renders a hint rather than empty.

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function globalBlob(
  amplitude: number,
  sigma: number,
  layer: HeatmapLayerType,
): HeatmapSource {
  return {
    centroid: [0, 0, 0],
    amplitude: clamp(amplitude, 0, 1),
    sigma: Math.max(sigma, 5),
    layer,
  };
}

function featureBlobs<T extends { centroid: [number, number, number] }>(
  items: T[],
  ampFn: (item: T) => number,
  sigmaFn: (item: T) => number,
  layer: HeatmapLayerType,
  reasonFn?: (item: T) => string,
): HeatmapSource[] {
  const out: HeatmapSource[] = [];
  for (const item of items) {
    const amplitude = clamp(ampFn(item), 0, 1);
    if (amplitude <= 0) continue;
    const src: HeatmapSource = { centroid: item.centroid, amplitude, sigma: Math.max(sigmaFn(item), 2), layer };
    if (reasonFn) src.reason = reasonFn(item);
    out.push(src);
  }
  return out;
}

function imV2Occurrences(
  fg: FeatureGraph,
  featureType: 'im_undercut' | 'im_undrafted',
  amplitude: number,
  sigma: number,
  layer: HeatmapLayerType,
): HeatmapSource[] {
  const v2 = fg.feature_graph_v2;
  if (!v2) return [];
  const out: HeatmapSource[] = [];
  for (const feat of v2.features) {
    if (feat.feature_type !== featureType) continue;
    for (let i = 0; i < feat.occurrences.length; i++) {
      const occ = feat.occurrences[i];
      if (!occ?.centroid) continue;
      out.push({ centroid: occ.centroid, amplitude: clamp(amplitude, 0, 1), sigma, layer, featureId: feat.id, occurrenceIndex: i });
    }
  }
  return out;
}

// Manufacturing Risk — spatial breakdown of all major IM DFM failure modes
function buildIMManufacturingRisk(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'manufacturing_risk';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // 0.25 wall thickness variation
    out.push(...featureBlobs(f.wall_samples,
      s => clamp(s.delta_from_nominal, 0, 1) * 0.25, () => wn * 4, layer,
      s => `Wall variation +${Math.round(s.delta_from_nominal * 100)}% (${s.thickness_mm.toFixed(1)}mm)`));
    // 0.20 undrafted faces
    out.push(...featureBlobs(
      f.draft_faces.filter(d => d.classification === 'undrafted'),
      d => clamp((1.5 - d.draft_deg) / 1.5, 0, 1) * 0.20, () => wn * 5, layer,
      d => `Undrafted face (${d.draft_deg.toFixed(1)}°)`));
    // 0.10 ribs thicker than 0.6× nominal → sink risk
    out.push(...featureBlobs(f.ribs,
      r => clamp(r.thickness_mm / (0.6 * wn) - 1, 0, 1) * 0.10, () => wn * 5, layer,
      r => `Rib ${r.thickness_mm.toFixed(1)}mm (${Math.round(r.thickness_mm / wn * 100)}% of wall)`));
    // 0.10 boss slenderness (ejection + sink indicator)
    out.push(...featureBlobs(f.bosses,
      b => clamp(b.slenderness / 4, 0, 1) * 0.10, b => b.diameter_mm * 1.5, layer,
      b => `Boss slenderness ×${b.slenderness.toFixed(1)} (Ø${b.diameter_mm.toFixed(1)}mm)`));
    // 0.05 thin wall (< 0.70× nominal)
    out.push(...featureBlobs(
      f.wall_samples.filter(s => s.thickness_mm < wn * 0.70),
      s => clamp(1 - s.thickness_mm / (wn * 0.70), 0, 1) * 0.05, () => wn * 3, layer,
      s => `Thin wall ${s.thickness_mm.toFixed(1)}mm (${Math.round(s.thickness_mm / wn * 100)}% of nominal)`));
  }

  // 0.15 undercuts from feature_graph_v2
  out.push(...imV2Occurrences(fg, 'im_undercut', 0.15, wn * 4, layer));
  // 0.10 corner radius — global until per-corner topology is extracted
  out.push(globalBlob(f && f.ribs.length > 0 ? 0.07 : 0.03, maxBbox * 0.20, layer));
  // 0.05 flow length ratio (L/T)
  const LT = Math.hypot(bboxMm[0], bboxMm[1]) / wn;
  out.push(globalBlob(clamp(LT / 200, 0, 1) * 0.05, maxBbox * 0.40, layer));

  if (!f || (f.wall_samples.length === 0 && f.bosses.length === 0 && f.ribs.length === 0)) {
    out.push(globalBlob(0.40, maxBbox * 0.35, layer));
  }
  return out;
}

// Thermal — heat concentration at thick sections, boss bases, and rib junctions
function buildIMThermal(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'thermal';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // Cooling time ∝ thickness² — thicker wall = exponentially hotter
    out.push(...featureBlobs(f.wall_samples,
      s => clamp((s.thickness_mm / 3.5) ** 2, 0, 1), s => s.thickness_mm * 3, layer,
      s => `Thick wall ${s.thickness_mm.toFixed(1)}mm → slow cooling`));
    // Boss bases are the hottest points in IM (thermal mass × height)
    out.push(...featureBlobs(f.bosses,
      b => clamp((b.height_mm * b.diameter_mm) / (wn ** 2 * 6), 0, 1), b => b.diameter_mm * 2, layer,
      b => `Boss Ø${b.diameter_mm.toFixed(1)}mm × h${b.height_mm.toFixed(1)}mm — heat mass`));
    // Rib-to-wall junctions — stress concentration AND heat sink
    out.push(...featureBlobs(f.ribs,
      r => clamp((r.thickness_mm / wn) ** 2 * 0.70, 0, 0.85), r => r.thickness_mm * 2.5, layer,
      r => `Rib junction ${r.thickness_mm.toFixed(1)}mm — heat trap`));
  }

  if (!f || (f.wall_samples.length === 0 && f.bosses.length === 0 && f.ribs.length === 0)) {
    // Tight sigma: heat is localized at thick sections, not distributed across the whole part
    out.push(globalBlob(0.45, maxBbox * 0.18, layer));
  }
  // fg unused in this layer but kept in signature for uniformity
  void fg;
  return out;
}

// Tool Wear — core pin stress, side-action wear, injection pressure
function buildIMToolWear(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'tool_wear';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // 0.30 core pin slenderness — tall thin bosses stress the core pin
    out.push(...featureBlobs(f.bosses, b => clamp(b.slenderness / 5, 0, 1) * 0.30, b => b.diameter_mm * 1.5, layer));
    // 0.20 thin core pins (d < 4mm = fragile)
    out.push(...featureBlobs(
      f.bosses.filter(b => b.diameter_mm < 4),
      b => clamp(1 - b.diameter_mm / 4, 0, 1) * 0.20, b => b.diameter_mm * 2, layer));
    // 0.15 deep rib inserts
    out.push(...featureBlobs(f.ribs, r => clamp(r.height_mm / (3 * wn), 0, 1) * 0.15, r => r.thickness_mm * 2, layer));
  }

  // 0.20 undercuts → side action / slide wear
  out.push(...imV2Occurrences(fg, 'im_undercut', 0.20, wn * 5, layer));
  // 0.15 injection pressure proxy (L/T)
  const LT = Math.hypot(bboxMm[0], bboxMm[1]) / wn;
  out.push(globalBlob(clamp(LT / 200, 0, 1) * 0.15, maxBbox * 0.38, layer));

  if (!f || (f.bosses.length === 0 && f.ribs.length === 0)) {
    // Intermediate sigma: tool stress concentrates at core pins, not distributed like cost
    out.push(globalBlob(0.35, maxBbox * 0.28, layer));
  }
  return out;
}

// Cost Density — cooling time, tool complexity, material volume, slide cost
function buildIMCostDensity(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'cost_density';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // 0.30 cooling time ∝ thickness²
    out.push(...featureBlobs(f.wall_samples, s => clamp((s.thickness_mm / 4) ** 2, 0, 1) * 0.30, s => s.thickness_mm * 3.5, layer));
    // 0.20 tool complexity: boss slenderness → longer core machining
    out.push(...featureBlobs(f.bosses, b => clamp(b.slenderness / 5, 0, 1) * 0.20, b => b.diameter_mm * 2, layer));
    // 0.20 material volume: boss volume adds direct material + cycle time cost
    out.push(...featureBlobs(
      f.bosses,
      b => clamp((b.height_mm * Math.PI * (b.diameter_mm / 2) ** 2) / (wn ** 3 * 50), 0, 1) * 0.20,
      b => b.diameter_mm * 2.5, layer));
    // 0.05 cycle time: undrafted faces need longer ejection
    out.push(...featureBlobs(
      f.draft_faces.filter(d => d.classification === 'undrafted'),
      d => clamp((1.5 - d.draft_deg) / 1.5, 0, 0.60) * 0.05, () => wn * 4, layer));
  }

  // 0.10 slide cost for undercuts
  out.push(...imV2Occurrences(fg, 'im_undercut', 0.10, wn * 5, layer));

  if (!f || (f.wall_samples.length === 0 && f.bosses.length === 0)) {
    // Wide sigma: cost is distributed across the whole part (cooling, material volume)
    out.push(globalBlob(0.40, maxBbox * 0.50, layer));
  }
  return out;
}

// Tolerance Risk — warpage, differential shrinkage, ejection distortion
function buildIMToleranceRisk(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'tolerance_risk';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // 0.25 differential shrinkage from thickness variation
    out.push(...featureBlobs(f.wall_samples, s => s.delta_from_nominal * 0.25, () => wn * 5, layer));
    // 0.20 ejection distortion from undrafted faces
    out.push(...featureBlobs(
      f.draft_faces.filter(d => d.classification === 'undrafted'),
      d => clamp((1.5 - d.draft_deg) / 1.5, 0, 1) * 0.20, () => wn * 5, layer));
    // 0.20 unsupported wall deflection during packing (tall ribs)
    out.push(...featureBlobs(f.ribs, r => clamp(r.height_mm / (2 * wn), 0, 1) * 0.20, r => r.thickness_mm * 3, layer));
  }

  // 0.20 parting line mismatch from undercuts
  out.push(...imV2Occurrences(fg, 'im_undercut', 0.20, wn * 4, layer));
  // 0.35 flow length / pressure gradient → warp (global: no gate location yet)
  const LT = Math.hypot(bboxMm[0], bboxMm[1]) / wn;
  out.push(globalBlob(clamp(LT / 200, 0, 1) * 0.35, maxBbox * 0.40, layer));

  if (!f || (f.wall_samples.length === 0 && f.ribs.length === 0)) {
    // Widest sigma: warp / shrinkage affects the whole part span
    out.push(globalBlob(0.40, maxBbox * 0.55, layer));
  }
  return out;
}

// Sustainability — cooling energy, material volume, regrind complexity
function buildIMSustainability(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'sustainability';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // 0.30 cooling energy ∝ thickness²
    out.push(...featureBlobs(f.wall_samples, s => clamp((s.thickness_mm / 4) ** 2, 0, 1) * 0.30, s => s.thickness_mm * 3.5, layer));
    // 0.30 boss material volume → embodied energy
    out.push(...featureBlobs(
      f.bosses,
      b => clamp((b.height_mm * Math.PI * (b.diameter_mm / 2) ** 2) / (wn ** 3 * 40), 0, 1) * 0.30,
      b => b.diameter_mm * 2, layer));
  }

  // 0.20 regrind difficulty from undercuts (complex scrap geometry)
  out.push(...imV2Occurrences(fg, 'im_undercut', 0.20, wn * 4, layer));
  // 0.20 gate distance proxy — no gate location yet, static global contribution
  out.push(globalBlob(0.10, maxBbox * 0.40, layer));

  if (!f || (f.wall_samples.length === 0 && f.bosses.length === 0)) {
    // Broad sigma: cooling energy and material volume affect the whole part
    out.push(globalBlob(0.40, maxBbox * 0.42, layer));
  }
  return out;
}

// Sink Mark Risk — rib/boss/wall-transition probability using 60% rule
// Score 0→green (no risk), 1→red (near-certain sink mark visible on A-surface)
function buildIMSinkMarkSources(
  fg: FeatureGraph,
  f: IMHeatmapFeatures | null,
  wn: number,
  bboxMm: [number, number, number],
): HeatmapSource[] {
  const layer: HeatmapLayerType = 'sink_mark';
  const maxBbox = Math.max(...bboxMm, 10);
  const out: HeatmapSource[] = [];

  if (f) {
    // Ribs: "Rule of 60%" — rib thickness should be ≤ 60% of wall nominal
    // Score ramps from 0 at 0.5× to 1.0 at 1.0× (beyond that, guaranteed sink)
    out.push(...featureBlobs(f.ribs,
      r => clamp((r.thickness_mm / wn - 0.5) / 0.5, 0, 1),
      r => r.thickness_mm * 1.5, layer,
      r => `Rib/wall = ${(r.thickness_mm / wn).toFixed(2)}× (threshold: 0.60×)`));

    // Bosses: large-diameter bosses concentrate material at the base → sink on back face
    // Score ramps 0 at 1×wall, 1 at 4×wall
    out.push(...featureBlobs(f.bosses,
      b => clamp((b.diameter_mm / wn - 1) / 3, 0, 1),
      b => b.diameter_mm * 1.2, layer,
      b => `Boss Ø${b.diameter_mm.toFixed(1)}mm (${(b.diameter_mm / wn).toFixed(1)}× wall) — base sink risk`));

    // Wall thick spots: excess material → sink on opposite surface
    // Only thick spots (above nominal) cause sink; thin spots cause flow hesitation instead
    out.push(...featureBlobs(
      f.wall_samples.filter(s => s.thickness_mm > wn),
      s => clamp(s.delta_from_nominal * 2, 0, 1),
      () => wn * 3, layer,
      s => `Thick zone ${s.thickness_mm.toFixed(1)}mm (+${Math.round(s.delta_from_nominal * 100)}%)`));
  }

  // fg is unused in this layer — no feature_graph_v2 features contribute to sink marks
  void fg;

  if (!f || (f.ribs.length === 0 && f.bosses.length === 0 && f.wall_samples.length === 0)) {
    // Very tight sigma: sink marks are highly localized surface defects
    out.push(globalBlob(0.30, maxBbox * 0.14, layer));
  }
  return out;
}

export function buildIMHeatmapSources(
  fg: FeatureGraph,
  signals: IMHeatmapSignals,
  features: IMHeatmapFeatures | null,
  layer: HeatmapLayerType,
): HeatmapSource[] {
  const wn = Math.max(signals.wallThicknessNominalMm, 0.5);
  const bbox = signals.bboxMm;
  const f = features;
  switch (layer) {
    case 'manufacturing_risk': return buildIMManufacturingRisk(fg, f, wn, bbox);
    case 'thermal':            return buildIMThermal(fg, f, wn, bbox);
    case 'tool_wear':          return buildIMToolWear(fg, f, wn, bbox);
    case 'cost_density':       return buildIMCostDensity(fg, f, wn, bbox);
    case 'tolerance_risk':     return buildIMToleranceRisk(fg, f, wn, bbox);
    case 'sustainability':     return buildIMSustainability(fg, f, wn, bbox);
    case 'sink_mark':          return buildIMSinkMarkSources(fg, f, wn, bbox);
    default:                   return [];
  }
}
