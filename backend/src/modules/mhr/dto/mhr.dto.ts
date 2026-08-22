import { IsString, IsNumber, IsOptional, IsNotEmpty, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMHRDto {
  @ApiProperty({ description: 'Location of the machine' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiProperty({ description: 'Commodity code' })
  @IsString()
  @IsNotEmpty()
  commodityCode: string;

  @ApiPropertyOptional({ description: 'Machine description' })
  @IsString()
  @IsOptional()
  machineDescription?: string;

  @ApiPropertyOptional({ description: 'Manufacturer name' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Model number' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({ description: 'Machine name' })
  @IsString()
  @IsNotEmpty()
  machineName: string;

  @ApiPropertyOptional({ description: 'Specification/Selection criteria' })
  @IsString()
  @IsOptional()
  specification?: string;

  // Machine Operating Hours
  @ApiProperty({ description: 'Number of shifts per day', default: 3.00 })
  @IsNumber()
  @Min(0)
  shiftsPerDay: number;

  @ApiProperty({ description: 'Hours per shift', default: 8.00 })
  @IsNumber()
  @Min(0)
  hoursPerShift: number;

  @ApiProperty({ description: 'Working days per year', default: 260.00 })
  @IsNumber()
  @Min(0)
  workingDaysPerYear: number;

  @ApiProperty({ description: 'Planned maintenance hours per year', default: 0.00 })
  @IsNumber()
  @Min(0)
  plannedMaintenanceHoursPerYear: number;

  @ApiProperty({ description: 'Capacity utilization rate (%)', default: 95.00 })
  @IsNumber()
  @Min(0)
  @Max(100)
  capacityUtilizationRate: number;

  // Depreciation Cost
  @ApiProperty({ description: 'Landed machine cost (INR)' })
  @IsNumber()
  @Min(0)
  landedMachineCost: number;

  @ApiProperty({ description: 'Accessories cost percentage', default: 6.00 })
  @IsNumber()
  @Min(0)
  accessoriesCostPercentage: number;

  @ApiProperty({ description: 'Installation cost percentage', default: 20.00 })
  @IsNumber()
  @Min(0)
  installationCostPercentage: number;

  @ApiProperty({ description: 'Payback period/economic life (years)', default: 10.00 })
  @IsNumber()
  @Min(0)
  paybackPeriodYears: number;

  // Interest on Investment
  @ApiProperty({ description: 'Interest rate percentage', default: 8.00 })
  @IsNumber()
  @Min(0)
  interestRatePercentage: number;

  // Insurance
  @ApiProperty({ description: 'Insurance rate percentage', default: 1.00 })
  @IsNumber()
  @Min(0)
  insuranceRatePercentage: number;

  // Rent
  @ApiProperty({ description: 'Machine footprint (m²)', default: 0.00 })
  @IsNumber()
  @Min(0)
  machineFootprintSqm: number;

  @ApiProperty({ description: 'Rent per m² per month (INR)', default: 0.00 })
  @IsNumber()
  @Min(0)
  rentPerSqmPerMonth: number;

  // Repairs & Maintenance
  @ApiProperty({ description: 'Maintenance cost percentage', default: 6.00 })
  @IsNumber()
  @Min(0)
  maintenanceCostPercentage: number;

  // Electricity
  @ApiProperty({ description: 'Power consumption (KWH per hour)', default: 0.00 })
  @IsNumber()
  @Min(0)
  powerKwhPerHour: number;

  @ApiProperty({ description: 'Electricity cost per KWH (INR)', default: 0.00 })
  @IsNumber()
  @Min(0)
  electricityCostPerKwh: number;

  // Admin and Profit
  @ApiProperty({ description: 'Admin overhead percentage', default: 0.00 })
  @IsNumber()
  @Min(0)
  adminOverheadPercentage: number;

  @ApiProperty({ description: 'Profit margin percentage', default: 0.00 })
  @IsNumber()
  @Min(0)
  profitMarginPercentage: number;

  // Manual Entry Fields
  @ApiPropertyOptional({ description: 'Flag indicating if this is a manual entry (skips calculation)' })
  @IsOptional()
  isManualEntry?: boolean;

  @ApiPropertyOptional({ description: 'Manually entered MHR value (INR per hour)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  manualMHRValue?: number;

  // India 2026 extended fields
  @ApiPropertyOptional() @IsString() @IsOptional() processGroup?: string;
  // processRoute/operation: the full process-hierarchy identity (mirrors
  // process_calculator_mappings' own group/route/operation triple) — without
  // these, the edit dialog can only re-match a saved record's route/operation
  // by re-searching mappings for one whose `operation` name equals this
  // record's free-text `specification` field, which is usually unset/
  // unrelated. Persisting the real selection directly is what lets Edit
  // actually hydrate instead of reopening with every dropdown unselected.
  @ApiPropertyOptional() @IsString() @IsOptional() processRoute?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() operation?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() processCategory?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() machineClass?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() automationLevel?: string;
  @ApiPropertyOptional() @IsNumber() @Min(1) @IsOptional() operators?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() wageGrade?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() machinePriceUsd?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() manufacturerCountry?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() setupTimeHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() lhrInrPerHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLaborRatePerHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrBase?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrBurden?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrTotal?: number;
  @ApiPropertyOptional() @IsOptional() specs?: Record<string, any>;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() directOverheadRate?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() indirectOverheadRate?: number;

  // Machine capability (physics-based selection, migration 324) — previously
  // settable only via the Excel bulk-import path or a raw SQL migration; this
  // lets a shop directly confirm a specific machine's real limits through the
  // dialog. Same columns machine-selection/selector.ts's fetchMachinePool()
  // reads for real capability-tiered ranking (see CAPABILITY_COLUMNS there).
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxXMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxYMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxZMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxDiameterMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxLengthMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxTonnage?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxWorkpieceWeightKg?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() powerKw?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessMsMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessSsMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessAlMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessCuMm?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() cuttableMaterials?: string[];
}

export class UpdateMHRDto {
  @ApiPropertyOptional({ description: 'Location of the machine' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Commodity code' })
  @IsString()
  @IsOptional()
  commodityCode?: string;

  @ApiPropertyOptional({ description: 'Machine description' })
  @IsString()
  @IsOptional()
  machineDescription?: string;

  @ApiPropertyOptional({ description: 'Manufacturer name' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Model number' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ description: 'Machine name' })
  @IsString()
  @IsOptional()
  machineName?: string;

  @ApiPropertyOptional({ description: 'Specification/Selection criteria' })
  @IsString()
  @IsOptional()
  specification?: string;

  @ApiPropertyOptional({ description: 'Number of shifts per day' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  shiftsPerDay?: number;

  @ApiPropertyOptional({ description: 'Hours per shift' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  hoursPerShift?: number;

  @ApiPropertyOptional({ description: 'Working days per year' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  workingDaysPerYear?: number;

  @ApiPropertyOptional({ description: 'Planned maintenance hours per year' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  plannedMaintenanceHoursPerYear?: number;

  @ApiPropertyOptional({ description: 'Capacity utilization rate (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  capacityUtilizationRate?: number;

  @ApiPropertyOptional({ description: 'Landed machine cost (INR)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  landedMachineCost?: number;

  @ApiPropertyOptional({ description: 'Accessories cost percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  accessoriesCostPercentage?: number;

  @ApiPropertyOptional({ description: 'Installation cost percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  installationCostPercentage?: number;

  @ApiPropertyOptional({ description: 'Payback period/economic life (years)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  paybackPeriodYears?: number;

  @ApiPropertyOptional({ description: 'Interest rate percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  interestRatePercentage?: number;

  @ApiPropertyOptional({ description: 'Insurance rate percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  insuranceRatePercentage?: number;

  @ApiPropertyOptional({ description: 'Machine footprint (m²)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  machineFootprintSqm?: number;

  @ApiPropertyOptional({ description: 'Rent per m² per month (INR)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  rentPerSqmPerMonth?: number;

  @ApiPropertyOptional({ description: 'Maintenance cost percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  maintenanceCostPercentage?: number;

  @ApiPropertyOptional({ description: 'Power consumption (KWH per hour)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  powerKwhPerHour?: number;

  @ApiPropertyOptional({ description: 'Electricity cost per KWH (INR)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  electricityCostPerKwh?: number;

  @ApiPropertyOptional({ description: 'Admin overhead percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  adminOverheadPercentage?: number;

  @ApiPropertyOptional({ description: 'Profit margin percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  profitMarginPercentage?: number;

  // Manual Entry Fields
  @ApiPropertyOptional({ description: 'Flag indicating if this is a manual entry (skips calculation)' })
  @IsOptional()
  isManualEntry?: boolean;

  @ApiPropertyOptional({ description: 'Manually entered MHR value (INR per hour)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  manualMHRValue?: number;

  // India 2026 extended fields
  @ApiPropertyOptional() @IsString() @IsOptional() processGroup?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() processRoute?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() operation?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() processCategory?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() machineClass?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() automationLevel?: string;
  @ApiPropertyOptional() @IsNumber() @Min(1) @IsOptional() operators?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() wageGrade?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() machinePriceUsd?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() manufacturerCountry?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() setupTimeHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() lhrInrPerHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLaborRatePerHr?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrBase?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrBurden?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() usdLhrTotal?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() directOverheadRate?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() indirectOverheadRate?: number;

  // specs (jsonb) was previously CREATE-only — an edited/existing record could
  // never have this touched via the interactive API at all, only the one-way
  // Excel-import path. Category-specific machine_library.json fields (press
  // force, roll diameter, router RPM, etc. — no dedicated column exists or is
  // warranted for these, see CLAUDE.md's Machine Economics entry) live here.
  @ApiPropertyOptional() @IsOptional() specs?: Record<string, any>;

  // Machine capability — see the identical block on CreateMHRDto for context.
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxXMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxYMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxZMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxDiameterMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxLengthMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxTonnage?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxWorkpieceWeightKg?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() powerKw?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessMsMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessSsMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessAlMm?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() maxThicknessCuMm?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() cuttableMaterials?: string[];
}

export class QueryMHRDto {
  @ApiPropertyOptional({ description: 'Search by machine name or description' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by location' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Filter by commodity code' })
  @IsString()
  @IsOptional()
  commodityCode?: string;

  @ApiPropertyOptional({ description: 'Filter by process group' })
  @IsString()
  @IsOptional()
  processGroup?: string;

  @ApiPropertyOptional({ description: 'Filter by machine class (e.g. fiber_laser, press_brake)' })
  @IsString()
  @IsOptional()
  machineClass?: string;

  @ApiPropertyOptional({ description: 'Filter by wage grade' })
  @IsString()
  @IsOptional()
  wageGrade?: string;

  @ApiPropertyOptional({ description: 'Filter by currency code (e.g. INR, USD, EUR)' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  limit?: number;
}
