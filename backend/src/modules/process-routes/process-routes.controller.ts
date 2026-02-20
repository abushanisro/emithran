interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProcessRoutesService } from './process-routes.service';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Process Routes')
@ApiBearerAuth()
@Controller({ path: 'api/process-routes', version: '1' })
export class ProcessRoutesController {
  constructor(private readonly processRoutesService: ProcessRoutesService) {}

  // ============================================================================
  // PROCESS ROUTES CRUD
  // ============================================================================

  @Get()
  @ApiOperation({ summary: 'Get all process routes with filtering and pagination' })
  @ApiResponse({
    status: 200,
    description: 'Process routes retrieved successfully',
    type: PaginatedProcessRoutesResponseDto,
  })
  async findAll(
    @Query() query: QueryProcessRoutesDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<PaginatedProcessRoutesResponseDto> {
    return this.processRoutesService.findAll(query, user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get process route by ID' })
  @ApiResponse({
    status: 200,
    description: 'Process route retrieved successfully',
    type: ProcessRouteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Process route not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.findOne(id, user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create new process route' })
  @ApiResponse({
    status: 201,
    description: 'Process route created successfully',
    type: ProcessRouteResponseDto,
  })
  async create(
    @Body() createDto: CreateProcessRouteDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.create(createDto, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update process route' })
  @ApiResponse({
    status: 200,
    description: 'Process route updated successfully',
    type: ProcessRouteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Process route not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProcessRouteDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.update(id, updateDto, user.id, token);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete process route' })
  @ApiResponse({ status: 204, description: 'Process route deleted successfully' })
  @ApiResponse({ status: 404, description: 'Process route not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.processRoutesService.delete(id, user.id, token);
  }

  // ============================================================================
  // WORKFLOW STATE TRANSITIONS
  // ============================================================================

  @Post(':id/workflow/submit-for-review')
  @ApiOperation({ summary: 'Submit process route for review' })
  @ApiResponse({
    status: 200,
    description: 'Process route submitted for review',
    type: ProcessRouteResponseDto,
  })
  async submitForReview(
    @Param('id') id: string,
    @Body() dto: WorkflowTransitionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.submitForReview(id, dto, user.id, token);
  }

  @Post(':id/workflow/approve')
  @ApiOperation({ summary: 'Approve process route' })
  @ApiResponse({
    status: 200,
    description: 'Process route approved',
    type: ProcessRouteResponseDto,
  })
  async approve(
    @Param('id') id: string,
    @Body() dto: WorkflowTransitionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.approve(id, dto, user.id, token);
  }

  @Post(':id/workflow/reject')
  @ApiOperation({ summary: 'Reject process route and return to draft' })
  @ApiResponse({
    status: 200,
    description: 'Process route rejected',
    type: ProcessRouteResponseDto,
  })
  async reject(
    @Param('id') id: string,
    @Body() dto: WorkflowTransitionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.reject(id, dto, user.id, token);
  }

  @Post(':id/workflow/activate')
  @ApiOperation({ summary: 'Activate approved process route' })
  @ApiResponse({
    status: 200,
    description: 'Process route activated',
    type: ProcessRouteResponseDto,
  })
  async activate(
    @Param('id') id: string,
    @Body() dto: WorkflowTransitionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.activate(id, dto, user.id, token);
  }

  @Post(':id/workflow/archive')
  @ApiOperation({ summary: 'Archive process route' })
  @ApiResponse({
    status: 200,
    description: 'Process route archived',
    type: ProcessRouteResponseDto,
  })
  async archive(
    @Param('id') id: string,
    @Body() dto: WorkflowTransitionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteResponseDto> {
    return this.processRoutesService.archive(id, dto, user.id, token);
  }

  @Get(':id/workflow/history')
  @ApiOperation({ summary: 'Get workflow history for process route' })
  @ApiResponse({
    status: 200,
    description: 'Workflow history retrieved successfully',
    type: [WorkflowHistoryResponseDto],
  })
  async getWorkflowHistory(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<WorkflowHistoryResponseDto[]> {
    return this.processRoutesService.getWorkflowHistory(id, user.id, token);
  }

  // ============================================================================
  // PROCESS ROUTE STEPS MANAGEMENT
  // ============================================================================

  @Get(':id/steps')
  @ApiOperation({ summary: 'Get all steps for a process route' })
  @ApiResponse({
    status: 200,
    description: 'Process route steps retrieved successfully',
    type: [ProcessRouteStepResponseDto],
  })
  async getSteps(
    @Param('id') routeId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteStepResponseDto[]> {
    return this.processRoutesService.getSteps(routeId, user.id, token);
  }

  @Post(':id/steps')
  @ApiOperation({ summary: 'Add new step to process route' })
  @ApiResponse({
    status: 201,
    description: 'Process route step created successfully',
    type: ProcessRouteStepResponseDto,
  })
  async addStep(
    @Param('id') routeId: string,
    @Body() createDto: CreateProcessRouteStepDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteStepResponseDto> {
    // Override routeId from URL param to ensure consistency
    createDto.processRouteId = routeId;
    return this.processRoutesService.addStep(createDto, user.id, token);
  }

  @Put(':id/steps/:stepId')
  @ApiOperation({ summary: 'Update process route step' })
  @ApiResponse({
    status: 200,
    description: 'Process route step updated successfully',
    type: ProcessRouteStepResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Process route step not found' })
  async updateStep(
    @Param('stepId') stepId: string,
    @Body() updateDto: UpdateProcessRouteStepDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteStepResponseDto> {
    return this.processRoutesService.updateStep(stepId, updateDto, user.id, token);
  }

  @Delete(':id/steps/:stepId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete process route step' })
  @ApiResponse({ status: 204, description: 'Process route step deleted successfully' })
  @ApiResponse({ status: 404, description: 'Process route step not found' })
  async deleteStep(
    @Param('stepId') stepId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.processRoutesService.deleteStep(stepId, user.id, token);
  }

  @Post(':id/steps/reorder')
  @ApiOperation({ summary: 'Reorder process route steps' })
  @ApiResponse({
    status: 200,
    description: 'Process route steps reordered successfully',
    type: [ProcessRouteStepResponseDto],
  })
  async reorderSteps(
    @Param('id') routeId: string,
    @Body() dto: ReorderProcessRouteStepsDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteStepResponseDto[]> {
    return this.processRoutesService.reorderSteps(routeId, dto, user.id, token);
  }

  // ============================================================================
  // CALCULATOR INTEGRATION
  // ============================================================================

  @Post(':id/steps/:stepId/calculate')
  @ApiOperation({ summary: 'Execute calculator for a process route step' })
  @ApiResponse({
    status: 200,
    description: 'Calculator executed successfully',
    type: ProcessRouteStepResponseDto,
  })
  async executeCalculator(
    @Param('id') routeId: string,
    @Param('stepId') stepId: string,
    @Body() dto: ExecuteCalculatorDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProcessRouteStepResponseDto> {
    return this.processRoutesService.executeCalculator(routeId, stepId, dto, user.id, token);
  }

  @Get(':id/cost-summary')
  @ApiOperation({ summary: 'Get cost summary for process route' })
  @ApiResponse({
    status: 200,
    description: 'Cost summary retrieved successfully',
    type: CostSummaryResponseDto,
  })
  async getCostSummary(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<CostSummaryResponseDto> {
    return this.processRoutesService.getCostSummary(id, user.id, token);
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  @Get('sessions/active')
  @ApiOperation({ summary: 'Get active session for user and BOM item' })
  @ApiResponse({
    status: 200,
    description: 'Active session retrieved successfully',
    type: SessionResponseDto,
  })
  async getActiveSession(
    @Query('bomItemId') bomItemId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<SessionResponseDto | null> {
    return this.processRoutesService.getActiveSession(user.id, bomItemId, token);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Save or update session' })
  @ApiResponse({
    status: 200,
    description: 'Session saved successfully',
    type: SessionResponseDto,
  })
  async saveSession(
    @Body() dto: SaveSessionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<SessionResponseDto> {
    return this.processRoutesService.saveSession(user.id, dto, token);
  }

  // ============================================================================
  // USER ROLES MANAGEMENT
  // ============================================================================

  @Get('roles/me')
  @ApiOperation({ summary: 'Get current user roles' })
  @ApiResponse({
    status: 200,
    description: 'User roles retrieved successfully',
    type: [UserRoleResponseDto],
  })
  async getUserRoles(
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<UserRoleResponseDto[]> {
    return this.processRoutesService.getUserRoles(user.id, token);
  }

  @Post('roles/me')
  @ApiOperation({ summary: 'Assign role to current user' })
  @ApiResponse({
    status: 201,
    description: 'Role assigned successfully',
    type: UserRoleResponseDto,
  })
  async assignRole(
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<UserRoleResponseDto> {
    return this.processRoutesService.assignRole(user.id, dto, token);
  }

  @Put('roles/:roleId')
  @ApiOperation({ summary: 'Update user role (e.g., set as primary)' })
  @ApiResponse({
    status: 200,
    description: 'Role updated successfully',
    type: UserRoleResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async updateRole(
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<UserRoleResponseDto> {
    return this.processRoutesService.updateRole(roleId, dto, user.id, token);
  }
}
