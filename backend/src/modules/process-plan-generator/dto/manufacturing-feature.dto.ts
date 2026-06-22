/**
 * Manufacturing Feature Graph — structured representation of all manufacturing
 * features extracted from the 2D drawing, 3D geometry, and BOM metadata.
 *
 * This is the intermediate representation between raw extraction data and the
 * AI process planner. The Rule Engine reads this graph to produce MandatoryOp[]
 * — operations that must always appear in the plan regardless of AI judgment.
 *
 * Confidence scoring:
 *   0.95+ drawing-extracted (Claude vision on 2D PDF)
 *   0.70  geometry-detected (3D STEP scan)
 *   0.50  bom-inferred     (BOM metadata only)
 *   0.99  always-present   (SAW_CUT, DEBURR, INSPECT — manufacturing constants)
 */

export type ManufacturingFeatureType =
  | 'OD_TURN'
  | 'FACE_TURN'
  | 'SHOULDER_TURN'
  | 'ID_BORE'
  | 'CROSS_HOLE'
  | 'AXIAL_HOLE'
  | 'COUNTERBORE'
  | 'COUNTERSINK'
  | 'THREAD_EXTERNAL'
  | 'THREAD_INTERNAL'
  | 'POCKET'
  | 'SLOT'
  | 'FLAT_FACE'
  | 'BEND'
  | 'LASER_CUT'
  | 'FORM'
  | 'ANODIZE'
  | 'PLATE'
  | 'HEAT_TREAT'
  | 'GRIND'
  | 'SURFACE_FINISH_FINE'  // Ra ≤ 1.6μm but > 0.8μm — requires dedicated finish turn
  | 'HONE'
  | 'LAPP'
  | 'DEBURR'
  | 'INSPECT'
  | 'SAW_CUT';

export interface ManufacturingFeature {
  id: string;                   // 'F1', 'F2', ...
  type: ManufacturingFeatureType;
  source: 'drawing' | 'geometry' | 'bom';
  confidence: number;           // 0.0–1.0
  // Geometry (all optional, op-specific)
  diameter?: number;            // mm
  length?: number;              // mm
  depth?: number;               // mm
  throughHole?: boolean;
  count?: number;               // number of identical holes, bends, etc.
  spec?: string;                // thread "M6×1", treatment "Type III Hardcoat"
  raMicrons?: number;
  tightest_tol_mm?: number;
  cutLengthMm?: number;         // LASER_CUT: total laser path length from geometry
}

export interface ManufacturingFeatureGraph {
  features: ManufacturingFeature[];
  buildSources: ('drawing' | 'geometry' | 'bom')[];
  overallConfidence: number;    // min of all feature confidences
}

/**
 * Guides the AI toward the correct machine category for each mandatory op.
 * Prevents CNC lathes from being assigned to bench/manual operations.
 */
export type MachineCategoryHint =
  | 'cnc_lathe'          // turning center, CNC lathe
  | 'cnc_mill'           // VMC, HMC, machining center
  | 'laser_cut'          // fiber/CO2 laser cutting machine
  | 'press_brake'        // press brake, CNC bending machine
  | 'saw'                // band saw, cold saw, power hacksaw
  | 'bench_manual'       // deburring, cleaning, marking — bench or manual workstation
  | 'inspection_bench'   // QC bench, CMM, inspection station
  | 'cmm'                // coordinate measuring machine
  | 'inspection'         // general inspection (visual, gauge, etc.)
  | 'surface_treatment'  // anodizing, plating — usually outsourced
  | 'heat_treatment'     // furnace — usually outsourced
  | 'any';               // no preference — AI picks best match

export interface MandatoryOp {
  featureId: string;
  suggestedOpNbr: number;
  operationHint: string;        // "Drilling Ø2.40mm THRU", "Anodising: Type III Hardcoat"
  reason: string;
  confidence: number;           // inherited from triggering feature
  machineCategoryHint: MachineCategoryHint;        // primary machine category
  alternativeMachineHints?: MachineCategoryHint[]; // e.g. drilling: ['cnc_lathe','cnc_mill']
}
