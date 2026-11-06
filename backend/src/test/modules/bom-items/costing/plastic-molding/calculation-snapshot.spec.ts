import { buildCalculationSnapshot, CALCULATION_SNAPSHOT_SCHEMA, snapshotDrift } from '../../../../../modules/bom-items/costing/plastic-molding/calculation-snapshot';
import { fingerprintRows, stableStringify } from '../../../../../modules/bom-items/costing/plastic-molding/reference-fingerprint';
import { buildQuoteValidation } from '../../../../../modules/bom-items/costing/plastic-molding/quote-validation';

describe('reference fingerprint', () => {
  it('is the same for the same data, whatever order the keys arrive in', () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(fingerprintRows({ x: 1, y: [1, 2] })).toBe(fingerprintRows({ y: [1, 2], x: 1 }));
  });

  it('changes when any value changes, and when a row is added; array order is data and counts', () => {
    const base = fingerprintRows({ variables: [{ key: 'k', value: 1.1 }] });
    expect(fingerprintRows({ variables: [{ key: 'k', value: 1.2 }] })).not.toBe(base);
    expect(fingerprintRows({ variables: [{ key: 'k', value: 1.1 }, { key: 'j', value: 1 }] })).not.toBe(base);
    expect(fingerprintRows([1, 2])).not.toBe(fingerprintRows([2, 1]));
  });

  it('is 16 hex characters', () => expect(fingerprintRows({})).toMatch(/^[0-9a-f]{16}$/));
});

describe('calculation snapshot', () => {
  const validation = buildQuoteValidation(['F-02', 'F-04'], ['G-03']);
  const snap = buildCalculationSnapshot(validation, { sourceVersion: '2026-Plastic', datasetFingerprint: 'abc123' }, 'emithran-cost-1', { volume: 50_000 });

  it('records the dataset and its fingerprint, the engine, each formula with its version and state, completeness and what was left out', () => {
    expect(snap).toEqual({
      schema: CALCULATION_SNAPSHOT_SCHEMA,
      referenceData: { sourceVersion: '2026-Plastic', fingerprint: 'abc123' },
      engineVersion: 'emithran-cost-1',
      formulas: [{ id: 'F-02', version: 1, state: 'VALIDATED' }, { id: 'F-04', version: 1, state: 'ASSUMED' }],
      state: 'ASSUMED', complete: false, unsupported: ['G-03'],
      inputs: { volume: 50_000 },
    });
  });

  it('stays small: ids and versions, not the assumption text (that lives in the registry at that version)', () => {
    expect(JSON.stringify({ ...snap, inputs: {} }).length).toBeLessThan(500);
    expect(JSON.stringify(snap)).not.toContain('Menges');
  });

  it('is reproducible while the dataset and every formula version it used are unchanged', () => {
    const current = { referenceFingerprint: 'abc123', formulaVersions: new Map([['F-02', 1], ['F-04', 1]]) };
    expect(snapshotDrift(snap, current)).toEqual({ reproducible: true, reasons: [] });
  });

  it('says what changed: the data, a formula version, or a formula that no longer exists', () => {
    const drift = snapshotDrift(snap, { referenceFingerprint: 'zzz', formulaVersions: new Map([['F-04', 2]]) });
    expect(drift.reproducible).toBe(false);
    expect(drift.reasons).toEqual([
      'the reference data has changed since this calculation',
      'F-02 is no longer in the formula registry',
      'F-04 is now version 2 (calculated with version 1)',
    ]);
  });
});
