import { ApiProperty } from '@nestjs/swagger';
import { ProjectStatus } from './projects.dto';

/**
 * Project Response DTO
 * Defines the API contract for project responses
 * Maps database snake_case to API camelCase
 */
export class ProjectResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Engine Block Manufacturing' })
  name: string;

  @ApiProperty({ example: 'Manufacturing cost analysis project', required: false })
  description?: string;

  @ApiProperty({ example: 'United States', required: false })
  country?: string;

  @ApiProperty({ example: 'California', required: false })
  state?: string;

  @ApiProperty({ example: 'San Francisco', required: false })
  city?: string;

  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.ACTIVE })
  status: ProjectStatus;

  @ApiProperty({ example: 3750000, required: false, description: 'Target price in rupees' })
  targetPrice?: number;

  @ApiProperty({ example: 'Automotive', required: false })
  industry?: string;

  @ApiProperty({ example: 50000, required: false, description: 'Estimated annual volume' })
  estimatedAnnualVolume?: number;

  @ApiProperty({ example: 2500.00, required: false, description: 'Target BOM cost' })
  targetBomCost?: number;

  @ApiProperty({ example: 'USD', required: false, description: 'Target BOM cost currency' })
  targetBomCostCurrency?: string;

  @ApiProperty({ example: '2025-01-15T10:30:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-01-20T14:45:00Z' })
  updatedAt: string;

  /**
   * Transform database row to DTO
   * Validates all required fields exist
   */
  static fromDatabase(row: any): ProjectResponseDto {
    if (!row.id || !row.name || !row.status || !row.created_at || !row.updated_at) {
      throw new Error('Invalid project data from database: missing required fields');
    }

    const dto = new ProjectResponseDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.description = row.description || undefined;
    dto.country = row.country || undefined;
    dto.state = row.state || undefined;
    dto.city = row.city || undefined;
    dto.status = row.status;
    dto.targetPrice = row.target_price ? Number(row.target_price) : undefined;
    dto.industry = row.industry || undefined;
    dto.estimatedAnnualVolume = row.estimated_annual_volume ? Number(row.estimated_annual_volume) : undefined;
    dto.targetBomCost = row.target_bom_cost ? Number(row.target_bom_cost) : undefined;
    dto.targetBomCostCurrency = row.target_bom_cost_currency || undefined;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;

    return dto;
  }
}

export class ProjectListResponseDto {
  @ApiProperty({ type: [ProjectResponseDto] })
  projects: ProjectResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;
}
