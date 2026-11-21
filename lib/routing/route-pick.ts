// A part's route choice, as the scenario stores it. A family that quotes the cheapest of several complete routes keeps the one the engineer
// picked in the Workflow Builder under its own scenario key ("partAssemblyRoute": "robotic"); Manual routing commits it, Auto clears it so the
// cheapest is quoted again. One reading of a route's pick for every place that needs it: setting a route in the Workflow Builder, restoring
// the Manual route after a reload, and building the Apply request. Pure.
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { isAssemblyItem } from '@/lib/costing/assembly-view';
import { isHydroformingItem } from '@/lib/costing/hydroforming-view';
import { isInsertMoldingItem } from '@/lib/costing/insert-molding-view';
import { isMultiShotItem } from '@/lib/costing/multi-shot-view';
import { isMultiSpindleItem } from '@/lib/costing/multi-spindle-view';
import { isPartAssemblyItem } from '@/lib/costing/part-assembly-view';
import { additiveRouteKeyOf } from '@/lib/routing/additive-route-id';
import { assemblyRouteKeyOf } from '@/lib/routing/assembly-route-id';
import { barTubeRouteKeyOf } from '@/lib/routing/bar-tube-route-id';
import { compositesRouteKeyOf } from '@/lib/routing/composites-route-id';
import { forgingRouteKeyOf } from '@/lib/routing/forging-route-id';
import { hydroformingRouteKeyOf } from '@/lib/routing/hydroforming-route-id';
import { insertMoldingRouteKeyOf } from '@/lib/routing/insert-molding-route-id';
import { multiShotRouteKeyOf } from '@/lib/routing/multi-shot-route-id';
import { multiSpindleRouteKeyOf } from '@/lib/routing/multi-spindle-route-id';
import { partAssemblyRouteKeyOf } from '@/lib/routing/part-assembly-route-id';
import { rotoBlowRouteKeyOf } from '@/lib/routing/roto-blow-route-id';


/** The scenario keys a route choice is stored under (each backend engine reads its own). */
export type RoutePickKey =
  | 'dieCastingProcess' | 'forgingRoute' | 'compositesRoute' | 'additiveRoute' | 'barTubeRoute' | 'rotoBlowRoute' | 'assemblyRoute'
  | 'insertMoldingRoute' | 'multiShotRoute' | 'multiSpindleRoute' | 'partAssemblyRoute' | 'hydroformRoute';

/** A route's choice under its family's key (one key for any route). */
export type RoutePicks = Partial<Record<RoutePickKey, string>>;

/** The families whose route ids carry their choice: the key it is stored under, read from the id ("partassembly-robotic" -> "robotic"). */
const BY_ROUTE_ID: readonly (readonly [RoutePickKey, (routeId: string) => string | undefined])[] = [
  ['forgingRoute', forgingRouteKeyOf],
  ['compositesRoute', compositesRouteKeyOf],
  ['additiveRoute', additiveRouteKeyOf],
  ['barTubeRoute', barTubeRouteKeyOf],
  ['rotoBlowRoute', rotoBlowRouteKeyOf],
  ['assemblyRoute', assemblyRouteKeyOf],
  ['insertMoldingRoute', insertMoldingRouteKeyOf],
  ['multiShotRoute', multiShotRouteKeyOf],
  ['multiSpindleRoute', multiSpindleRouteKeyOf],
  ['partAssemblyRoute', partAssemblyRouteKeyOf],
  ['hydroformRoute', hydroformingRouteKeyOf],
];

/**
 * The choice a complete route carries: its family's key with the route's key, read from the route id (each family's ids have their own
 * prefix, so a route matches one family at most); a die casting route, its process (the route's label).
 */
export function routePicksOf(route: { routeId: string; routeLabel: string }, family: string | null | undefined): RoutePicks {
  const picks: RoutePicks = {};
  if (family === 'die_cast') picks.dieCastingProcess = route.routeLabel;
  for (const [key, of] of BY_ROUTE_ID) {
    const value = of(route.routeId);
    if (value) picks[key] = value;
  }
  return picks;
}

/** The families (as the part was analysed) whose engine reads its own route key. */
const KEY_OF_FAMILY: Readonly<Record<string, RoutePickKey>> = {
  die_cast: 'dieCastingProcess',
  forged: 'forgingRoute',
  composite: 'compositesRoute',
  additive: 'additiveRoute',
  bar_tube: 'barTubeRoute',
  roto_blow: 'rotoBlowRoute',
};

/**
 * The key a part's route choice is stored under: its Process's when its engine reads its own (a weldment, a multi-spindle part, an insert or
 * multi-shot molding, a hydroformed part, an assembly, which an assembly or sub-assembly with no Process of its own is costed as), else its
 * family's; null when its routes carry none.
 */
export function routePickKeyOf(item: Pick<BOMItem, 'itemType' | 'scenarioOverrides'> | null | undefined, family: string | null | undefined): RoutePickKey | null {
  if (!item) return null;
  if (isPartAssemblyItem(item)) return 'partAssemblyRoute';
  if (isMultiSpindleItem(item)) return 'multiSpindleRoute';
  if (isHydroformingItem(item)) return 'hydroformRoute';
  if (isMultiShotItem(item)) return 'multiShotRoute';
  if (isInsertMoldingItem(item)) return 'insertMoldingRoute';
  if (isAssemblyItem(item)) return 'assemblyRoute';
  return family ? KEY_OF_FAMILY[family] ?? null : null;
}
