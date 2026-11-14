import { describe, expect, it } from 'vitest';

import { isCompleteRouteFamily } from '@/lib/routing/complete-route-family';

// The Workflow Builder lists complete routes (each a full quote) for these families; sheet metal has its own cut-then-form builder.
describe('isCompleteRouteFamily', () => {
  it.each(['plastic_molded', 'milled', 'turned', 'mill_turn', 'die_cast', 'sand_cast'])('%s lists complete routes', (family) => {
    expect(isCompleteRouteFamily(family)).toBe(true);
  });
  it.each(['sheet_metal', 'investment_cast', '', null])('%s does not', (family) => {
    expect(isCompleteRouteFamily(family)).toBe(false);
  });
});
