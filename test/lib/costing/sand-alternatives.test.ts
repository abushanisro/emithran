import { describe, expect, it } from 'vitest';

import { alternativeRows, type SandRouteAlternative } from '@/lib/costing/sand-alternatives';

const alt = (over: Partial<SandRouteAlternative>): SandRouteAlternative => ({
  mouldingProcess: 'Horizontal Automatic', mouldingMachine: 'M1', chosen: false, cavities: 2, totalCost: 10, complete: true, ...over,
});

describe('the moulding machines compared', () => {
  it('shows how much dearer each is than the chosen one, in amount and percent', () => {
    const rows = alternativeRows([alt({ chosen: true, totalCost: 8, mouldingMachine: 'A' }), alt({ mouldingMachine: 'B', totalCost: 10 })]);
    expect(rows[0]).toMatchObject({ machine: 'A', chosen: true, difference: null });
    expect(rows[1]!.difference).toEqual({ amount: 2, percent: 25 });
  });

  it('a chosen route with no total (incomplete) gives the others no difference', () => {
    const rows = alternativeRows([alt({ chosen: true, totalCost: null, complete: false }), alt({ mouldingMachine: 'B', totalCost: 10 })]);
    expect(rows.every((r) => r.difference === null)).toBe(true);
  });

  it('nothing in, nothing out', () => {
    expect(alternativeRows(undefined)).toEqual([]);
  });
});
