// Which operation each CAD feature of a blow molded or rotomolded part takes (memory/Roto & blow molding/Processes/operations.csv), by the
// thresholds of the staged reference (2026-RotoBlow variables). Pure.
//
//   Extrusion blow mold
//     a spout within minBlowHoleDiameter..maxBlowHoleDiameter      Blow Hole (the blow pin goes in through it), its neck's moil sawn off
//     a hole through the wall                                       Routing: a blown shell is closed, an opening is cut after molding
//     a blind hole deeper than maxBlowMoldSimpleHoleDepth           Coring; a shallower one As Molded
//     a void (a recess in the shell) deeper than voidDepthConstant  Coring (depth over its width); else As Molded
//     a non-round opening (ComplexHole)                             Routing
//     the parting line                                              Routing (the pinch-off flash trimmed)
//   Rotational mold
//     a hole or spout up to maxCorableHoleDiameter                  Coring (a core forms the opening); a larger one As Molded
//     a non-round opening (ComplexHole)                             Trimming: cut out by hand after molding, its plug and stock wasted
//     a blind hole or a void                                        As Molded; a void deeper than voidDepthConstant Coring
//   Anything else is a No Cost Feature.

export type RotoBlowRouteKey = 'blow' | 'roto';

export type FeatureOperation = 'As Molded' | 'Coring' | 'Blow Hole' | 'Trimming' | 'Routing' | 'Sawing' | 'No Cost Feature';

export interface RotoBlowHole { id: string; type: string; variant: string; diameterMm: number; depthMm: number }
export interface RotoBlowVoid { id: string; type: string; variant: string; volumeMm3: number; depthMm: number; equivalentDiameterMm: number | null }
export interface RotoBlowSpout { id: string; diameterMm: number; lengthMm: number }

/** One feature's operation: the process that makes it, and what it adds (a cut's length, a saw's section, a core). */
export interface FeatureOp {
  id: string;
  featureType: string;
  operation: FeatureOperation;
  /** The catalog process the operation belongs to. */
  process: 'Extrusion Blow Mold' | 'Rotational Mold' | 'Router' | 'Saw' | 'No Cost Feature';
  reason: string;
  /** A routed or trimmed edge (mm). */
  cutLengthMm?: number;
  /** A sawn section (mm²). */
  sawAreaMm2?: number;
  /** A plug cut out and wasted (mm³). */
  wasteVolumeMm3?: number;
}

export interface FeatureRules {
  minBlowHoleDiameter: number;
  maxBlowHoleDiameter: number;
  maxBlowMoldSimpleHoleDepth: number;
  maxCorableHoleDiameter: number;
  voidDepthConstant: number;
  trimStockAllowance: number;
}

export interface FeatureInput {
  wallMm: number;
  partingLineMm: number | null;
  spouts: readonly RotoBlowSpout[];
  holes: readonly RotoBlowHole[];
  voids: readonly RotoBlowVoid[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A recess's depth over its width: its width the side of a square of its volume over its depth. */
function depthOverWidth(v: RotoBlowVoid): number {
  if (!(v.depthMm > 0) || !(v.volumeMm3 > 0)) return 0;
  return v.depthMm / Math.sqrt(v.volumeMm3 / v.depthMm);
}

/** Every feature's operation on the route (see the file comment). */
export function featureOperations(route: RotoBlowRouteKey, part: FeatureInput, rules: FeatureRules): FeatureOp[] {
  const ops: FeatureOp[] = [];
  const molding = route === 'blow' ? 'Extrusion Blow Mold' : 'Rotational Mold';
  const wall = part.wallMm;
  for (const s of part.spouts) {
    if (route === 'blow') {
      if (s.diameterMm >= rules.minBlowHoleDiameter && s.diameterMm <= rules.maxBlowHoleDiameter) {
        ops.push({ id: s.id, featureType: 'Spout', operation: 'Blow Hole', process: molding, reason: `Ø ${r2(s.diameterMm)} mm, within the ${rules.minBlowHoleDiameter}-${rules.maxBlowHoleDiameter} mm blow-hole range` });
        ops.push({ id: s.id, featureType: 'Spout', operation: 'Sawing', process: 'Saw', reason: 'the neck\'s moil sawn off', sawAreaMm2: r2(Math.PI * s.diameterMm * wall) });
      } else {
        ops.push({ id: s.id, featureType: 'Spout', operation: 'As Molded', process: molding, reason: `Ø ${r2(s.diameterMm)} mm, outside the ${rules.minBlowHoleDiameter}-${rules.maxBlowHoleDiameter} mm blow-hole range: molded closed, not blown through` });
        ops.push({ id: s.id, featureType: 'Spout', operation: 'Routing', process: 'Router', reason: 'opened after molding', cutLengthMm: r2(Math.PI * s.diameterMm) });
      }
    } else if (s.diameterMm <= rules.maxCorableHoleDiameter) {
      ops.push({ id: s.id, featureType: 'Spout', operation: 'Coring', process: molding, reason: `Ø ${r2(s.diameterMm)} mm, up to the ${rules.maxCorableHoleDiameter} mm a core forms` });
    } else {
      ops.push({ id: s.id, featureType: 'Spout', operation: 'As Molded', process: molding, reason: `Ø ${r2(s.diameterMm)} mm, larger than a core forms: an opening in the mold` });
    }
  }
  for (const h of part.holes) {
    const through = h.variant === 'through';
    if (route === 'blow') {
      if (through) ops.push({ id: h.id, featureType: h.type, operation: 'Routing', process: 'Router', reason: 'a hole through a blown shell is cut after molding', cutLengthMm: r2(Math.PI * h.diameterMm) });
      else if (h.depthMm > rules.maxBlowMoldSimpleHoleDepth) ops.push({ id: h.id, featureType: h.type, operation: 'Coring', process: molding, reason: `${r2(h.depthMm)} mm deep, beyond the ${rules.maxBlowMoldSimpleHoleDepth} mm molded without a core` });
      else ops.push({ id: h.id, featureType: h.type, operation: 'As Molded', process: molding, reason: `${r2(h.depthMm)} mm deep: molded` });
    } else if (through && h.diameterMm <= rules.maxCorableHoleDiameter) {
      ops.push({ id: h.id, featureType: h.type, operation: 'Coring', process: molding, reason: `Ø ${r2(h.diameterMm)} mm through the wall, up to the ${rules.maxCorableHoleDiameter} mm a core forms` });
    } else {
      ops.push({ id: h.id, featureType: h.type, operation: 'As Molded', process: molding, reason: through ? 'larger than a core forms: an opening in the mold' : 'molded' });
    }
  }
  for (const v of part.voids) {
    if (v.type === 'ComplexHole') {
      const edge = v.equivalentDiameterMm != null ? Math.PI * v.equivalentDiameterMm : 0;
      if (route === 'blow') {
        ops.push({ id: v.id, featureType: 'ComplexHole', operation: 'Routing', process: 'Router', reason: 'a non-round opening cut after molding', cutLengthMm: r2(edge) });
      } else {
        const area = v.equivalentDiameterMm != null ? (Math.PI * v.equivalentDiameterMm ** 2) / 4 : 0;
        ops.push({
          id: v.id, featureType: 'ComplexHole', operation: 'Trimming', process: molding, reason: 'a non-round opening cut out by hand after molding',
          cutLengthMm: r2(edge), wasteVolumeMm3: r2(area * wall + edge * rules.trimStockAllowance * wall),
        });
      }
      continue;
    }
    const ratio = depthOverWidth(v);
    if (ratio > rules.voidDepthConstant) {
      ops.push({ id: v.id, featureType: 'Void', operation: 'Coring', process: molding, reason: `depth ${r2(ratio)} times its width, beyond ${rules.voidDepthConstant}: a core forms it` });
    } else {
      ops.push({ id: v.id, featureType: 'Void', operation: 'As Molded', process: molding, reason: `depth ${r2(ratio)} times its width: molded` });
    }
  }
  if (route === 'blow' && part.partingLineMm && part.partingLineMm > 0) {
    ops.push({ id: 'parting-line', featureType: 'PartingLine', operation: 'Routing', process: 'Router', reason: 'the pinch-off flash trimmed along the parting line', cutLengthMm: r2(part.partingLineMm) });
  }
  return ops;
}
