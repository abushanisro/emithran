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
  UseGuards,
  ParseUUIDPipe,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { createResponse, ApiResponse as CustomApiResponse } from '@/common/dto/api-response.dto';
import { ProjectReportsService } from './project-reports.service';
import {
  CreateBalloonDiagramDto,
  UpdateBalloonDiagramDto,
  BalloonDiagramResponseDto,
  InspectionReportDto,
  DiagramAnnotationDto,
} from './dto/project-reports.dto';

@ApiTags('Project Reports')
@ApiBearerAuth()
@Controller({ path: 'api/project-reports', version: '1' })
@UseGuards(SupabaseAuthGuard, RateLimitGuard)
export class ProjectReportsController {
  private readonly logger = new Logger(ProjectReportsController.name);

  constructor(private readonly projectReportsService: ProjectReportsService) {}

  private getUserId(user: any): string {
    return user?.id || '';
  }

  // ============================================================================
  // BALLOON DIAGRAM ENDPOINTS
  // ============================================================================

  @Post('balloon-diagrams')
  @ApiOperation({ summary: 'Create balloon diagram' })
  @ApiResponse({ status: 201, description: 'Balloon diagram created successfully' })
  async createBalloonDiagram(
    @Body() createDto: CreateBalloonDiagramDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<BalloonDiagramResponseDto>> {
    try {
      this.logger.log(`Creating balloon diagram: ${createDto.name}`);
      const result = await this.projectReportsService.createBalloonDiagram(
        createDto,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to create balloon diagram: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('projects/:projectId/balloon-diagrams')
  @ApiOperation({ summary: 'Get balloon diagrams for project' })
  @ApiResponse({ status: 200, description: 'Balloon diagrams retrieved successfully' })
  async getBalloonDiagrams(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<BalloonDiagramResponseDto[]>> {
    try {
      this.logger.log(`Fetching balloon diagrams for project ${projectId}`);
      const result = await this.projectReportsService.getBalloonDiagrams(
        projectId,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch balloon diagrams: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('balloon-diagrams/:id')
  @ApiOperation({ summary: 'Get balloon diagram by ID' })
  @ApiResponse({ status: 200, description: 'Balloon diagram retrieved successfully' })
  async getBalloonDiagram(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<BalloonDiagramResponseDto>> {
    try {
      this.logger.log(`Fetching balloon diagram ${id}`);
      const result = await this.projectReportsService.getBalloonDiagram(
        id,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch balloon diagram ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put('balloon-diagrams/:id')
  @ApiOperation({ summary: 'Update balloon diagram' })
  @ApiResponse({ status: 200, description: 'Balloon diagram updated successfully' })
  async updateBalloonDiagram(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateBalloonDiagramDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<BalloonDiagramResponseDto>> {
    try {
      this.logger.log(`Updating balloon diagram ${id}`);
      const result = await this.projectReportsService.updateBalloonDiagram(
        id,
        updateDto,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to update balloon diagram ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete('balloon-diagrams/:id')
  @ApiOperation({ summary: 'Delete balloon diagram' })
  @ApiResponse({ status: 200, description: 'Balloon diagram deleted successfully' })
  async deleteBalloonDiagram(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<void>> {
    try {
      this.logger.log(`Deleting balloon diagram ${id}`);
      await this.projectReportsService.deleteBalloonDiagram(
        id,
        this.getUserId(user),
      );
      return createResponse(undefined);
    } catch (error) {
      this.logger.error(`Failed to delete balloon diagram ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // DIAGRAM ANNOTATIONS ENDPOINTS
  // ============================================================================

  @Post('balloon-diagrams/:id/annotations')
  @ApiOperation({ summary: 'Add annotation to balloon diagram' })
  @ApiResponse({ status: 201, description: 'Annotation added successfully' })
  async addAnnotation(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @Body() annotationDto: DiagramAnnotationDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.projectReportsService.addAnnotation(
      diagramId,
      annotationDto,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Put('balloon-diagrams/:diagramId/annotations/:annotationId')
  @ApiOperation({ summary: 'Update diagram annotation' })
  @ApiResponse({ status: 200, description: 'Annotation updated successfully' })
  async updateAnnotation(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
    @Body() annotationDto: DiagramAnnotationDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.projectReportsService.updateAnnotation(
      diagramId,
      annotationId,
      annotationDto,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Delete('balloon-diagrams/:diagramId/annotations/:annotationId')
  @ApiOperation({ summary: 'Delete diagram annotation' })
  @ApiResponse({ status: 200, description: 'Annotation deleted successfully' })
  async deleteAnnotation(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<void>> {
    await this.projectReportsService.deleteAnnotation(
      diagramId,
      annotationId,
      this.getUserId(user),
    );
    return createResponse(undefined);
  }

  // ============================================================================
  // INSPECTION REPORT ENDPOINTS
  // ============================================================================

  @Get('projects/:projectId/inspection-report')
  @ApiOperation({ summary: 'Generate inspection report for project' })
  @ApiResponse({ status: 200, description: 'Inspection report generated successfully' })
  async generateInspectionReport(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
    @Query('partName') partName?: string,
    @Query('drawingNumber') drawingNumber?: string,
  ): Promise<CustomApiResponse<InspectionReportDto>> {
    try {
      this.logger.log(`Generating inspection report for project ${projectId}`);
      const result = await this.projectReportsService.generateInspectionReport(
        projectId,
        this.getUserId(user),
        { partName, drawingNumber }
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to generate inspection report: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('projects/:projectId/complete-report')
  @ApiOperation({ summary: 'Generate complete project report with balloon diagram and inspection' })
  @ApiResponse({ status: 200, description: 'Complete report generated successfully' })
  async generateCompleteReport(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<any>> {
    try {
      this.logger.log(`Generating complete project report for project ${projectId}`);
      const result = await this.projectReportsService.generateCompleteReport(
        projectId,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to generate complete report: ${error.message}`, error.stack);
      throw error;
    }
  }
}