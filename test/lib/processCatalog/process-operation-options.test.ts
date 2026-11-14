import { describe, expect, it } from 'vitest';

import { processOperationOptions } from '@/lib/processCatalog/process-operation-options';

const row = (processRoute: string, operation: string, extra: object = {}) => ({ processGroup: 'Machining', processRoute, operation, machineClass: 'x', isActive: true, ...extra });

describe('processOperationOptions: the Process and Operation lists for adding an operation by hand', () => {
  const rows = [
    row('Broach', 'Keyway Broaching'), row('Broach', 'Broach'),
    row('3 Axis Mill', 'Tapping'), row('3 Axis Mill', 'Drilling'), row('3 Axis Mill', '3 Axis Mill'),
    row('Laser Cutting', 'Laser Cutting', { processGroup: 'Sheet Metal' }),
    row('Shaper', 'Shaper', { isActive: false }),
    row('No Cost Feature', 'No Cost Feature', { machineClass: null }),
  ];
  const options = processOperationOptions(rows, 'Machining');

  it('lists every process of the group once, by name, and none of another group, inactive, or with no machine', () => {
    expect(options.map((o) => o.process)).toEqual(['3 Axis Mill', 'Broach']);
  });

  it('gives each process its own line first, then its operations by name', () => {
    expect(options[0]?.operations.map((o) => o.operation)).toEqual(['3 Axis Mill', 'Drilling', 'Tapping']);
    expect(options[1]?.operations.map((o) => o.operation)).toEqual(['Broach', 'Keyway Broaching']);
  });

  it('lists an operation once when the catalog holds it on several machine classes', () => {
    const twice = processOperationOptions([row('Tapping', 'Tapping', { machineClass: 'a' }), row('Tapping', 'Tapping', { machineClass: 'b' })], 'Machining');
    expect(twice[0]?.operations).toHaveLength(1);
  });
});
