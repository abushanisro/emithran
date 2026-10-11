// The sheet thickness costing actually uses for a part: the engineer's
// override, else the CAD-extracted thickness, else the stored column — the
// same order as the backend's resolveEffectiveSheetThicknessMm.
export function effectiveSheetThicknessMm(item: {
  scenarioOverrides?: Record<string, unknown> | null;
  featureGraph?: { summary?: { sheetThicknessMm?: number | null } | null } | null;
  sheetThicknessMm?: number | null;
}): number {
  const override = item.scenarioOverrides?.sheetThicknessMm;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  const cad = item.featureGraph?.summary?.sheetThicknessMm;
  if (typeof cad === 'number' && cad > 0) return cad;
  return item.sheetThicknessMm ?? 0;
}
