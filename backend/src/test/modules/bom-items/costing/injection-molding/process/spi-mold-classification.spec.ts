// Regression test for the SPI_MOLD_CLASSES lifeShotRating fix (migration
// 682, tblSpiType.json) — Class101 and Class105 were wrong before this fix:
//   Class101: was capped at 1,000,000 shots, real rating is ~unlimited (9,999,999,999)
//   Class105: was 500 shots, real rating is 5,000 (10x)
// Class102-104 already matched the real table and are unchanged.
//
// Run: npm run test -- spi-mold-classification

import { recommendMoldClass, computeMoldCost } from '../../../../../../modules/bom-items/costing/injection-molding/process/cost-injection-molding-engine';

describe('recommendMoldClass — real SPI lifeShotRating values (migration 682)', () => {
  it('a >1,000,000-shot lifetime now correctly lands on Class101 (previously would have needed a class that does not exist, or over-bumped)', () => {
    // Before the fix, Class101's cap was 1,000,000 — a lifetime of e.g.
    // 5,000,000 shots had no real class whose rating covered it. Now
    // Class101's real ~unlimited rating correctly covers it.
    const cls = recommendMoldClass(5_000_000, null, null);
    expect(cls).toBe('Class101');
  });

  it('a ~1,000-shot prototype lifetime still correctly lands on Class105 (5,000 >= 1,000) — was borderline-wrong at the old 500 rating', () => {
    const cls = recommendMoldClass(1_000, null, null);
    expect(cls).toBe('Class105');
  });

  it('a 4,999-shot lifetime still fits Class105 under the real 5,000 rating (would have needed Class104 under the old, wrong 500 rating)', () => {
    const cls = recommendMoldClass(4_999, null, null);
    expect(cls).toBe('Class105');
  });

  it('Class102/103/104 tier boundaries are unchanged from before this fix', () => {
    expect(recommendMoldClass(100_000, null, null)).toBe('Class104');
    expect(recommendMoldClass(500_000, null, null)).toBe('Class103');
    expect(recommendMoldClass(1_000_000, null, null)).toBe('Class102');
  });
});

describe('computeMoldCost — baseCostUsd table unaffected by the lifeShotRating fix', () => {
  it('single-cavity cost equals the class base cost, unchanged by this fix (only lifeShotRating changed, not baseCostUsd)', () => {
    expect(computeMoldCost('Class101', 1)).toBe(50_000);
    expect(computeMoldCost('Class105', 1)).toBe(1_500);
  });
});
