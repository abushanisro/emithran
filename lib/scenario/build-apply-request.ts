import type { ApplyCustomRouteStep } from '@/lib/api/hooks/useBOMItems';

/**
 * What the Cost Guide has staged, turned into the one Apply Scenario request (POST /bom-items/:id/scenario-applications). Pure: the page's state
 * goes in, the request (or the reason it cannot be made) comes out. Nothing is computed here; the backend does the work.
 */
export interface StagedManualRoute {
  label: string;
  /** A Workflow Builder route: the engine route it is based on, its cutting line and its additional steps. */
  dynamicCuttingRouteId?: string;
  dynamicCuttingStep?: { process: string };
  dynamicSteps?: { process: string; machineClass: string; isReal: boolean; processGroup?: string; processRoute?: string }[];
  /** A route applied as it is. */
  directApplyRouteId?: string;
  dieCastingProcess?: string;
  machineOverrides?: { processKey: string; mhrRecordId: string }[];
}

export interface StagedScenario {
  location: string;
  /** The batch size typed by the user; null when none is typed. */
  batchSizeDraft: number | null;
  /** The user asked for the batch size derived from the annual volume again. */
  batchSizeAuto: boolean;
  productionLife: number | null;
  /** The annual volume typed, and the one saved on the part: only a positive, changed figure is sent. */
  annualVolumeDraft: number | null;
  annualVolumeSaved: number | null;
  /** The grade to cost (the picked one, else the one the part is costed as). Empty: no material cost record is made. */
  materialGrade: string;
  processRouting: 'auto' | 'manual';
  manualRoute: StagedManualRoute | null;
  isDieCast: boolean;
  /** Currency and ask price, already resolved by the form. */
  scenarioPatch?: Record<string, unknown>;
  /** The revision of the applied scenario the page read: another apply since then is refused, not overwritten. */
  expectedRevision?: number;
}

export interface ApplyScenarioRequest {
  location: string;
  expectedRevision?: number;
  batchSize?: number | null;
  annualVolume?: number;
  productionLifeYears?: number;
  materialGrade?: string;
  scenarioPatch: Record<string, unknown>;
  route:
    | { mode: 'keep' }
    | { mode: 'route'; routeId: string }
    | { mode: 'custom'; baseCuttingRouteId: string; steps: ApplyCustomRouteStep[] };
  machineOverrides?: { processKey: string; mhrRecordId: string }[];
}

export type BuiltRequest = { ok: true; request: ApplyScenarioRequest } | { ok: false; reason: string };

/** The Workflow Builder's steps in order. The cutting line leads: the backend writes only the steps listed, never the base route's own cutting line. */
function customSteps(route: StagedManualRoute): ApplyCustomRouteStep[] {
  return [
    ...(route.dynamicCuttingStep ? [{ process: route.dynamicCuttingStep.process }] : []),
    ...(route.dynamicSteps ?? []).map((s): ApplyCustomRouteStep => s.isReal
      ? { process: s.process }
      : {
          process: s.process,
          machineClass: s.machineClass,
          ...(s.processGroup !== undefined ? { processGroup: s.processGroup } : {}),
          ...(s.processRoute !== undefined ? { processRoute: s.processRoute } : {}),
        }),
  ];
}

export function buildApplyScenarioRequest(s: StagedScenario): BuiltRequest {
  const manual = s.processRouting === 'manual' ? s.manualRoute : null;

  let route: ApplyScenarioRequest['route'];
  if (manual?.dynamicCuttingRouteId) route = { mode: 'custom', baseCuttingRouteId: manual.dynamicCuttingRouteId, steps: customSteps(manual) };
  else if (manual?.directApplyRouteId) route = { mode: 'route', routeId: manual.directApplyRouteId };
  else if (manual) return { ok: false, reason: `"${manual.label}" cannot be applied: no real route target was resolved for it. Reopen the Workflow Builder and pick a route again.` };
  else route = { mode: 'keep' };

  const volume = s.annualVolumeDraft;
  return {
    ok: true,
    request: {
      location: s.location,
      ...(s.expectedRevision !== undefined ? { expectedRevision: s.expectedRevision } : {}),
      // A typed batch size fixes it; "auto" returns it to the one derived from the annual volume; neither leaves it as it is.
      ...(s.batchSizeDraft !== null ? { batchSize: s.batchSizeDraft } : s.batchSizeAuto ? { batchSize: null } : {}),
      // Only a real, positive, changed volume is written: clearing the field must not commit a 0 nobody meant.
      ...(volume !== null && volume > 0 && volume !== s.annualVolumeSaved ? { annualVolume: volume } : {}),
      ...(s.productionLife !== null ? { productionLifeYears: s.productionLife } : {}),
      ...(s.materialGrade.trim() ? { materialGrade: s.materialGrade.trim() } : {}),
      scenarioPatch: {
        processRouting: s.processRouting,
        // Die casting: Manual is the process picked in the Workflow Builder; Auto clears it, so the cheapest feasible process is quoted.
        ...(s.isDieCast ? { dieCastingProcess: manual?.dieCastingProcess ?? null } : {}),
        ...(s.scenarioPatch ?? {}),
      },
      route,
      ...(manual?.machineOverrides?.length ? { machineOverrides: manual.machineOverrides } : {}),
    },
  };
}
