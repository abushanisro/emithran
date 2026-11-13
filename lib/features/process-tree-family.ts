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
