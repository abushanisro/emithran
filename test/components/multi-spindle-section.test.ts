import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MultiSpindleSection } from '@/components/costing/MultiSpindleSection';
import type { MultiSpindleSummary } from '@/lib/costing/multi-spindle-view';

// The Lead Screw side shaft (Ø14 x 32 mm, steel) in USA as the engine quoted it: 6-spindle on the DMG Mori GMC25ISM-6, 5/8" bar.
const MS: MultiSpindleSummary = {
  route: '6', routeLabel: '6-spindle multi-spindle', machineName: 'DMG Mori GMC25ISM-6', spindles: 6, cycleSec: 8.5, indexSec: 5.7,
  stations: [
    { spindle: 1, backWork: false, seconds: 1.78, slowest: false, operations: [{ name: 'Finish Turning', slide: 'od', seconds: 1.78 }] },
    { spindle: 2, backWork: false, seconds: 0, slowest: false, operations: [] },
    { spindle: 5, backWork: false, seconds: 2.8, slowest: true, operations: [{ name: 'Parting', slide: 'od', seconds: 2.8 }] },
    { spindle: 6, backWork: true, seconds: 1, slowest: false, operations: [] },
  ],
  splits: ['Rough Turning split over 2 stations: ring removed volume / total removed volume = 0.90, at least 0.22 (tblMultiSpindleOpSplitting, 6 spindles)'],
  bar: {
    form: 'round', sizeMm: 15.875, sizeLabel: '5/8" round bar', unitSystem: 'US', snapped: true, requiredMm: 15.624, allowancePerSideMm: 0.794,
    partingWidthMm: 2.5, facingStockMm: 0.794, lengthPerPartMm: 35.296, barLengthMm: 4500, remnantMm: 152.4,
  },
  partsPerBar: 123, materialMassKg: 0.057, partMassKg: 0.021, stockPricePerKg: 1.473, stockMissing: null, complete: true,
  options: [
    { route: '6', label: '6-spindle multi-spindle', complete: true, totalCost: 6.77, reason: null },
    { route: '8', label: '8-spindle multi-spindle', complete: true, totalCost: 6.99, reason: null },
    { route: 'twin', label: 'Twin-spindle turning center', complete: false, totalCost: null, reason: 'no Simultaneous Turning machine fits (HAAS DS-30Y: takes bar up to Ø76 mm)' },
  ],
};
const panel = (overrides: Record<string, unknown> = {}, ms: MultiSpindleSummary | null = MS) =>
  renderToStaticMarkup(createElement(MultiSpindleSection, { multiSpindle: ms, overrides, onChange: () => undefined }));

describe('the Multi-Spindle Machining section of the Cost Guide', () => {
  it('shows the bar (inch sizes in USA), what each part takes of it, and the routes with their totals', () => {
    const out = panel();
    expect(out).toContain('Auto (cheapest: 6-spindle multi-spindle)');
    expect(out).toContain('5/8&quot; round bar · needs 15.62 mm');
    expect(out).toContain('Inch sizes (USA)');
    expect(out).toContain('123 parts per 4500 mm bar, 152.4 mm remnant left in the feeder');
    expect(out).toContain('0.057 kg of bar for a 0.021 kg part');
    expect(out).toContain('1.473 USD/kg');
    expect(out).toContain('8-spindle multi-spindle · 6.99');
    expect(out).toContain('Twin-spindle turning center · not costed');
    expect(out).toContain('takes bar up to Ø76 mm');
  });

  it('a route set here is the select\'s value', () => {
    expect(panel({ multiSpindleRoute: 'twin' })).toContain('<option value="twin" selected="">');
  });

  it('says so when the part is not costed on a multi-spindle', () => {
    expect(panel({}, null)).toContain('Not costed on a multi-spindle yet');
  });
});
