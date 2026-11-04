// The sand cost route's measurements from a casting analysis (the C++ casting worker's result.json, casting-worker/result.schema.json), instead of
// the cad-engine's casting* keys. The worker measures on the exact solid: the draw axis and the part's extent along it, the parting line and its height,
// the nominal wall, and each core with its true volume and size, so the route no longer estimates the height above the parting line or leaves the cores out.
// Pure; a measurement the result does not hold is null, never a guess, and what the route needs but the result lacks is named.
import type { SandMeasurements } from '../bom-items/costing/casting/sand/sand-cost';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const AXES = { x: 0, y: 1, z: 2 } as const;

export interface AnalysisMeasurements {
  measurements: SandMeasurements | null;
  /** Why the result cannot be used for the route (the route then falls back to the cad-engine's measurements). */
  missing: string[];
}

/**
 * The route's measurements from one analysed part. An analysis of an assembly (several distinct parts) is not a casting: the cost route is for one part.
 */
export function measurementsFromCastingResult(result: unknown): AnalysisMeasurements {
  const r = result as { parts?: any[]; status?: string } | null;
  const parts = Array.isArray(r?.parts) ? r!.parts! : [];
  if (parts.length !== 1) return { measurements: null, missing: [parts.length === 0 ? 'the analysis has no part' : `the analysis has ${parts.length} distinct parts: the route costs one part`] };
  const part = parts[0];
  const casting = part?.casting;
  if (!casting) return { measurements: null, missing: ['the analysis has no casting measurement for the part'] };
  const volume = num(part.volume_mm3);
  const area = num(part.area_mm2);
  const size = Array.isArray(part.box_mm?.size) ? (part.box_mm.size as unknown[]).map(Number).filter((v) => Number.isFinite(v)) : [];
  const footprint = Array.isArray(casting.footprint_mm) && casting.footprint_mm.length === 2 && casting.footprint_mm.every((v: unknown) => num(v) != null) ? ([casting.footprint_mm[0], casting.footprint_mm[1]] as [number, number]) : null;
  const missing: string[] = [];
  if (volume == null) missing.push('the part volume (the part is not a valid solid)');
  if (area == null) missing.push('the part surface area');
  if (missing.length) return { measurements: null, missing };

  // The casting's height above the parting plane: its top along the draw axis less the parting height, both in the part's own coordinates.
  const axis = AXES[casting.draw_axis as keyof typeof AXES];
  const top = axis != null ? num(part.box_mm?.max?.[axis]) : null;
  const partingHeight = num(casting.parting?.height_mm);
  const above = top != null && partingHeight != null && top - partingHeight > 0 ? top - partingHeight : null;

  const cores = Array.isArray(casting.cores)
    ? casting.cores.flatMap((c: any) => (num(c?.volume_mm3) != null && Array.isArray(c?.size_mm) ? [{ volume_mm3: c.volume_mm3, area_mm2: num(c?.area_mm2), box_mm: c.size_mm }] : []))
    : null;
  return {
    missing: [],
    measurements: {
      volumeMm3: volume,
      surfaceAreaMm2: area,
      bboxMm: size,
      footprintMm: footprint,
      drawDepthMm: num(casting.draw_depth_mm),
      wallNominalMm: num(casting.wall_mm?.nominal),
      partingPerimeterMm: num(casting.parting_line_mm),
      rawCores: cores,
      abovePartingMm: above,
    },
  };
}
