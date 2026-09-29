import type { MaterialClass } from '../process/cost-machining-engine';
import { MACHINING_MATERIAL_HARDNESS_HB, nearestByHardness } from './machining-material-hardness';

/**
 * Real straight-drill cutting data — tblDrilling (machining_reference_data,
 * migrations 739-751), tool series "Virtual Drill, Carbide". One row per
 * material cut code (with its real Brinell hardness), each carrying:
 *   - cutting_speed_m_min: { solid, insert_based } — one speed per tool
 *     construction (the table notes: constant within a construction type),
 *   - feed_mm_rev_by_diameter: feed at the table's four diameter breakpoints
 *     (0.1 / 19.9 mm = Solid, 20.0 / 60.0 mm = Insert-Based).
 * construction_by_diameter and depth_max_mm_by_diameter are table-level.
 *
 * Feed between breakpoints: the table defines each construction band only by
 * its two end points, so a diameter inside a band takes the linear
 * interpolation between that band's two breakpoints (outside the table's
 * overall range it is clamped to the nearest breakpoint). A nearest-breakpoint
 * pick is not used: a Ø4 mm solid drill would take the Ø0.1 mm feed
 * (0.00033 mm/rev), off by two orders of magnitude. The derivation is
 * returned so the calculation trace states it.
 */
export interface DrillingParams {
  cuttingSpeedMPerMin: number;
  feedMmPerRev: number;
  construction: string;
  materialCutCode: string;
  hardnessHb: number;
  depthMaxMm: number | null;
  /** How feedMmPerRev was obtained from the breakpoints, for the trace. */
  feedDerivation: string;
  toolSeries: string | null;
}

interface DrillingMaterialRow {
  material_cut_code?: string;
  hardness?: number;
  cutting_speed_m_min?: { solid?: number; insert_based?: number };
  feed_mm_rev_by_diameter?: Record<string, number>;
}

export interface DrillingTable {
  materials?: DrillingMaterialRow[];
  construction_by_diameter?: Record<string, string>;
  depth_max_mm_by_diameter?: Record<string, number>;
  tool_series?: string;
}

function breakpoints(map: Record<string, number> | undefined): Array<{ d: number; v: number; key: string }> {
  if (!map) return [];
  return Object.entries(map)
    .map(([key, v]) => ({ key, d: Number(key), v }))
    .filter((b) => Number.isFinite(b.d) && typeof b.v === 'number' && Number.isFinite(b.v))
    .sort((a, b) => a.d - b.d);
}

export function resolveDrillingParams(
  table: DrillingTable | null | undefined,
  diameterMm: number,
  materialClass: MaterialClass,
): DrillingParams | null {
  if (!table?.materials?.length || !(diameterMm > 0)) return null;
  const row = nearestByHardness(table.materials, MACHINING_MATERIAL_HARDNESS_HB[materialClass]);
  if (!row?.material_cut_code || typeof row.hardness !== 'number') return null;

  const constructionPoints = Object.entries(table.construction_by_diameter ?? {})
    .map(([key, c]) => ({ d: Number(key), c }))
    .filter((p) => Number.isFinite(p.d))
    .sort((a, b) => a.d - b.d);
  if (constructionPoints.length === 0) return null;
  // The band this diameter falls in: the construction of the nearest
  // breakpoint at or above it (clamped to the last breakpoint).
  const bandPoint = constructionPoints.find((p) => diameterMm <= p.d) ?? constructionPoints[constructionPoints.length - 1]!;
  const construction = bandPoint.c;

  const speed = construction === 'Solid' ? row.cutting_speed_m_min?.solid
    : construction === 'Insert-Based' ? row.cutting_speed_m_min?.insert_based
    : undefined;
  if (typeof speed !== 'number' || !(speed > 0)) return null;

  const bandDiameters = new Set(constructionPoints.filter((p) => p.c === construction).map((p) => p.d));
  const band = breakpoints(row.feed_mm_rev_by_diameter).filter((b) => bandDiameters.has(b.d));
  if (band.length === 0) return null;

  let feed: number;
  let feedDerivation: string;
  const lo = [...band].reverse().find((b) => b.d <= diameterMm);
  const hi = band.find((b) => b.d >= diameterMm);
  if (lo && hi && lo.d !== hi.d) {
    feed = lo.v + ((diameterMm - lo.d) / (hi.d - lo.d)) * (hi.v - lo.v);
    feedDerivation = `linear between tblDrilling breakpoints Ø${lo.key} mm (${lo.v}) and Ø${hi.key} mm (${hi.v})`;
  } else {
    const exact = lo ?? hi!;
    feed = exact.v;
    feedDerivation = lo && hi
      ? `tblDrilling breakpoint Ø${exact.key} mm`
      : `clamped to tblDrilling breakpoint Ø${exact.key} mm (outside the ${construction} band)`;
  }

  const depthPoints = breakpoints(table.depth_max_mm_by_diameter);
  const depthMax = depthPoints.find((b) => b.d >= diameterMm) ?? depthPoints[depthPoints.length - 1];

  return {
    cuttingSpeedMPerMin: speed,
    feedMmPerRev: Math.round(feed * 100000) / 100000,
    construction,
    materialCutCode: row.material_cut_code,
    hardnessHb: row.hardness,
    depthMaxMm: depthMax?.v ?? null,
    feedDerivation,
    toolSeries: table.tool_series ?? null,
  };
}
