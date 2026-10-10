import { IsString, IsUUID, IsArray, IsOptional, IsNumber, IsBoolean, IsEnum, ValidateNested, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum RfqTrackingStatus {
  SENT = 'sent',
  RESPONDED = 'responded',
  EVALUATED = 'evaluated',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// ============================================================================
// Nested DTOs
// ============================================================================

class RfqTrackingVendorDto {
  @ApiProperty({ description: 'Vendor UUID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Vendor name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Vendor email address' })
  @IsOptional()
  @IsString()
  email?: string;
}

class RfqTrackingPartDto {
  @ApiProperty({ description: 'BOM item UUID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Part number' })
  @IsString()
  partNumber: string;

  @ApiProperty({ description: 'Part description' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Manufacturing process required' })
  @IsString()
  process: string;

  @ApiPropertyOptional({ description: 'Quantity required', minimum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: '2D file path' })
  @IsOptional()
  @IsString()
  file2dPath?: string;

  @ApiPropertyOptional({ description: '3D file path' })
  @IsOptional()
  @IsString()
  file3dPath?: string;
}

// ============================================================================
// Request DTOs
// ============================================================================

export class CreateRfqTrackingDto {
  @ApiProperty({ description: 'RFQ ID to track' })
  @IsUUID()
  rfqId: string;

  @ApiPropertyOptional({ description: 'Project ID (optional)' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ description: 'RFQ name/title' })
  @IsString()
  rfqName: string;

  @ApiProperty({ description: 'RFQ number for reference' })
  @IsString()
  rfqNumber: string;

  @ApiProperty({ 
    description: 'Vendors receiving this RFQ',
    type: [RfqTrackingVendorDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqTrackingVendorDto)
  vendors: RfqTrackingVendorDto[];

  @ApiProperty({ 
    description: 'Parts included in this RFQ',
    type: [RfqTrackingPartDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqTrackingPartDto)
  parts: RfqTrackingPartDto[];
}

export class UpdateVendorResponseDto {
  @ApiProperty({ description: 'Whether vendor has responded' })
  @IsBoolean()
  responded: boolean;

  @ApiPropertyOptional({ description: 'Quote amount if responded', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quoteAmount?: number;

  @ApiPropertyOptional({ description: 'Lead time in days if responded', minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  leadTimeDays?: number;
}

export class UpdateTrackingStatusDto {
  @ApiProperty({ 
    description: 'Updated RFQ tracking status',
    enum: RfqTrackingStatus
  })
  @IsEnum(RfqTrackingStatus)
  status: RfqTrackingStatus;
}

// ============================================================================
// Response DTOs
// ============================================================================

class RfqTrackingVendorResponseDto {
  @ApiProperty({ description: 'Vendor UUID' })
  id: string;

  @ApiProperty({ description: 'Vendor name' })
  name: string;

  @ApiPropertyOptional({ description: 'Vendor email address' })
  email?: string;

  @ApiProperty({ description: 'Whether vendor has responded' })
  responded: boolean;

  @ApiPropertyOptional({ description: 'When response was received' })
  responseReceivedAt?: Date;

  @ApiPropertyOptional({ description: 'Quote amount provided' })
  quoteAmount?: number;

  @ApiPropertyOptional({ description: 'Lead time in days provided' })
  leadTimeDays?: number;
}

class RfqTrackingPartResponseDto {
  @ApiProperty({ description: 'BOM item UUID' })
  id: string;

  @ApiProperty({ description: 'Part number' })
  partNumber: string;

  @ApiProperty({ description: 'Part description' })
  description: string;

  @ApiProperty({ description: 'Manufacturing process required' })
  process: string;

  @ApiProperty({ description: 'Quantity required' })
  quantity: number;

  @ApiPropertyOptional({ description: '2D file path' })
  file2dPath?: string;

  @ApiPropertyOptional({ description: '3D file path' })
  file3dPath?: string;

  @ApiProperty({ description: 'Whether 2D file is available' })
  has2dFile: boolean;

  @ApiProperty({ description: 'Whether 3D file is available' })
  has3dFile: boolean;
}

export class RfqTrackingResponseDto {
  @ApiProperty({ description: 'Tracking record UUID' })
  id: string;

  @ApiProperty({ description: 'Associated RFQ UUID' })
  rfqId: string;

  @ApiProperty({ description: 'User who created the RFQ' })
  userId: string;

  @ApiPropertyOptional({ description: 'Associated project UUID' })
  projectId?: string;

  @ApiProperty({ description: 'RFQ name/title' })
  rfqName: string;

  @ApiProperty({ description: 'RFQ number for reference' })
  rfqNumber: string;

  @ApiProperty({ 
    description: 'Current RFQ status',
    enum: RfqTrackingStatus
  })
  status: RfqTrackingStatus;

  @ApiProperty({ description: 'Number of vendors contacted' })
  vendorCount: number;

  @ApiProperty({ description: 'Number of parts included' })
  partCount: number;

  @ApiProperty({ description: 'Number of responses received' })
  responseCount: number;

  @ApiProperty({ description: 'When RFQ was sent' })
  sentAt: Date;

  @ApiPropertyOptional({ description: 'When first response was received' })
  firstResponseAt?: Date;

  @ApiPropertyOptional({ description: 'When last response was received' })
  lastResponseAt?: Date;

  @ApiPropertyOptional({ description: 'When RFQ was completed' })
  completedAt?: Date;

  @ApiProperty({ 
    description: 'Vendors and their response status',
    type: [RfqTrackingVendorResponseDto]
  })
  vendors: RfqTrackingVendorResponseDto[];

  @ApiProperty({ 
    description: 'Parts included in this RFQ',
    type: [RfqTrackingPartResponseDto]
  })
  parts: RfqTrackingPartResponseDto[];
}

export class RfqTrackingStatsDto {
  @ApiProperty({ description: 'Total RFQs sent' })
  totalSent: number;

  @ApiProperty({ description: 'Total RFQs with at least one response' })
  totalResponded: number;

  @ApiProperty({ description: 'Total completed RFQs' })
  totalCompleted: number;

  @ApiProperty({ description: 'Average response time in days' })
  avgResponseTime: number;

  @ApiProperty({ description: 'RFQs sent in last 7 days' })
  recentActivity: number;
}