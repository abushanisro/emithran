// The calculation behind a line's cycle as process_cost_records keeps it (migration 1097, costing/shared/calculator-run.ts): what Apply writes
// from an engine line, what a saved row gives back to its line, and what is kept of a run the calculator dialog sends.
import {
  calculationOfRow, calculatorColumnsFromClient, calculatorRunColumns, NO_CALCULATION,
} from '../../../../../modules/bom-items/costing/shared/calculator-run';

import type { CalculationTraceStep } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const CYCLE_CALCULATOR = '3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f';

// The multi-spindle cycle of the motor side gear shaft on a Tsugami M08SY: its slowest station plus the machine's index.
const input = (fieldName: string, value: number, unit: string, source: string): CalculationTraceStep => ({ fieldName, displayLabel: fieldName, kind: 'input', value, unit, source });
const SHAFT_CYCLE: CalculationTraceStep[] = [
  input('Slowest Station', 5.0825, 's', 'Station 1: Rough Turning, the slowest of 2'),
  input('Drum Index Time', 3, 's', 'Tsugami M08SY: index_time_s (HR Rates)'),
  input('Transfer Time', 2, 's', 'Tsugami M08SY: transfer_time_s (HR Rates)'),
  { fieldName: 'Index Time', displayLabel: 'Index Time', kind: 'calculated', value: 5, unit: 's', formula: '{Drum Index Time} + {Transfer Time}' },
  { fieldName: 'Cycle Time', displayLabel: 'Cycle Time', kind: 'calculated', value: 10.0825, unit: 's', formula: '{Slowest Station} + {Index Time}' },
];
const LOOKUPS = { 'Drum Index Time': { table: 'tblMultiSpindleIndex', row: { spindles: 2, index_time_s: 3 } } };
const engineLine = { calculatorId: CYCLE_CALCULATOR, calculatorVersion: 1, calculationTrace: SHAFT_CYCLE, lookupMatches: LOOKUPS };

describe('calculatorRunColumns (Apply)', () => {
  it('keeps the engine line\'s calculator, version and run, and the cycle\'s phases read off the run', () => {
    expect(calculatorRunColumns(engineLine)).toEqual({
      calculator_id: CYCLE_CALCULATOR,
      calculator_version: 1,
      calculator_run: { trace: SHAFT_CYCLE, lookupMatches: LOOKUPS },
      cycle_phases: [{ name: 'Slowest Station', seconds: 5.0825 }, { name: 'Index Time', seconds: 5 }],
    });
  });

  it('a line no calculator computed keeps nothing; a trace with no stored calculator keeps its run, and no version without a calculator', () => {
    expect(calculatorRunColumns({})).toEqual(NO_CALCULATION);
    expect(calculatorRunColumns({ calculatorId: 'not-a-uuid', calculatorVersion: 3, calculationTrace: SHAFT_CYCLE })).toMatchObject({
      calculator_id: null, calculator_version: null, calculator_run: { trace: SHAFT_CYCLE, lookupMatches: {} },
    });
  });
});

describe('calculationOfRow (a line rebuilt from its saved row)', () => {
  it('reads back the same calculation the engine line had', () => {
    expect(calculationOfRow(calculatorRunColumns(engineLine))).toEqual(engineLine);
  });

  it('an older row (no run) gives nothing, never an empty trace', () => {
    expect(calculationOfRow({ calculator_id: null, calculator_version: null, calculator_run: null })).toEqual({});
    expect(calculationOfRow({ calculator_run: { trace: [] } })).toEqual({});
  });
});

describe('calculatorColumnsFromClient (the calculator dialog\'s run)', () => {
  it('keeps the steps and lookup rows of the run the cycle was computed with, and reads the phases off it', () => {
    const cols = calculatorColumnsFromClient({ calculatorId: CYCLE_CALCULATOR, calculatorVersion: 1, calculatorRun: { trace: SHAFT_CYCLE, lookupMatches: LOOKUPS } });
    expect(cols).toEqual(calculatorRunColumns(engineLine));
  });

  it('drops what is not a step (no field name, an unknown kind), unknown keys, non-finite numbers and malformed lookup rows', () => {
    const cols = calculatorColumnsFromClient({
      calculatorId: CYCLE_CALCULATOR,
      calculatorRun: {
        trace: [
          { fieldName: 'Slowest Station', kind: 'input', value: 5, unit: 's', injected: '<script>' },
          { fieldName: 'Bad', kind: 'other', value: 1 },
          { kind: 'input', value: 2 },
          { fieldName: 'Overflow', kind: 'calculated', value: Number.POSITIVE_INFINITY },
        ],
        lookupMatches: { 'Slowest Station': { table: 7, row: {} }, 'Drum Index Time': { table: 'tblMultiSpindleIndex', row: { spindles: 2, note: { x: 1 } } } },
      },
    });
    expect(cols.calculator_run).toEqual({
      trace: [
        { fieldName: 'Slowest Station', displayLabel: 'Slowest Station', kind: 'input', value: 5, unit: 's' },
        { fieldName: 'Overflow', displayLabel: 'Overflow', kind: 'calculated', value: null },
      ],
      lookupMatches: { 'Drum Index Time': { table: 'tblMultiSpindleIndex', row: { spindles: 2 } } },
    });
    expect(cols.calculator_version).toBeNull();
  });

  it('a typed cycle (no calculator, no run) clears the calculation', () => {
    expect(calculatorColumnsFromClient({ calculatorId: null, calculatorRun: null })).toEqual(NO_CALCULATION);
    expect(calculatorColumnsFromClient({})).toEqual(NO_CALCULATION);
  });
});
