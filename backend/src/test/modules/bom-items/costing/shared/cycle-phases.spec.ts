import { cyclePhasesOf } from '../../../../../modules/bom-items/costing/shared/cycle-phases';
import type { CalculationTraceStep } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// A line's cycle phases: the time-valued parts its stored calculator's Cycle Time (or Total Time) formula adds up, in formula order, with their values.
const input = (fieldName: string, value: number, unit: string | null): CalculationTraceStep => ({ fieldName, displayLabel: fieldName, kind: 'input', value, unit });
const calc = (fieldName: string, value: number, unit: string | null, formula: string): CalculationTraceStep => ({ fieldName, displayLabel: fieldName, kind: 'calculated', value, unit, formula });

const injection: CalculationTraceStep[] = [
  input('Nominal Wall Thickness', 1.5, 'mm'),
  input('Press Dry Cycle Time', 1.18, 's'),
  input('Cycle Time Adjustment Factor', 1, null),
  calc('Cooling Time', 2.9, 's', 'floor({Nominal Wall Thickness} * 2)'),
  calc('Fill Time', 0.12, 's', '{Shot Melt Volume} / {Press Injection Rate}'),
  calc('Pack Time', 2, 's', 'max(2, {Cooling Time} * 0.35)'),
  calc('Cycle Time', 6.2, 's', 'floor(({Fill Time} + {Pack Time} + {Cooling Time} + {Press Dry Cycle Time}) * {Cycle Time Adjustment Factor} * 100 + 0.5) / 100'),
];

describe('cyclePhasesOf', () => {
  it('lists the time-valued parts of the cycle time in formula order, leaving out factors that are not a time', () => {
    expect(cyclePhasesOf(injection)).toEqual([
      { name: 'Fill Time', seconds: 0.12 },
      { name: 'Pack Time', seconds: 2 },
      { name: 'Cooling Time', seconds: 2.9 },
      { name: 'Press Dry Cycle Time', seconds: 1.18 },
    ]);
  });

  it('reads a Total Time in minutes as seconds', () => {
    expect(cyclePhasesOf([input('Load Time', 0.5, 'min'), calc('Run Time', 1.25, 'min', '{Length} / {Feed}'), calc('Total Time', 1.75, 'min', '{Load Time} + {Run Time}')]))
      .toEqual([{ name: 'Load Time', seconds: 30 }, { name: 'Run Time', seconds: 75 }]);
  });

  it('is null without a cycle time, with fewer than two time parts, or with no trace', () => {
    expect(cyclePhasesOf(undefined)).toBeNull();
    expect(cyclePhasesOf([calc('Setup Cost', 3, 'USD', '{A} + {B}')])).toBeNull();
    expect(cyclePhasesOf([input('Press Dry Cycle Time', 1, 's'), calc('Cycle Time', 1, 's', '{Press Dry Cycle Time} * {Factor}')])).toBeNull();
  });

  it('skips a part with no numeric value rather than showing zero', () => {
    const steps = injection.map((s) => (s.fieldName === 'Pack Time' ? { ...s, value: null } : s));
    expect(cyclePhasesOf(steps)!.map((p) => p.name)).toEqual(['Fill Time', 'Cooling Time', 'Press Dry Cycle Time']);
  });
});
