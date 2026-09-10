import {
  ROLLUP_REPORTING_CURRENCY,
  declareCostRecordCurrency,
  overlayRejectionReason,
  resolveBenchmarkLabourRate,
  resolvePersistedCostCurrencyBasis,
  rollupRejectionReason,
} from '../../../../../../modules/bom-items/costing/shared/core/persisted-currency-contract';

// The persisted-money currency contract added by migration 707 (audit phase
// P1a). Real currency codes and real rates -- there is nothing to mock here,
// which is the reason these two decisions were extracted out of the controller
// in the first place.
describe('persisted currency contract (migration 707)', () => {
  describe('rollupRejectionReason', () => {
    it('accepts the currency the BOM rollup is actually denominated in', () => {
      expect(rollupRejectionReason('USD')).toBeNull();
      expect(ROLLUP_REPORTING_CURRENCY).toBe('USD');
    });

    // The defect this gate exists to prevent: bom_item_costs has no currency
    // column and its other four inputs (raw material, packaging, procured,
    // tooling) are USD-native, so INR reaching total_cost_per_part would be
    // summed into BOM and project totals as though it were USD.
    it('refuses a factory-local currency, naming both currencies', () => {
      const reason = rollupRejectionReason('INR');
      expect(reason).not.toBeNull();
      expect(reason).toContain('INR');
      expect(reason).toContain('USD');
    });

    it('refuses every non-USD display currency a scenario override can select', () => {
      for (const code of ['INR', 'CNY', 'EUR', 'GBP', 'VND']) {
        expect(rollupRejectionReason(code)).not.toBeNull();
      }
    });
  });

  describe('resolvePersistedCostCurrencyBasis', () => {
    // A USA factory: the money is already in the factory currency, so nothing
    // was converted. Since P1b-iv-c that is 'local', not 'converted' -- calling
    // it converted would claim an FX step that never happened, even with a
    // truthful rate of 1.
    it('marks a same-currency row local, not converted', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: 'USD', rateFromLocal: 1,
      })).toBe('local');
    });

    // An India factory whose route response was normalised to USD: the row is
    // USD money, and it can say what it came from and at what rate.
    it('marks a genuine local-to-USD conversion converted', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: 'INR', rateFromLocal: 1 / 83.5,
      })).toBe('converted');
    });

    // ck_process_cost_records_converted_is_traceable requires both fields on a
    // converted row, so claiming that basis without them would be rejected by
    // the database -- and would be a false claim of traceability besides.
    it('will not claim converted without the local currency', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: null, rateFromLocal: 1 / 83.5,
      })).toBe('legacy_unverified');
    });

    it('will not claim converted without the rate', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: 'INR', rateFromLocal: null,
      })).toBe('legacy_unverified');
    });

    // A zero or non-finite rate is not a conversion anyone can reverse, so it
    // is an admitted gap rather than a traceable row. Guards against a rate
    // arriving as 0 from an unresolved lookup and reading as "free".
    it('rejects a rate that cannot describe a real conversion', () => {
      for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(resolvePersistedCostCurrencyBasis({
          lineCurrency: 'USD', localCurrency: 'INR', rateFromLocal: rate,
        })).toBe('legacy_unverified');
      }
    });

    // P1b-iv-c: 'local' is now the intended outcome for a route-applied row.
    // applyRoute hands the writer the routes as the engines computed them,
    // before the single conversion, so the money already IS in the factory
    // currency and no rate was applied to reach it.
    //
    // This replaces an assertion that 'local' was unreachable. That was correct
    // while the BOM rollup still summed money currency-blind; migrations 709
    // and 712 plus the application rollup removed that constraint, and
    // migration 712 dropped the database gate that enforced it.
    it('claims local when the money is already in the factory currency', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'INR', localCurrency: 'INR', rateFromLocal: null,
      })).toBe('local');
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: 'USD', rateFromLocal: null,
      })).toBe('local');
    });

    // ck_process_cost_records_local_agrees requires currency === cost_currency_local,
    // so a mismatch must never be labelled local -- the insert would be
    // rejected, and the claim would be false besides.
    it('will not claim local when the two currencies differ', () => {
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: 'INR', rateFromLocal: 1 / 83.5,
      })).toBe('converted');
      expect(resolvePersistedCostCurrencyBasis({
        lineCurrency: 'USD', localCurrency: null, rateFromLocal: null,
      })).toBe('legacy_unverified');
    });

    it('will not claim local on a non-ISO code', () => {
      for (const bad of ['inr', '', 'RUPEE', null]) {
        expect(resolvePersistedCostCurrencyBasis({
          lineCurrency: bad as string, localCurrency: bad as string, rateFromLocal: null,
        })).not.toBe('local');
      }
    });
  });
});

// P1b-iv-a: the overlay guard that removes the divide-by-83.5. Every row shape
// below is one that actually exists in the live database.
describe('overlayRejectionReason (P1b-iv-a)', () => {
  // The measured defect: a USD-denominated persisted row overlaid into an
  // INR-computed summary, then converted again by normalisation.
  it('refuses a USD row when the summary was computed in INR', () => {
    const reason = overlayRejectionReason(
      { currency: 'USD', cost_currency_basis: 'converted' }, 'INR',
    );
    expect(reason).toBe('persisted in USD, summary computed in INR');
  });

  // The same rows in a USA factory were never wrong: local == persisted == USD,
  // so nothing is converted twice and the snapshot must still be honoured.
  it('allows a USD row when the summary was computed in USD', () => {
    expect(overlayRejectionReason(
      { currency: 'USD', cost_currency_basis: 'converted' }, 'USD',
    )).toBeNull();
  });

  it('allows a local-basis row matching the summary currency', () => {
    expect(overlayRejectionReason(
      { currency: 'INR', cost_currency_basis: 'local' }, 'INR',
    )).toBeNull();
  });

  // 482 of the 507 live rows. The label was stamped unconditionally, so even
  // when it happens to match, it is not evidence.
  it('refuses a legacy_unverified row even when its label matches', () => {
    const reason = overlayRejectionReason(
      { currency: 'USD', cost_currency_basis: 'legacy_unverified' }, 'USD',
    );
    expect(reason).toMatch(/unverified/);
  });

  it('refuses a row with no declared currency', () => {
    expect(overlayRejectionReason({ currency: null, cost_currency_basis: 'local' }, 'USD'))
      .toBe('no declared currency');
  });

  it('refuses a row whose basis is missing entirely', () => {
    expect(overlayRejectionReason({ currency: 'USD', cost_currency_basis: null }, 'USD'))
      .toMatch(/unverified/);
  });

  // Whichever way the mismatch runs, it is still a mismatch.
  it('refuses in both directions', () => {
    expect(overlayRejectionReason({ currency: 'INR', cost_currency_basis: 'local' }, 'USD')).not.toBeNull();
    expect(overlayRejectionReason({ currency: 'USD', cost_currency_basis: 'local' }, 'INR')).not.toBeNull();
  });

  it('never converts or repairs, only accepts or explains', () => {
    // The contract is a decision, not a transformation: there is no numeric
    // output to misuse.
    const r = overlayRejectionReason({ currency: 'CNY', cost_currency_basis: 'converted' }, 'INR');
    expect(typeof r).toBe('string');
    expect(r).toContain('CNY');
    expect(r).toContain('INR');
  });
});

// The same contract for the other four cost-record tables (migration 708).
// Each case below is a real producer path, named after it.
describe('declareCostRecordCurrency (migration 708)', () => {
  it('raw material auto-derive: records the conversion it actually performed', () => {
    // rates.toUsd(lookup.price, 'INR') ran, so the row can prove it is USD.
    expect(declareCostRecordCurrency({
      declaredCurrency: 'USD',
      convertedFrom: { fromCurrency: 'INR', rateToStored: 0.011976 },
    })).toEqual({
      currency: 'USD',
      cost_currency_basis: 'converted',
      cost_currency_local: 'INR',
      cost_fx_rate_from_local: 0.011976,
    });
  });

  it('raw material hand-entered: declares nothing, because nothing is known', () => {
    // resolvedUnitCost starts as createDto.unitCost and the conversion sits
    // behind an `=== 0` branch, so this money never passed through FX. The
    // create DTO has no currency field either.
    expect(declareCostRecordCurrency({})).toEqual({
      currency: null,
      cost_currency_basis: 'legacy_unverified',
      cost_currency_local: null,
      cost_fx_rate_from_local: null,
    });
  });

  it('packaging: undeclared, and no currency invented for it', () => {
    const d = declareCostRecordCurrency({});
    expect(d.currency).toBeNull();
    expect(d.cost_currency_basis).toBe('legacy_unverified');
  });

  it('procured with a caller-declared currency: trusted, no conversion claimed', () => {
    expect(declareCostRecordCurrency({
      declaredCurrency: 'INR', storedCurrencyFallback: 'USD',
    })).toEqual({
      currency: 'INR',
      cost_currency_basis: 'local',
      cost_currency_local: 'INR',
      cost_fx_rate_from_local: null,
    });
  });

  // dto.currency || 'USD' meant a stored USD could not be told apart from a
  // defaulted one. The value is preserved; only the trust is withdrawn.
  it('procured without one: keeps USD in the column but marks it unverified', () => {
    expect(declareCostRecordCurrency({ storedCurrencyFallback: 'USD' })).toEqual({
      currency: 'USD',
      cost_currency_basis: 'legacy_unverified',
      cost_currency_local: null,
      cost_fx_rate_from_local: null,
    });
  });

  it('tooling: the hardcoded USD survives as a value, not as a claim', () => {
    const d = declareCostRecordCurrency({ storedCurrencyFallback: 'USD' });
    expect(d.currency).toBe('USD');
    expect(d.cost_currency_basis).toBe('legacy_unverified');
  });

  it('rejects anything that is not an ISO 4217 code as a declaration', () => {
    for (const bad of ['usd', 'RUPEE', '', '  ', 'US', 'USDD', null, undefined]) {
      const d = declareCostRecordCurrency({ declaredCurrency: bad as string, storedCurrencyFallback: 'USD' });
      expect(d.cost_currency_basis).toBe('legacy_unverified');
      expect(d.cost_currency_local).toBeNull();
    }
  });

  it('will not claim a conversion it cannot describe', () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = declareCostRecordCurrency({
        declaredCurrency: 'USD',
        convertedFrom: { fromCurrency: 'INR', rateToStored: rate },
      });
      // The currency is still known, so this is 'local' -- but never
      // 'converted', because there is no usable rate to record.
      expect(d.cost_currency_basis).toBe('local');
      expect(d.cost_fx_rate_from_local).toBeNull();
    }
  });

  // These two invariants are the same ones ck_*_currency_traceable enforces in
  // migration 708. If this resolver can emit a row the constraint rejects, the
  // insert fails at runtime -- so the code and the schema are asserted together
  // here rather than trusted to stay in step.
  it('never emits a row its own database constraint would reject', () => {
    const inputs = [
      {},
      { storedCurrencyFallback: 'USD' },
      { declaredCurrency: 'INR' },
      { declaredCurrency: 'INR', storedCurrencyFallback: 'USD' },
      { declaredCurrency: 'USD', convertedFrom: { fromCurrency: 'INR', rateToStored: 0.012 } },
      { declaredCurrency: 'USD', convertedFrom: { fromCurrency: 'inr', rateToStored: 0.012 } },
      { declaredCurrency: 'usd', convertedFrom: { fromCurrency: 'INR', rateToStored: 0.012 } },
      { convertedFrom: { fromCurrency: 'INR', rateToStored: 0.012 } },
    ];
    for (const input of inputs) {
      const d = declareCostRecordCurrency(input as Parameters<typeof declareCostRecordCurrency>[0]);
      if (d.cost_currency_basis === 'converted') {
        expect(d.cost_currency_local).not.toBeNull();
        expect(d.cost_fx_rate_from_local).not.toBeNull();
      }
      if (d.cost_currency_basis === 'local') {
        expect(d.cost_currency_local).not.toBeNull();
        expect(d.currency).toBe(d.cost_currency_local);
      }
      expect(['legacy_unverified', 'converted', 'local']).toContain(d.cost_currency_basis);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Rate-column denomination (P1b-v)
 *
 * Every row below is a REAL lhr_benchmark_rates row, read from the live table:
 *
 *   India / Sheet Metal   lhr 144.46 INR/hr   lhr_usd_effective 1.73 USD/hr
 *   India / Deburr        lhr 137.78 INR/hr   lhr_usd_effective 1.65 USD/hr
 *   USA   / Sheet Metal   lhr  46.67 USD/hr   lhr_usd_effective 46.67 USD/hr
 *
 * 144.46 / 1.73 = 83.5, the same FX factor as the double-conversion this
 * programme started from -- which is the point: picking the wrong column is
 * not a rounding difference, it is the whole conversion.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('resolveBenchmarkLabourRate (P1b-v rate denomination)', () => {
  const indiaSheetMetal = { lhr: 144.46, lhr_usd_effective: 1.73, currency: 'INR' };
  const indiaDeburr = { lhr: 137.78, lhr_usd_effective: 1.65, currency: 'INR' };
  const usaSheetMetal = { lhr: 46.67, lhr_usd_effective: 46.67, currency: 'USD' };

  // The defect: applyRoute persists factory-LOCAL money since P1b-iv-c, and the
  // previous rule handed it the USD column anyway, so direct_rate summed an INR
  // machine rate with a USD labour rate.
  it('returns the LOCAL rate when the row is persisted in its own currency', () => {
    expect(resolveBenchmarkLabourRate(indiaSheetMetal, 'INR')).toBe(144.46);
    expect(resolveBenchmarkLabourRate(indiaDeburr, 'INR')).toBe(137.78);
  });

  it('returns the USD rate when the caller is persisting USD', () => {
    expect(resolveBenchmarkLabourRate(indiaSheetMetal, 'USD')).toBe(1.73);
    expect(resolveBenchmarkLabourRate(indiaDeburr, 'USD')).toBe(1.65);
  });

  // A USD factory is where the old rule was accidentally correct, so it has to
  // keep producing exactly the same number or this is a behaviour change on the
  // default path rather than a fix.
  it('is unchanged for a USD factory, where both columns agree', () => {
    expect(resolveBenchmarkLabourRate(usaSheetMetal, 'USD')).toBe(46.67);
  });

  // The whole reason this returns a rate-or-null rather than a fallback: a
  // labour rate in the wrong currency is a different number, not a degraded
  // one. 0 is a visible gap; 1.73-instead-of-144.46 is a silent 83.5x error.
  it('refuses rather than substituting when neither column is the target currency', () => {
    expect(resolveBenchmarkLabourRate(indiaSheetMetal, 'CNY')).toBeNull();
    expect(resolveBenchmarkLabourRate({ lhr: 0, lhr_usd_effective: 0, currency: 'INR' }, 'USD')).toBeNull();
    expect(resolveBenchmarkLabourRate({ lhr: null, lhr_usd_effective: null, currency: null }, 'USD')).toBeNull();
  });

  // Pre-707 seed rows carry no currency of their own. They are fetched by
  // location, so the only currency they can be in is the one being asked for --
  // that is an assumption about the fetch, not a conversion.
  it('accepts a currency-less row at face value', () => {
    expect(resolveBenchmarkLabourRate({ lhr: 46.67, lhr_usd_effective: null, currency: null }, 'USD')).toBe(46.67);
  });

  // direct_rate = machine_rate + labor_rate. The invariant that makes that sum
  // meaningful is that both halves are in the row's declared currency.
  it('keeps direct_rate a single-currency sum', () => {
    const machineRateLocalInr = 1600;
    const labour = resolveBenchmarkLabourRate(indiaSheetMetal, 'INR');
    expect(labour).not.toBeNull();
    expect(machineRateLocalInr + labour!).toBeCloseTo(1744.46, 2);

    // What the superseded rule produced: INR + USD.
    expect(machineRateLocalInr + 1.73).toBeCloseTo(1601.73, 2);
  });
});
