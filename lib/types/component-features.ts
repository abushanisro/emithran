// aPriori-style component feature decomposition types.
// Produced by CAD engine ComponentFeatureAnalyzer; stored in feature_graph JSONB
// under the key "component_features".

export interface BlankAnalysis {
  id: "blank_1";
  face_id: number;
  volume_mm3: number;
  area_mm2: number;
  edge_count: number;
  edge_segments: Array<{ id: string; length_mm: number }>;
  centroid: { x: number; y: number; z: number };
}

export interface SetupAxisSlide {
  id: string; // 'slide_1', 'slide_2', ...
  direction_label: string; // '+Z', '-Z', '+X', ...
  direction_type: "ORTHOGONAL" | "OTHER";
  direction_vector: { x: number; y: number; z: number };
  tool_reach_mm: number;
  length_mm: number;
  max_rules_deg: number;
  wall_corner_diameter_mm: number | null;
  unobstructed_wall_corner_diameter_mm: number | null;
  distance_to_obstruction_mm: number | null;
  distance_to_tool_interference_mm: number | null;
  is_feasible: boolean;
  is_feasible_for_fillet: boolean;
  has_parallel_tangent_edges: boolean;
  distance_to_solid_shadow_border_mm: number | null;
  parting_projection_start_mm: { x: number; y: number } | null;
  parting_projection_end_mm: { x: number; y: number } | null;
  rectangle_lower_left: { x: number; y: number } | null;
  rectangle_upper_right: { x: number; y: number } | null;
  clearance_distance_mm: number | null;
  accessible_surface_area_mm2: number;
  has_blocked_volume: boolean;
  oriented_box_center: { x: number; y: number; z: number } | null;
  largest_window_area_mm2: number | null;
  largest_shadow_area_mm2: number;
  shadow_depth_mm: number;
  draft_angle_deg: number;
  group_id: string;
}

export type GCDRelationType =
  | "adjacent"           // faces share a boundary edge (OCC topology)
  | "ends_on"            // bend fold-line terminates on blank boundary
  | "intersects"         // sphere volumes overlap, or blank contains feature
  | "is_accessible_from" // feature reachable from a setup axis direction
  | "is_orthogonal"      // feature normals are perpendicular (≈90°)
  | "lies_near"          // within proximity without overlap
  | "lies_on"            // feature centroid lies within another feature's face bounds
  | "lies_outside"       // distant, no normal alignment
  | "parallel";          // feature normals co-directional (≈0° or 180°)

export interface GCDRelation {
  type: GCDRelationType;
  source_id: string;
  target_id: string;
  distance_mm?: number;
  area_mm2?: number;
  angle_deg?: number;
  /** OCC face ordinals (0-based) for 3D viewer highlighting. Present on adjacent relations. */
  face_ids?: number[];
}

export interface MainSurface {
  id: string;
  face_id: number;
  area_mm2: number;
  normal: { x: number; y: number; z: number };
  is_primary: boolean;
}

export interface SideClassification {
  inside: Array<{ feature_id: string; face_ids: number[] }>;
  outside: Array<{ feature_id: string; face_ids: number[] }>;
}

export interface ComponentFeatureAnalysis {
  blank: BlankAnalysis;
  main_surfaces: MainSurface[];
  setup_axes_candidates: SetupAxisSlide[];
  sides: SideClassification;
  gcd_relations: GCDRelation[];
}
