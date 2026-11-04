/**
 * The mould around the part: the flask of the moulding machine, split at the parting plane into the cope (above it) and the drag (below), in the part's own
 * coordinates (mm, Z-up as the worker reports them). The flask's size is the machine's own (the cost summary's `sandCasting.flask`); its place is a drawing
 * convention: centred on the footprint of the part and its gating across the draw axis, the longer side of the flask along the longer side of that footprint,
 * half its height above the parting plane and half below (the gating is designed on the same half). Opening the mould moves the cope up and the drag down along the draw axis.
 * Pure, so it is tested.
 */
import type { GatingSolid } from '@/lib/casting/gating-layout';
import type { Xyz } from '@/lib/casting/viewer-model';

export interface FlaskSize {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface MouldSolids {
  /** The sand above the parting plane, and below it. */
  cope: GatingSolid;
  drag: GatingSolid;
  /** A thin plate at the parting plane across the flask, where the halves meet. */
  partingPlane: GatingSolid;
  /** How far the cope has moved up (and the drag down), mm: 0 closed. */
  shiftMm: number;
  /** Whether the part with its gating lies inside the flask across the draw axis; when not, the layout does not hold and the viewer says so. */
  fits: boolean;
}

const PLANE_THICKNESS_MM = 1;

/** One coordinate of a point (the index is always 0, 1 or 2). */
const at = (p: Xyz, i: number): number => p[i] ?? 0;

/** The corners of a solid. */
function bounds(s: GatingSolid): { min: Xyz; max: Xyz } {
  if ('box' in s) return s.box;
  const { base, axis, radius, length } = s.cylinder;
  const lo: [number, number, number] = [base[0] - radius, base[1] - radius, base[2] - radius];
  const hi: [number, number, number] = [base[0] + radius, base[1] + radius, base[2] + radius];
  lo[axis] = base[axis];
  hi[axis] = base[axis] + length;
  return { min: lo, max: hi };
}

export function mouldSolids(args: {
  flask: FlaskSize;
  partMin: Xyz;
  partMax: Xyz;
  gating: readonly GatingSolid[];
  drawAxis: 'x' | 'y' | 'z';
  partingHeight: number | null;
  /** 0 closed to 1 fully open (the cope and the drag each move half the flask height). */
  open: number;
}): MouldSolids | null {
  const { flask, partMin, partMax, gating, drawAxis, open } = args;
  if (!(flask.lengthMm > 0 && flask.widthMm > 0 && flask.heightMm > 0)) return null;
  const a = ['x', 'y', 'z'].indexOf(drawAxis) as 0 | 1 | 2;
  const [u, v] = ([0, 1, 2] as const).filter((i) => i !== a) as [0 | 1 | 2, 0 | 1 | 2];
  const h = args.partingHeight ?? (partMin[a] + partMax[a]) / 2;

  const boxes = [{ min: partMin, max: partMax }, ...gating.map(bounds)];
  const lo = (i: number) => Math.min(...boxes.map((b) => at(b.min, i)));
  const hi = (i: number) => Math.max(...boxes.map((b) => at(b.max, i)));
  // The flask's longer side lies along the longer side of the footprint across the draw axis.
  const [fl, fw] = flask.lengthMm >= flask.widthMm ? [flask.lengthMm, flask.widthMm] : [flask.widthMm, flask.lengthMm];
  const uLonger = hi(u) - lo(u) >= hi(v) - lo(v);
  const [sizeU, sizeV] = uLonger ? [fl, fw] : [fw, fl];
  const fits = hi(u) - lo(u) <= sizeU && hi(v) - lo(v) <= sizeV;

  const half = flask.heightMm / 2;
  const shift = Math.min(1, Math.max(0, open)) * half;
  const make = (from: number, to: number): { min: Xyz; max: Xyz } => {
    const min: [number, number, number] = [0, 0, 0];
    const max: [number, number, number] = [0, 0, 0];
    min[u] = (lo(u) + hi(u)) / 2 - sizeU / 2;
    max[u] = (lo(u) + hi(u)) / 2 + sizeU / 2;
    min[v] = (lo(v) + hi(v)) / 2 - sizeV / 2;
    max[v] = (lo(v) + hi(v)) / 2 + sizeV / 2;
    min[a] = from;
    max[a] = to;
    return { min, max };
  };
  return {
    cope: { name: 'Cope', box: make(h + shift, h + half + shift) },
    drag: { name: 'Drag', box: make(h - half - shift, h - shift) },
    partingPlane: { name: 'Parting plane', box: make(h - PLANE_THICKNESS_MM / 2, h + PLANE_THICKNESS_MM / 2) },
    fits,
    shiftMm: shift,
  };
}

/** The gating solids of the cope half (the sprue above the parting plane and the risers) after the mould is opened by `shiftMm`; the runner, ingates and well stay with the drag. */
export function gatingWhenOpen(solids: readonly GatingSolid[], drawAxis: 'x' | 'y' | 'z', shiftMm: number): GatingSolid[] {
  const a = ['x', 'y', 'z'].indexOf(drawAxis) as 0 | 1 | 2;
  return solids.map((s) => {
    if (!(s.name === 'Sprue' || s.name.startsWith('Riser')) || shiftMm === 0) return s;
    if ('box' in s) {
      const min: [number, number, number] = [...s.box.min];
      const max: [number, number, number] = [...s.box.max];
      min[a] += shiftMm;
      max[a] += shiftMm;
      return { name: s.name, box: { min, max } };
    }
    const base: [number, number, number] = [...s.cylinder.base];
    base[a] += shiftMm;
    return { name: s.name, cylinder: { ...s.cylinder, base } };
  });
}
