import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsEnum, IsArray, IsNumber, IsBoolean, IsUUID } from 'class-validator';
import { Type, Transform } from 'class-transformer';

enum VendorStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

export enum VendorType {
  SUPPLIER = 'supplier',
  OEM = 'oem',
  BOTH = 'both',
}

// ============================================================================
// VENDOR DTOs
// ============================================================================

export class CreateVendorDto {
  @ApiProperty({ example: 'Acme Manufacturing Co.' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'CUS-1' })
  @IsOptional()
  @IsString()
  supplierCode?: string;

  @ApiPropertyOptional({ example: '123 Industrial Ave, City, ST 12345' })
  @IsOptional()
  @IsString()
  addresses?: string;

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: '+1-555-0123' })
  @IsOptional()
  @IsString()
  companyPhone?: string;

  @ApiPropertyOptional({ example: 'info@acme.com' })
  @IsOptional()
  @IsEmail()
  companyEmail?: string;

  @ApiPropertyOptional({ example: 'Major Auto OEM, Tech Corp' })
  @IsOptional()
  @IsString()
  majorCustomers?: string;

  @ApiPropertyOptional({ example: 'USA, Canada, Mexico' })
  @IsOptional()
  @IsString()
  countriesServed?: string;

  @ApiPropertyOptional({ example: '$5M - $10M' })
  @IsOptional()
  @IsString()
  companyTurnover?: string;

  // Services
  @ApiPropertyOptional({ example: ['Automotive', 'Aerospace', 'Defense'] })
  @IsOptional()
  @IsArray()
  industries?: string[];

  @ApiPropertyOptional({ example: ['CNC Machining', 'Casting', 'Forging'] })
  @IsOptional()
  @IsArray()
  process?: string[];

  @ApiPropertyOptional({ example: ['Aluminum', 'Steel', 'Brass'] })
  @IsOptional()
  @IsArray()
  materials?: string[];

  // Quality
  @ApiPropertyOptional({ example: ['ISO 9001', 'IATF 16949'] })
  @IsOptional()
  @IsArray()
  certifications?: string[];

  @ApiPropertyOptional({ example: 'CMM, Manual' })
  @IsOptional()
  @IsString()
  inspectionOptions?: string;

  @ApiPropertyOptional({ example: 'OTD, Rejection Rate' })
  @IsOptional()
  @IsString()
  qmsMetrics?: string;

  @ApiPropertyOptional({ example: '5S, Kaizen' })
  @IsOptional()
  @IsString()
  qmsProcedures?: string;

  // Facility
  @ApiPropertyOptional({ example: '10000 sq ft' })
  @IsOptional()
  @IsString()
  manufacturingWorkshop?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  warehouse?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  packing?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  logisticsTransportation?: boolean;

  @ApiPropertyOptional({ example: '500 units/month' })
  @IsOptional()
  @IsString()
  maximumProductionCapacity?: string;

  @ApiPropertyOptional({ example: 75.5 })
  @IsOptional()
  @IsNumber()
  averageCapacityUtilization?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsNumber()
  numHoursInShift?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  numShiftsInDay?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  numWorkingDaysPerWeek?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  inHouseMaterialTesting?: boolean;

  // Staff
  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  numOperators?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  numEngineers?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  numProductionManagers?: number;

  // Location
  @ApiPropertyOptional({ example: 'Bangalore' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Karnataka' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  // Documents
  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsString()
  companyProfileUrl?: string;

  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsString()
  machineListUrl?: string;

  // Status
  @ApiPropertyOptional({ example: VendorStatus.ACTIVE, enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({ example: VendorType.SUPPLIER, enum: VendorType })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;
}

export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

export class QueryVendorsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({ enum: VendorType })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  })
  process?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  })
  industries?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  })
  certifications?: string[];

  // Equipment filters
  @ApiPropertyOptional({ description: 'Filter by equipment type' })
  @IsOptional()
  @IsString()
  equipmentType?: string;

  @ApiPropertyOptional({ description: 'Minimum tonnage' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minTonnage?: number;

  @ApiPropertyOptional({ description: 'Maximum tonnage' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxTonnage?: number;

  @ApiPropertyOptional({ description: 'Minimum bed size length (mm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minBedLength?: number;

  @ApiPropertyOptional({ description: 'Minimum bed size width (mm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minBedWidth?: number;

  @ApiPropertyOptional({ description: 'Minimum bed size height (mm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minBedHeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  limit?: number;
}

// ============================================================================
// VENDOR EQUIPMENT DTOs
// ============================================================================

export class CreateVendorEquipmentDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional({ example: 'DMC' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'DMC 103 V' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 'cnc-machine' })
  @IsOptional()
  @IsString()
  equipmentType?: string;

  @ApiPropertyOptional({ example: 'vertical-machining-center' })
  @IsOptional()
  @IsString()
  equipmentSubtype?: string;

  @ApiPropertyOptional({ example: 1000.0 })
  @IsOptional()
  @IsNumber()
  bedSizeLengthMm?: number;

  @ApiPropertyOptional({ example: 500.0 })
  @IsOptional()
  @IsNumber()
  bedSizeWidthMm?: number;

  @ApiPropertyOptional({ example: 600.0 })
  @IsOptional()
  @IsNumber()
  bedSizeHeightMm?: number;

  @ApiPropertyOptional({ example: 40.0 })
  @IsOptional()
  @IsNumber()
  tonnage?: number;

  @ApiPropertyOptional({ example: 'Milling' })
  @IsOptional()
  @IsString()
  process?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ example: 2020 })
  @IsOptional()
  @IsNumber()
  yearOfManufacture?: number;

  @ApiPropertyOptional({ example: 50000.0 })
  @IsOptional()
  @IsNumber()
  marketPrice?: number;
}

export class UpdateVendorEquipmentDto extends PartialType(CreateVendorEquipmentDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

// ============================================================================
// VENDOR SERVICES DTOs
// ============================================================================

export class CreateVendorServiceDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty({ example: 'CNC Machining' })
  @IsString()
  serviceCategory: string;

  @ApiPropertyOptional({ example: 'Vertical Machining Center' })
  @IsOptional()
  @IsString()
  serviceSubcategory?: string;

  @ApiPropertyOptional({ example: ['Aluminum', 'Steel'] })
  @IsOptional()
  @IsArray()
  materialCapability?: string[];

  @ApiPropertyOptional({ example: 10.0 })
  @IsOptional()
  @IsNumber()
  minTonnage?: number;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber()
  maxTonnage?: number;

  @ApiPropertyOptional({ example: 10.0 })
  @IsOptional()
  @IsNumber()
  minPartSizeMm?: number;

  @ApiPropertyOptional({ example: 1000.0 })
  @IsOptional()
  @IsNumber()
  maxPartSizeMm?: number;
}

export class UpdateVendorServiceDto extends PartialType(CreateVendorServiceDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}

// ============================================================================
// VENDOR CONTACTS DTOs
// ============================================================================

export class CreateVendorContactDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Sales Manager' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+1-555-0123' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateVendorContactDto extends PartialType(CreateVendorContactDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}
