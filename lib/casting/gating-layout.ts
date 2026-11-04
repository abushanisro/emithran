/**
 * The designed gating system and risers laid out around the part (a schematic placement: the gating is designed by the calculators, not extracted from the
 * CAD, so where it goes is a drawing convention, not a measurement). Port of the demo's gatingSolids (D147), in the part's own coordinates (mm, Z-up as the worker
 * reports them). The runner runs along the part's longer side across the draw axis, its top at the parting plane, an ingate's length away; the ingates
 * bridge to the part, spread evenly along it; the sprue rises from the runner's far end through the cope, the well below it; the risers stand on the part's top,
 * above the ingates. Without a measured parting line the plane is the middle of the draw depth.
 */
import type { Xyz } from '@/lib/casting/viewer-model';

/** The designed system's sizes (mm): what the backend sends in the cost summary's `sandCasting.gating`. */
export interface SandGatingLayout {
  sprueDiameterMm: number;
  sprueHeightMm: number;
  wellDiameterMm: number;
  wellDepthMm: number;
  runnerWidthMm: number;
  runnerHeightMm: number;
  runnerLengthMm: number;
  ingates: number;
  ingateWidthMm: number;
  ingateHeightMm: number;
  ingateLengthMm: number;
  risers: number;
  riserDiameterMm: number;
  riserHeightMm: number;
}

/** One solid of the system in the part's coordinates: a box by its corners, or a cylinder along a part axis (0 x, 1 y, 2 z) from the centre of its base. */
export type GatingSolid =
  | { name: string; box: { min: Xyz; max: Xyz } }
  | { name: string; cylinder: { base: Xyz; axis: 0 | 1 | 2; radius: number; length: number } };

export function gatingSolids(
  g: SandGatingLayout,
  min: Xyz,
  max: Xyz,
  drawAxis: 'x' | 'y' | 'z',
  partingHeight: number | null,
): GatingSolid[] {
  const a = ['x', 'y', 'z'].indexOf(drawAxis) as 0 | 1 | 2;
  const [u, v] = ([0, 1, 2] as const).filter((i) => i !== a);
  // l: along the part's longer side across the draw axis; w: across it.
  const [l, w] = max[u!] - min[u!] >= max[v!] - min[v!] ? [u!, v!] : [v!, u!];
  const h = partingHeight ?? (min[a] + max[a]) / 2;
  const at = (along: number, across: number, up: number): Xyz => {
    const p: [number, number, number] = [0, 0, 0];
    p[l] = along;
    p[w] = across;
    p[a] = up;
    return p;
  };
  const box = (name: string, lo: Xyz, hi: Xyz): GatingSolid => ({ name, box: { min: lo, max: hi } });
  const li = g.ingateLengthMm;
  const length = max[l] - min[l];
  const runnerStart = min[l] - li;
  const runnerMiddle = max[w] + li + g.runnerWidthMm / 2;
  const sprueAt = runnerStart + g.sprueDiameterMm / 2;
  const along = (k: number, n: number) => min[l] + ((k + 0.5) * length) / n;
  return [
    box('Runner', at(runnerStart, max[w] + li, h - g.runnerHeightMm), at(max[l], max[w] + li + g.runnerWidthMm, h)),
    ...Array.from({ length: g.ingates }, (_, k) =>
      box(
        `Ingate ${k + 1}`,
        at(along(k, g.ingates) - g.ingateWidthMm / 2, max[w], h - g.ingateHeightMm),
        at(along(k, g.ingates) + g.ingateWidthMm / 2, max[w] + li, h),
      ),
    ),
    { name: 'Sprue', cylinder: { base: at(sprueAt, runnerMiddle, h), axis: a, radius: g.sprueDiameterMm / 2, length: g.sprueHeightMm } },
    { name: 'Sprue well', cylinder: { base: at(sprueAt, runnerMiddle, h - g.wellDepthMm), axis: a, radius: g.wellDiameterMm / 2, length: g.wellDepthMm } },
    ...Array.from({ length: g.risers }, (_, k): GatingSolid => ({
      name: `Riser ${k + 1}`,
      cylinder: { base: at(along(k, g.risers), (min[w] + max[w]) / 2, max[a]), axis: a, radius: g.riserDiameterMm / 2, length: g.riserHeightMm },
    })),
  ];
}

/** A solid in the GLB's frame (Y-up metres), ready to be a mesh: a box by its centre and size, or a cylinder by its centre, unit direction, radius and length. */
export type GlbShape =
  | { name: string; kind: 'box'; center: Xyz; size: Xyz }
  | { name: string; kind: 'cylinder'; center: Xyz; direction: Xyz; radius: number; length: number };

/** The direction of each part axis in the GLB frame: x stays x, y becomes -z, z becomes y (toGlbFrame). */
const AXIS_IN_GLB: readonly Xyz[] = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];

export function toGlbShape(solid: GatingSolid): GlbShape {
  if ('box' in solid) {
    const [x0, y0, z0] = solid.box.min;
    const [x1, y1, z1] = solid.box.max;
    // part (x, y, z) -> glb (x, z, -y), millimetres to metres: the box's corners keep their order on x and z, and swap on y.
    const lo: Xyz = [x0 / 1000, z0 / 1000, -y1 / 1000];
    const hi: Xyz = [x1 / 1000, z1 / 1000, -y0 / 1000];
    return { name: solid.name, kind: 'box', center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }
  const { base, axis, radius, length } = solid.cylinder;
  const direction = AXIS_IN_GLB[axis]!;
  const [bx, by, bz] = base;
  const start: Xyz = [bx / 1000, bz / 1000, -by / 1000];
  const half = length / 2 / 1000;
  return {
    name: solid.name,
    kind: 'cylinder',
    center: [start[0] + direction[0] * half, start[1] + direction[1] * half, start[2] + direction[2] * half],
    direction,
    radius: radius / 1000,
    length: length / 1000,
  };
}
