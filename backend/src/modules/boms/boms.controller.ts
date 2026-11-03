interface User { id: string; email: string; [key: string]: any; }
import { AuditService } from '../../common/audit/audit.service';
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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BOMsService } from './boms.service';
import { BomItemCostService } from '../bom-items/services/bom-item-cost.service';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { CADAnalysisService } from '../bom-items/services/cad-analysis.service';
import { CreateBOMDto, UpdateBOMDto, QueryBOMsDto } from './dto/boms.dto';
import { BOMResponseDto, BOMListResponseDto } from './dto/bom-response.dto';
import { BOMItemListResponseDto } from '../bom-items/dto/bom-item-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { OrgRole } from '../../common/authz/authz-policy';

@ApiTags('BOMs')
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'api/boms', version: '1' })
export class BOMsController {
  constructor(
    private readonly bomsService: BOMsService,
    private readonly bomItemCostService: BomItemCostService,
    private readonly bomItemsService: BOMItemsService,
    private readonly cadAnalysisService: CADAnalysisService,
    private readonly audit: AuditService,
  ) {}

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'Get all BOMs' })
  @ApiResponse({ status: 200, description: 'BOMs retrieved successfully', type: BOMListResponseDto })
  async findAll(@Query() query: QueryBOMsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMListResponseDto> {
    return this.bomsService.findAll(query, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id')
  @ApiOperation({ summary: 'Get BOM by ID' })
  @ApiResponse({ status: 200, description: 'BOM retrieved successfully', type: BOMResponseDto })
  @ApiResponse({ status: 404, description: 'BOM not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMResponseDto> {
    return this.bomsService.findOne(id, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id/items')
  @ApiOperation({ summary: 'Get all BOM items for a specific BOM' })
  @ApiResponse({ status: 200, description: 'BOM items retrieved successfully', type: BOMItemListResponseDto })
  @ApiResponse({ status: 404, description: 'BOM not found' })
  async getBomItems(@Param('id') bomId: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemListResponseDto> {
    return this.bomItemsService.findAll(bomId, undefined, undefined, undefined, undefined, user.id, token);
  }

  @Post()
  @UseGuards(OrganizationContextGuard)
  @ApiOperation({ summary: 'Create new BOM' })
  @ApiResponse({ status: 201, description: 'BOM created successfully', type: BOMResponseDto })
  async create(
    @Body() createBOMDto: CreateBOMDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<BOMResponseDto> {
    return this.bomsService.create(createBOMDto, user.id, token, organizationId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update BOM' })
  @ApiResponse({ status: 200, description: 'BOM updated successfully', type: BOMResponseDto })
  async update(@Param('id') id: string, @Body() updateBOMDto: UpdateBOMDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMResponseDto> {
    return this.bomsService.update(id, updateBOMDto, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete BOM' })
  @ApiResponse({ status: 200, description: 'BOM deleted successfully' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.audit.auditedRowChange('boms', id, 'bom.deleted', async () => {
    return this.bomsService.remove(id, user.id, token);
  });
  }

  // Cost-related endpoints
  @Post(':id/recalculate-all-costs')
  @UseGuards(OrganizationContextGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate all costs for a BOM (triggered on save)' })
  @ApiResponse({ status: 200, description: 'All costs recalculated successfully' })
  async recalculateAllCosts(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<{ message: string }> {
    await this.bomItemCostService.recalculateAllCosts(id, user.id, token, organizationId);
    return { message: 'All costs recalculated successfully' };
  }


  @OrgRole('viewer')
  @Get(':id/cost-report')
  @ApiOperation({ summary: 'Get comprehensive cost report for a BOM' })
  @ApiResponse({ status: 200, description: 'Cost report generated successfully' })
  async getCostReport(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<any> {
    return this.bomItemCostService.getBomCostReport(id, user.id, token);
  }

  // ============================================================================
  // CAD ANALYSIS ENDPOINTS FOR BOMs
  // ============================================================================



}
