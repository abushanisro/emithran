import { ApiProperty } from '@nestjs/swagger';

/**
 * BOM Response DTO
 * Defines the API contract for BOM responses
 */
export class BOMResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Main Assembly BOM' })
  name: string;

  @ApiProperty({ example: 'Primary bill of materials', required: false })
  description?: string;

  @ApiProperty({ example: 'uuid' })
  projectId: string;

  @ApiProperty({ enum: ['draft', 'approved', 'released', 'obsolete'] })
  status: string;

  @ApiProperty({ example: 0 })
  totalItems: number;

  @ApiProperty({ example: 0, required: false })
  totalCost?: number;

  @ApiProperty({ example: 'uuid' })
  createdBy: string;

  @ApiProperty({ example: 'uuid', required: false })
  approvedBy?: string;

  @ApiProperty({ example: '2025-01-20T14:45:00Z', required: false })
  approvedAt?: string;

  @ApiProperty({ example: '2025-01-15T10:30:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-01-20T14:45:00Z' })
  updatedAt: string;

  /**
   * Transform database row to DTO
   * Validates all required fields exist
   */
  static fromDatabase(row: any): BOMResponseDto {
    if (!row.id || !row.name || !row.project_id || !row.created_at || !row.updated_at) {
      throw new Error('Invalid BOM data from database: missing required fields');
    }

    const dto = new BOMResponseDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.description = row.description || undefined;
    dto.projectId = row.project_id;
    dto.status = row.status || 'draft';
    dto.totalItems = row.total_items || 0;
    dto.totalCost = row.total_cost || undefined;
    dto.createdBy = row.user_id || row.created_by;
    dto.approvedBy = row.approved_by || undefined;
    dto.approvedAt = row.approved_at || undefined;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;

    return dto;
  }
}

export class BOMListResponseDto {
  @ApiProperty({ type: [BOMResponseDto] })
  boms: BOMResponseDto[];

  @ApiProperty({ example: 42, description: 'Total number of BOMs' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;
}
