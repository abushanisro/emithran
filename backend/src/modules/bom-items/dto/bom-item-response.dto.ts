import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BOMItemType } from './bom-items.dto';

/**
 * BOM Item Response DTO
 * Defines the API contract for BOM Item responses
 */
export class BOMItemResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  bomId: string;

  @ApiProperty({ example: 'Cylinder Head Assembly' })
  name: string;

  @ApiPropertyOptional({ example: 'CH-2024-001' })
  partNumber?: string;

  @ApiPropertyOptional({ example: 'Main cylinder head with integrated cooling channels' })
  description?: string;

  @ApiProperty({ enum: BOMItemType, example: BOMItemType.ASSEMBLY })
  itemType: BOMItemType;

  @ApiPropertyOptional({ example: 'uuid' })
  parentItemId?: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 10000 })
  annualVolume: number;

  @ApiPropertyOptional({ example: 'pcs' })
  unit?: string;

  @ApiPropertyOptional({ example: 'Cast Iron' })
  material?: string;

  @ApiPropertyOptional({ example: 'EN-GJL-250' })
  materialGrade?: string;

  @ApiPropertyOptional({ example: 'make' })
  makeBuy?: string;

  @ApiPropertyOptional({ example: 1250.50 })
  unitCost?: number;

  @ApiPropertyOptional({ example: 1.5 })
  weight?: number;

  @ApiPropertyOptional({ example: 100.0 })
  maxLength?: number;

  @ApiPropertyOptional({ example: 50.0 })
  maxWidth?: number;

  @ApiPropertyOptional({ example: 30.0 })
  maxHeight?: number;

  @ApiPropertyOptional({ example: 5000.0 })
  surfaceArea?: number;

  @ApiPropertyOptional({ example: 12500.0 })
  volume?: number;

  @ApiProperty({ example: 0 })
  sortOrder: number;

  @ApiPropertyOptional({ example: 'file-path-3d.stp' })
  file3dPath?: string;

  @ApiPropertyOptional({ example: 'file-path-original.stp' })
  fileStepPath?: string;

  @ApiPropertyOptional({ example: 'file-path-2d.pdf' })
  file2dPath?: string;

  @ApiPropertyOptional({ example: 'file-path-drawing.dxf.gz' })
  fileDxfPath?: string;

  @ApiPropertyOptional({ example: 'https://cdn.supabase.io/storage/v1/...' })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 'sheet_metal', description: 'User-set manufacturing family override; null means auto-detect' })
  manufacturingFamilyOverride?: string;

  @ApiPropertyOptional({ example: 'drawing' })
  materialSource?: string;

  @ApiPropertyOptional({ example: 0.75 })
  materialConfidence?: number;

  @ApiPropertyOptional({ example: 2.0 })
  sheetThicknessMm?: number;

  @ApiPropertyOptional({ example: 1250.0 })
  cutLengthMm?: number;

  @ApiPropertyOptional({ example: 8 })
  bendCount?: number;

  @ApiPropertyOptional({ example: 6 })
  holeCount?: number;

  @ApiPropertyOptional({ example: 9 })
  pierceCount?: number;

  @ApiPropertyOptional({ example: 45320.0 })
  flatPatternAreaMm2?: number;

  @ApiPropertyOptional({ description: 'Manufacturing Feature Graph JSON' })
  featureGraph?: object;

  @ApiPropertyOptional({ example: 'sheet_metal', description: 'Denormalised from featureGraph.classification.family for SQL filtering' })
  familyClassification?: string;

  @ApiPropertyOptional({ example: 0.94, description: 'Denormalised from featureGraph.classification.confidence' })
  familyConfidence?: number;

  @ApiPropertyOptional({ example: 1.6 })
  surfaceFinishRa?: number;

  @ApiPropertyOptional({ example: 0.8 })
  surfaceFinishConfidence?: number;

  @ApiPropertyOptional({ example: 'None' })
  heatTreatment?: string;

  @ApiPropertyOptional({ example: 'RAL9005 Powder Coat' })
  coating?: string;

  @ApiPropertyOptional({ example: 0.9 })
  coatingConfidence?: number;

  @ApiPropertyOptional({ example: 'medium' })
  complexity?: string;

  @ApiPropertyOptional({ example: 0.05 })
  tightestToleranceMm?: number;

  @ApiPropertyOptional({ example: 0.85 })
  toleranceConfidence?: number;

  @ApiPropertyOptional({ description: 'Full drawing intelligence JSON' })
  drawingIntelligence?: Record<string, any>;

  @ApiProperty({ example: '2025-01-15T10:30:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-01-20T14:45:00Z' })
  updatedAt: string;

  /**
   * Transform database row to DTO
   * Validates all required fields exist
   */
  static fromDatabase(row: any): BOMItemResponseDto {
    if (!row.id || !row.bom_id || !row.name || !row.item_type || row.quantity === undefined || row.annual_volume === undefined) {
      throw new Error('Invalid BOM item data from database: missing required fields');
    }

    const dto = new BOMItemResponseDto();
    dto.id = row.id;
    dto.bomId = row.bom_id;
    dto.name = row.name;
    dto.partNumber = row.part_number || undefined;
    dto.description = row.description || undefined;
    dto.itemType = row.item_type;
    dto.parentItemId = row.parent_item_id || undefined;
    dto.quantity = Number(row.quantity);
    dto.annualVolume = Number(row.annual_volume);
    dto.unit = row.unit || undefined;
    dto.material = row.material || undefined;
    dto.materialGrade = row.material_grade || undefined;
    dto.makeBuy = row.make_buy || undefined;
    dto.unitCost = row.unit_cost !== undefined && row.unit_cost !== null ? Number(row.unit_cost) : undefined;
    dto.weight = row.weight !== undefined && row.weight !== null ? Number(row.weight) : undefined;
    dto.maxLength = row.max_length !== undefined && row.max_length !== null ? Number(row.max_length) : undefined;
    dto.maxWidth = row.max_width !== undefined && row.max_width !== null ? Number(row.max_width) : undefined;
    dto.maxHeight = row.max_height !== undefined && row.max_height !== null ? Number(row.max_height) : undefined;
    dto.surfaceArea = row.surface_area !== undefined && row.surface_area !== null ? Number(row.surface_area) : undefined;
    dto.volume = row.volume !== undefined && row.volume !== null ? Number(row.volume) : undefined;
    dto.sortOrder = row.sort_order !== undefined ? Number(row.sort_order) : 0;
    dto.file3dPath = row.file_3d_path || undefined;
    dto.fileStepPath = row.file_step_path || undefined;
    dto.file2dPath = row.file_2d_path || undefined;
    dto.fileDxfPath = row.file_dxf_path || undefined;
    dto.thumbnailUrl = row.thumbnail_url || undefined;
    dto.manufacturingFamilyOverride = row.manufacturing_family_override || undefined;
    dto.materialSource     = row.material_source ?? undefined;
    dto.materialConfidence = row.material_confidence !== null && row.material_confidence !== undefined ? Number(row.material_confidence) : undefined;
    dto.sheetThicknessMm   = row.sheet_thickness_mm    !== null && row.sheet_thickness_mm    !== undefined ? Number(row.sheet_thickness_mm)    : undefined;
    dto.cutLengthMm        = row.cut_length_mm          !== null && row.cut_length_mm          !== undefined ? Number(row.cut_length_mm)          : undefined;
    dto.bendCount          = row.bend_count             !== null && row.bend_count             !== undefined ? Number(row.bend_count)             : undefined;
    dto.holeCount          = row.hole_count             !== null && row.hole_count             !== undefined ? Number(row.hole_count)             : undefined;
    dto.pierceCount        = row.pierce_count           !== null && row.pierce_count           !== undefined ? Number(row.pierce_count)           : undefined;
    dto.flatPatternAreaMm2 = row.flat_pattern_area_mm2 !== null && row.flat_pattern_area_mm2 !== undefined ? Number(row.flat_pattern_area_mm2) : undefined;
    dto.featureGraph          = row.feature_graph ?? undefined;
    dto.familyClassification  = row.family_classification || undefined;
    dto.familyConfidence      = row.family_confidence != null ? Number(row.family_confidence) : undefined;
    dto.surfaceFinishRa       = row.surface_finish_ra != null ? Number(row.surface_finish_ra) : undefined;
    dto.surfaceFinishConfidence = row.surface_finish_confidence != null ? Number(row.surface_finish_confidence) : undefined;
    dto.heatTreatment         = row.heat_treatment || undefined;
    dto.coating               = row.coating || undefined;
    dto.coatingConfidence     = row.coating_confidence != null ? Number(row.coating_confidence) : undefined;
    dto.complexity            = row.complexity || undefined;
    dto.tightestToleranceMm   = row.tightest_tolerance_mm != null ? Number(row.tightest_tolerance_mm) : undefined;
    dto.toleranceConfidence   = row.tolerance_confidence != null ? Number(row.tolerance_confidence) : undefined;
    dto.drawingIntelligence   = row.drawing_intelligence ?? undefined;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;

    return dto;
  }
}

export class BOMItemListResponseDto {
  @ApiProperty({ type: [BOMItemResponseDto] })
  items: BOMItemResponseDto[];
}
