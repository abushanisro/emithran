import { ApiProperty } from '@nestjs/swagger';

export class MHRCalculationResult {
  // Working Hours Calculations
  @ApiProperty()
  workingHoursPerYear: number;

  @ApiProperty()
  availableHoursPerYear: number;

  @ApiProperty()
  effectiveHoursPerYear: number;

  // Cost Components - Per Hour
  @ApiProperty()
  depreciationPerHour: number;

  @ApiProperty()
  interestPerHour: number;

  @ApiProperty()
  insurancePerHour: number;

  @ApiProperty()
  rentPerHour: number;

  @ApiProperty()
  maintenancePerHour: number;

  @ApiProperty()
  electricityPerHour: number;

  // Totals - Per Hour
  @ApiProperty()
  costOfOwnershipPerHour: number;

  @ApiProperty()
  totalFixedCostPerHour: number;

  @ApiProperty()
  totalVariableCostPerHour: number;

  @ApiProperty()
  totalOperatingCostPerHour: number;

  @ApiProperty()
  adminOverheadPerHour: number;

  @ApiProperty()
  profitMarginPerHour: number;

  @ApiProperty()
  totalMachineHourRate: number;

  // Annual Costs
  @ApiProperty()
  depreciationPerAnnum: number;

  @ApiProperty()
  interestPerAnnum: number;

  @ApiProperty()
  insurancePerAnnum: number;

  @ApiProperty()
  rentPerAnnum: number;

  @ApiProperty()
  maintenancePerAnnum: number;

  @ApiProperty()
  electricityPerAnnum: number;

  @ApiProperty()
  totalFixedCostPerAnnum: number;

  @ApiProperty()
  totalVariableCostPerAnnum: number;

  @ApiProperty()
  totalAnnualCost: number;

  // Capital Investment Breakdown
  @ApiProperty()
  accessoriesCost: number;

  @ApiProperty()
  installationCost: number;

  @ApiProperty()
  totalCapitalInvestment: number;
}

export class MHRResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  location: string;

  @ApiProperty()
  commodityCode: string;

  @ApiProperty({ nullable: true })
  machineDescription?: string;

  @ApiProperty({ nullable: true })
  manufacturer?: string;

  @ApiProperty({ nullable: true })
  model?: string;

  @ApiProperty()
  machineName: string;

  @ApiProperty({ nullable: true })
  specification?: string;

  // Machine Operating Hours
  @ApiProperty()
  shiftsPerDay: number;

  @ApiProperty()
  hoursPerShift: number;

  @ApiProperty()
  workingDaysPerYear: number;

  @ApiProperty()
  plannedMaintenanceHoursPerYear: number;

  @ApiProperty()
  capacityUtilizationRate: number;

  // Costs
  @ApiProperty()
  landedMachineCost: number;

  @ApiProperty()
  accessoriesCostPercentage: number;

  @ApiProperty()
  installationCostPercentage: number;

  @ApiProperty()
  paybackPeriodYears: number;

  @ApiProperty()
  interestRatePercentage: number;

  @ApiProperty()
  insuranceRatePercentage: number;

  @ApiProperty()
  machineFootprintSqm: number;

  @ApiProperty()
  rentPerSqmPerMonth: number;

  @ApiProperty()
  maintenanceCostPercentage: number;

  @ApiProperty()
  powerKwhPerHour: number;

  @ApiProperty()
  electricityCostPerKwh: number;

  @ApiProperty()
  adminOverheadPercentage: number;

  @ApiProperty()
  profitMarginPercentage: number;

  // Manual Entry Fields
  @ApiProperty()
  isManualEntry: boolean;

  @ApiProperty({ nullable: true })
  manualMHRValue?: number;

  // Calculated Results
  @ApiProperty()
  calculations: MHRCalculationResult;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromDatabase(row: any): MHRResponseDto {
    return {
      id: row.id,
      userId: row.user_id,
      location: row.location,
      commodityCode: row.commodity_code,
      machineDescription: row.machine_description,
      manufacturer: row.manufacturer,
      model: row.model,
      machineName: row.machine_name,
      specification: row.specification,
      shiftsPerDay: parseFloat(row.shifts_per_day),
      hoursPerShift: parseFloat(row.hours_per_shift),
      workingDaysPerYear: parseFloat(row.working_days_per_year),
      plannedMaintenanceHoursPerYear: parseFloat(row.planned_maintenance_hours_per_year),
      capacityUtilizationRate: parseFloat(row.capacity_utilization_rate),
      landedMachineCost: parseFloat(row.landed_machine_cost),
      accessoriesCostPercentage: parseFloat(row.accessories_cost_percentage),
      installationCostPercentage: parseFloat(row.installation_cost_percentage),
      paybackPeriodYears: parseFloat(row.payback_period_years),
      interestRatePercentage: parseFloat(row.interest_rate_percentage),
      insuranceRatePercentage: parseFloat(row.insurance_rate_percentage),
      machineFootprintSqm: parseFloat(row.machine_footprint_sqm),
      rentPerSqmPerMonth: parseFloat(row.rent_per_sqm_per_month),
      maintenanceCostPercentage: parseFloat(row.maintenance_cost_percentage),
      powerKwhPerHour: parseFloat(row.power_kwh_per_hour),
      electricityCostPerKwh: parseFloat(row.electricity_cost_per_kwh),
      adminOverheadPercentage: parseFloat(row.admin_overhead_percentage),
      profitMarginPercentage: parseFloat(row.profit_margin_percentage),
      isManualEntry: row.is_manual_entry || false,
      manualMHRValue: row.manual_mhr_value ? parseFloat(row.manual_mhr_value) : undefined,
      calculations: JSON.parse(row.calculations || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class MHRListResponseDto {
  @ApiProperty({ type: [MHRResponseDto] })
  records: MHRResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
