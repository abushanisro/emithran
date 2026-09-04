import { z } from 'zod';

import type { RouteResultDto, ProcessLineCost } from '@/lib/api/hooks/useBOMItems';

// Recursive route-tree model for the Workflow Builder's multi-route picker
// (aPriori-style: many parallel route rows, each expandable to reveal its own
// real step chain — matches memory/sheetmetal/route1-5.png/sheetmetalroute.png,
// which show cutting AND forming (Prog Die/Tandem Die) routes as parallel
// top-level rows in the SAME grid). Deliberately forward-compatible: 'kind'
// already distinguishes required/optional/repeated nodes even though every
// node this adapter produces today is 'required' (real backend data has no
// optional/repeated branching yet). A future step-level alternative (e.g.
// real per-step machine choices) only needs a new branch inside
// adaptRoutesToTree — RouteTree.tsx itself never needs to change, since it
// already renders arbitrary depth.
export interface RouteNode {
  id: string;
  label: string;
  kind: 'required' | 'optional' | 'repeated';
  // Which real registered-engine family produced this route (see
  // RouteResultDto.processFamily's own doc comment). Surfaced so the UI can
  // visually group/label forming routes, NOT to hide them — route5.png's own
  // reference shows Prog Die/Tandem Die as real, visible parallel rows.
  processFamily: 'cutting' | 'forming';
  // True for both families — apply-route.dto.ts's VALID_ROUTE_IDS now
  // includes getFormingRouteIds() alongside getCuttingRouteIds(), so
  // selecting and applying a forming route (Standard/Tandem Press,
  // Progressive Die, Roll Bending 2/3/4) is a real, backend-accepted "Set
  // Route" target, not just a view/compare-only row.
  selectable: boolean;
  selectionNote: string | null;
  // Real, database-driven tooling-economics note (RouteResultDto.
  // toolingVolumeNote's own doc comment) — only set for progressive_die_press
  // / tandem_press, from a real sourced sm_reference_data annual-volume
  // threshold compared against this part's real annual volume. null for
  // every other route.
  toolingVolumeNote: string | null;
  feasible: boolean;
  infeasibleReason: string | null;
  cost: number | null;
  cycleTimeMin: number | null;
  machineName: string | null;
  hourlyRate: number | null;
  machineClass: string | null;
  badges: { lowestCost: boolean; fastest: boolean; bestQuality: boolean };
  children: RouteNode[];
}

// Validates the real shape adaptRoutesToTree depends on — not a re-validation
// of the whole RouteComparisonDto (useRouteComparison's own established
// convention is to trust the network boundary like every other hook in this
// codebase; retrofitting that would be an unrelated, broader change). Scoped
// narrowly to the new adapter boundary this rebuild introduces: a malformed
// route (missing routeId/routeLabel, non-array processLines) fails loudly
// here instead of silently rendering a blank or crashing tree deeper in
// RouteTree.tsx.
const processLineSchema = z.object({
  process: z.string(),
  machineClass: z.string(),
  machineName: z.string().nullable().optional(),
  hourlyRate: z.number(),
  totalCost: z.number(),
  cycleTimeMin: z.number(),
});

const routeResultSchema = z.object({
  routeId: z.string(),
  routeLabel: z.string(),
  processFamily: z.enum(['cutting', 'forming']),
  toolingVolumeNote: z.string().nullable(),
  processLines: z.array(processLineSchema),
  totalCost: z.number().nullable(),
  isFeasible: z.boolean(),
  cycleTimes: z.object({ totalMin: z.number() }),
  badges: z.object({ lowestCost: z.boolean(), fastest: z.boolean(), bestQuality: z.boolean() }),
  capability: z.object({ warnings: z.array(z.string()) }).passthrough(),
});

export class RouteTreeValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message);
    this.name = 'RouteTreeValidationError';
  }
}

function leafNode(routeId: string, line: ProcessLineCost, index: number): RouteNode {
  return {
    id: `${routeId}:${String(index)}`,
    label: line.process,
    kind: 'required',
    processFamily: 'cutting',
    selectable: false,
    selectionNote: null,
    toolingVolumeNote: null,
    feasible: true,
    infeasibleReason: null,
    cost: line.totalCost,
    cycleTimeMin: line.cycleTimeMin,
    machineName: line.machineName ?? null,
    hourlyRate: line.hourlyRate,
    machineClass: line.machineClass,
    badges: { lowestCost: false, fastest: false, bestQuality: false },
    children: [],
  };
}

// One top-level RouteNode per real registered-engine route — includes both
// 'cutting' (Laser/Turret/Waterjet/Shear/Plasma Cut/Plasma Punch/Laser
// Punch/OxyFuel/Router) and 'forming' (Standard/Tandem/Progressive-Die
// Press, Roll Bending) families, matching route5.png's own reference
// structure (Prog Die/Tandem Die shown as real parallel rows alongside the
// cutting routes, not hidden). children = that route's real process-line
// chain, in the real cost-engine-computed order — never fabricated or
// reordered by this adapter.
export function adaptRoutesToTree(routes: RouteResultDto[]): RouteNode[] {
  const parsed = z.array(routeResultSchema).safeParse(routes);
  if (!parsed.success) {
    throw new RouteTreeValidationError(
      `adaptRoutesToTree: received a malformed route-comparison result (${String(parsed.error.issues.length)} issue(s))`,
      parsed.error.issues,
    );
  }

  return routes.map((route) => ({
    id: route.routeId,
    label: route.routeLabel,
    kind: 'required',
    processFamily: route.processFamily,
    selectable: route.processFamily === 'cutting' || route.processFamily === 'forming',
    selectionNote: null,
    toolingVolumeNote: route.toolingVolumeNote,
    feasible: route.isFeasible,
    infeasibleReason: route.isFeasible ? null : (route.capability.warnings.join('; ') || 'Not capable for this part'),
    cost: route.totalCost,
    cycleTimeMin: route.cycleTimes.totalMin,
    machineName: route.processLines[0]?.machineName ?? null,
    hourlyRate: route.processLines[0]?.hourlyRate ?? null,
    machineClass: route.processLines[0]?.machineClass ?? null,
    badges: { ...route.badges },
    children: route.processLines.map((line, i) => leafNode(route.routeId, line, i)),
  }));
}
