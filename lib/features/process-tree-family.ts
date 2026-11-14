/**
 * The process tree's two ways of showing a step's features. Catalog families: the backend attaches each step's catalog operations (the
 * operation and the features it makes) for sheet metal, plastic molding and sand casting. Machining-tree families (machining, die casting): per-line
 * feature breakdowns and feature operations from the operation sequencer.
 */
const CATALOG_FAMILIES: ReadonlySet<string> = new Set(['sheet_metal', 'plastic_molded', 'sand_cast'])

export function showsCatalogOperations(family: string): boolean {
  return CATALOG_FAMILIES.has(family)
}

export function isMachiningTreeFamily(family: string): boolean {
  return family !== '' && !CATALOG_FAMILIES.has(family)
}

/**
 * Whether a step with no feature rows falls back to text rows: its cost line's breakdown ("Melting: 0.004 s per casting") or "No feature
 * data". A sand-casting step lists only features that highlight the part (catalog operations, or the whole casting for the steps that act
 * on all of it); its time is on the cost tab.
 */
export function showsStepTextRows(family: string): boolean {
  return family !== 'sand_cast'
}
