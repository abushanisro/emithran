import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { UuidValidator } from '@/common/validators/uuid.validator';
import { CreateSubtaskDto, UpdateSubtaskDto, SubtaskResponseDto } from '../dto/subtask.dto';

@Injectable()
export class SubtaskService {
  private readonly logger = new Logger(SubtaskService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createSubtask(createDto: CreateSubtaskDto, userId: string): Promise<SubtaskResponseDto> {
    UuidValidator.validateUuid(createDto.productionProcessId, 'Production Process ID');
    UuidValidator.validateUuid(userId, 'User ID');

    const supabase = this.supabaseService.getClient();

    try {
      // Verify the production process exists and user has access
      const { data: processData, error: processError } = await supabase
        .from('production_processes')
        .select('id, production_lot:production_lots!inner(created_by)')
        .eq('id', createDto.productionProcessId)
        .eq('production_lots.created_by', userId)
        .single();

      if (processError || !processData) {
        throw new NotFoundException('Production process not found or access denied');
      }

      // Prepare BOM parts data for the database function
      const bomPartsJson = createDto.bomParts?.map(part => ({
        bom_item_id: part.bomItemId,
        required_quantity: part.requiredQuantity,
        unit: part.unit || 'pcs'
      })) || [];

      // Call the database function to create subtask with BOM parts
      const { data, error } = await supabase.rpc('create_subtask_with_bom_parts', {
        p_production_process_id: createDto.productionProcessId,
        p_task_name: createDto.taskName,
        p_created_by: userId,
        p_description: createDto.description || null,
        p_assigned_operator: createDto.assignedOperator || null,
        p_planned_start_date: createDto.plannedStartDate || null,
        p_planned_end_date: createDto.plannedEndDate || null,
        p_status: createDto.status || 'PENDING',
        p_bom_parts: JSON.stringify(bomPartsJson)
      });

      if (error) {
        this.logger.error('Failed to create subtask:', error);
        throw new InternalServerErrorException('Failed to create subtask: ' + error.message);
      }

      if (!data || data.length === 0 || !data[0].success) {
        throw new InternalServerErrorException('Failed to create subtask: ' + (data?.[0]?.message || 'Unknown error'));
      }

      const result = data[0];

      // Fetch the created subtask details
      const createdSubtask = await this.getSubtaskById(result.subtask_id, userId);

      this.logger.log(`Subtask created successfully: ${result.subtask_id}`);
      return createdSubtask;

    } catch (error) {
      this.logger.error('Error creating subtask:', error);
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create subtask');
    }
  }

  async getSubtaskById(subtaskId: string, userId: string): Promise<SubtaskResponseDto> {
    UuidValidator.validateUuid(subtaskId, 'Subtask ID');

    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('process_subtasks')
      .select(`
        *,
        production_process:production_processes!inner(
          id,
          production_lot:production_lots!inner(created_by)
        ),
        bom_requirements:subtask_bom_requirements(
          id,
          bom_item_id,
          required_quantity,
          unit,
          requirement_status,
          bom_item:bom_items(
            id,
            part_number,
            name,
            description
          )
        )
      `)
      .eq('id', subtaskId)
      .eq('production_processes.production_lots.created_by', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Subtask not found or access denied');
    }

    return this.mapToSubtaskResponse(data);
  }

  async getSubtasksByProcess(processId: string, userId: string): Promise<SubtaskResponseDto[]> {
    UuidValidator.validateUuid(processId, 'Process ID');

    const supabase = this.supabaseService.getClient();

    // Verify process access first
    const { data: processData } = await supabase
      .from('production_processes')
      .select('id, production_lot:production_lots!inner(created_by)')
      .eq('id', processId)
      .eq('production_lots.created_by', userId)
      .single();

    if (!processData) {
      throw new NotFoundException('Production process not found or access denied');
    }

    const { data, error } = await supabase
      .from('process_subtasks')
      .select(`
        *,
        bom_requirements:subtask_bom_requirements(
          id,
          bom_item_id,
          required_quantity,
          unit,
          requirement_status,
          bom_item:bom_items(
            id,
            part_number,
            name,
            description
          )
        )
      `)
      .eq('production_process_id', processId)
      .order('task_sequence');

    if (error) {
      throw new InternalServerErrorException('Failed to fetch subtasks: ' + error.message);
    }

    return (data || []).map(subtask => this.mapToSubtaskResponse(subtask));
  }

  async updateSubtask(subtaskId: string, updateDto: UpdateSubtaskDto, userId: string): Promise<SubtaskResponseDto> {
    UuidValidator.validateUuid(subtaskId, 'Subtask ID');

    const supabase = this.supabaseService.getClient();

    // Verify access
    const existing = await this.getSubtaskById(subtaskId, userId);
    if (!existing) {
      throw new NotFoundException('Subtask not found or access denied');
    }

    const { error } = await supabase
      .from('process_subtasks')
      .update({
        task_name: updateDto.taskName,
        description: updateDto.description,
        assigned_operator: updateDto.assignedOperator,
        operator_name: updateDto.assignedOperator,
        status: updateDto.status,
        planned_start_date: updateDto.plannedStartDate,
        planned_end_date: updateDto.plannedEndDate,
        actual_start_date: updateDto.actualStartDate,
        actual_end_date: updateDto.actualEndDate,
        notes: updateDto.notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', subtaskId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update subtask:', error);
      throw new InternalServerErrorException('Failed to update subtask');
    }

    return this.getSubtaskById(subtaskId, userId);
  }

  async deleteSubtask(subtaskId: string, userId: string): Promise<void> {
    UuidValidator.validateUuid(subtaskId, 'Subtask ID');

    // Verify access first
    await this.getSubtaskById(subtaskId, userId);

    const supabase = this.supabaseService.getClient();

    const { error } = await supabase
      .from('process_subtasks')
      .delete()
      .eq('id', subtaskId);

    if (error) {
      this.logger.error('Failed to delete subtask:', error);
      throw new InternalServerErrorException('Failed to delete subtask');
    }
  }

  private mapToSubtaskResponse(data: any): SubtaskResponseDto {
    return {
      id: data.id,
      productionProcessId: data.production_process_id,
      taskName: data.task_name,
      description: data.description,
      taskSequence: data.task_sequence,
      plannedStartDate: data.planned_start_date,
      plannedEndDate: data.planned_end_date,
      actualStartDate: data.actual_start_date,
      actualEndDate: data.actual_end_date,
      assignedOperator: data.assigned_operator,
      operatorName: data.operator_name,
      status: data.status,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      bomRequirements: (data.bom_requirements || []).map((req: any) => ({
        id: req.id,
        bomItemId: req.bom_item_id,
        partNumber: req.bom_item?.part_number,
        partName: req.bom_item?.name || req.bom_item?.part_number,
        description: req.bom_item?.description,
        requiredQuantity: req.required_quantity,
        unit: req.unit,
        status: req.requirement_status
      }))
    };
  }
}