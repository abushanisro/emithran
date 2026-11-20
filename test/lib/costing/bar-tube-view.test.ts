import { describe, expect, it } from 'vitest';

import { barTubeRouteOf, sectionLabel, stockFormLabel, toolKeyLabel } from '@/lib/costing/bar-tube-view';
import { barTubeRouteKeyOf } from '@/lib/routing/bar-tube-route-id';

describe('the bar and tube panel', () => {
  it('reads the route set in the Cost Guide, else none (the engine quotes the cheapest)', () => {
    expect(barTubeRouteOf({ barTubeRoute: 'laser' })).toBe('laser');
    expect(barTubeRouteOf({})).toBeNull();
    expect(barTubeRouteOf(null)).toBeNull();
  });

  it('names the stock as an engineer reads it', () => {
    expect(stockFormLabel('ROUND_TUBE')).toBe('Round tube');
    expect(sectionLabel({ stockForm: 'ROUND_TUBE', sectionWidthMm: 25, sectionHeightMm: 25, wallMm: 1.5 })).toBe('Ø25 x 1.5 mm');
    expect(sectionLabel({ stockForm: 'RECTANGULAR_BAR', sectionWidthMm: 50, sectionHeightMm: 6, wallMm: null })).toBe('50 x 6 mm');
    expect(sectionLabel({ stockForm: 'SQUARE_TUBE', sectionWidthMm: 40, sectionHeightMm: 40, wallMm: 2 })).toBe('40 x 40 x 2 mm');
  });

  it('spells a rotary draw tool key out (bending_difficulty_factor: letter = wiper, digit = mandrel pitch)', () => {
    expect(toolKeyLabel('A0')).toBe('A0: no wiper, no mandrel');
    expect(toolKeyLabel('B1')).toBe('B1: standard mandrel and wiper, regular pitch mandrel');
    expect(toolKeyLabel('C7')).toBe('C7: high pressure mandrel and wiper, double close pitch mandrel');
    expect(toolKeyLabel(null)).toBeNull();
  });

  it('a Workflow Builder route id gives its route key; another family\'s id gives none', () => {
    expect(barTubeRouteKeyOf('bar-tube-saw')).toBe('saw');
    expect(barTubeRouteKeyOf('bar-tube-plate_laser')).toBe('plate_laser');
    expect(barTubeRouteKeyOf('additive-printing')).toBeUndefined();
    expect(barTubeRouteKeyOf('bar-tube-')).toBeUndefined();
  });
});
