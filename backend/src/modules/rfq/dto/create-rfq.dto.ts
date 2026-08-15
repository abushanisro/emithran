import { IsString, IsUUID, IsArray, IsOptional, IsEnum, IsDate, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export enum RfqSelectionType {
  SINGLE = 'single',
  MULTIPLE = 'multiple',
  COMPETITIVE = 'competitive',
}

export class CreateRfqDto {
  @ApiProperty({ description: 'RFQ name/title' })
  @IsString()
  @MinLength(1)
  rfqName: string;

  @ApiProperty({ description: 'Project ID this RFQ belongs to', required: false })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ 
    description: 'Array of BOM item IDs to include in RFQ',
    type: [String]
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }
    // Handle single string case by converting to array
    if (typeof value === 'string') {
      return [value];
    }
    return value;
  })
  bomItemIds: string[];

  @ApiProperty({ 
    description: 'Array of vendor IDs to send RFQ to',
    type: [String]
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }
    // Handle single string case by converting to array
    if (typeof value === 'string') {
      return [value];
    }
    return value;
  })
  vendorIds: string[];

  @ApiProperty({ description: 'Deadline for quote submission', required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  quoteDeadline?: Date;

  @ApiProperty({ 
    description: 'Type of supplier selection',
    enum: RfqSelectionType,
    default: RfqSelectionType.COMPETITIVE
  })
  @IsEnum(RfqSelectionType)
  selectionType: RfqSelectionType;

  @ApiProperty({ description: 'Name of the buyer/procurement contact', required: false })
  @IsOptional()
  @IsString()
  buyerName?: string;

  @ApiProperty({ description: 'Custom email message body', required: false })
  @IsOptional()
  @IsString()
  emailBody?: string;

  @ApiProperty({ description: 'Custom email subject', required: false })
  @IsOptional()
  @IsString()
  emailSubject?: string;
}