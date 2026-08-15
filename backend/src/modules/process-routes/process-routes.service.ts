import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateProcessRouteDto,
  UpdateProcessRouteDto,
  QueryProcessRoutesDto,
  WorkflowTransitionDto,
  CreateProcessRouteStepDto,
  UpdateProcessRouteStepDto,
  ReorderProcessRouteStepsDto,
  ExecuteCalculatorDto,
  SaveSessionDto,
  AssignRoleDto,
  UpdateRoleDto,
  WorkflowState,
} from './dto/process-route.dto';
import {
  ProcessRouteResponseDto,
  PaginatedProcessRoutesResponseDto,
  ProcessRouteStepResponseDto,
  WorkflowHistoryResponseDto,
  CostSummaryResponseDto,
  SessionResponseDto,
  UserRoleResponseDto,
} from './dto/process-route-response.dto';

@Injectable()
export class ProcessRoutesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // ============================================================================
  // Process Routes CRUD
  // ============================================================================

  async findAll(
    query: QueryProcessRoutesDto,
    userId: string,
    accessToken: string,
  ): Promise<PaginatedProcessRoutesResponseDto> {
    this.logger.log('Fetching all process routes', 'ProcessRoutesService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .select(
        `
        *,
        bom_items!inner(
          id,
          part_number,
          name,
          boms(id, name)
        )
      `,
        { count: 'exact' },
      )
      .order(query.sortBy || 'created_at', { ascending: query.sortOrder === 'asc' })
      .range(from, to);

    // Apply filters
    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }

    if (query.workflowState) {
      queryBuilder = queryBuilder.eq('workflow_state', query.workflowState);
    }

    if (query.processGroup) {
      queryBuilder = queryBuilder.eq('process_group', query.processGroup);
    }

    if (query.processCategory) {
      queryBuilder = queryBuilder.eq('process_category', query.processCategory);
    }

    if (query.isTemplate !== undefined) {
      queryBuilder = queryBuilder.eq('is_template', query.isTemplate);
    }

    if (query.createdByRole) {
      queryBuilder = queryBuilder.eq('created_by_role', query.createdByRole);
    }

    if (query.priority) {
      queryBuilder = queryBuilder.eq('priority', query.priority);
    }

    if (query.assignedTo) {
      queryBuilder = queryBuilder.eq('assigned_to', query.assignedTo);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching process routes: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to fetch process routes: ${error.message}`);
    }

    const routes = (data || []).map(this.transformRouteFromDatabase);
    const totalPages = Math.ceil((count || 0) / limit);

    return {
      routes,
      count: count || 0,
      page,
      limit,
      totalPages,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<ProcessRouteResponseDto> {
    this.logger.log(`Fetching process route: ${id}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .select(
        `
        *,
        bom_items(
          id,
          part_number,
          name,
          boms(id, name)
        )
      `,
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Process route not found: ${id}`, 'ProcessRoutesService');
      throw new NotFoundException(`Process route with ID ${id} not found`);
    }

    return this.transformRouteFromDatabase(data);
  }

  async create(
    createDto: CreateProcessRouteDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    this.logger.log('Creating process route', 'ProcessRoutesService');

    const insertData = {
      bom_item_id: createDto.bomItemId,
      name: createDto.name,
      description: createDto.description,
      process_group: createDto.processGroup,
      process_category: createDto.processCategory,
      is_template: createDto.isTemplate || false,
      template_name: createDto.templateName,
      created_by_role: createDto.createdByRole || 'process_planner',
      assigned_to: createDto.assignedTo,
      priority: createDto.priority || 'normal',
      workflow_state: 'draft',
      user_id: userId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating process route: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to create process route: ${error.message}`);
    }

    return this.transformRouteFromDatabase(data);
  }

  async update(
    id: string,
    updateDto: UpdateProcessRouteDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    this.logger.log(`Updating process route: ${id}`, 'ProcessRoutesService');

    const updateData: any = {};

    if (updateDto.name !== undefined) updateData.name = updateDto.name;
    if (updateDto.description !== undefined) updateData.description = updateDto.description;
    if (updateDto.processGroup !== undefined) updateData.process_group = updateDto.processGroup;
    if (updateDto.processCategory !== undefined) updateData.process_category = updateDto.processCategory;
    if (updateDto.isTemplate !== undefined) updateData.is_template = updateDto.isTemplate;
    if (updateDto.templateName !== undefined) updateData.template_name = updateDto.templateName;
    if (updateDto.assignedTo !== undefined) updateData.assigned_to = updateDto.assignedTo;
    if (updateDto.priority !== undefined) updateData.priority = updateDto.priority;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating process route: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to update process route: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`Process route with ID ${id} not found`);
    }

    return this.transformRouteFromDatabase(data);
  }

  async delete(id: string, userId: string, accessToken: string): Promise<void> {
    this.logger.log(`Deleting process route: ${id}`, 'ProcessRoutesService');

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting process route: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to delete process route: ${error.message}`);
    }
  }

  // ============================================================================
  // Workflow State Transitions
  // ============================================================================

  async submitForReview(
    id: string,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.transitionWorkflowState(id, WorkflowState.IN_REVIEW, dto, userId, accessToken);
  }

  async approve(
    id: string,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .update({
        workflow_state: WorkflowState.APPROVED,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error approving process route: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to approve process route: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`Process route with ID ${id} not found`);
    }

    // Add comment to history if provided
    if (dto.comment) {
      await this.addWorkflowComment(id, WorkflowState.APPROVED, dto.comment, userId, dto.role, accessToken);
    }

    return this.transformRouteFromDatabase(data);
  }

  async reject(
    id: string,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.transitionWorkflowState(id, WorkflowState.DRAFT, dto, userId, accessToken);
  }

  async activate(
    id: string,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.transitionWorkflowState(id, WorkflowState.ACTIVE, dto, userId, accessToken);
  }

  async archive(
    id: string,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.transitionWorkflowState(id, WorkflowState.ARCHIVED, dto, userId, accessToken);
  }

  private async transitionWorkflowState(
    id: string,
    toState: WorkflowState,
    dto: WorkflowTransitionDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteResponseDto> {
    this.logger.log(`Transitioning workflow state for route ${id} to ${toState}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .update({
        workflow_state: toState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error transitioning workflow state: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to transition workflow state: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`Process route with ID ${id} not found`);
    }

    // Add comment to history if provided
    if (dto.comment) {
      await this.addWorkflowComment(id, toState, dto.comment, userId, dto.role, accessToken);
    }

    return this.transformRouteFromDatabase(data);
  }

  private async addWorkflowComment(
    routeId: string,
    toState: string,
    comment: string,
    userId: string,
    role: string | undefined,
    accessToken: string,
  ): Promise<void> {
    await this.supabaseService.getClient(accessToken).from('process_route_workflow_history').insert({
      route_id: routeId,
      to_state: toState,
      changed_by: userId,
      comment,
    });
  }

  async getWorkflowHistory(id: string, userId: string, accessToken: string): Promise<WorkflowHistoryResponseDto[]> {
    this.logger.log(`Fetching workflow history for route: ${id}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_workflow_history')
      .select('*')
      .eq('route_id', id)
      .order('changed_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching workflow history: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to fetch workflow history: ${error.message}`);
    }

    return (data || []).map(this.transformWorkflowHistoryFromDatabase);
  }

  // ============================================================================
  // Process Route Steps CRUD
  // ============================================================================

  async getSteps(routeId: string, userId: string, accessToken: string): Promise<ProcessRouteStepResponseDto[]> {
    this.logger.log(`Fetching steps for route: ${routeId}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .select('*')
      .eq('process_route_id', routeId)
      .order('step_number', { ascending: true });

    if (error) {
      this.logger.error(`Error fetching route steps: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to fetch route steps: ${error.message}`);
    }

    return (data || []).map(this.transformStepFromDatabase);
  }

  async addStep(
    createDto: CreateProcessRouteStepDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteStepResponseDto> {
    this.logger.log('Creating process route step', 'ProcessRoutesService');

    const insertData = {
      process_route_id: createDto.processRouteId,
      process_id: createDto.processId,
      step_number: createDto.stepNumber,
      operation_name: createDto.operationName,
      setup_time_minutes: createDto.setupTimeMinutes,
      cycle_time_minutes: createDto.cycleTimeMinutes,
      labor_hours: createDto.laborHours,
      machine_hours: createDto.machineHours,
      machine_hour_rate_id: createDto.machineHourRateId,
      labor_hour_rate_id: createDto.laborHourRateId,
      calculated_cost: createDto.calculatedCost,
      calculator_mapping_id: createDto.calculatorMappingId,
      extracted_values: createDto.extractedValues || {},
      notes: createDto.notes,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating route step: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to create route step: ${error.message}`);
    }

    // Recalculate route totals
    await this.recalculateRouteTotals(createDto.processRouteId, accessToken);

    return this.transformStepFromDatabase(data);
  }

  async updateStep(
    id: string,
    updateDto: UpdateProcessRouteStepDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteStepResponseDto> {
    this.logger.log(`Updating route step: ${id}`, 'ProcessRoutesService');

    const updateData: any = {};

    if (updateDto.processId !== undefined) updateData.process_id = updateDto.processId;
    if (updateDto.stepNumber !== undefined) updateData.step_number = updateDto.stepNumber;
    if (updateDto.operationName !== undefined) updateData.operation_name = updateDto.operationName;
    if (updateDto.setupTimeMinutes !== undefined) updateData.setup_time_minutes = updateDto.setupTimeMinutes;
    if (updateDto.cycleTimeMinutes !== undefined) updateData.cycle_time_minutes = updateDto.cycleTimeMinutes;
    if (updateDto.laborHours !== undefined) updateData.labor_hours = updateDto.laborHours;
    if (updateDto.machineHours !== undefined) updateData.machine_hours = updateDto.machineHours;
    if (updateDto.machineHourRateId !== undefined) updateData.machine_hour_rate_id = updateDto.machineHourRateId;
    if (updateDto.laborHourRateId !== undefined) updateData.labor_hour_rate_id = updateDto.laborHourRateId;
    if (updateDto.calculatedCost !== undefined) updateData.calculated_cost = updateDto.calculatedCost;
    if (updateDto.calculatorMappingId !== undefined) updateData.calculator_mapping_id = updateDto.calculatorMappingId;
    if (updateDto.extractedValues !== undefined) updateData.extracted_values = updateDto.extractedValues;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating route step: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to update route step: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`Route step with ID ${id} not found`);
    }

    // Recalculate route totals
    await this.recalculateRouteTotals(data.process_route_id, accessToken);

    return this.transformStepFromDatabase(data);
  }

  async deleteStep(id: string, userId: string, accessToken: string): Promise<void> {
    this.logger.log(`Deleting route step: ${id}`, 'ProcessRoutesService');

    // Get the step to know which route to recalculate
    const { data: step } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .select('process_route_id')
      .eq('id', id)
      .single();

    const { error } = await this.supabaseService.getClient(accessToken).from('process_route_steps').delete().eq('id', id);

    if (error) {
      this.logger.error(`Error deleting route step: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to delete route step: ${error.message}`);
    }

    // Recalculate route totals if we found the step
    if (step) {
      await this.recalculateRouteTotals(step.process_route_id, accessToken);
    }
  }

  async reorderSteps(
    routeId: string,
    dto: ReorderProcessRouteStepsDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteStepResponseDto[]> {
    this.logger.log(`Reordering steps for route: ${routeId}`, 'ProcessRoutesService');

    // Update step numbers based on the order in the array
    for (let i = 0; i < dto.stepIds.length; i++) {
      const stepId = dto.stepIds[i];
      await this.supabaseService
        .getClient(accessToken)
        .from('process_route_steps')
        .update({ step_number: i + 1 })
        .eq('id', stepId);
    }

    // Fetch updated steps
    return this.getSteps(routeId, userId, accessToken);
  }

  // ============================================================================
  // Calculator Integration & Cost Summary
  // ============================================================================

  async executeCalculator(
    routeId: string,
    stepId: string,
    dto: ExecuteCalculatorDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessRouteStepResponseDto> {
    this.logger.log(`Executing calculator for step: ${stepId}`, 'ProcessRoutesService');

    // Get the step to find calculator mapping
    const { data: step, error: stepError } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .select('*')
      .eq('id', stepId)
      .single();

    if (stepError || !step) {
      throw new NotFoundException(`Step with ID ${stepId} not found`);
    }

    // TODO: Integrate with calculator service to execute calculation
    // For now, store the input values
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .update({
        extracted_values: dto.inputs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', stepId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error executing calculator: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to execute calculator: ${error.message}`);
    }

    return this.transformStepFromDatabase(data);
  }

  async getCostSummary(id: string, userId: string, accessToken: string): Promise<CostSummaryResponseDto> {
    this.logger.log(`Fetching cost summary for route: ${id}`, 'ProcessRoutesService');

    const route = await this.findOne(id, userId, accessToken);
    const steps = await this.getSteps(id, userId, accessToken);

    return {
      processRouteId: route.id,
      totalSetupTimeMinutes: route.totalSetupTimeMinutes,
      totalCycleTimeMinutes: route.totalCycleTimeMinutes,
      totalCost: route.totalCost,
      totalSteps: steps.length,
      steps: steps.map((step) => ({
        stepNumber: step.stepNumber,
        operationName: step.operationName,
        setupTimeMinutes: step.setupTimeMinutes || 0,
        cycleTimeMinutes: step.cycleTimeMinutes || 0,
        calculatedCost: step.calculatedCost || 0,
      })),
      calculatedAt: new Date().toISOString(),
    };
  }

  private async recalculateRouteTotals(routeId: string, accessToken: string): Promise<void> {
    // Get all steps for this route
    const { data: steps } = await this.supabaseService
      .getClient(accessToken)
      .from('process_route_steps')
      .select('setup_time_minutes, cycle_time_minutes, calculated_cost')
      .eq('process_route_id', routeId);

    if (!steps) return;

    const totalSetupTime = steps.reduce((sum, step) => sum + (step.setup_time_minutes || 0), 0);
    const totalCycleTime = steps.reduce((sum, step) => sum + (step.cycle_time_minutes || 0), 0);
    const totalCost = steps.reduce((sum, step) => sum + (step.calculated_cost || 0), 0);

    // Update the route with calculated totals
    await this.supabaseService
      .getClient(accessToken)
      .from('process_routes')
      .update({
        total_setup_time_minutes: totalSetupTime,
        total_cycle_time_minutes: totalCycleTime,
        total_cost: totalCost,
        updated_at: new Date().toISOString(),
      })
      .eq('id', routeId);
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  async getActiveSession(
    userId: string,
    bomItemId: string,
    accessToken: string,
  ): Promise<SessionResponseDto | null> {
    this.logger.log(`Fetching active session for user: ${userId}, BOM item: ${bomItemId}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" error
      this.logger.error(`Error fetching session: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to fetch session: ${error.message}`);
    }

    return data ? this.transformSessionFromDatabase(data) : null;
  }

  async saveSession(userId: string, dto: SaveSessionDto, accessToken: string): Promise<SessionResponseDto> {
    this.logger.log(`Saving session for user: ${userId}`, 'ProcessRoutesService');

    const sessionData = {
      user_id: userId,
      active_tab: dto.activeCategory,
      filters: dto.sessionData || {},
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('user_sessions')
      .upsert(sessionData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error saving session: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to save session: ${error.message}`);
    }

    return this.transformSessionFromDatabase(data);
  }

  // ============================================================================
  // User Roles Management
  // ============================================================================

  async getUserRoles(userId: string, accessToken: string): Promise<UserRoleResponseDto[]> {
    this.logger.log(`Fetching roles for user: ${userId}`, 'ProcessRoutesService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching user roles: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to fetch user roles: ${error.message}`);
    }

    return (data || []).map(this.transformUserRoleFromDatabase);
  }

  async assignRole(userId: string, dto: AssignRoleDto, accessToken: string): Promise<UserRoleResponseDto> {
    this.logger.log(`Assigning role ${dto.role} to user: ${userId}`, 'ProcessRoutesService');

    const roleData = {
      user_id: userId,
      role: dto.role,
      is_primary: dto.isPrimary || false,
      organization_id: dto.organizationId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('user_roles')
      .insert(roleData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error assigning role: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to assign role: ${error.message}`);
    }

    return this.transformUserRoleFromDatabase(data);
  }

  async updateRole(roleId: string, dto: UpdateRoleDto, userId: string, accessToken: string): Promise<UserRoleResponseDto> {
    this.logger.log(`Updating role: ${roleId}`, 'ProcessRoutesService');

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (dto.isPrimary !== undefined) {
      updateData.is_primary = dto.isPrimary;
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('user_roles')
      .update(updateData)
      .eq('id', roleId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating role: ${error.message}`, 'ProcessRoutesService');
      throw new InternalServerErrorException(`Failed to update role: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    return this.transformUserRoleFromDatabase(data);
  }

  // ============================================================================
  // Helper Methods for Database Transformation
  // ============================================================================

  private transformRouteFromDatabase(row: any): ProcessRouteResponseDto {
    return {
      id: row.id,
      bomItemId: row.bom_item_id,
      name: row.name,
      description: row.description,
      isTemplate: row.is_template,
      templateName: row.template_name,
      processGroup: row.process_group,
      processCategory: row.process_category,
      workflowState: row.workflow_state,
      workflowUpdatedAt: row.workflow_updated_at,
      workflowUpdatedBy: row.workflow_updated_by,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdByRole: row.created_by_role,
      assignedTo: row.assigned_to,
      priority: row.priority,
      totalSetupTimeMinutes: row.total_setup_time_minutes,
      totalCycleTimeMinutes: row.total_cycle_time_minutes,
      totalCost: row.total_cost,
      userId: row.user_id,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Optional joined data
      partNumber: row.bom_items?.part_number,
      bomItemName: row.bom_items?.name,
      bomName: row.boms?.name,
    };
  }

  private transformStepFromDatabase(row: any): ProcessRouteStepResponseDto {
    return {
      id: row.id,
      processRouteId: row.process_route_id,
      processId: row.process_id,
      stepNumber: row.step_number,
      operationName: row.operation_name,
      setupTimeMinutes: row.setup_time_minutes,
      cycleTimeMinutes: row.cycle_time_minutes,
      laborHours: row.labor_hours,
      machineHours: row.machine_hours,
      machineHourRateId: row.machine_hour_rate_id,
      laborHourRateId: row.labor_hour_rate_id,
      calculatedCost: row.calculated_cost,
      calculatorMappingId: row.calculator_mapping_id,
      extractedValues: row.extracted_values,
      isCompleted: row.is_completed,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private transformWorkflowHistoryFromDatabase(row: any): WorkflowHistoryResponseDto {
    return {
      id: row.id,
      processRouteId: row.route_id,
      fromState: row.from_state,
      toState: row.to_state,
      changedBy: row.changed_by,
      changedByRole: '', // Not stored in new migration
      comment: row.comment,
      createdAt: row.changed_at,
    };
  }

  private transformSessionFromDatabase(row: any): SessionResponseDto {
    return {
      id: row.id,
      userId: row.user_id,
      bomItemId: '', // Not stored in new schema
      processRouteId: '', // Not stored in new schema
      activeCategory: row.active_tab,
      activeRole: '', // Not stored in new schema
      sessionData: row.filters,
      lastAccessedAt: row.last_accessed,
      createdAt: row.created_at,
    };
  }

  private transformUserRoleFromDatabase(row: any): UserRoleResponseDto {
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      isPrimary: row.is_primary,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
