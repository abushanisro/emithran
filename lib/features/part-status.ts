import { type BOMItem, type PlasticDfmView } from '@/lib/api/hooks/useBOMItems';
import { isSupersededPlasticCheck, isSupersededPlasticWarning, plasticDfmReadiness } from '@/lib/dfm/plastic-superseded';
import {
  familyToProcessGroupLabel,
} from '@/lib/features/process-group';
import type { FeatureGraph } from '@/lib/types/manufacturing';

// Family for routing/display: geometric classification with the material veto
// applied. Single source of truth — every consumer of classification.family on
// this page must go through here or a bronze plate gets a press-brake route.
// The grade a part is costed on, by the backend precedence (bom-items.service
// getCostSummary): the Material Grade, else the material picked at Create BOM.
export function costedGrade(item: { materialGrade?: string | null; material?: string | null }): string {
  return item.materialGrade ?? item.material ?? '';
}

/**
 * The Process the user picked in Create/Edit BOM Item, persisted as scenario_overrides.processGroup; items saved before that existed fall back to
 * their stored family's process-group label. One rule for the Cost Guide and the tooling dialog.
 */
export function partProcessGroup(item: BOMItem, fg: FeatureGraph | null | undefined): string | null {
  // || on purpose: a blank saved choice falls back to the family, like an absent one
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition
  return (item.scenarioOverrides?.processGroup as string | undefined) || familyToProcessGroupLabel(item.familyClassification ?? fg?.classification?.family) || null;
}

/** The applied route is no longer one the engine offers for this part (the part's process changed since). */
export function appliedRouteIsStale(appliedRouteId: string | null | undefined, routes: ReadonlyArray<{ routeId: string }> | undefined): boolean {
  return !!appliedRouteId && !!routes && routes.length > 0 && !routes.some((r) => r.routeId === appliedRouteId);
}

/** Why the last Apply was refused (scenario_overrides.appliedScenario), or null when it was not. */
export function lastApplyError(item: { scenarioOverrides?: Record<string, unknown> | null }): string | null {
  const applied = item.scenarioOverrides?.['appliedScenario'] as { status?: string; error?: string } | undefined;
  return applied?.status === 'failed' && applied.error ? applied.error : null;
}

export function deriveReadiness(item: BOMItem, plasticDfm: PlasticDfmView | undefined): { label: string; ready: boolean } {
  const hasCritical = (item.featureGraph?.dfmWarnings ?? []).filter((w) => !isSupersededPlasticWarning(w)).some((w) => w.severity === 'critical')
    || plasticDfmReadiness(plasticDfm).critical;
  if (hasCritical) return { label: 'DFM Issues Found', ready: false };
  if (!costedGrade(item)) return { label: 'Material Pending', ready: false };
  if (!item.file2dPath && !item.drawingIntelligence) return { label: 'Drawing Required', ready: false };
  return { label: 'Ready for RFQ', ready: true };
}

export function buildRiskFlags(item: BOMItem, plasticDfm: PlasticDfmView | undefined): string[] {
  const flags: string[] = [];
  if (!costedGrade(item)) flags.push('Material not confirmed');
  if (item.tightestToleranceMm != null && item.tightestToleranceMm < 0.1)
    flags.push(`Tightest tolerance ±${item.tightestToleranceMm} mm`);
  if ((item.holeCount ?? 0) > 200) flags.push(`${item.holeCount ?? 0} holes — high pierce count`);
  if ((item.bendCount ?? 0) > 40) flags.push(`${item.bendCount ?? 0} bends`);
  for (const w of (item.featureGraph?.dfmWarnings ?? []).filter((x) => !isSupersededPlasticWarning(x))) {
    if (w.severity === 'critical' || w.severity === 'warning') flags.push(w.message);
  }
  for (const v of (item.featureGraph?.validationResults ?? []).filter((x) => !isSupersededPlasticCheck(x))) {
    if (!v.passed && v.severity !== 'info') flags.push(v.check);
  }
  flags.push(...plasticDfmReadiness(plasticDfm).flags);
  return flags;
}
