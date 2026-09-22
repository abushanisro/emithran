// Root-caused live (2026-09-18): searching "aluminium" (or "ALUMINIUM") in
// the Material Database returned 0 results even though every real
// aluminum-family row exists — spelled "Aluminum" throughout (verified
// directly against the real staged source, memory/sheetmetal/rawmetrial/
// rawmetalusa.json: "Aluminum, AA 1100", "Aluminum, AA 2219", etc., 29 real
// rows). A plain ILIKE substring match can never bridge this: "aluminium"
// and "aluminum" diverge right after their shared "alumin" prefix, so
// neither is a substring of the other. This is not a fuzzy-matching
// problem needing a nearest-neighbour guess (resolveAliasId's own
// discipline below) — it is a real, well-established American/British
// English spelling difference for the exact same material, and the fix is
// to search BOTH real spellings, never to guess a wrong material.
//
// Every pair below is verified against real data already in this database
// before being added — not a generic/invented list:
//   aluminum/aluminium — the material_group/material text for every real
//     ferrous & non-ferrous aluminum row (rawmetalusa.json).
//   fiber/fibre — "Carbon Fiber"/"Glass Fiber" real plastic material rows
//     (materials_final.json).
//   sulfur/sulphur — no current row uses this word, but it is the other
//     well-known AmE/BrE element-name pair relevant to alloy descriptions
//     (e.g. free-machining steel grades are routinely described by sulfur
//     content) — covered now rather than waiting for a second live report
//     of the identical root cause.
//
// Module-level, pure, exported functions (not private class methods) so
// they are independently unit-testable with zero Supabase/DB mocking —
// this project's standing rule against new mocked-Supabase test files
// means logic like this must live outside the injectable class to get real
// test coverage at all.
export const MATERIAL_SEARCH_SPELLING_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ['aluminum', 'aluminium'],
  ['fiber', 'fibre'],
  ['sulfur', 'sulphur'],
];

// Expands a raw search term into every real spelling variant that could
// appear in a real material name, so a real AmE/BrE wording difference
// never produces a false "no results". Only ever ADDS variants — the
// original term is always included unmodified as the first entry, so an
// exact hit still behaves exactly as before.
//
// Builds exactly two additional canonical forms in one linear pass each —
// "every known word rewritten to American spelling" and "...to British
// spelling" — rather than one variant per matched word: a compound term
// like "aluminium fibre reinforced" must normalize BOTH words together
// (-> "aluminum fiber reinforced"), not just whichever pair the loop
// happened to reach first.
//
// All generated variants are lowercase: the only two consumers of this
// function (buildMaterialSearchOrClause's ILIKE, and the frontend
// MaterialPickerDialog's already-lowercased haystack comparison) are both
// case-insensitive by construction, so there is no real behavior to gain
// from trying to transfer the original term's casing onto a rewritten
// word — and a naive attempt at that produced this function's own real
// bug (fixed 2026-09-18): a case-insensitive regex match still substitutes
// its literal (lowercase) replacement text, so "ALUMINIUM" was silently
// expanding to "aluminum", not "ALUMINUM" as an earlier version claimed.
export function expandSearchTermSpellingVariants(term: string): string[] {
  const lower = term.toLowerCase();
  let towardUs = lower;
  let towardUk = lower;
  for (const [us, uk] of MATERIAL_SEARCH_SPELLING_VARIANTS) {
    towardUs = towardUs.replace(new RegExp(uk, 'g'), us);
    towardUk = towardUk.replace(new RegExp(us, 'g'), uk);
  }
  return [...new Set([term, lower, towardUs, towardUk])];
}
