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

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
