import { describe, expect, it } from 'vitest';

import { calculatorProcessGroups, OTHER_GROUP, processGroupTabs } from '@/lib/calculators/process-group-tabs';

const calc = (id: string, name: string, processGroups: string[] = [], calcCategory = 'process') => ({ id, name, processGroups, calcCategory });

describe('the Calculators page tabs, one per process group', () => {
  const calculators = [
    calc('a', 'Machining - Drilling', ['Machining', 'Sheet Metal']),
    calc('b', 'Machining - Milling', ['Machining']),
    calc('c', 'Machining - Tool life'), // a helper: goes with the other Machining calculators
    calc('d', 'Rapid Prototyping - Cleaning', ['Rapid Prototyping']),
    calc('e', 'Rapid Prototyping - Feature cleaning'),
    calc('f', 'Press Brake Time Calculator', [], 'sheet_metal'), // no mapping, no family: its category's group
    calc('g', 'Shot Weight Calculator', [], 'tooling'), // nothing to go on: Other
  ];
  const groups = calculatorProcessGroups(calculators);

  it('a mapped calculator is under each process group that uses it', () => {
    expect(groups.get('a')).toEqual(['Machining', 'Sheet Metal']);
    expect(groups.get('d')).toEqual(['Rapid Prototyping']);
  });

  it('a helper is under the group most calculators named like it compute', () => {
    expect(groups.get('c')).toEqual(['Machining']);
    expect(groups.get('e')).toEqual(['Rapid Prototyping']);
  });

  it('one with neither is under its category\'s group, else Other', () => {
    expect(groups.get('f')).toEqual(['Sheet Metal']);
    expect(groups.get('g')).toEqual([OTHER_GROUP]);
  });

  it('the tabs are every group with its count, by name, Other last', () => {
    expect(processGroupTabs(groups)).toEqual([
      { group: 'Machining', count: 3 },
      { group: 'Rapid Prototyping', count: 2 },
      { group: 'Sheet Metal', count: 2 },
      { group: OTHER_GROUP, count: 1 },
    ]);
  });
});
