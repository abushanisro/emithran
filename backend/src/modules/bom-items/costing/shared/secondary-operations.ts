// Secondary operations every part can carry, whatever its family and route:
// heat treatment, surface treatment and the other secondary processes
// (memory/Heat treatment, memory/SurfaceTreatment, memory/Secondary process,
// priced by SecondaryProcessService). Pure.
//
// One mechanism (user decision 2026-10-04): the engineer picks them per part
// (Cost Guide / Workflow Builder), saved on the scenario as
// secondaryOperations = { heat, surface, other } (process names). Until a
// choice is saved, the drawing decides: its heat-treatment callout and its
// surface-treatment callout pre-select their reference processes. Each
// selected process is a line on the quote, after the route's own lines; a
// selected process the reference cannot cost is a named, uncosted line.

import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';

export type SecondaryGroup = 'heat' | 'surface' | 'other';
export const SECONDARY_GROUPS: readonly SecondaryGroup[] = ['heat', 'surface', 'other'];

/** HR Rates process group of each kind (migrations 818 / 820 / 826). */
export const SECONDARY_GROUP_LABEL: Record<SecondaryGroup, string> = {
  heat: 'Heat Treatment',
  surface: 'Surface Treatment',
  other: 'Other Secondary Processes',
};

export type SecondarySelection = Record<SecondaryGroup, string[]>;

/** One secondary result in the item's location currency (SecondaryProcessLine). */
export interface SecondaryResultLike {
  process: string;
  machineClass: string;
  status: 'costed' | 'not_applicable' | 'gap';
  reason: string;
  machine: { id: string; name: string; operators: number } | null;
  cycleTimeSec: number | null;
  setupMin: number | null;
  local: { machineRate: number | null; laborRate: number | null; costPerPart: number | null };
}

/** The saved choice, else the drawing defaults. */
export function resolveSecondarySelection(
  scenarioOverrides: Record<string, unknown> | null | undefined,
  drawingDefaults: SecondarySelection,
): { selection: SecondarySelection; source: 'scenario' | 'drawing' } {
  const raw = scenarioOverrides?.['secondaryOperations'] as Record<string, unknown> | null | undefined;
  if (raw && typeof raw === 'object' && SECONDARY_GROUPS.every((g) => Array.isArray(raw[g]))) {
    const selection = Object.fromEntries(SECONDARY_GROUPS.map((g) => [
      g, (raw[g] as unknown[]).filter((p): p is string => typeof p === 'string'),
    ])) as SecondarySelection;
    return { selection, source: 'scenario' };
  }
  return { selection: drawingDefaults, source: 'drawing' };
}

/** A selected secondary result as a quote line, converted by `conv` (location -> display currency). */
export function secondaryProcessLine(r: SecondaryResultLike, group: SecondaryGroup, conv: number): ProcessLineCost {
  const processGroup = SECONDARY_GROUP_LABEL[group];
  if (r.status !== 'costed' || r.local.costPerPart == null) {
    return {
      process: r.process, processGroup, processRoute: r.process, operation: r.process,
      setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
      machineClass: r.machineClass, machineName: r.machine?.name ?? null, commodityCode: null, labourRate: null,
      physicsGap: {
        gapType: 'unsupported_operation', process: r.process, machineClass: r.machineClass,
        reason: r.status === 'not_applicable' ? `not applicable to this part: ${r.reason}` : r.reason,
      },
    };
  }
  const total = r.local.costPerPart * conv;
  return {
    process: r.process, processGroup, processRoute: r.process, operation: r.process,
    setupCost: 0, runCost: total, totalCost: total,
    cycleTimeMin: r.cycleTimeSec != null ? r.cycleTimeSec / 60 : 0,
    ...(r.setupMin != null ? { setupTimeMin: r.setupMin, setupTimeSource: 'machine' as const } : {}),
    operators: r.machine?.operators ?? null,
    hourlyRate: r.local.machineRate != null ? r.local.machineRate * conv : 0,
    rateSource: 'mhr_database',
    machineClass: r.machineClass, machineName: r.machine?.name ?? null, commodityCode: null,
    labourRate: r.local.laborRate != null ? r.local.laborRate * conv : null,
    ...(r.machine?.id ? { mhrId: r.machine.id } : {}),
  };
}
