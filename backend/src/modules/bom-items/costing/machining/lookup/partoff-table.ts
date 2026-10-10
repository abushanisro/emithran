import type { MaterialClass } from '../process/cost-machining-engine';
import { MACHINING_MATERIAL_HARDNESS_HB, nearestByHardness } from './machining-material-hardness';

/**
 * Real part-off (parting) cutting data — tblVirtualPartoffInsertCutData
 * (machining_reference_data, migrations 739-751): one row per material cut
 * code (with its real Brinell hardness) × insert width (LengthMm), each with
 * its real cutting speed, feed and the maximum cut depth (DepthMaxMm) that
 * insert can reach.
 *
 * Selection: the rows of the material nearest this part's hardness, then the
 * narrowest insert whose DepthMaxMm reaches the required cut depth (a wider
 * insert than needed removes more material for nothing). When no insert
 * reaches that depth, there is no real parameter set — null, not the deepest
 * row stretched past its limit.
 */
interface PartoffParams {
  cuttingSpeedMPerMin: number;
  feedMmPerRev: number;
  insertWidthMm: number;
  depthMaxMm: number;
  materialCutCode: string;
  hardnessHb: number;
}

interface PartoffRow {
  FeedMm?: number;
  Hardness?: number;
  LengthMm?: number;
  DepthMaxMm?: number;
  CuttingSpeedMPerMin?: number;
  MaterialCutCodeName?: string;
}

export function resolvePartoffParams(
  rows: PartoffRow[] | null | undefined,
  cutDepthMm: number,
  materialClass: MaterialClass,
): PartoffParams | null {
  if (!rows?.length || !(cutDepthMm > 0)) return null;
  const nearest = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[materialClass]);
  if (!nearest) return null;
  const candidates = rows
    .filter((r) => r.MaterialCutCodeName === nearest.MaterialCutCodeName && r.Hardness === nearest.Hardness)
    .filter((r) => typeof r.DepthMaxMm === 'number' && r.DepthMaxMm >= cutDepthMm)
    .filter((r) => typeof r.FeedMm === 'number' && r.FeedMm > 0 && typeof r.CuttingSpeedMPerMin === 'number' && r.CuttingSpeedMPerMin > 0)
    .sort((a, b) => (a.LengthMm ?? Infinity) - (b.LengthMm ?? Infinity));
  const row = candidates[0];
  if (!row) return null;
  return {
    cuttingSpeedMPerMin: row.CuttingSpeedMPerMin!,
    feedMmPerRev: row.FeedMm!,
    insertWidthMm: row.LengthMm!,
    depthMaxMm: row.DepthMaxMm!,
    materialCutCode: row.MaterialCutCodeName!,
    hardnessHb: row.Hardness!,
  };
}
