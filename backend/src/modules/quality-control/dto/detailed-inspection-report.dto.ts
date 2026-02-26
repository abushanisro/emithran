import { IsString, IsNumber, IsOptional, IsEnum, IsArray, ValidateNested, Min, Max, IsUUID, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BalloonAnnotationDto {
  @ApiProperty({ description: 'Unique identifier for the balloon' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Balloon number' })
  @IsNumber()
  number: number;

  @ApiProperty({ description: 'X coordinate (percentage)' })
  @IsNumber()
  x: number;

  @ApiProperty({ description: 'Y coordinate (percentage)' })
  @IsNumber()
  y: number;
}

export class BalloonDrawingDto {
  @ApiProperty({ description: 'Part name' })
  @IsString()
  partName: string;

  @ApiProperty({ description: 'Material specification' })
  @IsString()
  material: string;

  @ApiProperty({ description: 'Surface treatment', required: false })
  @IsOptional()
  @IsString()
  surfaceTreatment?: string;

  @ApiProperty({ description: 'Drawing title' })
  @IsString()
  drawingTitle: string;

  @ApiProperty({ description: 'Drawing size', default: 'A4' })
  @IsString()
  drawingSize: string;

  @ApiProperty({ description: 'Balloon annotations', type: [BalloonAnnotationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalloonAnnotationDto)
  balloonAnnotations: BalloonAnnotationDto[];
}

export class FinalInspectionReportDto {
  @ApiProperty({ description: 'Company name' })
  @IsString()
  companyName: string;

  @ApiProperty({ description: 'Revision number', required: false })
  @IsOptional()
  @IsString()
  revisionNumber?: string;

  @ApiProperty({ description: 'Inspection date' })
  @IsDateString()
  inspectionDate: string;

  @ApiProperty({ description: 'Raw material' })
  @IsString()
  rawMaterial: string;

  @ApiProperty({ description: 'Inspector name' })
  @IsString()
  inspectionBy: string;

  @ApiProperty({ description: 'Approver name', required: false })
  @IsOptional()
  @IsString()
  approvedBy?: string;

  @ApiProperty({ description: 'General remarks', required: false })
  @IsOptional()
  @IsString()
  generalRemarks?: string;

  @ApiProperty({ description: 'Report status', enum: ['draft', 'release', 'rejected'] })
  @IsEnum(['draft', 'release', 'rejected'])
  status: 'draft' | 'release' | 'rejected';
}

export class MeasurementDto {
  @ApiProperty({ description: 'Measurement ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Serial number' })
  @IsNumber()
  slNo: number;

  @ApiProperty({ description: 'Specification description' })
  @IsString()
  specification: string;

  @ApiProperty({ description: 'Nominal value' })
  @IsNumber()
  nominal: number;

  @ApiProperty({ description: 'Plus tolerance' })
  @IsNumber()
  plusTolerance: number;

  @ApiProperty({ description: 'Minus tolerance' })
  @IsNumber()
  minusTolerance: number;

  @ApiProperty({ description: 'Measurement method' })
  @IsString()
  method: string;

  @ApiProperty({ description: 'Sample values (1-5)', type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  sampleValues: number[];

  @ApiProperty({ description: 'Remarks', required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class InspectionTableDto {
  @ApiProperty({ description: 'Number of samples (1-5)', minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  samples: number;

  @ApiProperty({ description: 'Measurement data', type: [MeasurementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements: MeasurementDto[];
}

export class CreateDetailedInspectionReportDto {
  @ApiProperty({ description: 'Inspection ID' })
  @IsUUID()
  inspectionId: string;

  @ApiProperty({ description: 'Balloon drawing data', type: BalloonDrawingDto })
  @ValidateNested()
  @Type(() => BalloonDrawingDto)
  balloonDrawing: BalloonDrawingDto;

  @ApiProperty({ description: 'Final inspection report data', type: FinalInspectionReportDto })
  @ValidateNested()
  @Type(() => FinalInspectionReportDto)
  finalInspectionReport: FinalInspectionReportDto;

  @ApiProperty({ description: 'Inspection table data', type: InspectionTableDto })
  @ValidateNested()
  @Type(() => InspectionTableDto)
  inspectionTable: InspectionTableDto;
}

export class DetailedInspectionReportResponseDto extends CreateDetailedInspectionReportDto {
  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}