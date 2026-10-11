import { pickerRateUsdPerHour } from '../../../modules/mhr/dto/mhr-response.dto';

// The picker's rate follows findAll()'s order: stored USD rate, then a manual
// entry, then the stored total. A row with none is priced on selection (null).
describe('pickerRateUsdPerHour', () => {
  const row = { mhr_usd_per_hour: null, total_machine_hour_rate: null, manual_mhr_value: null, is_manual_entry: false };

  it.each([
    ['stored USD rate wins', { ...row, mhr_usd_per_hour: '42.5', total_machine_hour_rate: 99 }, 42.5],
    ['manual entry next', { ...row, is_manual_entry: true, manual_mhr_value: '18', total_machine_hour_rate: 99 }, 18],
    ['stored total last', { ...row, total_machine_hour_rate: '9.55' }, 9.55],
    ['manual value ignored unless the row is a manual entry', { ...row, manual_mhr_value: 18, total_machine_hour_rate: 7 }, 7],
    ['no stored rate: priced on selection', row, null],
    ['zero total is no rate', { ...row, total_machine_hour_rate: 0 }, null],
  ])('%s', (_name, input, expected) => {
    expect(pickerRateUsdPerHour(input)).toBe(expected);
  });
});
