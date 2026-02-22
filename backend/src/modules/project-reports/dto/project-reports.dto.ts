import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsObject, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBalloonDiagramDto {
  @ApiProperty({ description: 'Project ID' })
  @IsUUID()
  @IsNotEmpty()
  project_id: string;

  @ApiProperty({ description: 'BOM ID' })
  @IsUUID()
  @IsNotEmpty()
  bom_id: string;

  @ApiProperty({ description: 'Diagram name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'CAD file path' })
  @IsString()
  @IsOptional()
  cad_file_path?: string;

  @ApiPropertyOptional({ description: 'Diagram data including annotations and dimensions' })
  @IsObject()
  @IsOptional()
  diagram_data?: any;
}

export class UpdateBalloonDiagramDto {
  @ApiPropertyOptional({ description: 'Diagram name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'CAD file path' })
  @IsString()
  @IsOptional()
  cad_file_path?: string;

  @ApiPropertyOptional({ description: 'Diagram data including annotations and dimensions' })
  @IsObject()
  @IsOptional()
  diagram_data?: any;
}

export class DiagramAnnotationDto {
  @ApiProperty({ description: 'BOM item ID' })
  @IsUUID()
  @IsNotEmpty()
  bom_item_id: string;

  @ApiProperty({ description: 'Balloon number' })
  @IsNumber()
  @IsNotEmpty()
  balloon_number: number;

  @ApiProperty({ description: 'X position on diagram' })
  @IsNumber()
  @IsNotEmpty()
  position_x: number;

  @ApiProperty({ description: 'Y position on diagram' })
  @IsNumber()
  @IsNotEmpty()
  position_y: number;

  @ApiPropertyOptional({ description: 'Z position for 3D diagrams' })
  @IsNumber()
  @IsOptional()
  position_z?: number;

  @ApiPropertyOptional({ description: 'Annotation text' })
  @IsString()
  @IsOptional()
  annotation_text?: string;

  @ApiPropertyOptional({ description: 'Leader line coordinates' })
  @IsObject()
  @IsOptional()
  leader_line?: any;
}

export class BalloonDiagramResponseDto {
  @ApiProperty({ description: 'Diagram ID' })
  id: string;

  @ApiProperty({ description: 'Project ID' })
  project_id: string;

  @ApiProperty({ description: 'BOM ID' })
  bom_id: string;

  @ApiProperty({ description: 'Diagram name' })
  name: string;

  @ApiPropertyOptional({ description: 'CAD file path' })
  cad_file_path?: string;

  @ApiPropertyOptional({ description: 'Diagram data' })
  diagram_data?: any;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updated_at: string;

  @ApiProperty({ description: 'Annotations' })
  annotations: DiagramAnnotationResponseDto[];
}

export class DiagramAnnotationResponseDto {
  @ApiProperty({ description: 'Annotation ID' })
  id: string;

  @ApiProperty({ description: 'BOM item ID' })
  bom_item_id: string;

  @ApiProperty({ description: 'Balloon number' })
  balloon_number: number;

  @ApiProperty({ description: 'Position coordinates' })
  position_x: number;
  position_y: number;
  position_z?: number;

  @ApiPropertyOptional({ description: 'Annotation text' })
  annotation_text?: string;

  @ApiPropertyOptional({ description: 'Leader line data' })
  leader_line?: any;

  @ApiProperty({ description: 'BOM item details' })
  bom_item: {
    part_name: string;
    part_number: string;
    material: string;
    quantity: number;
  };
}

export class InspectionDetailDto {
  @ApiProperty({ description: 'Serial number' })
  s_no: number;

  @ApiProperty({ description: 'Description' })
  description: string;

  @ApiProperty({ description: 'Specification in mm' })
  specification: string;

  @ApiProperty({ description: 'Greater than tolerance' })
  gt: number;

  @ApiProperty({ description: 'Less than tolerance' })
  lt: number;

  @ApiProperty({ description: 'Unit of measurement' })
  uom: string;

  @ApiProperty({ description: 'Measurement values' })
  measurements: number[];

  @ApiProperty({ description: 'Remarks' })
  remarks?: string;
}

export class InspectionReportDto {
  @ApiProperty({ description: 'Company name' })
  company_name: string;

  @ApiProperty({ description: 'Part name' })
  part_name: string;

  @ApiProperty({ description: 'Part number' })
  part_number: string;

  @ApiProperty({ description: 'Drawing number' })
  drawing_no: string;

  @ApiProperty({ description: 'Revision' })
  revision: string;

  @ApiProperty({ description: 'Material' })
  material: string;

  @ApiProperty({ description: 'Surface treatment' })
  surface_treatment: string;

  @ApiProperty({ description: 'Inspection date' })
  inspection_date: string;

  @ApiProperty({ description: 'General notes' })
  general_notes: string[];

  @ApiProperty({ description: 'Inspection details', type: [InspectionDetailDto] })
  @ValidateNested({ each: true })
  @Type(() => InspectionDetailDto)
  inspection_details: InspectionDetailDto[];

  @ApiProperty({ description: 'Raw material' })
  raw_material: string;

  @ApiProperty({ description: 'Inspected by' })
  inspected_by: string;

  @ApiProperty({ description: 'Approved by' })
  approved_by: string;

  @ApiProperty({ description: 'Balloon diagram data' })
  balloon_diagram?: BalloonDiagramResponseDto;
}