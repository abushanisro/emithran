interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupplierEvaluationGroupsService } from './supplier-evaluation-groups.service';
import {
  CreateSupplierEvaluationGroupDto,
  UpdateSupplierEvaluationGroupDto,
  SupplierEvaluationGroupDto,
  SupplierEvaluationGroupSummaryDto,
} from './dto/supplier-evaluation-group.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('supplier-evaluation-groups')
@Controller('api/supplier-evaluation-groups')
export class SupplierEvaluationGroupsController {
  constructor(
    private readonly supplierEvaluationGroupsService: SupplierEvaluationGroupsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new supplier evaluation group' })
  @ApiResponse({
    status: 201,
    description: 'Evaluation group created successfully',
    type: SupplierEvaluationGroupDto,
  })
  create(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Body() createDto: CreateSupplierEvaluationGroupDto,
  ): Promise<SupplierEvaluationGroupDto> {
    return this.supplierEvaluationGroupsService.create(userId, createDto, token);
  }

  @Get()
  @ApiOperation({ summary: 'Get all evaluation groups for user' })
  @ApiResponse({
    status: 200,
    description: 'All evaluation groups retrieved successfully',
    type: [SupplierEvaluationGroupSummaryDto],
  })
  findAll(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ): Promise<SupplierEvaluationGroupSummaryDto[]> {
    return this.supplierEvaluationGroupsService.findAll(userId, token);
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all evaluation groups for a project' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation groups retrieved successfully',
    type: [SupplierEvaluationGroupSummaryDto],
  })
  findByProject(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('projectId') projectId: string,
  ): Promise<SupplierEvaluationGroupSummaryDto[]> {
    return this.supplierEvaluationGroupsService.findByProject(userId, projectId, token);
  }

  @Get('project/:projectId/latest')
  @ApiOperation({ summary: 'Get the latest evaluation group for a project' })
  @ApiResponse({
    status: 200,
    description: 'Latest evaluation group retrieved successfully',
    type: SupplierEvaluationGroupDto,
  })
  getLatestByProject(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('projectId') projectId: string,
  ): Promise<SupplierEvaluationGroupDto | null> {
    return this.supplierEvaluationGroupsService.getLatestByProject(userId, projectId, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get evaluation group by ID' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation group retrieved successfully',
    type: SupplierEvaluationGroupDto,
  })
  findOne(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string,
  ): Promise<SupplierEvaluationGroupDto> {
    return this.supplierEvaluationGroupsService.findOne(userId, id, token);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update evaluation group' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation group updated successfully',
    type: SupplierEvaluationGroupDto,
  })
  update(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body() updateDto: UpdateSupplierEvaluationGroupDto,
  ): Promise<SupplierEvaluationGroupDto> {
    return this.supplierEvaluationGroupsService.update(userId, id, updateDto, token);
  }

  @Get(':id/validate-deletion')
  @ApiOperation({ summary: 'Validate if evaluation group can be deleted' })
  @ApiResponse({
    status: 200,
    description: 'Deletion validation result',
    schema: {
      type: 'object',
      properties: {
        canDelete: { type: 'boolean' },
        warnings: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
        impactSummary: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              count: { type: 'number' }
            }
          }
        }
      }
    }
  })
  validateDeletion(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string,
  ) {
    return this.supplierEvaluationGroupsService.validateDeletion(userId, id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete evaluation group' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation group deleted successfully',
  })
  remove(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.supplierEvaluationGroupsService.remove(userId, id, token);
  }
}