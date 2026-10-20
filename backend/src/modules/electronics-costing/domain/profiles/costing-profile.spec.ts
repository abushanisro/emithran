import { applyCostingProfile, fromPaise, toPaise, validateProfile, type CostingProfile } from './costing-profile';

// The EE profile saved from the EMUSKI DC-DC report: rejection 1% of conversion, SG&A 5% and
// profit 10% of material + conversion, inventory carrying cost 1.5% of material.
const EE_PROFILE: CostingProfile = {
  name: 'EE (EMUSKI report)',
  terms: [
    { name: 'rejection', ratePct: 1, base: ['conversion'] },
    { name: 'sga', ratePct: 5, base: ['material', 'conversion'] },
    { name: 'profit', ratePct: 10, base: ['material', 'conversion'] },
    { name: 'icc', ratePct: 1.5, base: ['material'] },
  ],
};

describe('applyCostingProfile', () => {
  it('reproduces the EMUSKI PCBA ledger to the paisa: BOM 348.25 + conversion 56.41 = 471.14', () => {
    const ledger = applyCostingProfile(EE_PROFILE, toPaise(348.25), toPaise(14.62 + 20.01 + 21.78));
    const byName = Object.fromEntries(ledger.terms.map((t) => [t.name, fromPaise(t.amountPaise)]));
    expect(byName).toEqual({ rejection: 0.56, sga: 20.23, profit: 40.47, icc: 5.22 });
    expect(fromPaise(ledger.totalPaise)).toBe(471.14);
  });

  it('records the base each term was taken of', () => {
    const ledger = applyCostingProfile(EE_PROFILE, 34825, 5641);
    expect(ledger.terms.find((t) => t.name === 'sga')?.basePaise).toBe(40466);
    expect(ledger.terms.find((t) => t.name === 'icc')?.basePaise).toBe(34825);
  });

  it('assembly-only (no component layer): material terms are zero, conversion terms remain', () => {
    const ledger = applyCostingProfile(EE_PROFILE, 0, 5641);
    expect(ledger.terms.find((t) => t.name === 'icc')?.amountPaise).toBe(0);
    expect(ledger.totalPaise).toBe(5641 + 56 + 282 + 564);
  });

  it('rounds half up to the paisa (522.375 -> 522, 0.5 -> 1)', () => {
    const half: CostingProfile = { name: 'half', terms: [{ name: 'x', ratePct: 50, base: ['conversion'] }] };
    expect(applyCostingProfile(half, 0, 1).totalPaise).toBe(2);
    expect(applyCostingProfile(EE_PROFILE, 34825, 0).terms.find((t) => t.name === 'icc')?.amountPaise).toBe(522);
  });

  it('is exact on large amounts where float arithmetic would drift', () => {
    const p: CostingProfile = { name: 'p', terms: [{ name: 'x', ratePct: 1.5, base: ['material'] }] };
    expect(applyCostingProfile(p, 9_999_999_999, 0).terms[0].amountPaise).toBe(150_000_000);
  });

  it('a profile with no terms returns material + conversion unchanged', () => {
    expect(applyCostingProfile({ name: 'none', terms: [] }, 100, 250).totalPaise).toBe(350);
  });

  it.each([[-1, 0], [0, -1], [1.5, 0], [Number.NaN, 0]])('rejects amounts (%s, %s)', (m, c) => {
    expect(() => applyCostingProfile(EE_PROFILE, m, c)).toThrow(RangeError);
  });
});

describe('validateProfile', () => {
  it('flags duplicate names, negative or over-precise rates, and empty bases', () => {
    const bad: CostingProfile = {
      name: 'bad',
      terms: [
        { name: 'a', ratePct: -1, base: ['material'] },
        { name: 'a', ratePct: 1.234, base: ['material'] },
        { name: 'b', ratePct: 1, base: [] },
      ],
    };
    expect(validateProfile(bad)).toEqual([
      'duplicate term a',
      'a: rate must be a non-negative number',
      'a: rate has more than two decimals',
      'b: needs at least one base component',
    ]);
  });

  it('refuses to apply an invalid profile', () => {
    expect(() => applyCostingProfile({ name: 'x', terms: [{ name: 'a', ratePct: -5, base: ['material'] }] }, 1, 1)).toThrow(
      /Invalid costing profile/,
    );
  });
});
