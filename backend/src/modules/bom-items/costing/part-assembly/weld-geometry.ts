// The weld metal of a MIG weld (its cross-section and the length it runs, for its deposition time and wire: Part Assembly - MIG welding)
// and the spots of a spot weld row. Pure. Every default is a published rule, named in the basis of the value it gave; a row's own size,
// area or count replaces it.
//
// Sources:
//   - AWS D1.1/D1.1M, Structural Welding Code - Steel, the minimum fillet weld size table, by the thicker part joined:
//     T <= 6 mm -> 3 mm, 6 < T <= 12 -> 5 mm, 12 < T <= 20 -> 6 mm, T > 20 -> 8 mm.
//   - AWS D1.1/D1.1M, plug welds: the hole at least the thickness of the part containing it plus 8 mm (5/16 in), filled to that thickness.
//   - ISO 9692-1 joint preparations for gas-shielded metal arc welding of steels: a single-V butt at 40-60 deg and a single bevel at 35-60 deg,
//     with a root gap up to 4 mm; a square butt with a gap. The defaults here are within those: 60 deg, 45 deg and a 2 mm gap, full penetration.
//   - Resistance spot welding: a pitch of at least 10 times the sheet thickness (Machine Design, "DFM: welding").
// J and U grooves, flared grooves and a Groove or Other weld on a Blank have shapes these give no default for: their area is the row's.
import type { PartAssemblyWeld } from './part-assembly-welds';

export type JointType =
  | 'fillet' | 'square_groove' | 'v_groove' | 'bevel_groove' | 'j_groove' | 'u_groove' | 'flared_bevel_groove' | 'flared_v_groove'
  | 'plug' | 'tack' | 'wrap_tie' | 'groove' | 'other';

/** The joint of each memory/Part Assembly MIG operation (an operation of another process has none). */
export const JOINT_TYPE: Readonly<Partial<Record<string, JointType>>> = {
  'Fillet Welding': 'fillet', 'Square Groove Welding': 'square_groove', 'V-Groove Welding': 'v_groove', 'Bevel Groove Welding': 'bevel_groove',
  'J-Groove Welding': 'j_groove', 'U-Groove Welding': 'u_groove', 'Flared Bevel Groove Welding': 'flared_bevel_groove',
  'Flared V-Groove Welding': 'flared_v_groove', 'Plug Welding': 'plug', 'Tack Welding': 'tack', 'Wrap Tie Welding': 'wrap_tie',
  'Groove Welding': 'groove', 'Other Welding': 'other',
};

/**
 * The plate edges a joint's preparation bevels: both plates of a single-V or single-U groove (the V is two 30 deg bevels, the U two J preps),
 * one of a bevel or J groove. A bevel the engineer flags on any other joint is taken as one edge.
 */
export function bevelledEdges(operation: string): number {
  const type = JOINT_TYPE[operation];
  return type === 'v_groove' || type === 'u_groove' ? 2 : 1;
}

export const ROOT_GAP_MM = 2;
export const V_GROOVE_INCLUDED_DEG = 60;
export const BEVEL_DEG = 45;
export const PLUG_HOLE_ALLOWANCE_MM = 8;
export const SPOT_PITCH_THICKNESSES = 10;

/** The AWS D1.1 minimum fillet weld leg (mm) for the thicker part joined. */
export function minimumFilletLegMm(thickerMm: number): number {
  return thickerMm <= 6 ? 3 : thickerMm <= 12 ? 5 : thickerMm <= 20 ? 6 : 8;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** The metal a MIG weld row deposits: its cross-section (mm²) and the length it runs (mm), each with where it came from; or what it lacks. */
export type WeldMetal =
  | { areaMm2: number; lengthMm: number; welds: number; tacked: boolean; areaBasis: string; lengthBasis: string }
  | { missing: string };

type WeldMeasures = Pick<PartAssemblyWeld, 'operation' | 'count' | 'lengthMm' | 'sizeMm' | 'areaMm2'>;

function crossSection(type: JointType, w: WeldMeasures, t: number | null): { areaMm2: number; basis: string } | { missing: string } {
  if (w.areaMm2 != null) return { areaMm2: w.areaMm2, basis: `${w.areaMm2} mm², the area set on the weld` };
  const needT = (what: string) => ({ missing: `the plate thickness (for ${what}): set it on the weld or on the weldment's parts` });
  switch (type) {
    case 'fillet': case 'wrap_tie': case 'tack': {
      if (w.sizeMm != null) return { areaMm2: (w.sizeMm * w.sizeMm) / 2, basis: `a ${w.sizeMm} mm fillet, leg² / 2` };
      if (t == null) return { missing: 'its leg, or the plate thickness for the AWS D1.1 minimum fillet' };
      const leg = minimumFilletLegMm(t);
      return { areaMm2: (leg * leg) / 2, basis: `a ${leg} mm fillet, leg² / 2 (the AWS D1.1 minimum fillet for ${t} mm plate)` };
    }
    case 'square_groove':
      if (t == null) return needT('a square groove');
      return { areaMm2: ROOT_GAP_MM * t, basis: `a square groove through ${t} mm at a ${ROOT_GAP_MM} mm gap (ISO 9692-1)` };
    case 'v_groove':
      if (t == null) return needT('a V-groove');
      return { areaMm2: t * t * tan(V_GROOVE_INCLUDED_DEG / 2) + ROOT_GAP_MM * t, basis: `a ${V_GROOVE_INCLUDED_DEG} deg V-groove through ${t} mm at a ${ROOT_GAP_MM} mm gap (ISO 9692-1)` };
    case 'bevel_groove':
      if (t == null) return needT('a bevel groove');
      return { areaMm2: (t * t * tan(BEVEL_DEG)) / 2 + ROOT_GAP_MM * t, basis: `a ${BEVEL_DEG} deg single bevel through ${t} mm at a ${ROOT_GAP_MM} mm gap (ISO 9692-1)` };
    case 'plug': {
      if (w.sizeMm != null) return { areaMm2: (Math.PI * w.sizeMm * w.sizeMm) / 4, basis: `a Ø${r2(w.sizeMm)} mm plug hole` };
      if (t == null) return { missing: 'its hole diameter, or the plate thickness for the AWS D1.1 minimum hole' };
      const d = t + PLUG_HOLE_ALLOWANCE_MM;
      return { areaMm2: (Math.PI * d * d) / 4, basis: `a Ø${r2(d)} mm plug hole (the AWS D1.1 minimum: ${t} mm plate + ${PLUG_HOLE_ALLOWANCE_MM} mm)` };
    }
    default:
      return { missing: `its cross-section (area): a ${w.operation.replace(/ Welding$/, '').toLowerCase()} joint has no default shape` };
  }
}

/**
 * The metal one MIG weld row deposits. A seam (fillet, groove, wrap tie): its cross-section over its length times its count, tacked first.
 * A plug: the hole's area, filled to the plate thickness, per plug. A tack weld: a fillet over the machine's tack length per tack (so the
 * caller gives the machine's tack length). What is missing is named, never assumed.
 */
export function weldMetal(w: WeldMeasures, thicknessMm: number | null, tackLengthMm: number | null): WeldMetal {
  const type = JOINT_TYPE[w.operation];
  if (!type) return { missing: `${w.operation} is not a MIG welding operation` };
  const section = crossSection(type, w, thicknessMm);
  if ('missing' in section) return section;
  const count = w.count ?? 1;
  if (type === 'plug') {
    if (thicknessMm == null) return { missing: 'the plate thickness (the depth a plug is filled to)' };
    return { areaMm2: section.areaMm2, lengthMm: thicknessMm * count, welds: count, tacked: false, areaBasis: section.basis, lengthBasis: `${count} plug(s), each filled ${thicknessMm} mm deep` };
  }
  if (type === 'tack') {
    if (tackLengthMm == null) return { missing: "the machine's tack length" };
    return { areaMm2: section.areaMm2, lengthMm: tackLengthMm * count, welds: count, tacked: false, areaBasis: section.basis, lengthBasis: `${count} tack(s) of ${tackLengthMm} mm (the machine's tack length)` };
  }
  if (w.lengthMm == null) return { missing: 'its length' };
  return { areaMm2: section.areaMm2, lengthMm: w.lengthMm * count, welds: count, tacked: true, areaBasis: section.basis, lengthBasis: `${count} x ${w.lengthMm} mm of weld` };
}

/** The spots of a spot weld row: its count, else its length at the minimum pitch (10 x the sheet thickness); or what it lacks. */
export function spotsOf(w: Pick<PartAssemblyWeld, 'count' | 'lengthMm'>, thicknessMm: number | null): { spots: number; basis: string } | { missing: string } {
  if (w.count != null) return { spots: w.count, basis: `${w.count} spot weld(s)` };
  if (w.lengthMm == null) return { missing: 'its spot count, or the length its spots run along' };
  if (thicknessMm == null) return { missing: 'the sheet thickness, for the spot pitch along its length' };
  const pitch = SPOT_PITCH_THICKNESSES * thicknessMm;
  const spots = Math.max(1, Math.ceil(w.lengthMm / pitch));
  return { spots, basis: `${w.lengthMm} mm at a ${pitch} mm pitch (${SPOT_PITCH_THICKNESSES} x the ${thicknessMm} mm sheet): ${spots} spot weld(s)` };
}
