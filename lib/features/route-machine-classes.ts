import { type RouteResultDto } from '@/lib/api/hooks/useBOMItems';

// The 4 real Plastic Molding machine_class slugs (migration 633/645/734) —
// used to scope the Tonnage/Clamp Force panel to rows actually costed on one
// of these real machines, never on an Inspection/manual-rate row.
export const IM_MACHINE_CLASSES = new Set(['injection_molding', 'compression_molding', 'reaction_injection_molding', 'structural_foam_molding', 'assembly_molding_insert_injection_molding', 'assembly_plastic_molding_multi_shot_molding']);

// Every route getRouteComparison returns shares identical non-cutting lines
// (deburr/press-brake/tapping/burring — computed once, reused across all
// routes; see that method's "Shared process lines" section) — only each
// route's own cutting line differs. So "which machineClass is a cutting
// machineClass" is derivable structurally from the live API response itself
// (whatever machineClass ISN'T common to every route), never a hardcoded set
// that silently goes stale the moment the backend's engine registry grows.
export function cuttingMachineClassesFromRoutes(routes: Pick<RouteResultDto, 'processLines'>[]): Set<string> {
  if (routes.length === 0) return new Set();
  const classSets = routes.map((r) => new Set(r.processLines.map((l) => l.machineClass)));
  const shared = new Set([...classSets[0]!].filter((cls) => classSets.every((s) => s.has(cls))));
  const cutting = new Set<string>();
  for (const s of classSets) for (const cls of s) if (!shared.has(cls)) cutting.add(cls);
  return cutting;
}

// Inverse of the above — used to recover which real cutting route a stored
// process_cost_records row's machine_class corresponds to (see the routing-
// restoration effect below), never a guessed/computed mapping.
export function cuttingMachineClassToRouteId(routes: Pick<RouteResultDto, 'routeId' | 'processLines'>[]): Record<string, string> {
  const cuttingClasses = cuttingMachineClassesFromRoutes(routes);
  const map: Record<string, string> = {};
  for (const r of routes) {
    const cuttingLine = r.processLines.find((l) => cuttingClasses.has(l.machineClass));
    if (cuttingLine) map[cuttingLine.machineClass] = r.routeId;
  }
  return map;
}

// Real physical ordering already encoded elsewhere in this codebase
// (cost-engine.ts's real processLines sequence, autoCompleteRoute's insertion
// points) — used only to softly WARN on an invalid custom reorder, never to
// block it (a real shop may have a genuine reason to deviate).
// Real process names as cost-engine.ts/turret-punch-engine.ts/waterjet-engine.ts
// actually emit them (confirmed by grep — "Laser Cutting" and "Press Brake",
// NOT the old WORKFLOW_KB display labels "Fiber Laser Cutting"/"CNC Press
// Brake", which never matched and silently made every ordering check a no-op).
// Hole Extrusion (Burring) + Tapping come BEFORE Press Brake + Deburring:
// the thread sits in the extruded collar, so the collar must be formed and
// tapped while the part is still flat (tapping an already-bent flange risks
// tool access/interference, and this also avoids handling an already-bent
// part through tapping) — see the matching reorder in cost-engine.ts /
// bom-items.service.ts::getRouteComparison's allLines assembly.
export const REAL_PROCESS_ORDER = [
  'Laser Cutting', 'Turret Punching', 'Waterjet Cutting',
  'Hole Extrusion (Burring)', 'Tapping', 'Press Brake', 'Deburring',
  'Counterboring', 'Countersinking', 'PEM Insertion', 'Reaming', 'CMM Inspection',
  'Surface Treatment',
];

export function orderingWarnings(orderedProcesses: string[]): Record<string, string> {
  const warnings: Record<string, string> = {};
  for (let i = 0; i < orderedProcesses.length; i++) {
    const p = orderedProcesses[i]!;
    const pIdx = REAL_PROCESS_ORDER.indexOf(p);
    if (pIdx < 0) continue;
    for (let j = 0; j < i; j++) {
      const q = orderedProcesses[j]!;
      const qIdx = REAL_PROCESS_ORDER.indexOf(q);
      if (qIdx > pIdx) { warnings[p] = `Typically performed before ${q}`; break; }
    }
  }
  return warnings;
}
