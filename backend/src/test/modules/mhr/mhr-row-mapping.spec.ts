import { mapMhrRowToDto } from '../../../modules/mhr/mhr-row-mapping';
import { MHR_CALCULATION_CONSTANTS } from '../../../modules/mhr/constants/mhr-calculation.constants';

const { DEFAULTS } = MHR_CALCULATION_CONSTANTS;

const fullRow = {
  id: 'r1',
  location: 'India',
  shifts_per_day: 2,
  hours_per_shift: 8,
  working_days_per_year: 300,
  planned_maintenance_hours_per_year: 100,
  capacity_utilization_rate: 80,
  landed_machine_cost: 1000000,
  accessories_cost_percentage: 5,
  installation_cost_percentage: 10,
  payback_period_years: 10,
  interest_rate_percentage: 9,
  insurance_rate_percentage: 1,
  maintenance_cost_percentage: 3,
};

describe('mapMhrRowToDto', () => {
  it('keeps a real stored 0 instead of replacing it with a default', () => {
    const { dto, assumedDefaults } = mapMhrRowToDto({
      ...fullRow,
      interest_rate_percentage: 0,
      insurance_rate_percentage: '0',
      maintenance_cost_percentage: 0,
      accessories_cost_percentage: 0,
      installation_cost_percentage: 0,
    });
    expect(dto.interestRatePercentage).toBe(0);
    expect(dto.insuranceRatePercentage).toBe(0);
    expect(dto.maintenanceCostPercentage).toBe(0);
    expect(dto.accessoriesCostPercentage).toBe(0);
    expect(dto.installationCostPercentage).toBe(0);
    expect(assumedDefaults).toEqual([]);
  });

  it('uses stored values as stored and reports nothing when the row is complete', () => {
    const { dto, assumedDefaults } = mapMhrRowToDto(fullRow);
    expect(dto.shiftsPerDay).toBe(2);
    expect(dto.capacityUtilizationRate).toBe(80);
    expect(assumedDefaults).toEqual([]);
  });

  it('fills a genuinely missing field from the single DEFAULTS table and reports it', () => {
    const { dto, assumedDefaults } = mapMhrRowToDto({
      ...fullRow,
      capacity_utilization_rate: null,
      shifts_per_day: undefined,
      interest_rate_percentage: '',
    });
    // One default per field, from one place: utilisation is the constants' 85, not a second, different 95.
    expect(dto.capacityUtilizationRate).toBe(DEFAULTS.CAPACITY_UTILIZATION_RATE);
    expect(dto.shiftsPerDay).toBe(DEFAULTS.SHIFTS_PER_DAY);
    expect(dto.interestRatePercentage).toBe(DEFAULTS.INTEREST_RATE);
    expect(assumedDefaults).toEqual([
      `shiftsPerDay=${DEFAULTS.SHIFTS_PER_DAY} (default)`,
      `capacityUtilizationRate=${DEFAULTS.CAPACITY_UTILIZATION_RATE} (default)`,
      `interestRatePercentage=${DEFAULTS.INTEREST_RATE} (default)`,
    ]);
  });

  it('reads camelCase rows (an already-mapped record) the same way', () => {
    const { dto, assumedDefaults } = mapMhrRowToDto({ shiftsPerDay: 1, capacityUtilizationRate: 0, landedMachineCost: 5, paybackPeriodYears: 5 });
    expect(dto.shiftsPerDay).toBe(1);
    expect(dto.capacityUtilizationRate).toBe(0);
    expect(assumedDefaults).toContain(`hoursPerShift=${DEFAULTS.HOURS_PER_SHIFT} (default)`);
  });

  it('reports a missing landed cost and an unusable payback period instead of hiding them', () => {
    const { dto, assumedDefaults } = mapMhrRowToDto({ ...fullRow, landed_machine_cost: null, payback_period_years: 0 });
    expect(dto.landedMachineCost).toBe(0);
    expect(dto.paybackPeriodYears).toBe(DEFAULTS.PAYBACK_PERIOD_YEARS);
    expect(assumedDefaults.some((d) => d.startsWith('landedMachineCost missing'))).toBe(true);
    expect(assumedDefaults.some((d) => d.includes('stored 0 is not a usable payback period'))).toBe(true);
  });
});
