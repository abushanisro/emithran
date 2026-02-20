interface User { id: string; email: string; [key: string]: any; }
/**
 * Child Part Cost Controller
 *
 * REST API endpoints for child part cost calculations
 * Provides CRUD operations and calculation preview
 *
 * @author Manufacturing Cost Engineering Team
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
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { ChildPartCostService } from '../services/child-part-cost.service';
import {
  CreateChildPartCostDto,
  UpdateChildPartCostDto,
  QueryChildPartCostsDto,
  ChildPartCostResponseDto,
  ChildPartCostListResponseDto,
  CalculateChildPartCostDto,
} from '../dto/child-part-cost.dto';

@ApiTags('Child Part Costs')
@Controller('api/child-part-costs')
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth()
export class ChildPartCostController {
  constructor(private readonly childPartCostService: ChildPartCostService) {}

  /**
   * Get all child part cost records with pagination and filtering
   */
  @Get()
  @ApiOperation({
    summary: 'Get all child part cost records',
    description: 'Retrieve paginated list of child part costs with optional filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Child part costs retrieved successfully',
    type: ChildPartCostListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findAll(
    @Query() query: QueryChildPartCostsDto,
    @Request() req: any,
  ): Promise<ChildPartCostListResponseDto> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.findAll(query, userId, accessToken);
  }

  /**
   * Get a single child part cost record by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get child part cost by ID',
    description: 'Retrieve a single child part cost record with recalculated values',
  })
  @ApiParam({ name: 'id', description: 'Child part cost record ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Child part cost retrieved successfully',
    type: ChildPartCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Child part cost not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(@Param('id') id: string, @Request() req: any): Promise<ChildPartCostResponseDto> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.findOne(id, userId, accessToken);
  }

  /**
   * Get child part cost by BOM item ID
   */
  @Get('bom-item/:bomItemId')
  @ApiOperation({
    summary: 'Get child part cost by BOM item ID',
    description: 'Retrieve child part cost record for a specific BOM item',
  })
  @ApiParam({ name: 'bomItemId', description: 'BOM item ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Child part cost retrieved successfully',
    type: ChildPartCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Child part cost not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findByBomItemId(
    @Param('bomItemId') bomItemId: string,
    @Request() req: any,
  ): Promise<ChildPartCostResponseDto | null> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.findByBomItemId(bomItemId, userId, accessToken);
  }

  /**
   * Create or update a child part cost record
   * Due to the unique constraint (one cost record per BOM item per user),
   * this endpoint will update an existing record if one already exists for the BOM item.
   */
  @Post()
  @ApiOperation({
    summary: 'Create or update child part cost',
    description: 'Create a new child part cost record with automatic calculation. If a record already exists for this BOM item, it will be updated instead.',
  })
  @ApiResponse({
    status: 201,
    description: 'Child part cost created or updated successfully',
    type: ChildPartCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async create(
    @Body() createDto: CreateChildPartCostDto,
    @Request() req: any,
  ): Promise<ChildPartCostResponseDto> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.create(createDto, userId, accessToken);
  }

  /**
   * Update an existing child part cost record
   */
  @Put(':id')
  @ApiOperation({
    summary: 'Update child part cost',
    description: 'Update an existing child part cost record with automatic recalculation',
  })
  @ApiParam({ name: 'id', description: 'Child part cost record ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Child part cost updated successfully',
    type: ChildPartCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Child part cost not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateChildPartCostDto,
    @Request() req: any,
  ): Promise<ChildPartCostResponseDto> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.update(id, updateDto, userId, accessToken);
  }

  /**
   * Delete a child part cost record
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete child part cost',
    description: 'Delete a child part cost record',
  })
  @ApiParam({ name: 'id', description: 'Child part cost record ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Child part cost deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Child part cost deleted successfully' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Child part cost not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async remove(@Param('id') id: string, @Request() req: any): Promise<{ message: string }> {
    const userId = req.user?.id;
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    return this.childPartCostService.remove(id, userId, accessToken);
  }

  /**
   * Calculate child part cost without saving (preview/what-if analysis)
   */
  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate child part cost (preview)',
    description: 'Calculate child part cost without saving to database. Useful for what-if analysis and previewing costs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Calculation completed successfully',
    schema: {
      type: 'object',
      properties: {
        partNumber: { type: 'string' },
        partName: { type: 'string' },
        makeBuy: { type: 'string', enum: ['make', 'buy'] },
        currency: { type: 'string' },
        baseCost: { type: 'number' },
        freightCost: { type: 'number' },
        dutyCost: { type: 'number' },
        overheadCost: { type: 'number' },
        costBeforeQuality: { type: 'number' },
        scrapAdjustment: { type: 'number' },
        defectAdjustment: { type: 'number' },
        totalCostPerPart: { type: 'number' },
        extendedCost: { type: 'number' },
        // ... additional fields
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid calculation input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 500, description: 'Calculation failed' })
  async calculateOnly(@Body() calculateDto: CalculateChildPartCostDto): Promise<any> {
    return this.childPartCostService.calculateOnly(calculateDto);
  }
}
