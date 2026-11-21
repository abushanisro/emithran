import { describe, expect, it } from 'vitest';

import { hydroformRouteOf, intensifierOf, isHydroformingItem, partsPerTrayOf, ruleLine, trayLine } from '@/lib/costing/hydroforming-view';
import { hydroformingRouteKeyOf } from '@/lib/routing/hydroforming-route-id';

describe('the Sheet Metal - Hydroforming Cost Guide', () => {
  it('is the panel of a part whose Process is Sheet Metal - Hydroforming, not of a plain sheet-metal part', () => {
    expect(isHydroformingItem({ scenarioOverrides: { processGroup: 'Sheet Metal - Hydroforming' } })).toBe(true);
    expect(isHydroformingItem({ scenarioOverrides: { processGroup: 'Sheet Metal' } })).toBe(false);
    expect(isHydroformingItem(null)).toBe(false);
  });

  it('reads the route set in the Cost Guide, and nothing else as one', () => {
    expect(hydroformRouteOf({ hydroformRoute: 'fluid-cell' })).toBe('fluid-cell');
    expect(hydroformRouteOf({ hydroformRoute: 'laser' })).toBeNull();
    expect(hydroformRouteOf(undefined)).toBeNull();
  });

  it('reads parts per tray as the engine does: a whole number of at least 1, else the data\'s default', () => {
    expect(partsPerTrayOf({ hydroformPartsPerTray: 4 })).toBe(4);
    expect(partsPerTrayOf({ hydroformPartsPerTray: '2.7' })).toBe(2);
    expect(partsPerTrayOf({ hydroformPartsPerTray: 0 })).toBeNull();
    expect(partsPerTrayOf({ hydroformPartsPerTray: '' })).toBeNull();
    expect(partsPerTrayOf({})).toBeNull();
  });

  it('includes the intensifier only when set', () => {
    expect(intensifierOf({ hydroformIntensifier: true })).toBe(true);
    expect(intensifierOf({ hydroformIntensifier: 'true' })).toBe(true);
    expect(intensifierOf({ hydroformIntensifier: null })).toBe(false);
  });

  it('states memory\'s rule and the tray as an engineer reads them', () => {
    expect(ruleLine({ route: 'deep-draw', ratio: 0.75, depthMm: 60, widthMm: 80, threshold: 0.65, basis: 'drawn form' })).toBe('depth / width 60 / 80 = 0.75 ≥ 0.65 → Hydroform Deep Draw');
    expect(ruleLine({ route: 'fluid-cell', ratio: 0.215, depthMm: 21.5, widthMm: 100, threshold: 0.65, basis: 'part' })).toBe('depth / width 21.5 / 100 = 0.21 < 0.65 → Hydroform Fluid Cell');
    expect(trayLine({ value: 3, requested: 4, max: 3 })).toBe('3 per cycle (4 asked, 3 fit the tray; the tray holds 3)');
    expect(trayLine({ value: 1, requested: null, max: 3 })).toBe("1 per cycle (the data's default; the tray holds 3)");
  });

  it('reads a hydroforming route id as its key, any other route as none', () => {
    expect(hydroformingRouteKeyOf('hydroform-deep-draw')).toBe('deep-draw');
    expect(hydroformingRouteKeyOf('hydroform-')).toBeUndefined();
    expect(hydroformingRouteKeyOf('roto-blow-blow')).toBeUndefined();
  });
});
