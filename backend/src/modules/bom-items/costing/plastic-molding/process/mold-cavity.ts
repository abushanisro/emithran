// Formula registry (plastic-molding/formula-registry.ts): F-26 (cavity and core machining and polish). Change a rule here -> bump its version there.
//
// What the reference says about machining and polishing a mold's cavity and core, looked up for a part: the complexity from its CAD face count
// (cmMoldSurfaceCountThreshold{Simple,Average}: staged for compression molding and borrowed, as the injection process states no rule), and the hours
// per square inch of part surface for that complexity at the part's surface area (tblHrsPerSqInch{Simple,Average,Complex}, the first row whose area
// covers it). The polish is the default cavity finish's hours per square meter (SPIFinishes, read on the reference). The hours and their price are the
// tooling calculator's formulas (mold-tooling-calculator.ts).
import type { MoldBaseReference, MoldComplexity } from '../plastic-reference';

const MM2_PER_SQ_IN = 645.16;

export interface MoldCavityLookup {
  complexity: MoldComplexity;
  faceCount: number;
  hoursPerSqIn: number;
  /** The surface-area bound (in2) of the row used. */
  rowUpToSqIn: number;
}

export function moldCavityLookup(input: { faceCount: number | null; surfaceAreaMm2: number | null; ref: MoldBaseReference }): MoldCavityLookup | { missing: string[] } {
  const missing: string[] = [];
  if (!(input.faceCount != null && input.faceCount > 0)) missing.push('the CAD face count (it decides the mold complexity)');
  if (!(input.surfaceAreaMm2 != null && input.surfaceAreaMm2 > 0)) missing.push('the part surface area (CAD)');
  if (missing.length > 0) return { missing };
  const t = input.ref.complexityFaceThresholds;
  const faces = input.faceCount!;
  const complexity: MoldComplexity = faces <= t.simple ? 'Simple' : faces <= t.average ? 'Average' : 'Complex';
  const rows = input.ref.cavityHoursPerSqInByComplexity[complexity];
  const sqIn = input.surfaceAreaMm2! / MM2_PER_SQ_IN;
  const row = rows.find((r) => sqIn <= r.upToSqIn) ?? rows[rows.length - 1]!;
  return { complexity, faceCount: faces, hoursPerSqIn: row.hoursPerSqIn, rowUpToSqIn: row.upToSqIn };
}
