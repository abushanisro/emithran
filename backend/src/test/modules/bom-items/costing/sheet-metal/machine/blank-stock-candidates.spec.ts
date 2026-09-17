import {
  roundBarCandidates, hexBarCandidates, rectangularBarCandidates,
  selectBestAutoCandidate, selectForcedFormCandidate, billetFallback,
  sortedDimensions, scoreCandidate,
  type StockProfile, type BoundingBox,
} from '../../../../../../modules/bom-items/costing/sheet-metal/machine/blank-stock-candidates';

// Pure functions, zero Supabase/DB dependency — no mocking needed or used,
// per this project's standing rule against mocked-Supabase spec files.
// BlankOptimizerService (blank-optimizer.service.ts) is a thin wrapper that
// fetches real stock_profiles rows and delegates all geometry here.

const ROUND_BAR_PROFILES: StockProfile[] = [
  { form: 'round_bar', size_a_mm: 20, size_b_mm: null },
  { form: 'round_bar', size_a_mm: 25, size_b_mm: null },
  { form: 'round_bar', size_a_mm: 30, size_b_mm: null },
];

// Real DIN934 across-flats sizes, migration 350.
const HEX_BAR_PROFILES: StockProfile[] = [
  { form: 'hex_bar', size_a_mm: 17, size_b_mm: null },
  { form: 'hex_bar', size_a_mm: 19, size_b_mm: null },
  { form: 'hex_bar', size_a_mm: 22, size_b_mm: null },
  { form: 'hex_bar', size_a_mm: 24, size_b_mm: null },
];

const RECT_BAR_PROFILES: StockProfile[] = [
  { form: 'rectangular_bar', size_a_mm: 25, size_b_mm: 20 },
  { form: 'rectangular_bar', size_a_mm: 30, size_b_mm: 25 },
];

describe('sortedDimensions', () => {
  it('sorts the bbox so L is always the longest (feed axis)', () => {
    expect(sortedDimensions({ length: 10, width: 40, height: 20 })).toEqual({ L: 40, W: 20, H: 10 });
  });
});

describe('scoreCandidate', () => {
  it('scores a tighter-fitting (less oversize) blank higher', () => {
    const tight = scoreCandidate(1000, 900);
    const loose = scoreCandidate(5000, 900);
    expect(tight).toBeGreaterThan(loose);
  });
  it('returns -Infinity for a non-positive blank volume rather than dividing by zero', () => {
    expect(scoreCandidate(0, 100)).toBe(-Infinity);
    expect(scoreCandidate(-5, 100)).toBe(-Infinity);
  });
});

describe('roundBarCandidates', () => {
  it('only includes sizes at or above the required minimum diameter', () => {
    const out = roundBarCandidates(ROUND_BAR_PROFILES, 22, 100, 30000);
    expect(out.map((c) => c.sizeLabel)).toEqual(['Ø25 round bar', 'Ø30 round bar']);
  });
  it('computes real cylinder volume (πr²·length), not an approximation', () => {
    const out = roundBarCandidates(ROUND_BAR_PROFILES, 18, 100, 1);
    const twenty = out.find((c) => c.sizeLabel === 'Ø20 round bar')!;
    expect(twenty.billetVolMm3).toBeCloseTo(Math.PI * 10 * 10 * 100, 5);
  });
});

// The confirmed live bug: real DIN934 hex bar stock (migration 350, 21
// sizes) was staged in stock_profiles but selectOptimalBlank never
// generated a single hex_bar candidate — the milled-part branch only ever
// looped round_bar and rectangular_bar. hex_bar sat completely unreachable
// despite FORM_LABELS on the frontend already knowing how to display it.
describe('hexBarCandidates — closes the real staged-but-unreachable hex_bar gap', () => {
  it('generates a real candidate for each hex bar size at or above the minimum across-flats', () => {
    const out = hexBarCandidates(HEX_BAR_PROFILES, 20, 100, 1);
    expect(out.map((c) => c.sizeLabel)).toEqual([
      '22 A/F hex bar', '24 A/F hex bar',
    ]);
  });
  it('uses the real regular-hexagon area identity (√3⁄2)·W² — not a fabricated constant', () => {
    const out = hexBarCandidates(HEX_BAR_PROFILES, 0, 100, 1);
    const flats24 = out.find((c) => c.sizeLabel === '24 A/F hex bar')!;
    const expectedArea = (Math.sqrt(3) / 2) * 24 * 24;
    expect(flats24.billetVolMm3).toBeCloseTo(expectedArea * 100, 5);
  });
  it('excludes every size below the required minimum', () => {
    const out = hexBarCandidates(HEX_BAR_PROFILES, 100, 100, 1);
    expect(out).toEqual([]);
  });
});

describe('rectangularBarCandidates', () => {
  it('fits a bar in either orientation (W×H or H×W)', () => {
    const out = rectangularBarCandidates(RECT_BAR_PROFILES, 18, 22, 100, 1);
    expect(out.map((c) => c.sizeLabel)).toContain('25×20 rect bar');
  });
  it('excludes a bar too small in both orientations', () => {
    const out = rectangularBarCandidates(RECT_BAR_PROFILES, 40, 40, 100, 1);
    expect(out).toEqual([]);
  });
});

describe('selectBestAutoCandidate', () => {
  const bbox: BoundingBox = { length: 100, width: 30, height: 30 };

  it('returns null when there are no candidates', () => {
    expect(selectBestAutoCandidate([], bbox)).toBeNull();
  });
  it('never returns a candidate as large as or larger than the plain bbox billet', () => {
    const bboxVol = (100 + 6) * (30 + 6) * (30 + 6);
    const oversized = [{ form: 'round_bar', sizeLabel: 'huge', billetVolMm3: bboxVol * 2, utilizationPct: 10, score: 999 }];
    expect(selectBestAutoCandidate(oversized, bbox)).toBeNull();
  });
  it('picks the highest-scoring candidate that IS smaller than the bbox billet', () => {
    const candidates = [
      { form: 'round_bar', sizeLabel: 'loose', billetVolMm3: 50000, utilizationPct: 20, score: 0.3 },
      { form: 'round_bar', sizeLabel: 'tight', billetVolMm3: 40000, utilizationPct: 80, score: 0.9 },
    ];
    expect(selectBestAutoCandidate(candidates, bbox)!.sizeLabel).toBe('tight');
  });
});

// The new "Stock Form" manual-override path (Cost Guide, mirrors the
// reference USA Digital Factory tool's own dropdown) — distinguishes an
// explicit user choice from the auto-decide heuristic above.
describe('selectForcedFormCandidate — explicit "Stock Form" override', () => {
  const bbox: BoundingBox = { length: 100, width: 20, height: 20 };

  it('billet override always returns the plain bbox billet, skipping stock_profiles entirely', () => {
    const result = selectForcedFormCandidate('billet', [], bbox, 1000, 105, 20.6, 20, 20);
    expect(result.form).toBe('billet');
    expect(result.requestedFormUnavailable).toBeUndefined();
  });

  it('honors an explicit round_bar request even when it is LARGER than the bbox billet', () => {
    // Unlike auto-decide, an explicit choice is not rejected just for being
    // bigger than the bbox billet — that guard only protects auto-selection.
    const hugeBbox: BoundingBox = { length: 10, width: 5, height: 5 };
    const result = selectForcedFormCandidate(
      'round_bar', ROUND_BAR_PROFILES, hugeBbox, 100, 15, 5.15, 5, 5,
    );
    expect(result.form).toBe('round_bar');
    expect(result.requestedFormUnavailable).toBeUndefined();
  });

  it('picks the smallest real fitting size for the requested form, not just the first', () => {
    const result = selectForcedFormCandidate(
      'round_bar', ROUND_BAR_PROFILES, bbox, 1000, 105, 20.6, 20, 20,
    );
    expect(result.sizeLabel).toBe('Ø25 round bar'); // 20mm excluded by minDiam, 25mm is smallest that fits
  });

  it('falls back to billet with a disclosed reason when no real size is large enough — never fabricates one', () => {
    const tinyProfiles: StockProfile[] = [{ form: 'round_bar', size_a_mm: 6, size_b_mm: null }];
    const bigBbox: BoundingBox = { length: 500, width: 200, height: 200 };
    const result = selectForcedFormCandidate(
      'round_bar', tinyProfiles, bigBbox, 1e7, 505, 206, 200, 200,
    );
    expect(result.form).toBe('billet');
    expect(result.requestedFormUnavailable).toEqual({
      requested: 'round_bar',
      reason: expect.stringContaining('round bar'),
    });
  });

  it('honors an explicit hex_bar request using the real DIN934 data', () => {
    const result = selectForcedFormCandidate(
      'hex_bar', HEX_BAR_PROFILES, bbox, 1000, 105, 20.6, 20, 20,
    );
    expect(result.form).toBe('hex_bar');
    expect(result.sizeLabel).toBe('22 A/F hex bar');
  });
});

describe('billetFallback', () => {
  it('adds the 6mm total stock allowance (3mm/side) to every axis', () => {
    const result = billetFallback({ length: 100, width: 50, height: 20 }, 1);
    expect(result.sizeLabel).toBe('106×56×26 billet');
  });
});
