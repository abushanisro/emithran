import {
  rankMaterialMatches,
  pickUnambiguousBest,
  designationTokens,
  escapeLikePattern,
  orderByRelevance,
  rankableFromDbRow,
  type RankableMaterial,
} from '../../../modules/raw-materials/material-search-ranking';

// Pure functions over real raw_materials rows -- no Supabase, no mocks.
//
// The two 6061 rows below are the REAL rows confirmed live on 2026-09-19
// (material / grade / group / density), which is exactly the pair that made a
// loose "6061" grade resolve nondeterministically before this ranker existed.
const AL_6061: RankableMaterial = {
  id: 'r-6061', material: 'Generic Aluminum, ANSI 6061', materialGrade: 'Aluminum, ANSI 6061',
  materialGroup: 'Ferrous & Non-Ferrous', densityKgM3: 2700, hasCost: true,
  enStandard: 'EN AW-6061',
};
const AL_6061_LD30: RankableMaterial = {
  id: 'r-6061-ld30', material: 'Generic Aluminum, ANSI 6061 (LD30)', materialGrade: null,
  materialGroup: 'Ferrous & Non-Ferrous', densityKgM3: 2770, hasCost: true,
};
const AL_7003: RankableMaterial = {
  id: 'r-7003', material: 'Generic Aluminum, AA 7003', materialGrade: 'Aluminum, AA 7003',
  materialGroup: 'Machining', densityKgM3: 2900, hasCost: true,
};
const AL_5083: RankableMaterial = {
  id: 'r-5083', material: 'Generic Aluminum, ANSI 5083', materialGrade: 'Aluminum, ANSI 5083',
  materialGroup: 'Machining', densityKgM3: 2640, hasCost: true,
};
const SS_304: RankableMaterial = {
  id: 'r-304', material: 'Generic Stainless Steel, AISI 304', materialGrade: 'Stainless Steel, AISI 304',
  materialGroup: 'Machining', densityKgM3: 8073, hasCost: true,
};
const SS_304L: RankableMaterial = {
  id: 'r-304l', material: 'Generic Stainless Steel, AISI 304L', materialGrade: 'Stainless Steel, AISI 304L',
  materialGroup: 'Machining', densityKgM3: 7800, hasCost: true,
};
const CORPUS = [AL_6061, AL_6061_LD30, AL_7003, AL_5083, SS_304, SS_304L];

const ids = (r: { row: RankableMaterial }[]) => r.map((x) => x.row.id);

describe('designationTokens', () => {
  it('splits punctuation and letter/digit boundaries consistently', () => {
    expect(designationTokens('AA6061-T6')).toEqual(['aa', '6061', 't', '6']);
    expect(designationTokens('Generic Aluminum, ANSI 6061 (LD30)')).toEqual(
      ['generic', 'aluminum', 'ansi', '6061', 'ld', '30'],
    );
    expect(designationTokens(null)).toEqual([]);
  });
});

describe('rankMaterialMatches — the reported loose-grade bug', () => {
  it('"6061" picks the base grade, not the LD30 variant, and discloses the variant', () => {
    const ranked = rankMaterialMatches('6061', CORPUS);
    expect(ids(ranked).slice(0, 2)).toEqual(['r-6061', 'r-6061-ld30']);
    const pick = pickUnambiguousBest(ranked);
    expect(pick.best?.row.id).toBe('r-6061');
    expect(pick.best?.row.densityKgM3).toBe(2700);
    // 2770 vs 2700 differ >1% -> must be surfaced, never silently dropped.
    expect(ids(pick.divergentAlternatives)).toEqual(['r-6061-ld30']);
  });

  it('is independent of input row order (deterministic)', () => {
    const forward = ids(rankMaterialMatches('6061', CORPUS));
    const reversed = ids(rankMaterialMatches('6061', [...CORPUS].reverse()));
    const rotated = ids(rankMaterialMatches('6061', [...CORPUS.slice(3), ...CORPUS.slice(0, 3)]));
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it('a bare family word is ambiguous -- no arbitrary aluminum row is picked', () => {
    for (const q of ['ALUMINUM', 'aluminium']) {
      const pick = pickUnambiguousBest(rankMaterialMatches(q, CORPUS));
      expect(pick.best).toBeNull();
      expect(pick.ambiguous.length).toBeGreaterThan(1);
    }
  });

  it('a family word whose candidates share one density is NOT ambiguous', () => {
    const copperA = { id: 'c1', material: 'Generic Copper, UNS C11000', densityKgM3: 8930, hasCost: true };
    const copperB = { id: 'c2', material: 'Generic Copper, UNS C27200', densityKgM3: 8930, hasCost: true };
    const pick = pickUnambiguousBest(rankMaterialMatches('copper', [copperB, copperA]));
    expect(pick.best?.row.id).toBe('c1'); // stable name order, same physics either way
  });
});

describe('rankMaterialMatches — tiers and specificity', () => {
  it('exact grade name outranks a designation match', () => {
    const ranked = rankMaterialMatches('Aluminum, ANSI 6061', CORPUS);
    expect(ranked[0].row.id).toBe('r-6061');
    expect(ranked[0].tier).toBe('exact');
  });

  it('matches whole designations only, never inside a longer number', () => {
    const decoy: RankableMaterial = { id: 'x', material: 'Aluminum 16061', densityKgM3: 2700 };
    expect(ids(rankMaterialMatches('6061', [decoy]))).toEqual([]);
  });

  it('"304" prefers 304 over 304L (base designation over suffix variant)', () => {
    const ranked = rankMaterialMatches('304', CORPUS);
    expect(ids(ranked)).toEqual(['r-304', 'r-304l']);
  });

  it('spells aluminium/aluminum interchangeably', () => {
    // Identical to the real grade once spelling/punctuation are normalised.
    const exact = rankMaterialMatches('aluminium ansi 6061', CORPUS);
    expect(exact[0].row.id).toBe('r-6061');
    expect(exact[0].tier).toBe('exact');
    // A partial name in the British spelling is still a designation match.
    const partial = rankMaterialMatches('aluminium 6061', CORPUS);
    expect(partial[0].row.id).toBe('r-6061');
    expect(partial[0].tier).toBe('designation');
  });

  it('finds a material by its cross-standard designation', () => {
    const ranked = rankMaterialMatches('EN AW-6061', CORPUS);
    expect(ranked[0].row.id).toBe('r-6061');
    expect(ranked[0].tier).toBe('standard');
    expect(ranked[0].reason).toContain('EN standard');
  });

  it('a registered alias outranks textual matches', () => {
    const ranked = rankMaterialMatches('6061', CORPUS, { aliasRowIds: new Set(['r-6061-ld30']) });
    expect(ranked[0].row.id).toBe('r-6061-ld30');
    expect(ranked[0].tier).toBe('alias');
  });

  it('a compound drawing string ranks rows by how much of it they cover', () => {
    const a: RankableMaterial = { id: 'a', material: 'Mild Steel IS2062', densityKgM3: 7850, hasCost: true };
    const b: RankableMaterial = { id: 'b', material: 'CRCA Steel', densityKgM3: 7850, hasCost: true };
    const c: RankableMaterial = { id: 'c', material: 'Copper C11000', densityKgM3: 8930, hasCost: true };
    const ranked = rankMaterialMatches('IS2062 E250 CRCA', [c, b, a]);
    expect(ids(ranked)).not.toContain('c');
    expect(ids(ranked).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing when there is no evidence of a match', () => {
    expect(rankMaterialMatches('inconel', CORPUS)).toEqual([]);
  });
});

describe('rankMaterialMatches — tie-breaks', () => {
  it('prefers the stock form suited to the part family when designation ties', () => {
    const sheet: RankableMaterial = { id: 's', material: 'Aluminum 6061 Sheet', shape: 'sheets', densityKgM3: 2700, hasCost: true };
    const bar: RankableMaterial = { id: 'b', material: 'Aluminum 6061 Bar', shape: 'bars', densityKgM3: 2700, hasCost: true };
    expect(rankMaterialMatches('6061', [sheet, bar], { family: 'milled' })[0].row.id).toBe('b');
    expect(rankMaterialMatches('6061', [sheet, bar], { family: 'sheet_metal' })[0].row.id).toBe('s');
  });

  it('prefers a row with real cost over an otherwise identical row without', () => {
    const noCost: RankableMaterial = { id: 'n', material: 'Aluminum 6061 A', densityKgM3: 2700, hasCost: false };
    const withCost: RankableMaterial = { id: 'w', material: 'Aluminum 6061 B', densityKgM3: 2700, hasCost: true };
    expect(rankMaterialMatches('6061', [noCost, withCost])[0].row.id).toBe('w');
  });

  it('two equally specific grades with different densities are ambiguous', () => {
    const ansi: RankableMaterial = { id: 'ansi', material: 'Aluminum, ANSI 6061', densityKgM3: 2700, hasCost: true };
    const aa: RankableMaterial = { id: 'aa', material: 'Aluminum, AA 6061', densityKgM3: 2770, hasCost: true };
    const pick = pickUnambiguousBest(rankMaterialMatches('6061', [ansi, aa]));
    expect(pick.best).toBeNull();
    expect(ids(pick.ambiguous).sort()).toEqual(['aa', 'ansi']);
  });
});

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards so a grade matches literally', () => {
    expect(escapeLikePattern('6061_T6')).toBe('6061\\_T6');
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('plain')).toBe('plain');
  });
});

describe('orderByRelevance — reorders, never drops', () => {
  it('keeps substring-only DB hits after every ranked row', () => {
    const rows = [
      { id: 'sub', material: 'Generic Titanium, Ti-6Al-4V', densityKgM3: 4430 },
      AL_7003,
      AL_6061,
    ];
    // "ium" is a raw substring of "Aluminum"/"Titanium" but no whole-word designation.
    const ordered = orderByRelevance('ium', rows, (r) => r);
    expect(ordered).toHaveLength(rows.length);
    expect(new Set(ordered.map((o) => o.item.id))).toEqual(new Set(rows.map((r) => r.id)));
  });

  it('puts the best grade first and explains why', () => {
    const ordered = orderByRelevance('6061', [...CORPUS].reverse(), (r) => r);
    expect(ordered[0].item.id).toBe('r-6061');
    expect(ordered[0].tier).toBe('designation');
    expect(ordered[0].reason).toContain('6061');
  });
});

describe('orderByRelevance — isBest flags one unambiguous pick', () => {
  it('flags exactly the base 6061 row', () => {
    const ordered = orderByRelevance('6061', CORPUS, (r) => r);
    expect(ordered.filter((o) => o.isBest).map((o) => o.item.id)).toEqual(['r-6061']);
  });

  it('flags nothing for a bare family name, so callers cannot auto-select a random alloy', () => {
    const ordered = orderByRelevance('aluminum', CORPUS, (r) => r);
    expect(ordered.length).toBeGreaterThan(1);
    expect(ordered.some((o) => o.isBest)).toBe(false);
  });
});

describe('rankableFromDbRow', () => {
  it('maps a snake_case raw_materials row, deriving density and cost presence', () => {
    const r = rankableFromDbRow({
      id: 'x', material: 'Generic Aluminum, ANSI 6061', material_grade: 'Aluminum, ANSI 6061',
      material_group: 'Ferrous & Non-Ferrous', density_kg_m3: '2700.00', cost: null, cost_india: '250.5',
      en_standard: 'EN AW-6061', shape: 'plates',
    });
    expect(r.densityKgM3).toBe(2700);
    expect(r.hasCost).toBe(true);
    expect(r.enStandard).toBe('EN AW-6061');
  });

  it('falls back to g/cm3 density and reports no cost when none is on file', () => {
    const r = rankableFromDbRow({ id: 'y', material: 'M', density: 2.7, cost: 0, cost_india: null, cost_usa: null });
    expect(r.densityKgM3).toBeCloseTo(2700, 6);
    expect(r.hasCost).toBe(false);
  });
});
