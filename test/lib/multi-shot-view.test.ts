import { describe, expect, it } from 'vitest';

import { isMultiShotItem, shotEntriesOf, shotEntriesPatch, shotEntriesProblem } from '@/lib/costing/multi-shot-view';
import { isCostedProcessGroup } from '@/lib/features/process-group';
import { moldingRouteSelectability } from '@/lib/routing/molding-route-selectability';
import { multiShotRouteKeyOf } from '@/lib/routing/multi-shot-route-id';

describe('the multi-shot Cost Guide', () => {
  it('is the part whose Process is Assembly Plastic Molding, a costed process', () => {
    expect(isMultiShotItem({ scenarioOverrides: { processGroup: 'Assembly Plastic Molding' } })).toBe(true);
    expect(isMultiShotItem({ scenarioOverrides: { processGroup: 'Assembly Molding' } })).toBe(false);
    expect(isCostedProcessGroup('Assembly Plastic Molding')).toBe(true);
  });

  it('reads the extra shots as the backend does, and writes them (or clears them)', () => {
    expect(shotEntriesOf({ multiShotShots: [{ grade: 'Generic TPE', volumePct: 30 }, { grade: '', volumePct: 10 }, { grade: 'ABS', volumePct: 100 }] }))
      .toEqual([{ grade: 'Generic TPE', volumePct: 30 }]);
    expect(shotEntriesPatch([{ grade: 'Generic TPE', volumePct: 30 }])).toEqual({ multiShotShots: [{ grade: 'Generic TPE', volumePct: 30 }] });
    expect(shotEntriesPatch([])).toEqual({ multiShotShots: null });
  });

  it('says why the shots cannot be saved: a material each, a share of the part, room left for the first shot', () => {
    expect(shotEntriesProblem([{ grade: 'Generic TPE', volumePct: 30 }])).toBeNull();
    expect(shotEntriesProblem([{ grade: '', volumePct: 30 }])).toBe('Pick a material for every shot.');
    expect(shotEntriesProblem([{ grade: 'A', volumePct: 0 }])).toMatch(/between 0 and 100/);
    expect(shotEntriesProblem([{ grade: 'A', volumePct: 60 }, { grade: 'B', volumePct: 40 }])).toMatch(/take 100 % of the part/);
  });
});

describe('the multi-shot routes', () => {
  it('ids round-trip to the scenario key, and are routes the Workflow Builder can set', () => {
    expect(multiShotRouteKeyOf('ms-horizontal')).toBe('horizontal');
    expect(multiShotRouteKeyOf('im-insert-manual')).toBeUndefined();
    const route = { routeId: 'ms-vertical', isFeasible: true, warnings: [], capability: { warnings: [] }, compatibility: undefined } as never;
    expect(moldingRouteSelectability(route)).toEqual({ selectable: true, note: 'Multi-shot molding on this press orientation: the Cost tab quotes it once it is applied.' });
  });
});
