// Formula registry (plastic-molding/formula-registry.ts): F-25 (mold base and plate steel). Change a rule here -> bump its version there.
//
// The mold base a part needs, chosen from memory/Plastic Modeling: the cavities laid out as layoutNumCav says for the cavity count, with
// betweenPartsMoldBorder of steel between neighbouring parts and the runner region coefficient on the width; the edge borders beside them
// (tblEdgeMoldBorderX / Y, the first row whose press force covers the press); and the smallest standard base (tblStandardMoldBaseSizes, in the
// system useMetricOrImperialValues names) that holds the result, either way round. The plate thicknesses, the steel and its price are the tooling
// calculator's formulas (mold-tooling-calculator.ts); this only looks up. A base larger than every standard one (a custom base) is not modelled:
// it is a named gap.
import type { MoldBaseReference } from '../plastic-reference';

export interface MoldBaseChoice {
  layout: { widthWise: number; lengthWise: number; runnerCoefficient: number };
  regionWidthMm: number;
  regionLengthMm: number;
  edgeBorderXMm: number;
  edgeBorderYMm: number;
  requiredWidthMm: number;
  requiredLengthMm: number;
  base: { name: string; widthMm: number; lengthMm: number };
  cavityDepthBorderMm: number;
  coreDepthBorderMm: number;
}

const byForce = (rows: ReadonlyArray<{ maxKn: number; mm: number }>, kn: number) => (rows.find((r) => kn <= r.maxKn) ?? rows[rows.length - 1])?.mm;

export function selectMoldBase(input: {
  /** The part's footprint on the parting plane: its two longest sides, mm. */
  partLengthMm: number;
  partWidthMm: number;
  cavities: number;
  /** The press's clamp force, kN: picks the borders. */
  clampKn: number | null;
  ref: MoldBaseReference;
}): MoldBaseChoice | { missing: string[] } {
  const { ref } = input;
  const missing: string[] = [];
  const layout = ref.layouts.find((l) => l.cavities === input.cavities);
  if (!layout) missing.push(`layoutNumCav has no layout for ${input.cavities} cavities`);
  if (!(input.clampKn != null && input.clampKn > 0)) missing.push('the press clamp force (it picks the mold borders)');
  if (!(input.partLengthMm > 0 && input.partWidthMm > 0)) missing.push('the part footprint (CAD bounding box)');
  if (missing.length > 0 || !layout || input.clampKn == null) return { missing };

  const regionWidthMm = (layout.widthWise * input.partLengthMm + (layout.widthWise - 1) * ref.betweenPartsMm) * layout.runnerCoefficient;
  const regionLengthMm = layout.lengthWise * input.partWidthMm + (layout.lengthWise - 1) * ref.betweenPartsMm;
  const edgeBorderXMm = byForce(ref.edgeBorderXByKn, input.clampKn)!;
  const edgeBorderYMm = byForce(ref.edgeBorderYByKn, input.clampKn)!;
  const requiredWidthMm = regionWidthMm + 2 * edgeBorderXMm;
  const requiredLengthMm = regionLengthMm + 2 * edgeBorderYMm;
  const base = ref.bases.find((b) => (b.widthMm >= requiredWidthMm && b.lengthMm >= requiredLengthMm) || (b.lengthMm >= requiredWidthMm && b.widthMm >= requiredLengthMm));
  if (!base) {
    return { missing: [`no standard mold base in tblStandardMoldBaseSizes (${ref.system}) holds ${Math.round(requiredWidthMm)} x ${Math.round(requiredLengthMm)} mm: a custom base is not modelled`] };
  }
  return {
    layout: { widthWise: layout.widthWise, lengthWise: layout.lengthWise, runnerCoefficient: layout.runnerCoefficient },
    regionWidthMm, regionLengthMm, edgeBorderXMm, edgeBorderYMm, requiredWidthMm, requiredLengthMm, base,
    cavityDepthBorderMm: byForce(ref.cavityDepthBorderByKn, input.clampKn)!,
    coreDepthBorderMm: byForce(ref.coreDepthBorderByKn, input.clampKn)!,
  };
}
