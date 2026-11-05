import { loadReference } from './forging-fixtures';
import { amortiseForgingDie } from '../../../../../modules/bom-items/costing/forging/forging-tooling';

const ref = loadReference();
// Die costs below are ENTERED quotes (v1.1 D7): memory has no die cost build-up.
const base = {
  reference: ref, kind: 'press' as const, dieCostUsd: 10_000, replacementDieCostUsd: 10_000,
  coating: 'None', annualVolume: 10_000, productionLifeYears: 5,
};

describe('forging die amortisation (v1.1 6.11)', () => {
  it('uncoated press die: 7 die sets for 50,000 parts at 7,500 per die', () => {
    const a = amortiseForgingDie(base);
    if (!a.amortised) throw new Error(a.reason);
    // lifetime  10,000 / yr × 5 yr = 50,000 parts
    // tool life pressToolLifeNumberOfParts 7,500 × None 1.0 = 7,500 parts
    // sets      max(1, ceil(50,000 / 7,500)) = ceil(6.667) = 7
    // total     10,000 + (7 − 1) × 10,000 = 70,000 USD; per part 70,000 / 50,000 = 1.40 USD
    expect(a.lifetimeParts).toBe(50_000);
    expect(a.toolLifeParts).toBe(7_500);
    expect(a.dieSets).toBe(7);
    expect(a.totalToolingUsd).toBe(70_000);
    expect(a.perPartUsd).toBeCloseTo(1.4, 10);
    expect(a.warnings).toEqual([]); // 10,000 is inside minFinishDieCost 5,000 .. maxFinishDieCost 25,000
  });

  it('PVD TiN coating multiplies tool life: one die set', () => {
    const a = amortiseForgingDie({ ...base, coating: 'PVD TiN' });
    if (!a.amortised) throw new Error(a.reason);
    // tool life 7,500 × 7.2 = 54,000 ≥ 50,000 → 1 set; 10,000 / 50,000 = 0.20 USD per part
    expect(a.toolLifeParts).toBeCloseTo(54_000, 6);
    expect(a.dieSets).toBe(1);
    expect(a.perPartUsd).toBeCloseTo(0.2, 10);
  });

  it('trim die uses trimToolLifeNumberOfParts and the trim cost bounds', () => {
    // 3,000 USD trim die, replacement 2,000: ceil(50,000 / 7,500) = 7 sets
    // total 3,000 + 6 × 2,000 = 15,000 USD; per part 0.30 USD.
    // 3,000 > maxTrimDieCostWithOutMaterial 4,000? No: inside 500 .. 4,000, no warning.
    const a = amortiseForgingDie({ ...base, kind: 'trim', dieCostUsd: 3_000, replacementDieCostUsd: 2_000 });
    if (!a.amortised) throw new Error(a.reason);
    expect(a.totalToolingUsd).toBe(15_000);
    expect(a.perPartUsd).toBeCloseTo(0.3, 10);
    expect(a.warnings).toEqual([]);
  });

  it('an entered cost outside the staged validity range is a warning, not a gap', () => {
    const a = amortiseForgingDie({ ...base, dieCostUsd: 30_000 });
    expect(a.amortised).toBe(true);
    expect(a.warnings).toEqual([
      "Entered die cost 30000 USD is outside minFinishDieCost 5000 to maxFinishDieCost 25000 USD (memory's validity range for a calculated die cost).",
    ]);
  });

  it('missing die cost, volume, life or coating: not amortised, each named', () => {
    const a = amortiseForgingDie({ ...base, dieCostUsd: null, annualVolume: null, productionLifeYears: 0, coating: null });
    expect(a.amortised).toBe(false);
    if (!a.amortised) {
      expect(a.reason).toBe(
        'Die not amortised: missing die cost (enter the quote: memory has no die cost build-up, v1.1 6.11); annual volume; '
        + "production life (years); die coating (forging_tblToolCoating; 'None' if uncoated).",
      );
    }
  });

  it('an unknown coating is named, not treated as uncoated', () => {
    const a = amortiseForgingDie({ ...base, coating: 'Diamond' });
    expect(a.amortised).toBe(false);
    if (!a.amortised) expect(a.reason).toContain('forging_tblToolCoating row for coating "Diamond"');
  });

  it('disableInvestmentAmortization switches amortisation off', () => {
    const a = amortiseForgingDie({ ...base, reference: { ...ref, switches: { ...ref.switches, disableInvestmentAmortization: true } } });
    expect(a.amortised).toBe(false);
    if (!a.amortised) expect(a.reason).toBe('disableInvestmentAmortization is true: tooling is not amortised to the part.');
  });
});
