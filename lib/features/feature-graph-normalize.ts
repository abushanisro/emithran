import { type BOMItem } from '@/lib/api/hooks/useBOMItems';
import type { FeatureGraph, FeatureGraphSummary } from '@/lib/types/manufacturing';

// TODO: Remove after all BOM items are migrated to feature_graph_version >= 4
export function normalizeFeatureGraph(raw: FeatureGraph | null): FeatureGraph | null {
  if (!raw?.summary) return raw;
  const summary = raw.summary;

  // Rebuild holeGroups for old DB entries that have holeDiameters but no holeGroups.
  // NaN→null serialization bug in old pipeline left holeGroups: [] with diameter_mm: null entries.
  const validGroups = (summary.holeGroups ?? []).filter(
    (g): g is { diameter_mm: number; count: number } =>
      typeof g.diameter_mm === 'number' && isFinite(g.diameter_mm) && g.diameter_mm > 0 && g.count > 0,
  );
  let holeGroups = validGroups;

  if (holeGroups.length === 0 && (summary.holeDiameters ?? []).length > 0) {
    const acc: Record<string, number> = {};
    for (const d of summary.holeDiameters!) {
      if (typeof d === 'number' && isFinite(d) && d > 0) {
        const k = d.toFixed(1);
        acc[k] = (acc[k] ?? 0) + 1;
      }
    }
    holeGroups = Object.entries(acc)
      .map(([k, count]) => ({ id: `hole_d${k}_c${count}`, diameter_mm: parseFloat(k), count, geometry_refs: { faces: [], edges: [] } }))
      .sort((a, b) => a.diameter_mm - b.diameter_mm);
  }

  if (holeGroups === validGroups) return raw;
  return { ...raw, summary: { ...summary, holeGroups } };
}

export function buildSummary(item: BOMItem, fg: import('@/lib/types/manufacturing').FeatureGraph | null): FeatureGraphSummary {
  return {
    bendCount: item.bendCount ?? 0,
    cutLengthMm: item.cutLengthMm ?? 0,
    holeCount: item.holeCount ?? 0,
    sheetThicknessMm: item.sheetThicknessMm ?? 0,
    slotCount: 0,
    pierceCount: item.pierceCount ?? 0,
    flatPatternAreaMm2: item.flatPatternAreaMm2 ?? 0,
    holeDiameters: fg?.summary?.holeDiameters ?? [],
    holeGroups: fg?.summary?.holeGroups ?? [],
    bendRadii: fg?.summary?.bendRadii ?? [],
  };
}
