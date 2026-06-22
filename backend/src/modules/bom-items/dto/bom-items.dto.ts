import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNumber, IsEnum, Min, IsIn, registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export enum BOMItemType {
  ASSEMBLY = 'assembly',
  SUB_ASSEMBLY = 'sub_assembly',
  CHILD_PART = 'child_part',
}

/**
 * Custom validator to ensure unit_cost is only set when make_buy is 'buy'
 */
function IsUnitCostValidForMakeBuy(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isUnitCostValidForMakeBuy',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as any;
          // If make_buy is 'make', unit_cost must be 0 or undefined
          if (obj.makeBuy === 'make' && value && value !== 0) {
            return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return 'unit_cost can only be non-zero when make_buy is set to "buy"';
        },
      },
    });
  };
}

export class CreateBOMItemDto {
  @ApiProperty({ example: 'bom-uuid' })
  @IsUUID()
  bomId: string;

  @ApiProperty({ example: 'Cylinder Head Assembly' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'CH-2024-001' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ example: 'Main cylinder head with integrated cooling channels' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: BOMItemType, example: BOMItemType.ASSEMBLY })
  @IsEnum(BOMItemType)
  itemType: BOMItemType;

  @ApiPropertyOptional({ example: 'parent-item-uuid' })
  @IsOptional()
  @IsUUID()
  parentItemId?: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0)
  annualVolume: number;

  @ApiPropertyOptional({ example: 'pcs' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 'Cast Iron' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'EN-GJL-250' })
  @IsOptional()
  @IsString()
  materialGrade?: string;

  @ApiPropertyOptional({ example: 'make', description: 'Make or buy decision: make (manufacturing) or buy (purchasing)' })
  @IsOptional()
  @IsIn(['make', 'buy'])
  makeBuy?: string;

  @ApiPropertyOptional({ example: 1250.50, description: 'Unit cost in INR for purchased parts (when makeBuy is buy)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsUnitCostValidForMakeBuy()
  unitCost?: number;

  @ApiPropertyOptional({ example: 1.5, description: 'Part weight in kg' })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ example: 100.0, description: 'Maximum length in mm' })
  @IsOptional()
  @IsNumber()
  maxLength?: number;

  @ApiPropertyOptional({ example: 50.0, description: 'Maximum width in mm' })
  @IsOptional()
  @IsNumber()
  maxWidth?: number;

  @ApiPropertyOptional({ example: 30.0, description: 'Maximum height in mm' })
  @IsOptional()
  @IsNumber()
  maxHeight?: number;

  @ApiPropertyOptional({ example: 5000.0, description: 'Surface area in mm2' })
  @IsOptional()
  @IsNumber()
  surfaceArea?: number;

  @ApiPropertyOptional({ example: 12500.0, description: 'Part volume in mm³' })
  @IsOptional()
  @IsNumber()
  volume?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: 'file-path-3d.stp' })
  @IsOptional()
  @IsString()
  file3dPath?: string;

  @ApiPropertyOptional({ example: 'file-path-original.stp', description: 'Original STEP/IGES path before STL conversion — used by reanalyze for full OCC topology' })
  @IsOptional()
  @IsString()
  fileStepPath?: string;

  @ApiPropertyOptional({ example: 'file-path-2d.pdf' })
  @IsOptional()
  @IsString()
  file2dPath?: string;

  @ApiPropertyOptional({ example: 'file-path-drawing.dxf.gz' })
  @IsOptional()
  @IsString()
  fileDxfPath?: string;

  @ApiPropertyOptional({ example: 'material-uuid', description: 'Link to material from materials database' })
  @IsOptional()
  @IsUUID()
  materialId?: string;

  @ApiPropertyOptional({ example: 'sheet_metal', enum: ['sheet_metal', 'cnc_turned', 'cnc_milled'], description: 'Override the auto-detected manufacturing family. Null = auto-detect.' })
  @IsOptional()
  @IsIn(['sheet_metal', 'cnc_turned', 'cnc_milled'])
  manufacturingFamilyOverride?: string | null;

  @ApiPropertyOptional({ example: 'drawing', description: 'Provenance of the material identification: cad | drawing | manual | estimate' })
  @IsOptional()
  @IsString()
  materialSource?: string;

  @ApiPropertyOptional({ example: 0.75, description: 'Confidence score 0–1 for the material identification' })
  @IsOptional()
  @IsNumber()
  materialConfidence?: number;

  @ApiPropertyOptional({ example: 2.0, description: 'Sheet metal material thickness in mm' })
  @IsOptional()
  @IsNumber()
  sheetThicknessMm?: number;

  @ApiPropertyOptional({ example: 1250.0, description: 'Total laser/plasma cut perimeter in mm (sheet metal)' })
  @IsOptional()
  @IsNumber()
  cutLengthMm?: number;

  @ApiPropertyOptional({ example: 8, description: 'Number of bends / form operations (sheet metal)' })
  @IsOptional()
  @IsNumber()
  bendCount?: number;

  @ApiPropertyOptional({ example: 6, description: 'Number of holes detected (sheet metal)' })
  @IsOptional()
  @IsNumber()
  holeCount?: number;

  @ApiPropertyOptional({ example: 9, description: 'Total laser pierce points (holes + slots + 1)' })
  @IsOptional()
  @IsNumber()
  pierceCount?: number;

  @ApiPropertyOptional({ example: 45320.0, description: 'Flat pattern area in mm² (dominant sheet face)' })
  @IsOptional()
  @IsNumber()
  flatPatternAreaMm2?: number;

  @ApiPropertyOptional({ description: 'Manufacturing Feature Graph — family classification, individual feature instances, process recommendations' })
  @IsOptional()
  featureGraph?: object;

  @ApiPropertyOptional({ example: 'sheet_metal', description: 'Denormalised family; auto-populated from featureGraph by service if omitted' })
  @IsOptional()
  @IsString()
  familyClassification?: string;

  @ApiPropertyOptional({ example: 0.94, description: 'Denormalised confidence; auto-populated from featureGraph by service if omitted' })
  @IsOptional()
  @IsNumber()
  familyConfidence?: number;

  @ApiPropertyOptional({ example: 1.6, description: 'Surface finish Ra in µm — from drawing analysis' })
  @IsOptional()
  @IsNumber()
  surfaceFinishRa?: number;

  @ApiPropertyOptional({ example: 0.8 })
  @IsOptional()
  @IsNumber()
  surfaceFinishConfidence?: number;

  @ApiPropertyOptional({ example: 'None', description: 'Heat treatment specification from drawing' })
  @IsOptional()
  @IsString()
  heatTreatment?: string;

  @ApiPropertyOptional({ example: 'RAL9005 Powder Coat', description: 'Coating specification from drawing' })
  @IsOptional()
  @IsString()
  coating?: string;

  @ApiPropertyOptional({ example: 0.9 })
  @IsOptional()
  @IsNumber()
  coatingConfidence?: number;

  @ApiPropertyOptional({ example: 'medium', enum: ['simple', 'medium', 'complex'] })
  @IsOptional()
  @IsIn(['simple', 'medium', 'complex'])
  complexity?: string;

  @ApiPropertyOptional({ example: 0.05, description: 'Tightest tolerance in mm from drawing' })
  @IsOptional()
  @IsNumber()
  tightestToleranceMm?: number;

  @ApiPropertyOptional({ example: 0.85 })
  @IsOptional()
  @IsNumber()
  toleranceConfidence?: number;

  @ApiPropertyOptional({ description: 'Full drawing intelligence JSON — threads, GD&T callouts, tolerances, revision, notes' })
  @IsOptional()
  drawingIntelligence?: Record<string, any>;
}

export class UpdateBOMItemDto extends PartialType(CreateBOMItemDto) { }

export class QueryBOMItemsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(BOMItemType)
  itemType?: BOMItemType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;
}
