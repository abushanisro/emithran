import type { CreateMHRDto } from './dto/mhr.dto';
import { MHR_CALCULATION_CONSTANTS } from './constants/mhr-calculation.constants';

/**
 * Maps a stored mhr_records row (snake_case, or an already-mapped camelCase
 * response) to the calculation engine's input.
 *
 * A stored value is used as stored, including a real 0 (a machine with 0%
 * interest, 0% insurance or no rent is real data, not a missing value). Only a
 * value that is genuinely absent (null, undefined, empty, not a number) gets a
 * default, every default comes from MHR_CALCULATION_CONSTANTS.DEFAULTS (one
 * value per field, defined once), and each one used is listed in
 * `assumedDefaults` so the rate it produces can say it is not measured.
 */
export interface MhrRowMapping {
  dto: CreateMHRDto;
  /** One entry per field that was absent and filled with a default, e.g. "capacityUtilizationRate=85 (default)". */
  assumedDefaults: string[];
}

const { DEFAULTS } = MHR_CALCULATION_CONSTANTS;

/** The stored value as a number, or undefined when the row has no usable value for it. */
export function storedNumber(row: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const raw = row[camel] ?? row[snake];
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

export function mapMhrRowToDto(row: Record<string, any>): MhrRowMapping {
  const assumedDefaults: string[] = [];
  // A field whose absence changes the rate: default it, and say so.
  const withDefault = (camel: string, snake: string, fallback: number): number => {
    const v = storedNumber(row, camel, snake);
    if (v !== undefined) return v;
    assumedDefaults.push(`${camel}=${fallback} (default)`);
    return fallback;
  };
  // A cost component whose absence means the machine has none of it (no rent,
  // no power draw on file, no overhead, no margin): 0, which is what absent means.
  const orZero = (camel: string, snake: string): number => storedNumber(row, camel, snake) ?? 0;

  let paybackPeriodYears = withDefault('paybackPeriodYears', 'payback_period_years', DEFAULTS.PAYBACK_PERIOD_YEARS);
  if (paybackPeriodYears <= 0) {
    // Depreciation divides by the payback period; a stored 0 or negative is not
    // a usable period, so the default is used and reported, never Infinity.
    assumedDefaults.push(`paybackPeriodYears=${DEFAULTS.PAYBACK_PERIOD_YEARS} (default; stored ${paybackPeriodYears} is not a usable payback period)`);
    paybackPeriodYears = DEFAULTS.PAYBACK_PERIOD_YEARS;
  }

  const landedMachineCost = storedNumber(row, 'landedMachineCost', 'landed_machine_cost');
  if (landedMachineCost === undefined) {
    assumedDefaults.push('landedMachineCost missing: depreciation, interest, insurance and maintenance are 0');
  }

  const manual = storedNumber(row, 'manualMHRValue', 'manual_mhr_value');

  const dto: CreateMHRDto = {
    location: row.location,
    commodityCode: row.commodityCode ?? row.commodity_code,
    machineDescription: row.machineDescription ?? row.machine_description,
    manufacturer: row.manufacturer,
    model: row.model,
    machineName: row.machineName ?? row.machine_name,
    specification: row.specification,
    shiftsPerDay: withDefault('shiftsPerDay', 'shifts_per_day', DEFAULTS.SHIFTS_PER_DAY),
    hoursPerShift: withDefault('hoursPerShift', 'hours_per_shift', DEFAULTS.HOURS_PER_SHIFT),
    workingDaysPerYear: withDefault('workingDaysPerYear', 'working_days_per_year', DEFAULTS.WORKING_DAYS_PER_YEAR),
    plannedMaintenanceHoursPerYear: orZero('plannedMaintenanceHoursPerYear', 'planned_maintenance_hours_per_year'),
    capacityUtilizationRate: withDefault('capacityUtilizationRate', 'capacity_utilization_rate', DEFAULTS.CAPACITY_UTILIZATION_RATE),
    landedMachineCost: landedMachineCost ?? 0,
    accessoriesCostPercentage: withDefault('accessoriesCostPercentage', 'accessories_cost_percentage', DEFAULTS.ACCESSORIES_COST_PERCENTAGE),
    installationCostPercentage: withDefault('installationCostPercentage', 'installation_cost_percentage', DEFAULTS.INSTALLATION_COST_PERCENTAGE),
    paybackPeriodYears,
    interestRatePercentage: withDefault('interestRatePercentage', 'interest_rate_percentage', DEFAULTS.INTEREST_RATE),
    insuranceRatePercentage: withDefault('insuranceRatePercentage', 'insurance_rate_percentage', DEFAULTS.INSURANCE_RATE),
    machineFootprintSqm: orZero('machineFootprintSqm', 'machine_footprint_sqm'),
    rentPerSqmPerMonth: orZero('rentPerSqmPerMonth', 'rent_per_sqm_per_month'),
    maintenanceCostPercentage: withDefault('maintenanceCostPercentage', 'maintenance_cost_percentage', DEFAULTS.MAINTENANCE_COST_PERCENTAGE),
    powerKwhPerHour: orZero('powerKwhPerHour', 'power_kwh_per_hour'),
    electricityCostPerKwh: orZero('electricityCostPerKwh', 'electricity_cost_per_kwh'),
    adminOverheadPercentage: orZero('adminOverheadPercentage', 'admin_overhead_percentage'),
    profitMarginPercentage: orZero('profitMarginPercentage', 'profit_margin_percentage'),
    isManualEntry: Boolean(row.isManualEntry ?? row.is_manual_entry ?? false),
    manualMHRValue: manual ?? 0,
  };
  return { dto, assumedDefaults };
}
