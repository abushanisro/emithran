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
  return !FEATURE_ONLY_FAMILIES.has(family)
}

/**
 * Families whose steps list features only, never their cost line's text ("Band Saw: 10.46 s per casting"): every step either forms the part's
 * features or acts on the whole part, and its time is on the Cost tab.
 */
const FEATURE_ONLY_FAMILIES: ReadonlySet<string> = new Set(['sand_cast', 'forged', 'powder_metal', 'composite', 'additive'])

/** What a step that acts on the whole part shows as its feature: the casting, or the part. */
export function wholePartLabel(family: string): string {
  return family === 'sand_cast' || family === 'die_cast' || family === 'investment_cast' ? 'Whole casting' : 'Whole part'
}

/** Families made by machining alone: their first step is the one that machines the part. */
const MACHINED_FAMILIES: ReadonlySet<string> = new Set(['milled', 'turned', 'mill_turn'])

/**
 * Whether the features no step claims are shown under the part's first step. A machined part's first step machines it, so it holds them; a
 * cast or forged part's first step (melting, a wax pattern, sawing the bar) makes none of them, and a feature that is machined afterwards is
 * listed under its machining step.
 */
export function firstStepHoldsUnclaimedFeatures(family: string): boolean {
  return MACHINED_FAMILIES.has(family)
}
