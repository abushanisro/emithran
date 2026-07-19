export type HeatmapLayerType =
  | 'manufacturing_risk'
  | 'tool_wear'
  | 'thermal'
  | 'cost_density'
  | 'tolerance_risk'
  | 'sustainability'
  | 'sink_mark';  // IM-only: rib/boss/wall-transition sink mark probability

// ─── Injection Molding heatmap types ─────────────────────────────────────────

export interface IMBossFeature {
  centroid: [number, number, number];
  diameter_mm: number;
  height_mm: number;
  slenderness: number;
}

export interface IMRibFeature {
  centroid: [number, number, number];
  height_mm: number;
  thickness_mm: number;
}

export interface IMWallSample {
  centroid: [number, number, number];
  thickness_mm: number;
  delta_from_nominal: number;
}

export interface IMDraftFace {
  centroid: [number, number, number];
  draft_deg: number;
  classification: 'undrafted' | 'drafted' | 'overdrafted' | 'undercut';
}

export interface IMHeatmapFeatures {
  bosses: IMBossFeature[];
  ribs: IMRibFeature[];
  wall_samples: IMWallSample[];
  draft_faces: IMDraftFace[];
}

export interface IMHeatmapSignals {
  wallThicknessNominalMm: number;
  wallThicknessMaxMm: number;
  wallUniformityRatio: number;
  undercutFaceCount: number;
  undraftedFaceCount: number;
  blindFeatureCount: number;
  partingComplexity: number;
  avgDraftAngleDeg: number;
  ribCount: number;
  bboxMm: [number, number, number];
}

export interface HeatmapSource {
  centroid: [number, number, number];
  amplitude: number;
  sigma: number;
  layer: HeatmapLayerType;
  featureId?: string;
  occurrenceIndex?: number;
  /** Human-readable reason for this blob — shown in the heatmap inspector contributor list */
  reason?: string;
}

export interface ColorRampStop {
  t: number;
  rgb: [number, number, number];
}

export type ColorRamp = ColorRampStop[];

export type HeatmapNormalization = 'absolute' | 'relative';

export interface HeatmapEngineInput {
  positions: Float32Array;
  sources: HeatmapSource[];
  colorRamp: ColorRamp;
  normalization: HeatmapNormalization;
  onProgress?: (pct: number) => void;
}

export interface HeatmapStats {
  maxRawRisk: number;
  percentCritical: number;
  percentHigh: number;
  percentMedium: number;
}

export interface HeatmapEngineOutput {
  colors: Float32Array;
  riskValues: Float32Array;
  stats: HeatmapStats;
}
