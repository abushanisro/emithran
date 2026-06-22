export type HeatmapLayerType =
  | 'manufacturing_risk'
  | 'tool_wear'
  | 'thermal'
  | 'cost_density'
  | 'tolerance_risk'
  | 'sustainability';

export interface HeatmapSource {
  centroid: [number, number, number];
  amplitude: number;
  sigma: number;
  layer: HeatmapLayerType;
  featureId?: string;
  occurrenceIndex?: number;
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
