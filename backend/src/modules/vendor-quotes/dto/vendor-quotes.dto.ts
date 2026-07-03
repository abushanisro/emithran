import { IsUUID, IsString, IsNumber, IsOptional, IsDate, IsEnum, IsArray, ValidateNested, IsBoolean, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum QuoteStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum SelectionStatus {
  PENDING = 'pending',
  SELECTED = 'selected',
  ALTERNATE = 'alternate',
  REJECTED = 'rejected',
}

export class VendorQuoteLineItemDto {
  @ApiProperty({ description: 'BOM item ID' })
  @IsUUID()
  bomItemId: string;

  @ApiPropertyOptional({ description: 'Line number in quote' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  lineNumber?: number;

  @ApiPropertyOptional({ description: 'Part description' })
  @IsOptional()
  @IsString()
  partDescription?: string;

  @ApiProperty({ description: 'Unit price' })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ description: 'Quantity' })
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Total price (calculated if not provided)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPrice?: number;

  @ApiProperty({ description: 'Lead time in days' })
  @IsNumber()
  @Min(0)
  leadTimeDays: number;

  @ApiProperty({ description: 'Expected delivery date' })
  @IsDate()
  @Type(() => Date)
  deliveryDate: Date;

  @ApiPropertyOptional({ description: 'Production capacity per month' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  productionCapacityPerMonth?: number;

  @ApiPropertyOptional({ description: 'Minimum order quantity' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  minimumOrderQuantity?: number;

  @ApiPropertyOptional({ description: 'Material grade' })
  @IsOptional()
  @IsString()
  materialGrade?: string;

  @ApiPropertyOptional({ description: 'Finish specification' })
  @IsOptional()
  @IsString()
  finishSpecification?: string;

  @ApiPropertyOptional({ description: 'Quality standard' })
  @IsOptional()
  @IsString()
  qualityStandard?: string;

  @ApiPropertyOptional({ description: 'Certification requirements' })
  @IsOptional()
  @IsString()
  certificationRequirements?: string;

  @ApiPropertyOptional({ description: 'Packaging requirements' })
  @IsOptional()
  @IsString()
  packagingRequirement?: string;

  @ApiPropertyOptional({ description: 'Tooling cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  toolingCost?: number;

  @ApiPropertyOptional({ description: 'Setup cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  setupCost?: number;

  @ApiPropertyOptional({ description: 'Shipping cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({ description: 'Handling cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  handlingCost?: number;

  @ApiPropertyOptional({ description: 'Price validity in days', default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  priceValidityDays?: number;

  @ApiPropertyOptional({ description: 'Payment terms override' })
  @IsOptional()
  @IsString()
  paymentTermsOverride?: string;

  @ApiPropertyOptional({ description: 'Warranty period in months', default: 12 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  warrantyPeriodMonths?: number;

  @ApiPropertyOptional({ description: 'General remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ description: 'Technical notes' })
  @IsOptional()
  @IsString()
  technicalNotes?: string;

  @ApiPropertyOptional({ description: 'Compliance notes' })
  @IsOptional()
  @IsString()
  complianceNotes?: string;

  @ApiPropertyOptional({ description: 'Risk assessment' })
  @IsOptional()
  @IsString()
  riskAssessment?: string;
}

export class CreateVendorQuoteDto {
  @ApiProperty({ description: 'Supplier nomination evaluation ID' })
  @IsUUID()
  nominationEvaluationId: string;

  @ApiProperty({ description: 'Vendor ID' })
  @IsUUID()
  vendorId: string;

  @ApiProperty({ description: 'Quote number' })
  @IsString()
  quoteNumber: string;

  @ApiPropertyOptional({ description: 'Quote date', default: 'current date' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  quoteDate?: Date;

  @ApiPropertyOptional({ description: 'Quote validity end date' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  validUntil?: Date;

  @ApiPropertyOptional({ description: 'Currency code', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Payment terms' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'Delivery terms' })
  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @ApiPropertyOptional({ description: 'Warranty terms' })
  @IsOptional()
  @IsString()
  warrantyTerms?: string;

  @ApiPropertyOptional({ description: 'Special conditions' })
  @IsOptional()
  @IsString()
  specialConditions?: string;

  @ApiPropertyOptional({ description: 'Contact person name' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ description: 'Contact email' })
  @IsOptional()
  @IsString()
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'Contact phone' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiPropertyOptional({ description: 'Quote line items', type: [VendorQuoteLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorQuoteLineItemDto)
  lineItems?: VendorQuoteLineItemDto[];
}

export class UpdateVendorQuoteDto {
  @ApiPropertyOptional({ description: 'Quote number' })
  @IsOptional()
  @IsString()
  quoteNumber?: string;

  @ApiPropertyOptional({ description: 'Quote date' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  quoteDate?: Date;

  @ApiPropertyOptional({ description: 'Quote validity end date' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  validUntil?: Date;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Payment terms' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'Delivery terms' })
  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @ApiPropertyOptional({ description: 'Warranty terms' })
  @IsOptional()
  @IsString()
  warrantyTerms?: string;

  @ApiPropertyOptional({ description: 'Special conditions' })
  @IsOptional()
  @IsString()
  specialConditions?: string;

  @ApiPropertyOptional({ description: 'Contact person name' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ description: 'Contact email' })
  @IsOptional()
  @IsString()
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'Contact phone' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiPropertyOptional({ description: 'Quote status', enum: QuoteStatus })
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;
}

export class VendorAssignmentDto {
  @ApiProperty({ description: 'Supplier nomination ID' })
  @IsUUID()
  nominationId: string;

  @ApiProperty({ description: 'BOM item ID' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ description: 'Vendor ID' })
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional({ description: 'Selected quote line item ID' })
  @IsOptional()
  @IsUUID()
  quoteLineItemId?: string;

  @ApiPropertyOptional({ description: 'Quoted unit price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedUnitPrice?: number;

  @ApiPropertyOptional({ description: 'Quoted total price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedTotalPrice?: number;

  @ApiPropertyOptional({ description: 'Quoted delivery date' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  quotedDeliveryDate?: Date;

  @ApiPropertyOptional({ description: 'Quoted lead time in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedLeadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Assignment reason' })
  @IsOptional()
  @IsString()
  assignmentReason?: string;

  @ApiPropertyOptional({ description: 'Cost competitiveness score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  costCompetitivenessScore?: number;

  @ApiPropertyOptional({ description: 'Delivery competitiveness score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  deliveryCompetitivenessScore?: number;

  @ApiPropertyOptional({ description: 'Quality competitiveness score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  qualityCompetitivenessScore?: number;

  @ApiPropertyOptional({ description: 'Overall selection score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  overallSelectionScore?: number;

  @ApiPropertyOptional({ description: 'Selection status', enum: SelectionStatus, default: SelectionStatus.SELECTED })
  @IsOptional()
  @IsEnum(SelectionStatus)
  selectionStatus?: SelectionStatus;
}