// A line timed by one calculator run per group (machining-trace.ts groupedRunsTrace, sumRuns): its calculation is each group's run, under the
// group's name when there are several, then how the line's cycle is made from them. The calculator reopens on the first group's inputs.
import { calculatorInputSteps, groupedRunsTrace, sumRuns } from '../../../../../../modules/bom-items/costing/machining/process/machining-trace';

import type { CalcRun } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import type { CalculationTraceStep } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';

const tapRun = (diameter: number, uses: number): CalculationTraceStep[] => [
  { fieldName: 'Tap Diameter', displayLabel: 'Tap Diameter', kind: 'input', value: diameter, unit: 'mm', source: `Parsed from thread size "M${diameter}"` },
  { fieldName: 'No of Uses', displayLabel: 'No of Uses', kind: 'input', value: uses, unit: null, source: 'CAD/drawing feature extraction' },
  { fieldName: 'Time per Use', displayLabel: 'Time per Use', kind: 'calculated', value: 4, unit: 's', formula: '{Length} / ({Feed per Rev} * {RPM}) * 60' },
  { fieldName: 'Tool Change Time', displayLabel: 'Tool Change Time', kind: 'calculated', value: 3, unit: 's', formula: '3' },
];
const UNLOAD = { label: 'Unload Time', sec: 2, source: 'Assumption: final clear and unload, once per operation (a fixed allowance)' };

describe('groupedRunsTrace', () => {
  it('one group: its run as it is, then the unload and the line\'s cycle', () => {
    const trace = groupedRunsTrace('Tapping', [{ label: 'M4', trace: tapRun(4, 2) }], UNLOAD, 13);
    expect(trace.map((st) => st.fieldName)).toEqual(['Tap Diameter', 'No of Uses', 'Time per Use', 'Tool Change Time', 'Unload Time', 'Tapping cycle time']);
    expect(trace.at(-1)).toMatchObject({ kind: 'calculated', value: 13, unit: 's' });
    expect(trace.at(-2)).toMatchObject({ kind: 'input', value: 2, source: UNLOAD.source });
  });

  it('several groups: each under its size, and the calculator refills from the first', () => {
    const trace = groupedRunsTrace('Tapping', [{ label: 'M4', trace: tapRun(4, 2) }, { label: 'M6', trace: tapRun(6, 1) }], UNLOAD, 24);
    expect(trace.filter((st) => st.group === 'M6').map((st) => st.fieldName)).toContain('M6 · Tap Diameter');
    expect(calculatorInputSteps(trace).find((st) => st.fieldName === 'Tap Diameter')?.value).toBe(4);
  });

  it('no resolved group, no calculation', () => {
    expect(groupedRunsTrace('Tapping', [], UNLOAD, 0)).toEqual([]);
  });
});

describe('sumRuns', () => {
  const run = (sec: number): CalcRun => ({ sec, trace: tapRun(4, 1), missing: [], calculatorId: 'c1', calculatorVersion: 2, lookups: {} });

  it('one run is itself; several are summed under each feature, keeping the calculator', () => {
    expect(sumRuns([{ label: 'Hole 1', run: run(5) }], 'Drilling cycle time').sec).toBe(5);
    const summed = sumRuns([{ label: 'Hole 1', run: run(5) }, { label: 'Hole 2', run: run(7) }], 'Drilling cycle time');
    expect(summed.sec).toBe(12);
    expect(summed.calculatorId).toBe('c1');
    expect(summed.trace.at(-1)).toMatchObject({ fieldName: 'Drilling cycle time', value: 12 });
  });
});
