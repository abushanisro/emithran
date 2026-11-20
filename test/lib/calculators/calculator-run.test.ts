import { describe, expect, it } from 'vitest';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import {
  calculationOfLine, calculationOfRecord, runOfCalculator, seedOfCalculation, tracedLineOf, type LineCalculation,
} from '@/lib/calculators/calculator-run';

const CYCLE = 'b7c4e2a1-0d3f-4e5a-8b6c-1d2e3f4a5b6c'; // "Multi-Spindle Machining - Cycle"

// The saved Simultaneous Turning line of the motor side gear shaft (Tsugami M08SY): its cycle is the slowest station plus the index.
const MACHINE_REF = { kind: 'machine', machineId: 'm1', machineName: 'Tsugami M08SY', machineClass: 'simultaneous_turning', location: 'USA', column: 'index_time_s' } as const;
const TRACE: CalculationTraceStep[] = [
  { kind: 'input', fieldName: 'Slowest Station', displayLabel: 'Slowest Station', value: 5.0825, unit: 's', source: 'Station 1: Rough Turning, the slowest of 2' },
  { kind: 'input', fieldName: 'Drum Index Time', displayLabel: 'Drum Index Time', value: 3, unit: 's', source: 'Tsugami M08SY: index_time_s (HR Rates)', ref: MACHINE_REF },
  { kind: 'input', fieldName: 'Transfer Time', displayLabel: 'Transfer Time', value: 2, unit: 's', source: 'Tsugami M08SY: transfer_time_s (HR Rates)' },
  { kind: 'calculated', fieldName: 'Cycle Time', displayLabel: 'Cycle Time', value: 10.0825, unit: 's', formula: '{Slowest Station} + {Drum Index Time} + {Transfer Time}' },
];
const SAVED: LineCalculation = { calculatorId: CYCLE, calculatorVersion: 1, calculatorRun: { trace: TRACE, lookupMatches: {} } };

describe('the calculation of a line and of its saved record', () => {
  it('a live line with a trace gives the calculation a saved line keeps; one without a trace gives none', () => {
    expect(calculationOfLine({ calculatorId: CYCLE, calculatorVersion: 1, calculationTrace: TRACE })).toEqual(SAVED);
    expect(calculationOfLine({ calculatorId: CYCLE, calculationTrace: [] })).toBeNull();
    expect(calculationOfLine(undefined)).toBeNull();
  });

  it('a saved record with a run is its calculation; a record applied before runs were kept has none', () => {
    expect(calculationOfRecord({ calculatorId: CYCLE, calculatorVersion: 1, calculatorRun: { trace: TRACE, lookupMatches: {} } })).toEqual(SAVED);
    expect(calculationOfRecord({ calculatorId: null, calculatorVersion: null, calculatorRun: null })).toBeNull();
    expect(tracedLineOf(null)).toBeNull();
  });
});

describe('seedOfCalculation: the saved line\'s calculator opens with the inputs it was costed from', () => {
  it('fills every input with its value and source, and keeps where each was read', () => {
    const seed = seedOfCalculation(SAVED);
    expect(seed?.calculatorId).toBe(CYCLE);
    expect(seed?.inputs).toEqual({ 'Slowest Station': 5.0825, 'Drum Index Time': 3, 'Transfer Time': 2 });
    expect(seed?.provenance['Slowest Station']).toBe('Station 1: Rough Turning, the slowest of 2');
    expect(seed?.refs['Drum Index Time']).toMatchObject({ kind: 'machine', column: 'index_time_s' });
  });

  it('a run with no stored calculator opens none', () => {
    expect(seedOfCalculation({ ...SAVED, calculatorId: null })).toBeUndefined();
  });
});

describe('runOfCalculator: the dialog\'s run, saved with the cycle it gave', () => {
  const fields = [
    { fieldName: 'Cycle Time', displayLabel: 'Cycle Time', fieldType: 'calculated', unit: 's', defaultValue: '{Slowest Station} + {Drum Index Time} + {Transfer Time}', displayOrder: 9 },
    { fieldName: 'Slowest Station', displayLabel: 'Slowest Station', fieldType: 'number', unit: 's', displayOrder: 1 },
    { fieldName: 'Drum Index Time', displayLabel: 'Drum Index Time', fieldType: 'number', unit: 's', displayOrder: 2 },
    { fieldName: 'Transfer Time', displayLabel: 'Transfer Time', fieldType: 'number', unit: 's', displayOrder: 3 },
  ];

  it('lists the fields in display order: inputs with their value and source, the cycle with its formula and result', () => {
    const run = runOfCalculator({
      fields,
      inputs: { 'Slowest Station': 6, 'Drum Index Time': '3', 'Transfer Time': 2 },
      results: { 'Cycle Time': 11 },
      provenance: { 'Slowest Station': 'Entered in the calculator', 'Drum Index Time': 'Tsugami M08SY: index_time_s (HR Rates)' },
      refs: { 'Drum Index Time': MACHINE_REF, 'Transfer Time': null },
      lookupMatches: { 'Drum Index Time': { table: 'tblMultiSpindleIndex', row: { spindles: 2 } }, 'Cycle Time': { table: 'x', row: {} } },
    });
    expect(run.trace.map((st) => [st.kind, st.fieldName, st.value])).toEqual([
      ['input', 'Slowest Station', 6], ['input', 'Drum Index Time', 3], ['input', 'Transfer Time', 2], ['calculated', 'Cycle Time', 11],
    ]);
    expect(run.trace[0]).toMatchObject({ source: 'Entered in the calculator', unit: 's' });
    expect(run.trace[1]?.ref).toMatchObject({ column: 'index_time_s' });
    expect(run.trace[2]).not.toHaveProperty('source');
    expect(run.trace[3]).toMatchObject({ formula: '{Slowest Station} + {Drum Index Time} + {Transfer Time}' });
    // Lookup rows only for inputs: a calculated field has none.
    expect(run.lookupMatches).toEqual({ 'Drum Index Time': { table: 'tblMultiSpindleIndex', row: { spindles: 2 } } });
  });

  it('reopens with what it was saved with: the run seeds the same inputs', () => {
    const run = runOfCalculator({ fields, inputs: { 'Slowest Station': 6, 'Drum Index Time': 3, 'Transfer Time': 2 }, results: { 'Cycle Time': 11 }, provenance: {} });
    expect(seedOfCalculation({ calculatorId: CYCLE, calculatorVersion: 1, calculatorRun: run })?.inputs)
      .toEqual({ 'Slowest Station': 6, 'Drum Index Time': 3, 'Transfer Time': 2 });
  });

  it('an empty or non-numeric input is kept as it is (text) or as no value, never as zero', () => {
    const run = runOfCalculator({ fields, inputs: { 'Slowest Station': '', 'Drum Index Time': 'n/a' }, results: null, provenance: {} });
    expect(run.trace.map((st) => st.value)).toEqual([null, 'n/a', null, null]);
  });
});
