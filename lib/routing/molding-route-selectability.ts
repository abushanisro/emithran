import type { RouteResultDto } from '@/lib/api/hooks/useBOMItems';

// Which molding routes the Workflow Builder lets an engineer set. Every molding process can be set manually (the injection tonnage tiers, Structural Foam, Compression,
// Reaction Injection), each priced by its own engine in the route comparison, and each only when the apply endpoint would accept it: the part's material and features can
// be made by the process, and the engine priced it. A route that cannot be set says why, from the route's own result, before the click.

/** The route ids apply-route accepts for a molding part (backend dto/apply-route.dto.ts VALID_ROUTE_IDS). */
export const MOLDING_APPLY_ROUTE_IDS: ReadonlySet<string> = new Set([
  'im-small-50t', 'im-standard-200t', 'im-large-500t',
  'im-structural-foam-molding', 'im-compression-molding', 'im-reaction-injection-molding',
]);

/** The injection tonnage tiers: one process, three presses. Every other molding route is a different process. */
const INJECTION_TIERS: ReadonlySet<string> = new Set(['im-small-50t', 'im-standard-200t', 'im-large-500t']);

export interface MoldingRouteSelectability {
  selectable: boolean;
  /** Why it cannot be set, or what to know before setting it; null when there is nothing to say. */
  note: string | null;
}

type RouteForSelection = Pick<RouteResultDto, 'routeId' | 'isFeasible' | 'warnings' | 'capability' | 'compatibility'>;

export function moldingRouteSelectability(route: RouteForSelection): MoldingRouteSelectability {
  if (!MOLDING_APPLY_ROUTE_IDS.has(route.routeId)) {
    return { selectable: false, note: 'Not a molding route this part can be applied from.' };
  }
  const incompatibilities = route.compatibility?.status === 'incompatible' ? route.compatibility.incompatibilities : [];
  if (incompatibilities.length > 0) {
    const first = incompatibilities[0]!;
    return { selectable: false, note: `Cannot be set: this process cannot make ${incompatibilities.length === 1 ? 'a feature' : `${incompatibilities.length} features`} of this part (${first.count} x ${first.featureType}: ${first.reason})` };
  }
  if (!route.isFeasible) {
    const why = route.capability.warnings[0] ?? route.warnings[0] ?? 'it could not be priced for this part';
    return { selectable: false, note: `Cannot be set: ${why}` };
  }
  return {
    selectable: true,
    note: INJECTION_TIERS.has(route.routeId) ? null : 'A different manufacturing process: priced by its own engine, and the Cost tab prices the part in it once it is applied.',
  };
}
