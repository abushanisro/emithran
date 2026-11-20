import { describe, expect, it } from 'vitest';

import { machineDisplayLabel, NO_COST_FEATURE } from '@/lib/features/display-format';

describe('machineDisplayLabel', () => {
  it('a saved No Cost Feature says it was not costed, never that it is a manually rated operation', () => {
    expect(machineDisplayLabel({ processRoute: NO_COST_FEATURE, machineName: null, mhrId: null })).toBe('Not costed — No Cost Feature');
  });

  it('otherwise the machine, else what is true about it', () => {
    expect(machineDisplayLabel({ machineName: 'BLIN HDS-J150', processRoute: 'Cutting' })).toBe('BLIN HDS-J150');
    expect(machineDisplayLabel({ mhrId: 'm1' })).toBe('Machine name unavailable');
    expect(machineDisplayLabel({})).toBe('Manual rate — not linked to a machine');
  });
});
