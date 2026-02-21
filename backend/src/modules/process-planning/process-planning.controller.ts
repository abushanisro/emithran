import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ProcessPlanningService } from './process-planning.service';
import { CreateProcessPlanningSpecDto, UpdateProcessPlanningSpecDto, ProcessPlanningSpecResponseDto } from './dto/process-planning.dto';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';

@ApiTags('Process Planning')
@Controller({ path: 'api/process-planning', version: '1' })
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth()
export class ProcessPlanningController {
  constructor(private readonly processPlanningService: ProcessPlanningService) {}

  @Get('bom-items/:bomItemId/specifications')
  @ApiOperation({ summary: 'Get process planning specifications for a BOM item' })
  @ApiResponse({ status: 200, description: 'Process planning specifications retrieved successfully', type: ProcessPlanningSpecResponseDto })
  @ApiResponse({ status: 404, description: 'Specifications not found' })
  @ApiParam({ name: 'bomItemId', description: 'BOM Item ID' })
  async getSpecificationsByBomItem(
    @Param('bomItemId') bomItemId: string,
    @Request() req: any
  ): Promise<ProcessPlanningSpecResponseDto | null> {
    const userId = req.user?.sub || req.user?.id;
    return this.processPlanningService.getSpecificationsByBomItem(bomItemId, userId);
  }

  @Get('projects/:projectId/specifications')
  @ApiOperation({ summary: 'Get all process planning specifications for a project' })
  @ApiResponse({ status: 200, description: 'Process planning specifications retrieved successfully', type: [ProcessPlanningSpecResponseDto] })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  async getSpecificationsByProject(
    @Param('projectId') projectId: string,
    @Request() req: any
  ): Promise<ProcessPlanningSpecResponseDto[]> {
    const userId = req.user?.sub || req.user?.id;
    return this.processPlanningService.getSpecificationsByProject(projectId, userId);
  }

  @Post('specifications')
  @ApiOperation({ summary: 'Create process planning specifications' })
  @ApiResponse({ status: 201, description: 'Process planning specifications created successfully', type: ProcessPlanningSpecResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed or specifications already exist' })
  async createSpecifications(
    @Body() dto: CreateProcessPlanningSpecDto,
    @Request() req: any
  ): Promise<ProcessPlanningSpecResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    return this.processPlanningService.createSpecifications(dto, userId);
  }

  @Put('bom-items/:bomItemId/specifications')
  @ApiOperation({ summary: 'Update process planning specifications for a BOM item' })
  @ApiResponse({ status: 200, description: 'Process planning specifications updated successfully', type: ProcessPlanningSpecResponseDto })
  @ApiResponse({ status: 404, description: 'Specifications not found' })
  @ApiParam({ name: 'bomItemId', description: 'BOM Item ID' })
  async updateSpecifications(
    @Param('bomItemId') bomItemId: string,
    @Body() dto: UpdateProcessPlanningSpecDto,
    @Request() req: any
  ): Promise<ProcessPlanningSpecResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    return this.processPlanningService.updateSpecifications(bomItemId, dto, userId);
  }

  @Post('specifications/upsert')
  @ApiOperation({ summary: 'Create or update process planning specifications (upsert)' })
  @ApiResponse({ status: 200, description: 'Process planning specifications saved successfully', type: ProcessPlanningSpecResponseDto })
  async upsertSpecifications(
    @Body() dto: CreateProcessPlanningSpecDto,
    @Request() req: any
  ): Promise<ProcessPlanningSpecResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    return this.processPlanningService.upsertSpecifications(dto, userId);
  }

  @Delete('bom-items/:bomItemId/specifications')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete process planning specifications for a BOM item' })
  @ApiResponse({ status: 204, description: 'Process planning specifications deleted successfully' })
  @ApiParam({ name: 'bomItemId', description: 'BOM Item ID' })
  async deleteSpecifications(
    @Param('bomItemId') bomItemId: string,
    @Request() req: any
  ): Promise<void> {
    const userId = req.user?.sub || req.user?.id;
    await this.processPlanningService.deleteSpecifications(bomItemId, userId);
  }
}