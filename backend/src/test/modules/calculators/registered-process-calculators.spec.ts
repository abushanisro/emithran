import {
  evaluateCalculatorFormulas,
  normalizeFieldName,
  type CalculatorFieldRow,
} from '../../../modules/calculators/calculator-formula-evaluator';

// Regression cover for migration 702 (restore the secondary-operation
// process_calculator_mappings rows).
//
// Binding a calculator to a machine class only fixes the reported failure if
// that calculator, fed the seed the cost engine actually supplies, produces a
// cycle time the system can persist. process_cost_records.cycle_time is
// NUMERIC NOT NULL CHECK (cycle_time >= 1) seconds (migration 034), and
// writeProcessLinesAsRecords() rejects the ENTIRE apply-route request when a
// line resolves below that. So "no calculator registered" and "cycle time
// resolved to less than 1 second" are two different ways to fail the same
// apply, and swapping one for the other would not be a fix.
//
// These are not DB tests and nothing here is mocked: evaluateCalculatorFormulas
// is a pure function over (field rows, input values). The field rows below are
// the REAL definitions of the two calculators involved, transcribed from
// migrations calculators/049 and calculators/053 and confirmed against the live
// rows served by GET /v1/api/calculators/:id — same field names, same
// field_type, same default_value formula strings. The seeds are the exact keys
// bom-items.service.ts passes in seedScope for each.

function field(
  field_name: string,
  field_type: 'number' | 'text' | 'calculated',
  display_order: number,
  default_value: string | null = null,
): CalculatorFieldRow {
  return { id: `f${String(display_order)}`, field_name, field_type, display_order, default_value };
}

// Real "Sheet Metal - Inspection" fields (migration calculators/049).
// MHR/LHR default_value is null in the live rows — a rate is resolved per
// location from mhr_records/lhr_records, never carried on a calculator.
const INSPECTION_FIELDS: CalculatorFieldRow[] = [
  field('MHR per Hour', 'number', 1, null),
  field('LHR per Hour', 'number', 2, null),
  field('Method', 'text', 3, 'visual'),
  field('Visual Pass Base', 'number', 4, '0'),
  field('Holes to Inspect', 'number', 5, '0'),
  field('Hole Check Time', 'number', 6, '0'),
  field('Bends to Inspect', 'number', 7, '0'),
  field('Bend Check Time', 'number', 8, '0'),
  field('Threads to Inspect', 'number', 9, '0'),
  field('Thread Gauge Time', 'number', 10, '0'),
  field('Has Thickness Check', 'number', 11, '0'),
  field('Thickness Check Time', 'number', 12, '0'),
  field('Has Dimension Check', 'number', 13, '0'),
  field('Dimension Check Time', 'number', 14, '0'),
  field(
    'Total Time',
    'calculated',
    15,
    '{Visual Pass Base} + {Holes to Inspect} * {Hole Check Time} + {Bends to Inspect} * {Bend Check Time} + {Threads to Inspect} * {Thread Gauge Time} + {Has Thickness Check} * {Thickness Check Time} + {Has Dimension Check} * {Dimension Check Time}',
  ),
  field('Total Time Min', 'calculated', 16, '{Total Time} / 60'),
  field('Machine Cost', 'calculated', 17, '{MHR per Hour} * {Total Time} / 3600'),
  field('Labour Cost', 'calculated', 18, '{LHR per Hour} * {Total Time} / 3600'),
  field('Total Process Cost', 'calculated', 19, '{Machine Cost} + {Labour Cost}'),
];

// Real "Sheet Metal - PEM Insertion" fields (migration calculators/053), shown
// here AFTER migration 702 clears the two fabricated rate defaults. The live
// rows carried 'MHR per Hour' = '91.6' and 'LHR per Hour' = '96.14' — Indian-
// rupee figures baked into a calculator being resolved for a USA factory.
const PEM_FIELDS: CalculatorFieldRow[] = [
  field('MHR per Hour', 'number', 1, null),
  field('LHR per Hour', 'number', 2, null),
  field('OLE', 'number', 3, '80'),
  field('Setup Percentage', 'number', 4, '30'),
  field('Insertion Cycle Time', 'number', 5, null),
  field('No Of Insertions', 'number', 6, '1'),
  field('Total Time', 'calculated', 7, '{No Of Insertions} * {Insertion Cycle Time}'),
  field('Machine Cost', 'calculated', 8, '{MHR per Hour} * {Total Time} / 3600'),
  field('Labour Cost', 'calculated', 9, '{LHR per Hour} * {Total Time} / (3600 * ({OLE} / 100))'),
  field('Process Cost', 'calculated', 10, '{Machine Cost} + {Labour Cost}'),
  field('Setup Cost', 'calculated', 11, '{Process Cost} * ({Setup Percentage} / 100)'),
  field('Total Process Cost', 'calculated', 12, '{Process Cost} + {Setup Cost}'),
];

function totalTimeSec(fields: CalculatorFieldRow[], seed: Record<string, number | string>): number {
  const { scope } = evaluateCalculatorFormulas(fields, [], seed);
  return scope[normalizeFieldName('Total Time')] as number;
}

describe('Sheet Metal - Inspection calculator (machine_class cmm)', () => {
  // The seed bom-items.service.ts builds from planInspection() for the part
  // that reproduced the reported failure: 4 holes, 4 bends, no threads,
  // thickness + overall-dimension checks, visual method.
  const REPORTED_PART_SEED = {
    'Visual Pass Base': 30,
    'Holes to Inspect': 4,
    'Hole Check Time': 5,
    'Bends to Inspect': 4,
    'Bend Check Time': 8,
    'Threads to Inspect': 0,
    'Thread Gauge Time': 0,
    'Has Thickness Check': 1,
    'Thickness Check Time': 6,
    'Has Dimension Check': 1,
    'Dimension Check Time': 10,
  };

  it('sums the real sampled feature counts and per-feature times', () => {
    // 30 + 4*5 + 4*8 + 0 + 6 + 10
    expect(totalTimeSec(INSPECTION_FIELDS, REPORTED_PART_SEED)).toBe(98);
  });

  it('clears the >= 1 second floor that writeProcessLinesAsRecords enforces', () => {
    expect(totalTimeSec(INSPECTION_FIELDS, REPORTED_PART_SEED)).toBeGreaterThanOrEqual(1);
  });

  it('drops a feature class out of the total when this part has none of it', () => {
    const noBends = { ...REPORTED_PART_SEED, 'Bends to Inspect': 0 };
    expect(totalTimeSec(INSPECTION_FIELDS, noBends)).toBe(98 - 32);
  });

  it('still totals a real visual pass when the part has no countable features', () => {
    // planInspection() sets skip for a genuinely uninspected part; when it does
    // NOT skip, the visual base alone must still clear the persistence floor.
    const baseOnly = {
      'Visual Pass Base': 30, 'Holes to Inspect': 0, 'Hole Check Time': 0,
      'Bends to Inspect': 0, 'Bend Check Time': 0, 'Threads to Inspect': 0,
      'Thread Gauge Time': 0, 'Has Thickness Check': 0, 'Thickness Check Time': 0,
      'Has Dimension Check': 0, 'Dimension Check Time': 0,
    };
    expect(totalTimeSec(INSPECTION_FIELDS, baseOnly)).toBe(30);
  });

  it('reports no machine/labour cost rather than a zero one when no rate is seeded', () => {
    // The cost engine prices this line itself from the resolved MHR/LHR; the
    // calculator must not manufacture a number from a stored default.
    const { scope } = evaluateCalculatorFormulas(INSPECTION_FIELDS, [], REPORTED_PART_SEED);
    expect(scope[normalizeFieldName('Machine Cost')]).toBeUndefined();
    expect(scope[normalizeFieldName('Labour Cost')]).toBeUndefined();
  });

  it('prices machine and labour from a seeded real rate when one is supplied', () => {
    const { scope } = evaluateCalculatorFormulas(
      INSPECTION_FIELDS, [], { ...REPORTED_PART_SEED, 'MHR per Hour': 36, 'LHR per Hour': 18 },
    );
    expect(scope[normalizeFieldName('Machine Cost')]).toBeCloseTo(36 * 98 / 3600, 6);
    expect(scope[normalizeFieldName('Labour Cost')]).toBeCloseTo(18 * 98 / 3600, 6);
  });
});

describe('Sheet Metal - PEM Insertion calculator (machine_class pem_press)', () => {
  // Seed keys as bom-items.service.ts supplies them, per hole-diameter group
  // matched against sm_lookup_pem_hardware (migration 381 seeds PEM S-M3-1 at
  // 4 seconds per insertion).
  const PEM_GROUP_SEED = { 'Insertion Cycle Time': 4, 'No Of Insertions': 3 };

  it('multiplies the real looked-up insertion time by the real insertion count', () => {
    expect(totalTimeSec(PEM_FIELDS, PEM_GROUP_SEED)).toBe(12);
  });

  it('clears the >= 1 second persistence floor for a single insertion', () => {
    expect(totalTimeSec(PEM_FIELDS, { 'Insertion Cycle Time': 4, 'No Of Insertions': 1 })).toBe(4);
  });

  it('yields no total time when the hardware lookup found no insertion time', () => {
    // A diameter matching no PEM spec is not a PEM insertion point at all. The
    // caller only calls this calculator for groups that DID match, so an
    // unseeded cycle time must surface as absent — never as a zero-time,
    // zero-cost line that still gets written to the route.
    const { scope } = evaluateCalculatorFormulas(PEM_FIELDS, [], { 'No Of Insertions': 3 });
    expect(scope[normalizeFieldName('Total Time')]).toBeUndefined();
  });

  it('no longer derives a cost from the fabricated INR rate defaults', () => {
    // Before migration 702 these fields defaulted to 91.6 and 96.14 INR/hr, so
    // this same call returned a confident-looking cost for a USA part.
    const { scope } = evaluateCalculatorFormulas(PEM_FIELDS, [], PEM_GROUP_SEED);
    expect(scope[normalizeFieldName('Machine Cost')]).toBeUndefined();
    expect(scope[normalizeFieldName('Labour Cost')]).toBeUndefined();
    expect(scope[normalizeFieldName('Total Process Cost')]).toBeUndefined();
  });

  it('prices from a seeded real rate, applying the stored OLE and setup percentages', () => {
    const { scope } = evaluateCalculatorFormulas(
      PEM_FIELDS, [], { ...PEM_GROUP_SEED, 'MHR per Hour': 60, 'LHR per Hour': 24 },
    );
    const machine = 60 * 12 / 3600;
    const labour = 24 * 12 / (3600 * 0.8);
    expect(scope[normalizeFieldName('Machine Cost')]).toBeCloseTo(machine, 6);
    expect(scope[normalizeFieldName('Labour Cost')]).toBeCloseTo(labour, 6);
    expect(scope[normalizeFieldName('Total Process Cost')]).toBeCloseTo((machine + labour) * 1.3, 6);
  });
});
