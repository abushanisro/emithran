/**
 * The part families whose route comparison lists complete routes, each a full quote: the plastic-molding processes, one machine class
 * per machining route, one route per die-casting process, the sand-casting, investment-casting and forging routes, and a hydroformed part's
 * two routes (process-group.ts routingFamilyOf). Sheet metal has its own cut-then-form builder.
 */
const COMPLETE_ROUTE_FAMILIES: ReadonlySet<string> = new Set(['plastic_molded', 'milled', 'turned', 'mill_turn', 'die_cast', 'sand_cast', 'investment_cast', 'forged', 'powder_metal', 'composite', 'additive', 'bar_tube', 'roto_blow', 'assembly', 'part_assembly', 'hydroforming'])

export function isCompleteRouteFamily(family: string | null | undefined): boolean {
  return !!family && COMPLETE_ROUTE_FAMILIES.has(family)
}
