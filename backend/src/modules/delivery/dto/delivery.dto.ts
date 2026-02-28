import { 
  IsString, 
  IsUUID, 
  IsOptional, 
  IsEnum, 
  IsDate, 
  IsNumber, 
  IsArray, 
  ValidateNested, 
  Min, 
  Max,
  IsBoolean,
  IsEmail,
  IsPhoneNumber,
  ArrayNotEmpty,
  MinLength,
  MaxLength
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Enums
export enum DeliveryStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  FAILED_DELIVERY = 'failed_delivery',
  RETURNED = 'returned',
  CANCELLED = 'cancelled'
}

export enum DeliveryPriority {
  LOW = 'low',
  STANDARD = 'standard',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  SENT = 'sent',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled'
}

// Address DTOs
export class CreateDeliveryAddressDto {
  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  addressType?: string = 'shipping';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  contactPerson: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber('IN')
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  addressLine1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine2?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  city: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  stateProvince?: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  postalCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string = 'India';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;
}

// Delivery Item DTOs
export class CreateDeliveryItemDto {
  @ApiProperty()
  @IsUUID()
  qualityApprovedItemId: string;

  @ApiProperty()
  @IsUUID()
  bomItemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  approvedQuantity: number;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  deliveryQuantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitWeightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unitDimensionsCm?: string; // "L x W x H"

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  packagingType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  packagingInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  hazmatClassification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  qcCertificateNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitValueInr?: number;
}

// Main Delivery Order DTOs
export class CreateDeliveryOrderDto {
  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiProperty()
  @IsUUID()
  deliveryAddressId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority = DeliveryPriority.STANDARD;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  requestedDeliveryDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryWindowStart?: string; // HH:MM format

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryWindowEnd?: string; // HH:MM format

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  packageCount?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialHandlingRequirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  handlingCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [CreateDeliveryItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryItemDto)
  items: CreateDeliveryItemDto[];
}

export class UpdateDeliveryOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  requestedDeliveryDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  estimatedDeliveryDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrierReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  pickupDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  handlingCostInr?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// Tracking DTOs
export class CreateTrackingEventDto {
  @ApiProperty()
  @IsUUID()
  deliveryOrderId: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  eventType: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  eventDescription: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  eventTimestamp: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  carrierStatusCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  proofOfDelivery?: any; // JSONB type for flexible proof data
}

// Invoice DTOs
export class CreateDeliveryInvoiceDto {
  @ApiProperty()
  @IsUUID()
  deliveryOrderId: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  invoiceDate: Date;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  dueDate: Date;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  subtotalInr: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  taxRate?: number = 0.18; // 18% GST

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryChargesInr?: number;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  billToCompany: string;

  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  billToAddress: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  billToGstin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  purchaseOrderNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentTerms?: string = 'Net 30';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// Response DTOs
export class DeliveryOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  projectId: string;

  @ApiPropertyOptional()
  projectName?: string;

  @ApiPropertyOptional()
  inspectionId?: string;

  @ApiProperty()
  status: DeliveryStatus;

  @ApiProperty()
  priority: DeliveryPriority;

  @ApiPropertyOptional()
  requestedDeliveryDate?: Date;

  @ApiPropertyOptional()
  estimatedDeliveryDate?: Date;

  @ApiPropertyOptional()
  actualDeliveryDate?: Date;

  @ApiPropertyOptional()
  deliveryWindowStart?: string;

  @ApiPropertyOptional()
  deliveryWindowEnd?: string;

  @ApiPropertyOptional()
  totalWeightKg?: number;

  @ApiPropertyOptional()
  totalVolumeM3?: number;

  @ApiProperty()
  packageCount: number;

  @ApiPropertyOptional()
  specialHandlingRequirements?: string;

  @ApiPropertyOptional()
  deliveryInstructions?: string;

  @ApiPropertyOptional()
  deliveryCostInr?: number;

  @ApiPropertyOptional()
  insuranceCostInr?: number;

  @ApiPropertyOptional()
  handlingCostInr?: number;

  @ApiPropertyOptional()
  totalDeliveryCostInr?: number;

  @ApiPropertyOptional()
  carrierReference?: string;

  @ApiPropertyOptional()
  pickupDate?: Date;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional()
  trackingNumber?: string;

  @ApiProperty()
  deliveryAddress: any; // Will be populated with address details

  @ApiPropertyOptional()
  carrier?: any; // Will be populated with carrier details

  @ApiProperty()
  items: any[]; // Will be populated with delivery items

  @ApiPropertyOptional()
  tracking?: any[];

  @ApiPropertyOptional()
  createdBy?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  approvedBy?: string;

  @ApiPropertyOptional()
  approvedAt?: Date;
}

// Query DTOs
export class DeliveryOrderQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string = 'created_at';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trackingNumber?: string;
}

// Available Items from QC
export class QualityApprovedItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  inspectionId: string;

  @ApiProperty()
  bomItemId: string;

  @ApiProperty()
  approvedQuantity: number;

  @ApiProperty()
  approvalStatus: string;

  @ApiPropertyOptional()
  approvalNotes?: string;

  @ApiProperty()
  approvedAt: Date;

  @ApiProperty()
  approvedBy: string;

  // Populated fields from joins
  @ApiProperty()
  bomItem: {
    id: string;
    partNumber: string;
    description: string;
    material: string;
    unitOfMeasure: string;
    unitCost: number;
  };

  @ApiProperty()
  inspection: {
    id: string;
    name: string;
    projectId: string;
    status: string;
  };
}