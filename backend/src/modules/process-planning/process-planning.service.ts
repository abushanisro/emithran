import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateProcessPlanningSpecDto, UpdateProcessPlanningSpecDto, ProcessPlanningSpecResponseDto } from './dto/process-planning.dto';

@Injectable()
export class ProcessPlanningService {
  private readonly logger = new Logger(ProcessPlanningService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Get process planning specifications for a BOM item
   */
  async getSpecificationsByBomItem(bomItemId: string, userId: string): Promise<ProcessPlanningSpecResponseDto | null> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('process_planning_with_bom_details')
        .select('*')
        .eq('bom_item_id', bomItemId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          return null;
        }
        throw error;
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error(`Error getting process planning specs for BOM item ${bomItemId}:`, error);
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to access these specifications.');
      }
      throw new BadRequestException('Failed to retrieve process planning specifications.');
    }
  }

  /**
   * Get all process planning specifications for a project
   */
  async getSpecificationsByProject(projectId: string, userId: string): Promise<ProcessPlanningSpecResponseDto[]> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('process_planning_with_bom_details')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return (data || []).map(item => this.mapToResponseDto(item));
    } catch (error) {
      this.logger.error(`Error getting process planning specs for project ${projectId}:`, error);
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to access these specifications.');
      }
      throw new BadRequestException('Failed to retrieve process planning specifications.');
    }
  }

  /**
   * Upsert (create or update) process planning specifications
   */
  async upsertSpecifications(dto: CreateProcessPlanningSpecDto, userId: string): Promise<ProcessPlanningSpecResponseDto> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('process_planning_specifications')
        .upsert({
          bom_item_id: dto.bomItemId,
          project_id: dto.projectId,
          tolerance_grade: dto.toleranceGrade || 'IT8',
          surface_finish: dto.surfaceFinish || 'Ra 3.2 μm',
          heat_treatment: dto.heatTreatment || 'As Required',
          hardness: dto.hardness,
          manufacturing_method: dto.manufacturingMethod,
          tooling_required: dto.toolingRequired,
          special_instructions: dto.specialInstructions,
          coating_specification: dto.coatingSpecification,
          created_by: userId,
          updated_by: userId
        }, {
          onConflict: 'bom_item_id,project_id'
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error(`Error upserting process planning specs:`, error);
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to modify specifications for this project.');
      }
      throw new BadRequestException('Failed to save process planning specifications.');
    }
  }

  /**
   * Create new process planning specifications
   */
  async createSpecifications(dto: CreateProcessPlanningSpecDto, userId: string): Promise<ProcessPlanningSpecResponseDto> {
    try {
      const client = this.supabaseService.getClient();

      // Check if specifications already exist for this BOM item
      const { data: existing } = await client
        .from('process_planning_specifications')
        .select('id')
        .eq('bom_item_id', dto.bomItemId)
        .eq('project_id', dto.projectId)
        .single();

      if (existing) {
        throw new BadRequestException('Process planning specifications already exist for this BOM item.');
      }

      const { data, error } = await client
        .from('process_planning_specifications')
        .insert({
          bom_item_id: dto.bomItemId,
          project_id: dto.projectId,
          tolerance_grade: dto.toleranceGrade || 'IT8',
          surface_finish: dto.surfaceFinish || 'Ra 3.2 μm',
          heat_treatment: dto.heatTreatment || 'As Required',
          hardness: dto.hardness,
          manufacturing_method: dto.manufacturingMethod,
          tooling_required: dto.toolingRequired,
          special_instructions: dto.specialInstructions,
          coating_specification: dto.coatingSpecification,
          created_by: userId,
          updated_by: userId
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error(`Error creating process planning specs:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to create specifications for this project.');
      }
      throw new BadRequestException('Failed to create process planning specifications.');
    }
  }

  /**
   * Update existing process planning specifications
   */
  async updateSpecifications(bomItemId: string, dto: UpdateProcessPlanningSpecDto, userId: string): Promise<ProcessPlanningSpecResponseDto> {
    try {
      const client = this.supabaseService.getClient();

      const { data, error } = await client
        .from('process_planning_specifications')
        .update({
          tolerance_grade: dto.toleranceGrade,
          surface_finish: dto.surfaceFinish,
          heat_treatment: dto.heatTreatment,
          hardness: dto.hardness,
          manufacturing_method: dto.manufacturingMethod,
          tooling_required: dto.toolingRequired,
          special_instructions: dto.specialInstructions,
          coating_specification: dto.coatingSpecification,
          updated_by: userId
        })
        .eq('bom_item_id', bomItemId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new NotFoundException('Process planning specifications not found.');
        }
        throw error;
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error(`Error updating process planning specs for BOM item ${bomItemId}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to modify specifications for this project.');
      }
      throw new BadRequestException('Failed to update process planning specifications.');
    }
  }

  /**
   * Delete process planning specifications
   */
  async deleteSpecifications(bomItemId: string, userId: string): Promise<void> {
    try {
      const client = this.supabaseService.getClient();

      const { error } = await client
        .from('process_planning_specifications')
        .delete()
        .eq('bom_item_id', bomItemId);

      if (error) {
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error deleting process planning specs for BOM item ${bomItemId}:`, error);
      if (error.message?.includes('row-level security')) {
        throw new ForbiddenException('You do not have permission to delete specifications for this project.');
      }
      throw new BadRequestException('Failed to delete process planning specifications.');
    }
  }

  /**
   * Map database row to response DTO
   */
  private mapToResponseDto(row: any): ProcessPlanningSpecResponseDto {
    return {
      id: row.id,
      bomItemId: row.bom_item_id,
      projectId: row.project_id,
      toleranceGrade: row.tolerance_grade || 'IT8',
      surfaceFinish: row.surface_finish || 'Ra 3.2 μm',
      heatTreatment: row.heat_treatment || 'As Required',
      hardness: row.hardness,
      manufacturingMethod: row.manufacturing_method,
      toolingRequired: row.tooling_required,
      specialInstructions: row.special_instructions,
      coatingSpecification: row.coating_specification,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      // BOM item details from view
      bomItemName: row.bom_item_name,
      partNumber: row.part_number,
      bomItemDescription: row.bom_item_description,
      itemType: row.item_type,
      material: row.material,
      materialGrade: row.material_grade
    };
  }
}