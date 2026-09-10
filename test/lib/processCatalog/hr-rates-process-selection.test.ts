import { describe, it, expect } from 'vitest';
import {
  effectiveProcessGroupOf,
  processGroupOptionsFrom,
  categoryOptionsFrom,
  matchesProcessAndCategory,
  categoryMachineClassesOf,
  benchmarkMatchesCategory,
  calculatorMappingsForMachineClass,
  unambiguousMapping,
} from '@/lib/processCatalog/hr-rates-process-selection';

// A real mhr_records row: process_group is often unset and the group lives in
// commodity_code; the human category comes from benchmark_source_key.
function row(overrides: Record<string, unknown> = {}) {
  return {
    machineClass: 'roll_bending_3',
    benchmarkSourceKey: '3 Roll Bender:Faccin HCU 300 X 1',
    processGroup: undefined,
    commodityCode: 'Sheet Metal',
    ...overrides,
  };
}

// An mhr_benchmark_rates row: machine_class only, no benchmark_source_key.
function benchmarkRow(machineClass: string) {
  return { machineClass, benchmarkSourceKey: undefined, processGroup: 'Sheet Metal' };
}

describe('effectiveProcessGroupOf', () => {
  it('falls back to commodity_code, which is where the group lives on most real rows', () => {
    expect(effectiveProcessGroupOf(row({ processGroup: undefined, commodityCode: 'Sheet Metal' })))
      .toBe('Sheet Metal');
  });

  it('prefers a real process_group when the row has one', () => {
    expect(effectiveProcessGroupOf(row({ processGroup: 'Machining', commodityCode: 'Sheet Metal' })))
      .toBe('Machining');
  });

  it('reports "-" only when the row genuinely states neither', () => {
    expect(effectiveProcessGroupOf({ processGroup: undefined, commodityCode: undefined })).toBe('-');
  });
});

describe('processGroupOptionsFrom', () => {
  it('lists every group that really appears, via either column, and omits unknowns', () => {
    const groups = processGroupOptionsFrom([
      row({ commodityCode: 'Sheet Metal' }),
      row({ processGroup: 'Machining', commodityCode: undefined }),
      row({ commodityCode: 'Sheet Metal' }),
      row({ processGroup: undefined, commodityCode: undefined }),
    ]);
    expect(groups).toEqual(['Machining', 'Sheet Metal']);
  });

  // This is the bug the /mhr/process-groups endpoint has: it reads only the raw
  // process_group column, so a commodity-code-only group is invisible to it.
  it('does not lose a group that only ever appears in commodity_code', () => {
    const groups = processGroupOptionsFrom([row({ processGroup: undefined, commodityCode: 'Sheet Metal' })]);
    expect(groups).toEqual(['Sheet Metal']);
  });
});

describe('categoryOptionsFrom', () => {
  it('lists the real categories within one group only', () => {
    const cats = categoryOptionsFrom(
      [
        row({ benchmarkSourceKey: '3 Roll Bender:A' }),
        row({ benchmarkSourceKey: '2 Roll Bender:B' }),
        row({ benchmarkSourceKey: 'Wire EDM:C', processGroup: 'Machining', commodityCode: undefined }),
      ],
      'Sheet Metal',
    );
    expect(cats).toEqual(['2 Roll Bender', '3 Roll Bender']);
  });

  it('returns nothing until a group is chosen, rather than every category on file', () => {
    expect(categoryOptionsFrom([row()], '')).toEqual([]);
  });
});

describe('matchesProcessAndCategory', () => {
  it('matches a row in the chosen process and category', () => {
    expect(matchesProcessAndCategory(row(), 'Sheet Metal', '3 Roll Bender')).toBe(true);
  });

  it('rejects a different category', () => {
    expect(matchesProcessAndCategory(row(), 'Sheet Metal', '2 Roll Bender')).toBe(false);
  });

  // Category names are not globally unique — "Inspection" exists under more
  // than one process group — so category alone would leak across groups.
  it('rejects a same-named category belonging to another process group', () => {
    const machiningInspection = row({
      benchmarkSourceKey: 'Inspection:CMM-1',
      processGroup: 'Machining',
      commodityCode: undefined,
    });
    expect(matchesProcessAndCategory(machiningInspection, 'Machining', 'Inspection')).toBe(true);
    expect(matchesProcessAndCategory(machiningInspection, 'Post Processing', 'Inspection')).toBe(false);
  });

  it('still matches a row whose group is only in commodity_code', () => {
    expect(
      matchesProcessAndCategory(
        row({ processGroup: undefined, commodityCode: 'Sheet Metal' }),
        'Sheet Metal',
        '3 Roll Bender',
      ),
    ).toBe(true);
  });
});

describe('categoryMachineClassesOf', () => {
  it('reads the classes off the rows in the category, not from its name', () => {
    const classes = categoryMachineClassesOf(
      [
        row({ machineClass: 'roll_bending_3' }),
        row({ machineClass: 'roll_bending_3' }),
        row({ machineClass: 'roll_bending_2', benchmarkSourceKey: '2 Roll Bender:X' }),
      ],
      'Sheet Metal',
      '3 Roll Bender',
    );
    expect([...classes]).toEqual(['roll_bending_3']);
  });

  // migration 569 maps several real categories onto one class, so a category
  // spanning more than one class is normal and must not be collapsed.
  it('keeps every class a category legitimately spans', () => {
    const classes = categoryMachineClassesOf(
      [
        row({ machineClass: 'fiber_laser', benchmarkSourceKey: 'Laser Cutting Machine:A' }),
        row({ machineClass: 'co2_laser', benchmarkSourceKey: 'Laser Cutting Machine:B' }),
      ],
      'Sheet Metal',
      'Laser Cutting Machine',
    );
    expect([...classes].sort()).toEqual(['co2_laser', 'fiber_laser']);
  });

  it('is empty before a category is chosen', () => {
    expect(categoryMachineClassesOf([row()], 'Sheet Metal', '').size).toBe(0);
  });
});

describe('benchmarkMatchesCategory', () => {
  // Benchmark rows have no benchmark_source_key, so resolving their category by
  // name gives "Roll Bending 3" and matches nothing — every benchmark machine
  // would vanish from the dropdown.
  it('matches a benchmark row on the classes the category resolves to', () => {
    const classes = new Set(['roll_bending_3']);
    expect(benchmarkMatchesCategory(benchmarkRow('roll_bending_3'), classes)).toBe(true);
    expect(benchmarkMatchesCategory(benchmarkRow('roll_bending_2'), classes)).toBe(false);
  });

  it('matches nothing when the category resolves to no class at all', () => {
    expect(benchmarkMatchesCategory(benchmarkRow('roll_bending_3'), new Set())).toBe(false);
  });

  it('never matches a benchmark row carrying no class', () => {
    expect(benchmarkMatchesCategory({ machineClass: undefined }, new Set(['roll_bending_3']))).toBe(false);
  });
});

describe('calculator resolution by machine class', () => {
  const bendBrake = { machineClass: 'press_brake', operation: 'Bend Brake', lhrProcessGroup: 'Sheet Metal' };
  const progDie = { machineClass: 'press_brake', operation: 'Progressive Die Press', lhrProcessGroup: 'Sheet Metal' };
  const rollBend = { machineClass: 'roll_bending_3', operation: '3 Roll Bending', lhrProcessGroup: 'Sheet Metal' };

  it('joins on machine_class, a real column on both tables', () => {
    expect(calculatorMappingsForMachineClass([bendBrake, progDie, rollBend], 'roll_bending_3'))
      .toEqual([rollBend]);
  });

  it('returns nothing for an unresolved class instead of everything', () => {
    expect(calculatorMappingsForMachineClass([bendBrake, rollBend], '')).toEqual([]);
  });

  it('resolves a single match to that one authoritative row', () => {
    expect(unambiguousMapping([rollBend])).toBe(rollBend);
  });

  // press_brake covers both bending and progressive-die stamping, priced by
  // genuinely different formulas — picking one silently would mis-cost the part.
  it('refuses to pick one when the class maps to several operations', () => {
    expect(unambiguousMapping([bendBrake, progDie])).toBeUndefined();
  });

  it('resolves nothing from an empty match set', () => {
    expect(unambiguousMapping([])).toBeUndefined();
  });
});
