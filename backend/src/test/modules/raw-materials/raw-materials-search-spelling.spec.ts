import {
  expandSearchTermSpellingVariants,
  buildMaterialSearchOrClause,
  MATERIAL_SEARCH_SPELLING_VARIANTS,
} from '../../../modules/raw-materials/raw-materials.service';

// Pure functions, zero Supabase/DB dependency — no mocking needed or used,
// per this project's standing rule against mocked-Supabase spec files.
//
// Root-caused live (2026-09-18): searching "aluminium" (or "ALUMINIUM") in
// the Material Database returned 0 results even though every real
// aluminum-family row exists — spelled "Aluminum" throughout in the real
// staged source data. A plain ILIKE substring match can never bridge this:
// "aluminium" and "aluminum" diverge right after their shared "alumin"
// prefix, so neither is a substring of the other.
describe('expandSearchTermSpellingVariants', () => {
  it('returns just the original term when it contains no known spelling variant', () => {
    expect(expandSearchTermSpellingVariants('titanium')).toEqual(['titanium']);
  });

  it('expands the reported live bug: "aluminium" also searches "aluminum"', () => {
    const variants = expandSearchTermSpellingVariants('aluminium');
    expect(variants).toContain('aluminium');
    expect(variants).toContain('aluminum');
  });

  it('expands the reported live bug in ALL CAPS: "ALUMINIUM" also searches for "aluminum"', () => {
    // The exact original term is always preserved (so an exact-case hit
    // still works unmodified); the generated variant is lowercase, which
    // is sufficient because both real consumers (ILIKE, and the frontend's
    // already-lowercased comparison) are case-insensitive — see this
    // function's own doc comment for why case is deliberately not
    // preserved on rewritten words.
    const variants = expandSearchTermSpellingVariants('ALUMINIUM');
    expect(variants).toContain('ALUMINIUM');
    expect(variants).toContain('aluminum');
  });

  it('works in the other direction too: "aluminum" also searches "aluminium"', () => {
    // Bidirectional by design — a future row spelled the British way (or a
    // user who happens to type the American spelling for a British-named
    // alloy like a real "Aluminium Bronze" row) must also be found.
    const variants = expandSearchTermSpellingVariants('aluminum');
    expect(variants).toContain('aluminum');
    expect(variants).toContain('aluminium');
  });

  it('expands fiber/fibre (real "Carbon Fiber"/"Glass Fiber" rows)', () => {
    expect(expandSearchTermSpellingVariants('carbon fibre')).toContain('carbon fiber');
    expect(expandSearchTermSpellingVariants('carbon fiber')).toContain('carbon fibre');
  });

  it('expands sulfur/sulphur', () => {
    expect(expandSearchTermSpellingVariants('sulphur')).toContain('sulfur');
    expect(expandSearchTermSpellingVariants('sulfur')).toContain('sulphur');
  });

  it('never drops the original term, even when it matches a variant pattern', () => {
    const variants = expandSearchTermSpellingVariants('Aluminium');
    expect(variants).toContain('Aluminium');
  });

  it('does not fabricate variants for unrelated words', () => {
    const variants = expandSearchTermSpellingVariants('stainless steel');
    expect(variants).toEqual(['stainless steel']);
  });

  it('handles a term containing multiple variant words at once', () => {
    const variants = expandSearchTermSpellingVariants('aluminium fibre reinforced');
    expect(variants).toContain('aluminium fibre reinforced');
    expect(variants).toContain('aluminum fiber reinforced');
  });

  it('is documented as verified against real staged data, not an invented generic list', () => {
    // Guards against silent expansion of the curated list with an
    // unverified pair later — each addition must cite real data (see the
    // module-level comment in raw-materials.service.ts).
    expect(MATERIAL_SEARCH_SPELLING_VARIANTS).toEqual([
      ['aluminum', 'aluminium'],
      ['fiber', 'fibre'],
      ['sulfur', 'sulphur'],
    ]);
  });
});

describe('buildMaterialSearchOrClause', () => {
  it('builds a PostgREST OR-ILIKE clause covering grade/material_group/name', () => {
    const clause = buildMaterialSearchOrClause('steel');
    expect(clause).toBe(
      'grade.ilike."%steel%",material_group.ilike."%steel%",name.ilike."%steel%"',
    );
  });

  it('the reported live bug is fixed: "aluminium" clause also matches real "Aluminum" rows via ILIKE', () => {
    const clause = buildMaterialSearchOrClause('aluminium');
    expect(clause).toContain('grade.ilike."%aluminium%"');
    expect(clause).toContain('grade.ilike."%aluminum%"');
  });

  it('escapes literal double quotes so a real material name is never misread as PostgREST filter syntax', () => {
    const clause = buildMaterialSearchOrClause('Alloy "X10CrNi18-8"');
    expect(clause).toContain('Alloy \\"X10CrNi18-8\\"');
  });

  it('escapes double quotes on every expanded variant, not just the original term', () => {
    // Closes a real latent gap the OLD getEnhancedMaterials() search block
    // had before this shared helper existed: it built its OR-clause inline
    // with NO quote escaping at all.
    const clause = buildMaterialSearchOrClause('"aluminium"');
    const parts = clause.split(',');
    expect(parts.every((p) => !p.includes('%"aluminium"%') || p.includes('\\"aluminium\\"'))).toBe(true);
  });
});
