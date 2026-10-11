import { describe, it, expect } from 'vitest';
import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';
import {
  identityMappings,
  effectiveProcessGroupOf,
  categoryOptionsFrom,
  matchesProcessAndCategory,
  categoryMachineClassesOf,
  calculatorMappingsForMachineClass,
  unambiguousMapping,
  optionsKeepingSelection,
  selectionForMachineClass,
  buildHrRatesIndex,
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

describe('buildHrRatesIndex process groups', () => {
  it('lists every group that really appears, via either column, and omits unknowns', () => {
    const groups = buildHrRatesIndex([
      row({ commodityCode: 'Sheet Metal' }),
      row({ processGroup: 'Machining', commodityCode: undefined }),
      row({ commodityCode: 'Sheet Metal' }),
      row({ processGroup: undefined, commodityCode: undefined }),
    ]).processGroups;
    expect(groups).toEqual(['Machining', 'Sheet Metal']);
  });

  // The displayed group falls back to commodity_code when process_group is empty.
  it('does not lose a group that only ever appears in commodity_code', () => {
    const groups = buildHrRatesIndex([row({ processGroup: undefined, commodityCode: 'Sheet Metal' })]).processGroups;
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

describe('optionsKeepingSelection', () => {
  it('keeps the selected value listed while no loaded row carries it (rows still loading)', () => {
    expect(optionsKeepingSelection([], 'Sheet Metal')).toEqual(['Sheet Metal']);
  });

  it('keeps a saved value the rows no longer have, in sorted position', () => {
    expect(optionsKeepingSelection(['Machining', 'Sheet Metal'], 'Other Secondary Processes'))
      .toEqual(['Machining', 'Other Secondary Processes', 'Sheet Metal']);
  });

  it('adds nothing when the value is already an option or nothing is selected', () => {
    expect(optionsKeepingSelection(['Machining', 'Sheet Metal'], 'Sheet Metal')).toEqual(['Machining', 'Sheet Metal']);
    expect(optionsKeepingSelection(['Machining'], '')).toEqual(['Machining']);
  });
});

describe('selectionForMachineClass', () => {
  // Real USA CMM rows (migration 806): class cmm, group Other Secondary Processes.
  const cmm = (name: string) => row({
    machineClass: 'cmm', processGroup: 'Other Secondary Processes', commodityCode: undefined,
    benchmarkSourceKey: `CMM Inspection:${name}`,
  });
  const rows = [cmm('Axiom Too 1200'), cmm('Axiom Zenith 1000'), row()];

  it('fills Process and Category for a line with no machine from its saved class', () => {
    const cat = mhrCategoryOf(rows[0]!);
    expect(selectionForMachineClass(rows, 'cmm', '')).toEqual({ processGroup: 'Other Secondary Processes', category: cat });
  });

  it('keeps the line Process and fills only the Category', () => {
    expect(selectionForMachineClass(rows, 'cmm', 'Other Secondary Processes').processGroup).toBe('Other Secondary Processes');
  });

  it('names no category when the class spans several', () => {
    const spread = [...rows, row({ machineClass: 'cmm', processGroup: 'Other Secondary Processes', commodityCode: undefined, benchmarkSourceKey: 'Inspection Bench:Granite Table' })];
    expect(selectionForMachineClass(spread, 'cmm', '').category).toBeUndefined();
  });

  it('returns nothing for a class HR Rates has no row of', () => {
    expect(selectionForMachineClass(rows, 'shaver', '')).toEqual({});
  });
});

describe('buildHrRatesIndex', () => {
  const rows = [
    row(),
    row({ machineClass: 'press_brake', benchmarkSourceKey: 'Bend Press Brake:Trumpf TruBend 5130' }),
    row({ machineClass: 'cmm', processGroup: 'Other Secondary Processes', commodityCode: undefined, benchmarkSourceKey: 'CMM Inspection:Axiom Too 1200' }),
  ];
  const index = buildHrRatesIndex(rows);

  it('answers every picker from one pass, matching the row-scan functions', () => {
    expect(index.processGroups).toEqual(['Other Secondary Processes', 'Sheet Metal']);
    expect(index.categoriesOf('Sheet Metal')).toEqual(categoryOptionsFrom(rows, 'Sheet Metal'));
    expect([...index.machineClassesOf('Sheet Metal', 'Bend Press Brake')]).toEqual(['press_brake']);
  });

  it('reads the reverse direction, class to Process and Category', () => {
    expect(index.selectionForMachineClass('cmm', '')).toEqual({ processGroup: 'Other Secondary Processes', category: 'CMM Inspection' });
  });

  it('returns the same object for the same question, so memoized dependents do not re-run', () => {
    expect(index.categoriesOf('Sheet Metal')).toBe(index.categoriesOf('Sheet Metal'));
    expect(index.machineClassesOf('Sheet Metal', 'Bend Press Brake')).toBe(index.machineClassesOf('Sheet Metal', 'Bend Press Brake'));
    expect(index.machineClassesOf('Sheet Metal', 'Unknown')).toBe(index.machineClassesOf('Machining', 'Unknown'));
  });

  it('answers empty, not undefined, for an unknown group or category', () => {
    expect(index.categoriesOf('Unknown')).toEqual([]);
    expect(index.machineClassesOf('Unknown', 'x').size).toBe(0);
  });
});

describe('identityMappings (the route and operation a line saves as)', () => {
  // Live catalog 2026-10-09: Black Oxide's only row is inactive (no calculator wired).
  const blackOxide = { processRoute: 'Black Oxide', operation: 'Black Oxide', isActive: false };

  it('a class whose only row has no calculator still has its route', () => {
    expect(identityMappings([blackOxide])).toEqual([blackOxide]);
  });

  it('active rows win over deactivated duplicates', () => {
    const laser = { processRoute: 'Laser Cutting', operation: 'Laser Cut', isActive: true };
    expect(identityMappings([laser, { processRoute: 'Sheet Cutting', operation: 'Co2 Laser Cutting', isActive: false }])).toEqual([laser]);
  });
});
