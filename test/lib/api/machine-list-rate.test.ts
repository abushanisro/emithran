import { describe, expect, it } from 'vitest';

import { machineListRateUsd, type MHRPickerRow, type MHRRecord } from '@/lib/api/mhr';

describe('machineListRateUsd', () => {
  it('a slim picker row carries its real rate', () => {
    const row: MHRPickerRow = { id: 'p', machineName: 'Bend Brake-800kN', location: 'USA', commodityCode: null, mhrUsdPerHour: 18.45 };
    expect(machineListRateUsd(row)).toBe(18.45);
  });

  it('the injected saved machine (a full record) uses the full rate rule', () => {
    const full = { id: 'f', machineName: 'Saved', mhrUsdPerHour: undefined, calculations: { totalMachineHourRate: 9.55 } } as unknown as MHRRecord;
    expect(machineListRateUsd(full)).toBe(9.55);
  });
});
