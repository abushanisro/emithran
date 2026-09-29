import { machiningLookupSeeds } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-lookup-seeds';
import { loadMachiningCalculatorSpec } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { realDrillingTable, realKeywayBroachReference, realPartoffTable, realTappingTable } from '../real-reference-tables';

// The lookup inputs of a machining calculator come from ONE resolver, shared
// by the cost engine and the Edit Process Cost dialog endpoint. These run it
// against the real reference tables (parsed from memory/machining CSVs).

const spec = loadMachiningCalculatorSpec();
const lookupFieldsOf = (operation: string): Set<string> => {
  const calc = spec.calculators.find((c) => c.operation === operation)!;
  return new Set(calc.fields.filter((f) => f.source === 'lookup').map((f) => f.name));
};

describe('machiningLookupSeeds', () => {
  const ctx = { matClass: 'aluminum' as const, drillingTable: realDrillingTable(), partoffTable: realPartoffTable() };

  it('fills Drilling speed and feed from the real tblDrilling row for the entered diameter', () => {
    const r = machiningLookupSeeds('Drilling', ctx, { 'Hole Diameter': 6 })!;
    expect(r.missing).toEqual([]);
    expect(Object.keys(r.seeds).sort()).toEqual([...lookupFieldsOf('Drilling')].sort());
    expect(r.seeds['Cutting Speed']!.match?.table).toBe('tblDrilling');
    expect(r.seeds['Feed']!.value).toBeGreaterThan(0);
  });

  it('a different diameter picks a different real feed', () => {
    const small = machiningLookupSeeds('Drilling', ctx, { 'Hole Diameter': 3 })!.seeds['Feed']!.value;
    const large = machiningLookupSeeds('Drilling', ctx, { 'Hole Diameter': 20 })!.seeds['Feed']!.value;
    expect(small).not.toBe(large);
  });

  it('names the missing key instead of inventing a row', () => {
    const r = machiningLookupSeeds('Drilling', ctx, {})!;
    expect(r.seeds).toEqual({});
    expect(r.missing.join(' ')).toContain('Hole Diameter');
  });

  it('fills Parting from the real part-off insert that reaches the bar radius', () => {
    const r = machiningLookupSeeds('Parting', ctx, { 'Bar Diameter': 20 })!;
    expect(r.missing).toEqual([]);
    expect(Object.keys(r.seeds).sort()).toEqual([...lookupFieldsOf('Parting')].sort());
    expect(r.seeds['Feed']!.match?.table).toBe('tblVirtualPartoffInsertCutData');
  });

  it('reports the table, not a value, when its data is not available', () => {
    for (const op of ['Reaming', 'Rough Turning', 'Keyway Broaching', 'Wire EDM', 'Deburring', 'Secondary Setup (Rechuck)']) {
      const r = machiningLookupSeeds(op, { matClass: 'aluminum' }, { 'Hole Diameter': 6 })!;
      expect(r.missing.length).toBeGreaterThan(0);
    }
  });

  it('only ever produces lookup inputs the calculator actually has', () => {
    const full = {
      ...ctx,
      turningParams: { roughCutDepthMm: 2, roughCuttingSpeedMPerMin: 300, roughFeedMmPerRev: 0.3, finishCutDepthMm: 0.5, finishCuttingSpeedMPerMin: 400, finishFeedMmPerRev: 0.1, dataFound: true },
      grindingParams: { workSpeedMMin: 20, roughInfeedMm: 0.02, finishInfeedMm: 0.005, roughAxialFeedRevMm: 10, finishAxialFeedRevMm: 5, dataFound: true },
      keywayBroach: realKeywayBroachReference(),
      tappingTable: realTappingTable(),
      wireEdmParams: { roughFeedRateMmPerMin: 3, finishFeedRateMmPerMin: 6, dataFound: true },
      deburrParams: { linearSpeedMmPerSec: 20, dataFound: true },
      workholderTable: [{ Name: '3 Jaw Chuck', 'Install And Remove Time (min)': 10 }],
    };
    for (const calc of spec.calculators) {
      const r = machiningLookupSeeds(calc.operation, full, { 'Hole Diameter': 6, 'Bar Diameter': 20, 'Thread Pitch': 1, 'Keyway Width': 6, 'Keyway Length': 40 });
      if (!r) continue;
      const allowed = lookupFieldsOf(calc.operation);
      for (const field of Object.keys(r.seeds)) expect({ op: calc.operation, field, ok: allowed.has(field) }).toEqual({ op: calc.operation, field, ok: true });
    }
  });
});
