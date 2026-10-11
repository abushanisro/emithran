export type ManufacturingFamily =
  | 'sheet_metal' | 'milled' | 'turned'
  | 'plastic_molded' | 'casting' | 'die_cast' | 'sand_cast' | 'investment_cast' | 'forging'
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
/**
 * feature_graph_v2 feature types: the reference operation-catalog vocabulary
 * (cad-engine/shared/reference_features.json), each paired with a `variant`
 * (sheet_metal/feature_models.py, machining/feature_models.py), plus the two
 * injection-molding DFM face categories.
 */
export type FeatureCategory =
  // Sheet metal (sheet_metal/feature_models.py)
  | 'SimpleHole'
  | 'ComplexHole'
  | 'StraightBend'
  | 'Form'
  | 'Lance'
  | 'Blank'
  // Machining (machining/feature_models.py)
  | 'MultiStepHole'
  | 'Edge'
  | 'Ring'
  | 'Slot'
  | 'Keyway'
  | 'PocketV2'
  | 'Cutout'
  | 'PlanarFace'
  | 'CurvedWall'
  | 'CurvedSurface'
  // Die casting (die_casting/feature_models.py) — SimpleHole/MultiStepHole/
  // Ring/PlanarFace/CurvedWall/CurvedSurface above are shared verbatim; these
  // are die-casting-only additions
  | 'RingedHole'
  | 'ComboVoid'
  | 'Void'
  | 'SlideBundle'
  | 'SharpEdge'
  | 'NotSupported'
  // Injection molding DFM faces
  | 'im_undercut'
  | 'im_undrafted';

export interface FamilyClassification {
  family: ManufacturingFamily;
  confidence: number;
  signals: string[];
  classificationSignals?: Record<string, number | string>;
  classificationReasons?: string[];
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
  counterboreGroups?: HoleGroup[];
  countersinkGroups?: HoleGroup[];
  bendRadii?: number[];
  // Real, CAD-detected — computed in cad-engine/feature_extractors.py.
  sharpCornerCount?: number;
  acuteCornerCount?: number;
  smallHoleCount?: number;
  /** The measured cut path by category (STEP topology parts only). */
  cutLengthBreakdownMm?: { outerProfile: number; circularHoles: number; internalProfiles: number };
  /** Longest unbroken laser path, mm (STEP topology parts only). */
  longestContinuousCutMm?: number;
  /** Head travel between pierce points, s (STEP topology parts only). */
  rapidTraverseSec?: number;
  /** Flat-pattern nesting metrics, when the 2D unfold resolved them. */
  flatPatternBoundingRectMm2?: number;
  materialUtilizationPct?: number;
  scrapAreaMm2?: number;
  // New in cad-engine geo_v38 — see memory_optimizer.py's CACHE_VERSION
  // changelog for full derivation/disclosed-limitation notes.
  extrudedFlangeCount?: number;
  thinWebCount?: number;
  internalProfileCount?: number;
  // Injection-molded Phase-1 features (present when family = plastic_molded)
  wallThicknessNominalMm?: number;
  wallThicknessMinMm?: number;
  wallThicknessMaxMm?: number;
  holeOrBossCount?: number;
  filletCount?: number;
  ribCountProxy?: number;
  ribCount?: number;
  wallUniformityRatio?: number | null;
  blindFeatureCount?: number;
  undraftedFaceCount?: number;
  undercutFaceCount?: number;
  partingComplexity?: number | null;
  avgDraftAngleDeg?: number | null;
  // Die casting (auto-fill.service.ts: primary_setup_axis / parting_plane_offset_mm)
  castingSetupAxis?: number[] | null;
  castingPartingPlaneOffsetMm?: number | null;
  /** Pull axes the engine proved undercut-free; drawn as setup-axis arrows in the viewer. */
  castingSetupAxes?: number[][];
  // Real flat-pattern outline/hole geometry (cad-engine's wire-walk
  // extractor, see feature_extractors.py's _compute_flat_pattern_outline) --
  // undefined/'unavailable' when the wire-walk/merge couldn't resolve one
  // for this part's topology. Same fields the true-nest endpoint already
  // reads (see backend bom-items.service.ts's getTrueNest).
  flatPatternOutlinePointsMm?: number[][];
  flatPatternHolesMm?: { cx_mm: number; cy_mm: number; diameter_mm: number }[];
  flatPatternOutlineSource?: 'wire_walk' | 'unavailable';
  flatPatternBoundingLengthMm?: number;
  flatPatternBoundingWidthMm?: number;
}

export interface FeatureGraph {
  extractedAt: string;
  classification: FamilyClassification;
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
  /** Per-face attributes + edge convexity for every domain (null when the part exceeded the engine's face limit). */
  face_graph?: FaceGraph;
  /** Per-feature spatial data for injection molding heatmap (bosses, ribs, wall samples, draft faces) */
  imHeatmapFeatures?: import('@/lib/heatmap/types').IMHeatmapFeatures;
  /** Machining feature extraction (cad-engine machining/feature_models.py). */
  machining_features?: MachiningFeaturesResult | null;
  /** Part bounding box (mm), when the engine reported one. */
  bounding_box?: { x?: number; y?: number; z?: number };
  bboxX?: number;
  bboxY?: number;
  bboxZ?: number;
}

/** cad-engine machining feature extraction, as MachiningFeatureSet.to_dict() returns it. */
export interface MachiningFeaturesResult {
  family?: string;
  features?: {
    id: string;
    type: string;
    variant?: string | null;
    params?: Record<string, unknown>;
    confidence?: number;
    children?: string[];
    face_ids?: number[];
  }[];
  feature_summary?: Record<string, number>;
  variant_summary?: Record<string, number>;
  extraction_version?: string;
  warnings?: string[];
  unclaimed_face_ids?: number[];
  face_map?: FaceMapEntry[];
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
  /** Sheet-metal cut path (Blank / cut_profile, geo_v51+): which part of the cut this occurrence is */
  cut_category?: 'outer_profile' | 'circular_holes' | 'internal_profiles';
  /** Sheet-metal cut path: the measured cut length of this category, mm (same walk as cut_length_mm) */
  length_mm?: number;
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
  // CNC-specific fields — present for machined parts only
  ld_ratio?: number | null;
  depth_mm?: number | null;
  tapped?: boolean | null;
  spec?: string | null;
  material_removed_mm3?: number | null;
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
  /**
   * Real "Operation // FeatureType" string from the canonical Machining
   * operations catalog (memory/machining/operations_full.json /
   * process_taxonomy_operations) — attached backend-side by
   * auto-fill.service.ts's attachCanonicalOperations for machining features
   * only. Absent for Sheet Metal / Plastic Molding features.
   */
  canonical_operation?: string;
  /**
   * Die casting: every real operation the reference catalog pairs with this
   * feature type (memory/Die Casting/Processes/operations.csv), attached by
   * auto-fill.service.ts. No instance-level selection rule is sourced yet,
   * so this is the allowed list, not a chosen operation.
   */
  catalog_operations?: string[];
  /** Machining features: geometric variant of feature_type (e.g. "threaded" on a SimpleHole). */
  variant?: string;
}

export interface FeatureGraphV2 {
  metadata: {
    /** face_id → {tri_start, tri_count} mapping for exact triangle highlighting. Single source of truth. */
    face_map: FaceMapEntry[];
    /** Total triangle count from STL file header. Verify: sum(face_map[i].tri_count) must equal this. */
    stl_tri_total?: number;
  };
  features: FeatureNodeV2[];
  /** Sheet-metal quantities with the faces they were measured on (geo_v52+). */
  measurements?: Partial<Record<MeasurementKey, FeatureMeasurement>>;
}

/** Attributed adjacency graph: face i is the TopExp ordinal used by face_map / feature_graph_v2. */
export interface FaceGraph {
  face_attributes: {
    surface_type: string;
    area_mm2: number;
    centroid: [number, number, number];
    reversed: boolean;
    normal?: [number, number, number];
    axis?: [number, number, number];
    radius_mm?: number;
  }[];
  edge_graph: { a: number; b: number; convexity: 'convex' | 'concave' | 'smooth'; dihedral_deg: number }[];
}

export type MeasurementKey = 'pierce_count' | 'bend_line_length' | 'flat_pattern_area';

export interface FeatureMeasurement {
  value: number;
  unit: string;
  method?: string;
  occurrences: { kind?: string; face_ids: number[]; length_mm?: number }[];
  /** False when the occurrences cannot account for `value` — shown, never hidden. */
  reconciles: boolean;
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
