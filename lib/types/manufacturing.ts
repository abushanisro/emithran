export type FeatureType =
  | 'flat_pattern' | 'bend' | 'hole' | 'slot'
  | 'flange' | 'hem' | 'corner_relief' | 'notch'
  | 'louver' | 'emboss' | 'dimple' | 'bead'
  | 'hardware';

export type ManufacturingFamily =
  | 'sheet_metal' | 'cnc_milled' | 'cnc_turned'
  | 'injection_molded' | 'casting' | 'forging'
  | 'extrusion' | 'weldment' | 'additive';

export type CostDriverType =
  | 'laser_time'
  | 'press_brake_hits'
  | 'pierce_count'
  | 'material_usage'
  | 'drill_time'
  | 'mill_time'
  | 'turn_time'
  | 'setup_time'
  | 'inspection_time';

export interface CostDriver {
  name: string;
  unit: string;
  value: number;
  driverType?: CostDriverType;
  quantity?: number;
}

/** Legacy process-slot category used by ManufacturingFeatureBase */
export type FeatureProcessCategory = 'cut' | 'form' | 'machined';

/** Standardized feature type categories for Feature Graph v2 */
export type FeatureCategory =
  | 'hole'    // vertical cylindrical through/blind hole — detected
  | 'bend'    // sheet-metal bend (horizontal cylinder face) — detected
  | 'slot'    // elongated internal wire loop — detected
  | 'pocket'  // planar recessed face — detected, face_ids in follow-up
  | 'cutout'  // internal profile cut through flat face — not yet detected
  | 'emboss'  // raised or depressed formed area — not yet detected
  | 'louver'  // ventilation cut-form — not yet detected
  | 'flange'  // bent-up edge (distinct from bend) — not yet detected
  | 'hem'     // folded-back edge — not yet detected
  | 'bead';   // stiffening rib — not yet detected

export type ExtractionMethod =
  | 'occ_cylindrical_face'    // OCC topology — STEP, trusted
  | 'stl_curvature_analysis'  // STL mesh-based, approximate
  | 'bbox_heuristic'          // bounding box inference
  | 'summary_expansion';      // expanded from aggregate count (Phase 1 fallback)

export interface GeometryRefs {
  faces: number[];    // OCC face indices → Three.js viewer highlight (Phase 2)
  edges: number[];    // OCC edge indices
  vertices: number[]; // OCC vertex indices (Phase 2+)
}

export interface ManufacturingFeatureBase {
  id: string;                   // stable hash-based ID: hole_d5.0_x12, bend_r3.0_x5
  featureCategory: FeatureProcessCategory;
  index: number;
  faces: number[];              // backward compat alias for geometryRefs.faces
  edges: number[];
  geometryRefs: GeometryRefs;   // placeholder for 3D click-to-highlight
  costDrivers: CostDriver[];
  confidence: number;           // 0–1 per-feature extraction certainty
  source: 'cad_engine' | 'step_topology' | 'mesh_inference';
  extractionMethod: ExtractionMethod;
  manufacturingIntent?: string; // routing hint: 'laser_pierce', 'press_brake', 'laser_cut'
}

export interface HoleFeature extends ManufacturingFeatureBase {
  type: 'hole';
  featureCategory: 'cut';
  recognition: {
    diameter_mm: number;
    count: number;
    depth_mm: number | null;               // null until Phase 2 OCC depth extraction
    through: 'through' | 'blind' | null;   // null until Phase 2
  };
}

export interface BendFeature extends ManufacturingFeatureBase {
  type: 'bend';
  featureCategory: 'form';
  recognition: {
    radius_mm: number | null;       // null = unknown (STL or no OCC bend data)
    count: number;
    angle_deg: number | null;       // null until Phase 2 extracts from OCC edges
    bend_length_mm: number | null;  // null until Phase 2
  };
}

export interface FlatPatternFeature extends ManufacturingFeatureBase {
  type: 'flat_pattern';
  featureCategory: 'cut';
  recognition: {
    area_mm2: number;
    cut_length_mm: number;
    pierce_count: number;
    sheet_thickness_mm: number;
    est_laser_time_sec: number;
  };
}

// Discriminated union — extend in Phase 2 (SlotFeature, FlangeFeature, etc.)
export type SheetMetalFeature = FlatPatternFeature | HoleFeature | BendFeature;
export type ManufacturingFeature = SheetMetalFeature;

export interface FamilyClassification {
  family: ManufacturingFamily;
  confidence: number;
  signals: string[];
}

export interface ProcessRecommendation {
  sequence: number;
  process: string;
  machine?: string;
  estimated_time_sec?: number;
  status: 'recommended' | 'optional' | 'not_applicable';
}

export type DFMSeverity = 'critical' | 'warning' | 'info';

export interface DFMWarning {
  id: string;
  severity: DFMSeverity;
  category: 'draft_angle' | 'fillet' | 'thin_wall' | 'deep_pocket' | 'undercut' | 'sharp_corner' | 'general';
  message: string;
  featureRef?: string;
  recommendation: string;
}

export interface ValidationResult {
  id: string;
  check: string;
  passed: boolean;
  severity: DFMSeverity;
  actualValue?: string;
  threshold?: string;
  recommendation?: string;
}

export interface HoleGroupLocation {
  manufacturing_region: 'Primary blank' | 'Flange' | 'Side wall';
  face_type: 'flat' | 'flange' | 'sidewall';
  /** Absolute OCC coordinates — for display ("X: 120–180 mm") */
  bbox: { x_min: number; x_max: number; y_min: number; y_max: number };
  /** Three.js-centered coordinates (abs minus part bbox center) — for Zoom to Region */
  bbox_centered?: { x_min: number; x_max: number; y_min: number; y_max: number };
}

export interface HoleGroup {
  id?: string;
  diameter_mm: number;
  count: number;
  geometry_refs?: { faces: number[]; edges: number[] };  // populated in Feature Highlighting milestone
  location?: HoleGroupLocation;
}

export interface FeatureGraphSummary {
  bendCount: number;
  cutLengthMm: number;
  holeCount: number;
  sheetThicknessMm: number;
  slotCount: number;
  pierceCount: number;
  flatPatternAreaMm2: number;
  costDrivers?: CostDriver[];
  holeDiameters?: number[];
  holeGroups?: HoleGroup[];
  bendRadii?: number[];
}

export interface FeatureGraph {
  extractedAt: string;
  classification: FamilyClassification;
  features: ManufacturingFeature[];
  processRecommendations: ProcessRecommendation[];
  summary?: FeatureGraphSummary;
  dfmWarnings?: DFMWarning[];
  validationResults?: ValidationResult[];
  manufacturabilityScore?: number;
  difficultyLevel?: 'easy' | 'medium' | 'hard' | 'very_hard';
  feature_graph_version?: number;
  cad_engine_version?: string;
  analyzed_at?: string;
  /** Per-instance occurrence data — added in Feature Graph v2 */
  feature_graph_v2?: FeatureGraphV2;
}

export interface FeatureSelection {
  featureId: string;
  faces?: number[];
  edges?: number[];
}

// ─── Feature Graph v2 — per-instance occurrence data ─────────────────────────
//
// INVARIANT: occurrences.length === physical count of that feature in the part.
// Each entry is one physical hole or bend — never a grouped aggregate.
// Required for instance-level DFM, pattern detection, and exact face highlighting.

/** Maps one OCC face ordinal → triangle range in the corresponding STL file. */
export interface FaceMapEntry {
  face_id: number;    // OCC face ordinal from TopExp_Explorer walk
  tri_start: number;  // index of first STL triangle for this face
  tri_count: number;  // number of STL triangles belonging to this face
}

export interface FeatureOccurrence {
  /** Three.js-centered coordinates: abs_coord − part_bbox_center */
  centroid: [number, number, number];
  /**
   * OCC face indices for this occurrence — always an array.
   * Holes/bends: single-element [face_id].
   * Slots: multiple wall-face ids.
   * Empty for items analyzed before face_map was introduced (need re-analysis).
   */
  face_ids: number[];
  // Spatial DFM metrics — present for analyses after Phase 4 CAD engine update; null otherwise
  /** mm from hole wall (or bend axis centroid) to nearest outer part edge */
  edge_clearance_mm?: number | null;
  /** mm to nearest hole centroid (for holes: excludes self; for bends: nearest hole) */
  nearest_hole_distance_mm?: number | null;
  /** mm to nearest bend centroid — holes only */
  nearest_bend_distance_mm?: number | null;
  /** count of hole centroids within 30mm radius in XY plane — holes only */
  local_feature_density?: number | null;
  /** axial length of the bend cylinder patch in mm — bends only */
  bend_length_mm?: number | null;
  /** angular extent of the bend patch in degrees — bends only */
  bend_angle_deg?: number | null;
  /** distance from bend cylinder surface to nearest outer part edge (edge_clearance_mm − bend_radius) — bends only */
  edge_to_bend_distance_mm?: number | null;
  /** bounding box of neighboring hole centroids within 30mm radius — holes only */
  hole_cluster_bbox_mm?: {
    x_min: number; x_max: number;
    y_min: number; y_max: number;
    extent_x: number; extent_y: number;
    /** diagonal of the cluster bounding box — overall cluster footprint size */
    diagonal: number;
    count: number;
  } | null;
  // Risk scores set by DFMScoringService — absent until Phase 4B scoring ships
  risk_score?: number;
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  risk_factors?: Array<{ code: string; label: string }>;
}

export interface FeatureNodeV2 {
  id: string;
  feature_type: FeatureCategory;
  /**
   * One entry per physical feature instance in the part.
   * occurrences.length === physical count. Never a grouped aggregate.
   */
  occurrences: FeatureOccurrence[];
  normal?: [number, number, number];
  /** Bounding box of all occurrence centroids, in Three.js-centered coords */
  bbox_centered?: { x_min: number; x_max: number; y_min: number; y_max: number };
  // Type-specific optional fields:
  diameter_mm?: number;  // hole
  radius_mm?: number;    // bend, hem
  length_mm?: number;    // slot, bead
  width_mm?: number;     // slot, louver, emboss
  depth_mm?: number;     // pocket, emboss, bead
  angle_deg?: number;    // bend, flange, hem
}

export interface FeatureGraphV2 {
  metadata: {
    /** face_id → {tri_start, tri_count} mapping for exact triangle highlighting. Single source of truth. */
    face_map: FaceMapEntry[];
    /** Total triangle count from STL file header. Verify: sum(face_map[i].tri_count) must equal this. */
    stl_tri_total?: number;
  };
  features: FeatureNodeV2[];
}

// ─── DFM Risk Scoring ─────────────────────────────────────────────────────────

export type DFMRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Viewer color for each risk level */
export const RISK_COLORS: Record<DFMRiskLevel, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

export interface OccurrenceScore {
  occurrenceIndex: number;
  riskScore: number;
  riskLevel: DFMRiskLevel;
  riskFactors: Array<{ code: string; label: string }>;
}

export interface FeatureDFMScores {
  featureId: string;
  featureType: string;
  occurrences: OccurrenceScore[];
}

export interface DFMScoresResponse {
  bomItemId: string;
  sheetThicknessMm: number;
  features: FeatureDFMScores[];
  scoredAt: string;
}
