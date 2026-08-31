// Regression test for read-time economics resolution (Phase 1, "Machine
// Economics" initiative) — MHRResponseDto.fromDatabase() must resolve
// direct/indirect overhead + labor rate via resolveMachineEconomics() so
// records saved BEFORE this initiative (real value present but no source
// tag, or genuinely blank with a benchmark now on file) display correctly
// without requiring a re-save. See economics-resolver.spec.ts for the
// resolver's own tier-priority tests — this file only checks the DTO wiring.
import { MHRResponseDto } from './mhr-response.dto';

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'id-1', user_id: 'user-1', location: 'USA', commodity_code: 'Sheet Metal',
    machine_name: 'Test Machine', shifts_per_day: '3', hours_per_shift: '8',
    working_days_per_year: '260', planned_maintenance_hours_per_year: '0',
    capacity_utilization_rate: '85', landed_machine_cost: '50000',
    accessories_cost_percentage: '8', installation_cost_percentage: '20',
    payback_period_years: '10', interest_rate_percentage: '5.5',
    insurance_rate_percentage: '1.5', machine_footprint_sqm: '10',
    rent_per_sqm_per_month: '15', maintenance_cost_percentage: '7',
    power_kwh_per_hour: '10', electricity_cost_per_kwh: '0.12',
    admin_overhead_percentage: '12', profit_margin_percentage: '15',
    direct_overhead_rate: null, direct_overhead_source: null,
    indirect_overhead_rate: null, indirect_overhead_source: null,
    usd_lhr_total: null, labor_rate_source: null,
    benchmark_direct_overhead_rate_usd_hr: null,
    benchmark_indirect_overhead_rate_usd_hr: null,
    benchmark_labor_rate_usd_hr: null,
    calculations: '{}', created_at: '2026-01-01', updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('MHRResponseDto.fromDatabase — read-time economics resolution', () => {
  it('a pre-initiative row with a real value but no source tag resolves to imported, not blank', () => {
    const dto = MHRResponseDto.fromDatabase(dbRow({ direct_overhead_rate: '19.60' }));
    expect(dto.directOverheadRate).toBe(19.6);
    expect(dto.directOverheadSource).toBe('imported');
  });

  it('a blank field with a benchmark on file shows the benchmark value, tagged benchmark', () => {
    const dto = MHRResponseDto.fromDatabase(dbRow({ benchmark_indirect_overhead_rate_usd_hr: '8.40' }));
    expect(dto.indirectOverheadRate).toBe(8.4);
    expect(dto.indirectOverheadSource).toBe('benchmark');
  });

  it('a blank field with no benchmark renders as undefined ("-" in the UI), not a misleading $0.00', () => {
    const dto = MHRResponseDto.fromDatabase(dbRow());
    expect(dto.usdLhrTotal).toBeUndefined();
    expect(dto.laborRateSource).toBe('no_rate');
  });

  it('an explicit shop_override value is never masked by a benchmark on the same row', () => {
    const dto = MHRResponseDto.fromDatabase(dbRow({
      usd_lhr_total: '2.16', labor_rate_source: 'shop_override',
      benchmark_labor_rate_usd_hr: '36.30',
    }));
    expect(dto.usdLhrTotal).toBe(2.16);
    expect(dto.laborRateSource).toBe('shop_override');
  });
});
