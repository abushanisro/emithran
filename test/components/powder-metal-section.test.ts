import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PowderMetalSection, powderMetalUncostedReason } from '@/components/costing/PowderMetalSection';
import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

type Summary = Pick<CostSummaryDto, 'powderMetal' | 'processLines'>;
const WHY = 'Powder metal cannot be costed: HR Rates has no powder metal machines for India';
// The one uncosted line a powder metal part gets when its route cannot be built (backend powder-metal-cost-summary.ts).
const UNCOSTED = {
  processLines: [{
    process: 'Powder Metal', processGroup: 'Powder Metal', totalCost: 0,
    physicsGap: { gapType: 'unsupported_operation', process: 'Powder Metal', machineClass: 'powder_metal', reason: WHY },
  }],
  powderMetal: undefined,
} as unknown as Summary;
const ROUTE = {
  routeLabel: 'Press and sinter', greenDensityKgM3: 7020, greenDensitySource: 'material', compactionPressureMpa: 551.2, pressForceKn: 291.4,
  fillHeightMm: 47.6, compressionRatio: 2.38, belt: { speedMmPerMin: 101.6, partsAcross: 9, partsPerMetre: 32.8 }, complete: true,
} as NonNullable<CostSummaryDto['powderMetal']>;

const html = (props: { powderMetal: CostSummaryDto['powderMetal']; uncostedReason?: string | null }) =>
  renderToStaticMarkup(createElement(PowderMetalSection, { ...props, greenDensity: null, onChange: () => undefined }));

describe('the Powder Metal section of the Cost Guide', () => {
  it('with no route, says why in its place (the reason on the uncosted Powder Metal line)', () => {
    expect(powderMetalUncostedReason(UNCOSTED)).toBe(WHY);
    const out = html({ powderMetal: undefined, uncostedReason: powderMetalUncostedReason(UNCOSTED) });
    expect(out).toContain(WHY);
    expect(out).not.toContain('Compaction');
  });

  it('with a route, shows what the route makes of the green density, and no reason', () => {
    expect(powderMetalUncostedReason({ ...UNCOSTED, powderMetal: ROUTE })).toBeNull();
    const out = html({ powderMetal: ROUTE, uncostedReason: null });
    expect(out).toContain('placeholder="7020 kg/m³"');
    expect(out).toContain('551.2 MPa · 291 kN');
    expect(out).toContain('101.6 mm/min · 9 across · 32.8 per m');
  });

  it('a line of another process with a gap is not the powder metal reason', () => {
    const other = { powderMetal: undefined, processLines: [{ ...UNCOSTED.processLines[0], processGroup: 'Machining' }] } as unknown as Summary;
    expect(powderMetalUncostedReason(other)).toBeNull();
  });
});
