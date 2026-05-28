interface User { id: string; email: string; [key: string]: any; }
import {
  Controller, Get, Post, Put, Delete,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VaveService } from './vave.service';
import {
  CreateVaveProjectDto,
  UpdateVaveProjectDto,
  CreateVaveBomItemDto,
  BulkImportVaveBomDto,
  CreateVaveIdeaDto,
  UpdateVaveIdeaDto,
  BulkCreateVaveIdeasDto,
  CreateVaveShouldCostDto,
} from './dto/vave.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('VAVE')
@ApiBearerAuth()
@Controller({ path: 'api/vave', version: '1' })
export class VaveController {
  constructor(private readonly vaveService: VaveService) {}

  // ─── Projects ─────────────────────────────────────────────────────────────

  @Get('projects')
  @ApiOperation({ summary: 'List all VAVE projects for the current user' })
  @ApiResponse({ status: 200 })
  async listProjects(
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vaveService.findAllProjects(user.id, token);
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a new VAVE project' })
  @ApiResponse({ status: 201 })
  async createProject(
    @Body() dto: CreateVaveProjectDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vaveService.createProject(dto, user.id, token);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'Get VAVE project detail with stats' })
  async getProject(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vaveService.findOneProject(id, user.id, token);
  }

  @Put('projects/:id')
  @ApiOperation({ summary: 'Update VAVE project' })
  async updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateVaveProjectDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vaveService.updateProject(id, dto, user.id, token);
  }

  @Delete('projects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete VAVE project' })
  async deleteProject(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vaveService.deleteProject(id, user.id, token);
  }

  // ─── BOM Items ────────────────────────────────────────────────────────────

  @Get('projects/:id/bom')
  @ApiOperation({ summary: 'List BOM items for a VAVE project' })
  async listBomItems(
    @Param('id') projectId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.findBomItems(projectId, token);
  }

  @Post('projects/:id/bom/bulk')
  @ApiOperation({ summary: 'Bulk import BOM items into a VAVE project' })
  async bulkImportBom(
    @Param('id') projectId: string,
    @Body() dto: BulkImportVaveBomDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.bulkImportBom(projectId, dto, token);
  }

  @Post('projects/:id/bom')
  @ApiOperation({ summary: 'Add a single BOM item to a VAVE project' })
  async createBomItem(
    @Param('id') projectId: string,
    @Body() dto: CreateVaveBomItemDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.createBomItem(projectId, dto, token);
  }

  @Delete('projects/:id/bom/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a BOM item' })
  async deleteBomItem(
    @Param('id') projectId: string,
    @Param('itemId') itemId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.deleteBomItem(projectId, itemId, token);
  }

  // ─── Ideas ────────────────────────────────────────────────────────────────

  @Get('projects/:id/ideas')
  @ApiOperation({ summary: 'List VAVE ideas for a project' })
  async listIdeas(
    @Param('id') projectId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.findIdeas(projectId, token);
  }

  @Post('projects/:id/ideas/bulk')
  @ApiOperation({ summary: 'Bulk create VAVE ideas (e.g., from AI ideation)' })
  async bulkCreateIdeas(
    @Param('id') projectId: string,
    @Body() dto: BulkCreateVaveIdeasDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.bulkCreateIdeas(projectId, dto, token);
  }

  @Post('projects/:id/ideas')
  @ApiOperation({ summary: 'Create a single VAVE idea' })
  async createIdea(
    @Param('id') projectId: string,
    @Body() dto: CreateVaveIdeaDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.createIdea(projectId, dto, token);
  }

  @Put('projects/:id/ideas/:ideaId')
  @ApiOperation({ summary: 'Update a VAVE idea (status, quadrant, etc.)' })
  async updateIdea(
    @Param('id') projectId: string,
    @Param('ideaId') ideaId: string,
    @Body() dto: UpdateVaveIdeaDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.updateIdea(projectId, ideaId, dto, token);
  }

  @Delete('projects/:id/ideas/:ideaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a VAVE idea' })
  async deleteIdea(
    @Param('id') projectId: string,
    @Param('ideaId') ideaId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.deleteIdea(projectId, ideaId, token);
  }

  // ─── Should Costs ─────────────────────────────────────────────────────────

  @Get('projects/:id/should-costs')
  @ApiOperation({ summary: 'List should-cost records for a VAVE project' })
  async listShouldCosts(
    @Param('id') projectId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.findShouldCosts(projectId, token);
  }

  @Post('projects/:id/should-costs')
  @ApiOperation({ summary: 'Upsert a should-cost record for a part' })
  async upsertShouldCost(
    @Param('id') projectId: string,
    @Body() dto: CreateVaveShouldCostDto,
    @AccessToken() token: string,
  ) {
    return this.vaveService.upsertShouldCost(projectId, dto, token);
  }

  @Delete('projects/:id/should-costs/:costId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a should-cost record' })
  async deleteShouldCost(
    @Param('id') projectId: string,
    @Param('costId') costId: string,
    @AccessToken() token: string,
  ) {
    return this.vaveService.deleteShouldCost(projectId, costId, token);
  }
}
