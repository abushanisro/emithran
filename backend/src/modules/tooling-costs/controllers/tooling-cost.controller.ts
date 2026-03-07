interface User { id: string; email: string; [key: string]: any; }
/**
 * Tooling Cost Controller
 *
 * Production-grade REST API controller for tooling costs
 * - RESTful endpoints with proper HTTP methods
 * - Authentication with Supabase
 * - Request validation with DTOs
 * - Swagger API documentation
 *
 * @class ToolingCostController
 * @version 1.0.0
 */

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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { ToolingCostService } from '../services/tooling-cost.service';
import {
  CreateToolingCostDto,
  UpdateToolingCostDto,
  QueryToolingCostsDto,
  ToolingCostResponseDto,
  ToolingCostListResponseDto,
} from '../dto/tooling-cost.dto';

@ApiTags('Tooling Costs')
@ApiBearerAuth()
@Controller('api/tooling-costs')
@UseGuards(SupabaseAuthGuard)
export class ToolingCostController {
  constructor(
    private readonly toolingCostService: ToolingCostService,
  ) {}

  /**
   * Get all tooling costs with pagination and filtering
   */
  @Get()
  @ApiOperation({ summary: 'Get all tooling costs' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of tooling costs',
    type: ToolingCostListResponseDto,
  })
  async findAll(
    @Query() query: QueryToolingCostsDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ToolingCostListResponseDto> {
    return this.toolingCostService.findAll(query, userId, accessToken);
  }

  /**
   * Get single tooling cost by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get tooling cost by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns single tooling cost',
    type: ToolingCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tooling cost not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    return this.toolingCostService.findOne(id, userId, accessToken);
  }

  /**
   * Create new tooling cost
   */
  @Post()
  @ApiOperation({ summary: 'Create new tooling cost' })
  @ApiResponse({
    status: 201,
    description: 'Tooling cost created successfully',
    type: ToolingCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreateToolingCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    return this.toolingCostService.create(dto, userId, accessToken);
  }

  /**
   * Update existing tooling cost
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update tooling cost' })
  @ApiResponse({
    status: 200,
    description: 'Tooling cost updated successfully',
    type: ToolingCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tooling cost not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateToolingCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    return this.toolingCostService.update(id, dto, userId, accessToken);
  }

  /**
   * Delete tooling cost
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tooling cost' })
  @ApiResponse({ status: 204, description: 'Tooling cost deleted successfully' })
  @ApiResponse({ status: 404, description: 'Tooling cost not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<void> {
    await this.toolingCostService.remove(id, userId, accessToken);
  }

  /**
   * Get total tooling cost for a BOM item
   */
  @Get('bom-item/:bomItemId/total')
  @ApiOperation({ summary: 'Get total tooling cost for a BOM item' })
  @ApiResponse({
    status: 200,
    description: 'Returns total tooling cost for the BOM item',
    schema: {
      type: 'object',
      properties: {
        totalCost: { type: 'number', example: 125.50 }
      }
    }
  })
  async getTotalCostForBomItem(
    @Param('bomItemId') bomItemId: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<{ totalCost: number }> {
    const totalCost = await this.toolingCostService.getTotalCostForBomItem(bomItemId, userId, accessToken);
    return { totalCost };
  }
}