import { describe, expect, it } from 'vitest';

import { rowFacts } from '@/lib/bom/row-summary';

describe("a BOM row's details in one line", () => {
  it('lists the material, quantity and unit, make or buy, level, weight, annual volume and description in reading order', () => {
    expect(
      rowFacts(
        {
          material: 'Steel', materialGrade: 'AISI 1018', quantity: 2, unit: 'pcs', makeBuy: 'make',
          weight: 0.1254, annualVolume: 10000, description: 'Lead nut housing',
        },
        'L2',
      ),
    ).toEqual(['AISI 1018', 'Qty 2 pcs', 'Make', 'L2', '0.125 kg', `${(10000).toLocaleString()}/yr`, 'Lead nut housing']);
  });

  it('leaves out what is not set, and shows the material when there is no grade', () => {
    expect(rowFacts({ material: 'ABS', quantity: 1, makeBuy: 'buy', weight: 0, annualVolume: null, description: '  ' }, 'L1')).toEqual([
      'ABS', 'Qty 1', 'Buy', 'L1',
    ]);
    expect(rowFacts({ materialGrade: ' ', material: undefined }, 'L0')).toEqual(['Make', 'L0']);
  });
});
