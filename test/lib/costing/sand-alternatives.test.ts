import { describe, expect, it } from 'vitest';

import { alternativeRows, type SandRouteAlternative } from '@/lib/costing/sand-alternatives';

const alt = (over: Partial<SandRouteAlternative>): SandRouteAlternative => ({
  mouldingProcess: 'Horizontal Automatic', mouldingMachine: 'M1', chosen: false, cavities: 2, totalCost: 10, complete: true, reason: null, ...over,
});

describe('the moulding machines compared', () => {
  it('shows how much dearer each is than the chosen one, in amount and percent', () => {
    const rows = alternativeRows([alt({ chosen: true, totalCost: 8, mouldingMachine: 'A' }), alt({ mouldingMachine: 'B', totalCost: 10 })]);
    expect(rows[0]).toMatchObject({ machine: 'A', chosen: true, difference: null });
    expect(rows[1]!.difference).toEqual({ amount: 2, percent: 25 });
  });

  it('gives a machine with no total, or a chosen route with no total, no difference', () => {
    const rows = alternativeRows([alt({ chosen: true, totalCost: null }), alt({ mouldingMachine: 'B', totalCost: 10 }), alt({ mouldingMachine: 'C', totalCost: null, cavities: null, reason: 'C: the part does not fit the flask' })]);
    expect(rows.every((r) => r.difference === null)).toBe(true);
    expect(rows[2]).toMatchObject({ total: null, cavities: null, note: 'C: the part does not fit the flask' });
  });

  it('nothing in, nothing out', () => {
    expect(alternativeRows(undefined)).toEqual([]);
  });
});
