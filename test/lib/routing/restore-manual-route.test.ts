import { describe, expect, it } from 'vitest';

import { restoredManualRouteId } from '@/lib/routing/restore-manual-route';

const lines = [{ notes: 'auto_fill_from_route:turret_punch' }, { notes: 'auto_fill_from_route:turret_punch' }];
const offered = ['fiber_laser', 'turret_punch', 'waterjet'];

describe('restoredManualRouteId', () => {
  it('the reported bug: a plain manual pick survives a reload', () => {
    expect(restoredManualRouteId(lines, 'manual', offered)).toBe('turret_punch');
  });
  it('the same lines in Auto mode are not a manual pick', () => {
    expect(restoredManualRouteId(lines, 'auto', offered)).toBeNull();
    expect(restoredManualRouteId(lines, undefined, offered)).toBeNull();
  });
  it('a route no longer offered is not restored (never guessed)', () => {
    expect(restoredManualRouteId(lines, 'manual', ['fiber_laser'])).toBeNull();
  });
  it('custom-route lines are not handled here', () => {
    expect(restoredManualRouteId([{ notes: 'auto_fill_from_custom_route:abc' }], 'manual', offered)).toBeNull();
  });
  it('no saved lines -> nothing to restore', () => {
    expect(restoredManualRouteId([], 'manual', offered)).toBeNull();
  });
});
