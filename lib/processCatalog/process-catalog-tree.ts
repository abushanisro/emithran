import { z } from 'zod';

import type { ProcessCalculatorMapping } from '@/lib/api/hooks/useProcessCalculatorMappings';

// Real Group -> Route -> Operation catalog tree, for PICKING which process to
// add/edit (ProcessCostDialog's own "Process Selection (Hierarchical)"
// cascade, and RouteSelectionDialog's identical "+ Add Step" cascade —
// both already derive this same real structure from the flat
// ProcessCalculatorMapping[] list, never from the /hierarchy endpoint's
// ProcessHierarchy type, which only returns 3 UNRELATED flat name lists
// with no real group/route/operation relationship encoded in it).
//
// Deliberately a DIFFERENT type from lib/routing/route-tree.ts's RouteNode:
// a RouteNode represents an already-cost-computed, machine-selected real
// route; a ProcessCatalogNode represents the real DEFINITION/taxonomy used
// to pick which operation to add or re-target — no cost, no machine
// selection, no children beyond the 3 real levels (group/route/operation).
export interface ProcessCatalogNode {
  // Stable, derived from the real names themselves (never an array index) —
  // "<group>", "<group>::<route>", or "<group>::<route>::<operation>".
  id: string;
  label: string;
  level: 'group' | 'route' | 'operation';
  // Only meaningful at level 'operation' — the real machine class
  // (process_calculator_mappings.machine_class) this operation resolves to,
  // and the real mapping row's own id. null at 'group'/'route' levels.
  machineClass: string | null;
  mappingId: string | null;
  // Only meaningful at level 'operation' — the real row's is_active flag.
  // Always true unless the tree was built with { includeInactive: true }.
  // null at 'group'/'route' levels, which have no is_active of their own.
  isActive: boolean | null;
  children: ProcessCatalogNode[];
}

export interface ProcessCatalogTreeOptions {
  // Default false: only real, active mappings become pickable operations, and
  // a group/route with zero active operations under it is honestly omitted
  // rather than shown as a dead end. That is right for surfaces that PICK an
  // operation to cost against — a retired row must never be costable.
  //
  // Set true for the admin surface that AUTHORS this taxonomy: there, a
  // real-but-inactive row (e.g. every Machining row, which has no calculator
  // wired yet) is still a real row that must stay visible and editable.
  // Hiding it there is the bug, not the safeguard.
  includeInactive?: boolean;
}

const mappingSchema = z.object({
  id: z.string(),
  processGroup: z.string(),
  processRoute: z.string(),
  operation: z.string(),
  machineClass: z.string().optional(),
  isActive: z.boolean(),
});

export class ProcessCatalogValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ProcessCatalogValidationError';
  }
}

// Builds the real Group -> Route -> Operation tree. See
// ProcessCatalogTreeOptions.includeInactive for the one behavioural knob.
export function adaptMappingsToProcessCatalogTree(
  mappings: ProcessCalculatorMapping[],
  options: ProcessCatalogTreeOptions = {},
): ProcessCatalogNode[] {
  const parsed = z.array(mappingSchema).safeParse(mappings);
  if (!parsed.success) {
    throw new ProcessCatalogValidationError(
      `adaptMappingsToProcessCatalogTree: received a malformed mappings result (${String(parsed.error.issues.length)} issue(s))`,
      parsed.error.issues,
    );
  }

  const groups = new Map<string, Map<string, Map<string, ProcessCalculatorMapping>>>();
  for (const m of mappings) {
    if (!m.isActive && !options.includeInactive) continue;
    let routes = groups.get(m.processGroup);
    if (!routes) {
      routes = new Map();
      groups.set(m.processGroup, routes);
    }
    let operations = routes.get(m.processRoute);
    if (!operations) {
      operations = new Map();
      routes.set(m.processRoute, operations);
    }
    // First real mapping wins on a duplicate (group, route, operation)
    // triple — never overwritten by a later, arbitrary duplicate row.
    if (!operations.has(m.operation)) operations.set(m.operation, m);
  }

  const tree: ProcessCatalogNode[] = [];
  for (const [groupLabel, routes] of groups) {
    const routeNodes: ProcessCatalogNode[] = [];
    for (const [routeLabel, operations] of routes) {
      const opNodes: ProcessCatalogNode[] = [];
      for (const [opLabel, mapping] of operations) {
        opNodes.push({
          id: `${groupLabel}::${routeLabel}::${opLabel}`,
          label: opLabel,
          level: 'operation',
          machineClass: mapping.machineClass ?? null,
          mappingId: mapping.id,
          isActive: mapping.isActive,
          children: [],
        });
      }
      routeNodes.push({
        id: `${groupLabel}::${routeLabel}`,
        label: routeLabel,
        level: 'route',
        machineClass: null,
        mappingId: null,
        isActive: null,
        children: opNodes,
      });
    }
    tree.push({
      id: groupLabel,
      label: groupLabel,
      level: 'group',
      machineClass: null,
      mappingId: null,
      isActive: null,
      children: routeNodes,
    });
  }
  return tree;
}
