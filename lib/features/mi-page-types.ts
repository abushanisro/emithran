import type { RoutePicks } from '@/lib/routing/route-pick';

export type PanelId = 'left' | 'center' | 'right' | 'process' | 'drivers';

export interface ManualRouteOption {
  id: string;
  label: string;
  complexityLevel: 'simple' | 'standard' | 'complex';
  isRecommended: boolean;
  processes: string[];
  rationale: string;
  // Real machine picks made in the Workflow Builder (page.tsx's
  // RouteSelectionDialog) — applied via useMachineOverride AFTER apply-route
  // creates the process_cost_records rows, since machine-override updates an
  // existing row rather than creating one.
  machineOverrides?: { processKey: string; mhrRecordId: string }[];
  // Exact identity of a dynamically-assembled (Workflow Builder) route, so
  // reopening the dialog to EDIT this same route restores exactly what's
  // applied instead of resetting to the CAD-optimal default. `processes`
  // above is cosmetic-label-only and `id` is a synthetic `custom-<timestamp>`
  // — neither can round-trip back to a real cuttingRouteId ('sm-laser' etc.)
  // or the real additional-step identities, so this is tracked separately.
  dynamicCuttingRouteId?: string;
  dynamicSteps?: { process: string; machineClass: string; isReal: boolean; processGroup?: string; processRoute?: string }[];
  // The cutting route's OWN process line (e.g. "Turret Punching") — tracked
  // separately from dynamicSteps ("additional steps" only, deliberately, so
  // the Workflow Builder's cutting-method selector and its additional-steps
  // list don't show it twice). apply-custom-route writes ONLY what's in its
  // `steps` payload — it does NOT implicitly add baseCuttingRouteId's own
  // cutting line — so this must be prepended at the call site, or the
  // cutting operation is silently missing from every applied route.
  dynamicCuttingStep?: { process: string; machineClass: string };
  // The route choice this route commits as the scenario's (route-pick.ts): its family's key with its key ("partAssemblyRoute": "robotic"),
  // or a die-casting route's process ("dieCastingProcess"), so the Cost Summary quotes the route picked in the Workflow Builder and its
  // lines (directApplyRouteId) are applied like any complete route.
  routePicks?: RoutePicks;
  // A real, already-valid apply-route.dto.ts routeId (e.g. one of the 3 real
  // Injection Molding tonnage tiers) to apply directly via the plain
  // applyRoute mutation — for a family whose real routes are already
  // complete, self-contained multi-line quotes (no separate cutting +
  // additional-steps composition the way Sheet Metal's dynamic path needs).
  // Distinct from dynamicCuttingRouteId (Sheet Metal's composed-route
  // identity) — this is the real id itself, sourced straight from the backend's own
  // route-comparison result, never a second hand-kept mapping table.
  directApplyRouteId?: string;
}

/** An operation picked in the Workflow Builder to add to the part by hand: opened in the Edit Process Cost dialog as a new line. */
export interface AddProcessRequest { key: number; processRoute: string; operation: string; machineClass: string | null; category: string | null }
