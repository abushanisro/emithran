import {
  computeCurrencyAwareRollup,
  RollupSourceAmount,
} from '../../../../modules/bom-items/services/bom-item-rollup';

// The currency-aware BOM rollup core (P1b-iii). Real currency codes, real
// rates, no mocks -- the FX snapshot is a plain closure, which is exactly how
// the service supplies it.
const NOW = () => '2026-09-08T00:00:00.000Z';

// One snapshot, INR -> USD, the real order of magnitude measured on this
// database (1 / 83.5).
const INR_TO_USD = 0.011976047904191617;
const snapshot = (rates: Record<string, number>) => (from: string) => rates[from] ?? null;
const usdSnapshot = snapshot({ INR: INR_TO_USD });

const amt = (o: Partial<RollupSourceAmount>): RollupSourceAmount => ({
  kind: 'raw_material', amount: 0, currency: 'USD', basis: 'local', ...o,
});

describe('computeCurrencyAwareRollup (P1b-iii)', () => {
  it('rolls INR inputs up to INR with no conversion at all', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'INR',
      // Deliberately a snapshot with NO rates: a same-currency rollup must not
      // need one, and must not call for one.
      rateToReporting: () => { throw new Error('must not ask for a rate'); },
      now: NOW,
      amounts: [
        amt({ kind: 'process', amount: 603.841886, currency: 'INR' }),
        amt({ kind: 'procured_parts', amount: 96.8, currency: 'INR' }),
      ],
    });
    expect(r.trusted).toBe(true);
    expect(r.integrity).toBe('consistent');
    expect(r.totals!.process).toBeCloseTo(603.841886, 6);
    expect(r.totals!.procured_parts).toBeCloseTo(96.8, 6);
    expect(r.totals!.own_cost).toBeCloseTo(700.641886, 6);
    // No conversion happened, so no rate is recorded.
    expect(r.provenance.fxRates).toEqual({});
  });

  it('converts INR and USD into one reporting currency exactly once', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'process', amount: 835, currency: 'INR' }),   // -> 10.00 USD
        amt({ kind: 'raw_material', amount: 5, currency: 'USD' }),
      ],
    });
    expect(r.trusted).toBe(true);
    expect(r.totals!.process).toBeCloseTo(10, 6);
    expect(r.totals!.raw_material).toBeCloseTo(5, 6);
    expect(r.totals!.own_cost).toBeCloseTo(15, 6);
    // Exactly once: 835 INR appears as 10 USD, not 0.1197 (twice) or 835.
    expect(r.provenance.inputs[0].amountReporting).toBeCloseTo(10, 6);
    expect(r.provenance.fxRates).toEqual({ INR: INR_TO_USD });
  });

  it('asks the snapshot for each distinct currency once and reuses the rate', () => {
    let calls = 0;
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: (from) => { calls++; return from === 'INR' ? INR_TO_USD : null; },
      now: NOW,
      amounts: [
        amt({ kind: 'process', amount: 100, currency: 'INR' }),
        amt({ kind: 'tooling', amount: 200, currency: 'INR' }),
        amt({ kind: 'procured_parts', amount: 300, currency: 'INR' }),
      ],
    });
    expect(r.trusted).toBe(true);
    // One snapshot, one lookup per currency -- three INR amounts cannot end up
    // on three different rates.
    expect(calls).toBe(1);
    expect(Object.keys(r.provenance.fxRates)).toEqual(['INR']);
    expect(r.totals!.own_cost).toBeCloseTo(600 * INR_TO_USD, 8);
  });

  it('refuses a trusted total when any contributing input is unverified', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'raw_material', amount: 5, currency: 'USD', basis: 'local' }),
        // The real shape of the 25 legacy process rows and 3 legacy tooling rows.
        amt({ kind: 'tooling', amount: 10.130435, currency: null, basis: 'legacy_unverified' }),
      ],
    });
    expect(r.trusted).toBe(false);
    expect(r.totals).toBeNull();
    expect(r.provenance.untrustedKinds).toEqual(['tooling']);
    expect(r.provenance.inputs[1].reason).toMatch(/legacy_unverified/);
    // The trusted input is still explained, so the refusal is auditable.
    expect(r.provenance.inputs[0].amountReporting).toBeCloseTo(5, 6);
  });

  it('reports mixed when untrusted money coexists with more than one currency', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'process', amount: 603.84, currency: 'INR', basis: 'converted' }),
        amt({ kind: 'raw_material', amount: 5, currency: 'USD', basis: 'local' }),
        amt({ kind: 'packaging_logistics', amount: 273, currency: null, basis: 'legacy_unverified' }),
      ],
    });
    expect(r.trusted).toBe(false);
    expect(r.integrity).toBe('mixed');
    expect(r.provenance.declaredCurrencies).toEqual(['INR', 'USD']);
  });

  it('reports unverified, not mixed, when only one currency is in play', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [amt({ kind: 'tooling', amount: 10, currency: null, basis: 'legacy_unverified' })],
    });
    expect(r.integrity).toBe('unverified');
  });

  it('never fabricates a rate the snapshot does not have', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: () => null, // snapshot has nothing
      now: NOW,
      amounts: [amt({ kind: 'process', amount: 1000, currency: 'VND', basis: 'local' })],
    });
    expect(r.trusted).toBe(false);
    expect(r.totals).toBeNull();
    expect(r.provenance.inputs[0].reason).toMatch(/no VND to USD rate/);
    expect(r.provenance.fxRates).toEqual({});
  });

  it('rejects a non-positive or non-finite rate rather than using it', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeCurrencyAwareRollup({
        reportingCurrency: 'USD',
        rateToReporting: () => bad,
        now: NOW,
        amounts: [amt({ kind: 'process', amount: 100, currency: 'INR', basis: 'local' })],
      });
      expect(r.trusted).toBe(false);
      expect(r.totals).toBeNull();
    }
  });

  // An empty source set is a legitimate zero, not a silent one: there is
  // genuinely no money on the item. It is distinguishable from the untrusted
  // case by trusted/integrity, which is the point.
  it('treats a genuinely empty input set as a trusted zero', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD', rateToReporting: usdSnapshot, now: NOW, amounts: [],
    });
    expect(r.trusted).toBe(true);
    expect(r.integrity).toBe('consistent');
    expect(r.totals!.total_cost).toBe(0);
    expect(r.provenance.inputs).toEqual([]);
  });

  // A zero-value legacy row cannot change any total in any currency, so it
  // must not permanently block an item from ever rolling up.
  it('does not let a zero-amount unverified row block the rollup', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'raw_material', amount: 5, currency: 'USD' }),
        amt({ kind: 'tooling', amount: 0, currency: null, basis: 'legacy_unverified' }),
      ],
    });
    expect(r.trusted).toBe(true);
    expect(r.totals!.own_cost).toBeCloseTo(5, 6);
  });

  it('propagates an untrusted child up the assembly tree', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'raw_material', amount: 5, currency: 'USD' }),
        // A child whose own currency_integrity was not 'consistent'.
        amt({ kind: 'direct_children', amount: 973.6419, currency: 'INR', basis: 'legacy_unverified', ref: 'child-1' }),
      ],
    });
    expect(r.trusted).toBe(false);
    expect(r.provenance.untrustedKinds).toEqual(['direct_children']);
    expect(r.provenance.inputs[1].ref).toBe('child-1');
  });

  it('carries the provenance needed to explain a total', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [amt({ kind: 'process', amount: 835, currency: 'INR', basis: 'converted', ref: 'row-1' })],
    });
    expect(r.provenance.reportingCurrency).toBe('USD');
    expect(r.provenance.fxRates.INR).toBe(INR_TO_USD);
    expect(r.provenance.computedAt).toBe('2026-09-08T00:00:00.000Z');
    expect(r.provenance.inputs[0]).toMatchObject({
      kind: 'process', ref: 'row-1', currency: 'INR', basis: 'converted', amountSource: 835,
    });
  });

  it('refuses to run without an ISO reporting currency', () => {
    for (const bad of ['usd', '', 'DOLLAR', null]) {
      expect(() => computeCurrencyAwareRollup({
        reportingCurrency: bad as string, rateToReporting: usdSnapshot, amounts: [], now: NOW,
      })).toThrow(/ISO 4217/);
    }
  });

  // own_cost excludes children; total_cost includes them. Same split the
  // aggregate columns have always used.
  it('separates own cost from children exactly as the columns do', () => {
    const r = computeCurrencyAwareRollup({
      reportingCurrency: 'USD',
      rateToReporting: usdSnapshot,
      now: NOW,
      amounts: [
        amt({ kind: 'raw_material', amount: 1, currency: 'USD' }),
        amt({ kind: 'packaging_logistics', amount: 2, currency: 'USD' }),
        amt({ kind: 'procured_parts', amount: 3, currency: 'USD' }),
        amt({ kind: 'process', amount: 4, currency: 'USD' }),
        amt({ kind: 'tooling', amount: 5, currency: 'USD' }),
        amt({ kind: 'direct_children', amount: 10, currency: 'USD' }),
      ],
    });
    expect(r.totals!.own_cost).toBeCloseTo(15, 6);
    expect(r.totals!.total_cost).toBeCloseTo(25, 6);
    expect(r.totals!.unit_cost).toBeCloseTo(25, 6);
  });
});
