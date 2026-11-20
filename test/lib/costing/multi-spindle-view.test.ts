import { describe, expect, it } from 'vitest';

import {
  barLine, isMultiSpindleItem, lengthPerPartLine, multiSpindleRouteOf, type MultiSpindleSummary,
} from '@/lib/costing/multi-spindle-view';
import { isCostedProcessGroup, processGroupOptionLabel, processGroupToFamilyHint } from '@/lib/features/process-group';
import { multiShotRouteKeyOf } from '@/lib/routing/multi-shot-route-id';
import { multiSpindleRouteKeyOf } from '@/lib/routing/multi-spindle-route-id';

// The 5/8" bar of a Ø14 x 32 mm part in USA (backend multi-spindle-stock.ts selectBar).
const bar: MultiSpindleSummary['bar'] = {
  form: 'round', sizeMm: 15.875, sizeLabel: '5/8" round bar', unitSystem: 'US', snapped: true, requiredMm: 15.624, allowancePerSideMm: 0.794,
  partingWidthMm: 2.5, facingStockMm: 0.794, lengthPerPartMm: 35.296, barLengthMm: 4500, remnantMm: 152.4,
};

describe('a Multi-Spindle Machining part', () => {
  it('is the part whose Process is Multi-Spindle Machining, a costed process analysed as a turned part', () => {
    expect(isMultiSpindleItem({ scenarioOverrides: { processGroup: 'Multi-Spindle Machining' } })).toBe(true);
    expect(isMultiSpindleItem({ scenarioOverrides: { processGroup: 'Machining' } })).toBe(false);
    expect(isMultiSpindleItem(null)).toBe(false);
    expect(isCostedProcessGroup('Multi-Spindle Machining')).toBe(true);
    expect(processGroupOptionLabel('Multi-Spindle Machining')).toBe('Multi-Spindle Machining');
    expect(processGroupToFamilyHint('Multi-Spindle Machining')).toBe('turned');
  });

  it('reads the route set in the Cost Guide (none: the engine quotes the cheapest)', () => {
    expect(multiSpindleRouteOf({ multiSpindleRoute: 'twin' })).toBe('twin');
    expect(multiSpindleRouteOf({ multiSpindleRoute: '' })).toBeNull();
    expect(multiSpindleRouteOf(null)).toBeNull();
  });

  it('says the bar and what each part takes of it as an engineer reads them', () => {
    expect(barLine(bar)).toBe('5/8" round bar · needs 15.62 mm');
    expect(barLine({ ...bar, form: 'hex', sizeLabel: '21 mm hex bar', requiredMm: 21, snapped: false })).toBe('21 mm hex bar · needs 21 mm (as supplied)');
    expect(lengthPerPartLine(bar)).toBe('35.30 mm (parting 2.50 mm, facing 0.79 mm)');
  });
});

describe('the multi-spindle routes', () => {
  it('ids round-trip to the scenario key, and are not multi-shot\'s (ms-)', () => {
    expect(multiSpindleRouteKeyOf('multispindle-6')).toBe('6');
    expect(multiSpindleRouteKeyOf('multispindle-twin')).toBe('twin');
    expect(multiSpindleRouteKeyOf('multispindle-')).toBeUndefined();
    expect(multiSpindleRouteKeyOf('ms-horizontal')).toBeUndefined();
    expect(multiShotRouteKeyOf('multispindle-8')).toBeUndefined();
  });
});
