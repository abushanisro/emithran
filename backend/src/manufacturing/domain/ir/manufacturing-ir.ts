/**
 * Manufacturing Intermediate Representation (Manufacturing IR)
 *
 * The backbone of the Manufacturing Knowledge Engine. Every pipeline stage
 * consumes only this object — never raw CAD data, never DB rows, never HTTP
 * request bodies.
 *
 * Design principles:
 *   - All properties are readonly: the IR is immutable once built
 *   - Features are a discriminated union: no "any", no loose JSON blobs
 *   - Every engineering dimension carries its unit in the name (e.g. diameterMm)
 *   - The schema is versioned so downstream consumers can reject stale IRs
 */

// ── ISO Cutting Material Groups (ISO 513:2012) ───────────────────────────────
export type ISOGroup = 'P' | 'M' | 'K' | 'N' | 'S' | 'H' | 'POLYMER';

// ── Tolerance classes (ISO 286-1) ────────────────────────────────────────────
export type ToleranceClass = 'H6' | 'H7' | 'H8' | 'H9' | 'h6' | 'h7' | 'h8' | 'g6' | 'k6' | 'n6' | string;

// ── Surface finish (Ra in µm) ────────────────────────────────────────────────
export interface SurfaceFinish {
  readonly raMicron: number;
  readonly symbol?: string; // N6, N7, ∇∇∇, etc.
}

// ── Feature types ─────────────────────────────────────────────────────────────
export type FeatureKind =
  | 'hole'
  | 'threaded_hole'
  | 'bend'
  | 'pocket'
  | 'contour'
  | 'surface'
  | 'turned_diameter'
  | 'slot'
  | 'boss'
  | 'rib';

export interface HoleFeature {
  readonly kind: 'hole';
  readonly featureId: string;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly isThrough: boolean;
  readonly count: number;
  readonly toleranceClass?: ToleranceClass;
  readonly surfaceFinish?: SurfaceFinish;
}

export interface ThreadedHoleFeature {
  readonly kind: 'threaded_hole';
  readonly featureId: string;
  readonly threadSpec: string;    // 'M8×1.25', 'UNC 3/8-16'
  readonly majorDiameterMm: number;
  readonly pitchMm: number;
  readonly depthMm: number;
  readonly isThrough: boolean;
  readonly count: number;
}

export interface BendFeature {
  readonly kind: 'bend';
  readonly featureId: string;
  readonly angleDeg: number;
  readonly radiusMm: number;
  readonly lengthMm: number;
  readonly count: number;
}

export interface PocketFeature {
  readonly kind: 'pocket';
  readonly featureId: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly isBlind: boolean;
  readonly count: number;
  readonly surfaceFinish?: SurfaceFinish;
}

export interface ContourFeature {
  readonly kind: 'contour';
  readonly featureId: string;
  readonly perimeterMm: number;
  readonly thicknessMm: number;
  readonly flatPatternAreaMm2: number;
  readonly cutLengthMm: number;
  readonly pierceCount: number;
}

export interface SurfaceFeature {
  readonly kind: 'surface';
  readonly featureId: string;
  readonly areaMm2: number;
  readonly surfaceFinish?: SurfaceFinish;
}

export interface TurnedDiameterFeature {
  readonly kind: 'turned_diameter';
  readonly featureId: string;
  readonly outerDiameterMm: number;
  readonly lengthMm: number;
  readonly materialRemovalMm: number; // (blank OD − finish OD) / 2
  readonly toleranceClass?: ToleranceClass;
}

export interface SlotFeature {
  readonly kind: 'slot';
  readonly featureId: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly count: number;
}

export type Feature =
  | HoleFeature
  | ThreadedHoleFeature
  | BendFeature
  | PocketFeature
  | ContourFeature
  | SurfaceFeature
  | TurnedDiameterFeature
  | SlotFeature;

// ── Material context ──────────────────────────────────────────────────────────
export interface MaterialContext {
  readonly grade: string;           // 'SS304', 'EN8', 'AL6061', 'PA66-GF30'
  readonly isoGroup: ISOGroup;
  readonly densityGCm3: number;
  readonly grossWeightKg: number;
  readonly netWeightKg: number;
  readonly tensileStrengthMpa?: number;
  readonly standardRef: string;     // 'ISO 513:2012', 'ASTM A240', etc.
}

// ── Constraints ───────────────────────────────────────────────────────────────
export type ConstraintKind =
  | 'geometric_tolerance'
  | 'surface_finish'
  | 'heat_treatment'
  | 'coating'
  | 'hardness';

export interface Constraint {
  readonly kind: ConstraintKind;
  readonly appliesTo: string;  // featureId or 'part'
  readonly value: string;      // '±0.02 mm', 'Ra 1.6 µm', 'HRC 58-62', etc.
  readonly standardRef?: string;
}

// ── Part context ──────────────────────────────────────────────────────────────
export interface PartContext {
  readonly partId: string;
  readonly partNumber: string;
  readonly description?: string;
  readonly material: MaterialContext;
  readonly batchSize: number;
  readonly location: string;     // 'USA' | 'IN' | 'FR' | etc.
  readonly currency: string;     // ISO 4217
  readonly currencySymbol: string;
}

// ── IR metadata ───────────────────────────────────────────────────────────────
export type IRConfidence = 'high' | 'medium' | 'low';

export interface IRMetadata {
  readonly cadEngineVersion: string;
  readonly extractedAt: Date;
  readonly confidence: IRConfidence;
  readonly featureSource: 'cad_engine' | 'drawing_intelligence' | 'manual';
  readonly warnings: readonly string[];
}

// ── Manufacturing IR (the backbone) ──────────────────────────────────────────
export interface ManufacturingIR {
  /**
   * Monotonically increasing schema version.
   * Pipeline stages should reject IRs with versions they cannot handle.
   */
  readonly irVersion: '1.0';

  readonly irId: string;
  readonly part: PartContext;
  readonly features: readonly Feature[];
  readonly constraints: readonly Constraint[];
  readonly metadata: IRMetadata;
}

// ── IR builder helpers ────────────────────────────────────────────────────────
// These are the only functions allowed to construct a ManufacturingIR.
// Controllers and services must go through the builder, never construct the
// object directly, so schema validation is always enforced.

export function featuresByKind<K extends FeatureKind>(
  ir: ManufacturingIR,
  kind: K,
): readonly Extract<Feature, { kind: K }>[] {
  return ir.features.filter((f): f is Extract<Feature, { kind: K }> => f.kind === kind);
}

export function totalHoleCount(ir: ManufacturingIR): number {
  const holes = featuresByKind(ir, 'hole');
  const threads = featuresByKind(ir, 'threaded_hole');
  return holes.reduce((s, h) => s + h.count, 0) + threads.reduce((s, t) => s + t.count, 0);
}

export function totalBendCount(ir: ManufacturingIR): number {
  return featuresByKind(ir, 'bend').reduce((s, b) => s + b.count, 0);
}

export function hasFeatureKind(ir: ManufacturingIR, kind: FeatureKind): boolean {
  return ir.features.some((f) => f.kind === kind);
}
