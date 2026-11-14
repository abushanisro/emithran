/**
 * What a costing engineer reads off a machined part: each feature instance's CAD measurements, the operations
 * that machine a feature with their time and cost, and the part's cost drivers. Built only from feature_graph_v2
 * and the priced process lines; a measurement the CAD engine did not report is absent, never estimated.
 * Pure: no React, no fetch.
 */
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

/** A priced process line, as far as this file reads it (ProcessLine of the cost summary). */
export interface PricedLine {
  process: string;
  machineName?: string | null;
  hourlyRate: number;
  featureBreakdown?: readonly { name: string; timeSec: number; count: number; featureIds?: string[] | undefined }[] | undefined;
}

export interface FeatureInstance {
  /** 1-based, across every feature passed in. */
  index: number;
  featureType: string;
  variant: string;
  diameterMm?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  depthToDiameter?: number;
  radiusMm?: number;
  areaMm2?: number;
  removedMm3?: number;
  /** A pocket's tightest inside corner; 0 = sharp. */
  cornerRadiusMm?: number;
  /** The thinnest material behind the instance's faces. */
  minWallMm?: number;
  /** The direction the tool approaches from; "either way" appended when both ends are open. */
  toolAxis?: string;
  thread?: string;
}

const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
/** The instance with the measurements that were not reported left out. */
const present = (o: { [K in keyof FeatureInstance]: FeatureInstance[K] | undefined }): FeatureInstance =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as unknown as FeatureInstance;

/** One row per physical instance, with the measurements the CAD engine reported for it. */
export function featureInstances(features: readonly FeatureNodeV2[]): FeatureInstance[] {
  const rows: FeatureInstance[] = [];
  for (const f of features) {
    for (const occurrence of f.occurrences) {
      const o = occurrence as unknown as Record<string, unknown>;
      // extents_mm is the instance's bounding size; a planar face or pocket floor has a zero third extent.
      const [lengthMm, widthMm, heightMm] = (Array.isArray(o.extents_mm) ? (o.extents_mm as unknown[]) : [])
        .map(positive).filter((v): v is number => v !== undefined).sort((a, b) => b - a);
      const floorMm2 = lengthMm && widthMm ? lengthMm * widthMm : undefined;
      const removedMm3 = positive(o.material_removed_mm3);
      // A pocket reports no depth of its own: it is the removed volume over the floor.
      const depthMm = positive(o.depth_mm) ?? (f.feature_type === 'PocketV2' && removedMm3 && floorMm2 ? removedMm3 / floorMm2 : undefined);
      const diameterMm = positive(f.diameter_mm);
      rows.push(present({
        index: rows.length + 1,
        featureType: f.feature_type,
        variant: f.variant ?? 'default',
        diameterMm,
        lengthMm: positive(o.length_mm) ?? lengthMm,
        widthMm: positive(o.width_mm) ?? widthMm,
        heightMm,
        depthMm,
        depthToDiameter: positive(o.ld_ratio) ?? (depthMm && diameterMm ? depthMm / diameterMm : undefined),
        radiusMm: positive(o.radius_mm),
        areaMm2: positive(o.area_mm2),
        removedMm3,
        cornerRadiusMm: typeof o.corner_radius_mm === 'number' && o.corner_radius_mm >= 0 ? o.corner_radius_mm : undefined,
        minWallMm: positive(o.min_wall_mm),
        toolAxis: Array.isArray(o.tool_axis) && o.tool_axis.length === 3
          ? `${(o.tool_axis as number[]).map((c) => Number(c.toFixed(2))).join(', ')}${o.tool_axis_bidirectional === true ? ' (either way)' : ''}`
          : undefined,
        thread: typeof o.spec === 'string' && o.spec ? o.spec : undefined,
      }));
    }
  }
  return rows;
}

export interface OperationCost {
  process: string;
  machine: string | null;
  operation: string;
  count: number;
  timeSec: number;
  /** Cutting time at the line's machine rate (the line's setup and allowances are not in it). */
  cost: number;
}

/** Every priced operation, or only those that machine one of `featureIds`, longest first. */
export function operationCosts(lines: readonly PricedLine[], featureIds?: readonly string[]): OperationCost[] {
  const wanted = featureIds ? new Set(featureIds) : null;
  return lines
    .flatMap((l) => (l.featureBreakdown ?? [])
      .filter((b) => !wanted || (b.featureIds ?? []).some((id) => wanted.has(id)))
      .map((b) => ({
        process: l.process, machine: l.machineName ?? null, operation: b.name, count: b.count,
        timeSec: b.timeSec, cost: (b.timeSec / 3600) * l.hourlyRate,
      })))
    .sort((a, b) => b.timeSec - a.timeSec);
}

export interface CostDriver {
  group: 'Material removal' | 'Holes and threads' | 'Surfaces' | 'Edges';
  name: string;
  value: string;
  /** Why it drives cost. */
  why: string;
}

const faces = (n: number) => `${n} ${n === 1 ? 'face' : 'faces'}`;
const round = (v: number, digits = 1) => v.toLocaleString('en-US', { maximumFractionDigits: digits });

/** The part's geometric cost drivers, read from its features. A driver with nothing to report is left out. */
export function machiningCostDrivers(features: readonly FeatureNodeV2[]): CostDriver[] {
  const rows = featureInstances(features);
  const of = (type: string, variant?: string) => rows.filter((r) => r.featureType === type && (!variant || r.variant === variant));
  const sum = (rs: FeatureInstance[], pick: (r: FeatureInstance) => number | undefined) => rs.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const min = (rs: FeatureInstance[], pick: (r: FeatureInstance) => number | undefined) => {
    const vs = rs.map(pick).filter((v): v is number => v !== undefined);
    return vs.length ? Math.min(...vs) : undefined;
  };
  const max = (rs: FeatureInstance[], pick: (r: FeatureInstance) => number | undefined) => {
    const vs = rs.map(pick).filter((v): v is number => v !== undefined);
    return vs.length ? Math.max(...vs) : undefined;
  };
  const out: CostDriver[] = [];
  const add = (group: CostDriver['group'], name: string, value: string | undefined, why: string) => { if (value) out.push({ group, name, value, why }); };

  const removed = sum(rows, (r) => r.removedMm3);
  add('Material removal', 'Volume removed by features', removed > 0 ? `${round(removed / 1000)} cm³` : undefined, 'Roughing time is this volume over the removal rate of the material.');
  const pockets = of('PocketV2');
  add('Material removal', 'Pockets', pockets.length ? `${pockets.length}` : undefined, 'Each is roughed, then its floor and walls are finished.');
  const deepest = max(pockets, (r) => r.depthMm);
  add('Material removal', 'Deepest pocket', deepest ? `${round(deepest)} mm` : undefined, 'Depth sets the wall area to finish and the reach of the cutter.');
  const narrowest = min(pockets, (r) => r.widthMm);
  add('Material removal', 'Narrowest pocket', narrowest ? `${round(narrowest, 2)} mm` : undefined, 'The cutter can be no wider than this; a small cutter feeds slowly.');
  const reach = max(pockets, (r) => (r.depthMm && r.widthMm ? r.depthMm / r.widthMm : undefined));
  add('Material removal', 'Highest pocket depth to width', reach ? `${round(reach)} : 1` : undefined, 'Above about 4 : 1 a pocket needs long-reach tooling or another process.');

  const holes = [...of('SimpleHole'), ...of('MultiStepHole')];
  add('Holes and threads', 'Holes', holes.length ? `${holes.length}` : undefined, 'Each is centre drilled and drilled; time grows with depth.');
  const diameters = [...new Set(holes.map((r) => r.diameterMm).filter((v): v is number => v !== undefined))].sort((a, b) => a - b);
  add('Holes and threads', 'Hole diameters', diameters.length ? diameters.map((d) => `Ø${round(d, 2)}`).join(', ') : undefined, 'Each diameter is a tool and a tool change.');
  const ld = max(holes, (r) => r.depthToDiameter);
  add('Holes and threads', 'Deepest hole, depth to diameter', ld ? `${round(ld)} : 1` : undefined, 'Above about 5 : 1 a hole needs peck drilling or gun drilling.');
  const threads = holes.filter((r) => r.thread);
  const threadSizes = [...new Set(threads.flatMap((r) => (r.thread ? [r.thread] : [])))];
  add('Holes and threads', 'Tapped holes', threads.length ? `${threads.length} (${threadSizes.join(', ')})` : undefined, 'Each is tapped after drilling; each thread size is a tool.');

  const planar = sum(of('PlanarFace'), (r) => r.areaMm2);
  add('Surfaces', 'Planar faces to finish', planar > 0 ? `${faces(of('PlanarFace').length)}, ${round(planar, 0)} mm²` : undefined, 'Finishing time is the area over the stepover, at the finishing feed.');
  const walls = sum([...of('CurvedWall'), ...of('Cutout')], (r) => r.areaMm2);
  add('Surfaces', 'Walls to contour', walls > 0 ? `${round(walls, 0)} mm²` : undefined, 'Followed with the side of the cutter, one step-down at a time.');
  const freeForm = sum(of('CurvedSurface'), (r) => r.areaMm2);
  add('Surfaces', 'Free-form surface', freeForm > 0 ? `${faces(of('CurvedSurface').length)}, ${round(freeForm, 0)} mm²` : undefined, 'Cut with a ball cutter at a fine stepover: the slowest area to machine.');

  const rounds = of('Edge', 'round');
  add('Edges', 'Rounded edges', rounds.length ? `${rounds.length}` : undefined, 'Each is a pass with a corner-rounding cutter along its length.');
  const grooves = [...of('Slot', 'groove'), ...of('Ring', 'groove')];
  add('Edges', 'Grooves', grooves.length ? `${grooves.length}` : undefined, 'Each is a pass with a form cutter.');
  const slots = [...of('Slot', 'straight'), ...of('Slot', 'radial'), ...of('Keyway')];
  add('Edges', 'Slots and keyways', slots.length ? `${slots.length}` : undefined, 'Milled at the full width of the cutter, or broached.');
  return out;
}
