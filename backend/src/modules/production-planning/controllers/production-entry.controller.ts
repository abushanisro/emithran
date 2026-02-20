interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { createResponse, ApiResponse as StandardApiResponse } from '@/common/dto/api-response.dto';
import { ProductionEntryService } from '../services/production-entry.service';
import {
  CreateProductionEntryDto,
  UpdateProductionEntryDto,
  ProductionEntryResponseDto,
  WeeklySummaryDto,
  ProductionEntriesQueryDto
} from '../dto/production-entry.dto';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';

@ApiTags('production-entries')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('api/production-planning/production-entries')
export class ProductionEntryController {
  constructor(private readonly productionEntryService: ProductionEntryService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new production entry' })
  @ApiResponse({
    status: 201,
    description: 'Production entry created successfully',
    type: ProductionEntryResponseDto
  })
  @ApiResponse({
    status: 409,
    description: 'Production entry already exists for this lot, process, date, and shift'
  })
  async create(
    @Body() createProductionEntryDto: CreateProductionEntryDto,
    @Request() req: any
  ): Promise<StandardApiResponse<ProductionEntryResponseDto>> {
    const result = await this.productionEntryService.createProductionEntry(
      createProductionEntryDto,
      req.user.id
    );
    return createResponse(result);
  }

  @Get('debug')
  @ApiOperation({ summary: 'Debug endpoint to test controller registration' })
  async debug(): Promise<{ message: string; timestamp: string }> {
    return {
      message: 'Production entries controller is working!',
      timestamp: new Date().toISOString()
    };
  }

  @Get()
  @ApiOperation({ summary: 'Get production entries with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'Production entries retrieved successfully',
    type: [ProductionEntryResponseDto]
  })
  async findAll(
    @Query() queryDto: ProductionEntriesQueryDto
  ): Promise<StandardApiResponse<ProductionEntryResponseDto[]>> {
    const result = await this.productionEntryService.getProductionEntries(queryDto);
    return createResponse(result);
  }

  @Get('weekly-summary/:lotId')
  @ApiOperation({ summary: 'Get weekly production summary for a lot' })
  @ApiResponse({
    status: 200,
    description: 'Weekly summary retrieved successfully',
    type: [WeeklySummaryDto]
  })
  async getWeeklySummary(
    @Param('lotId') lotId: string
  ): Promise<StandardApiResponse<WeeklySummaryDto[]>> {
    const result = await this.productionEntryService.getWeeklySummary(lotId);
    return createResponse(result);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific production entry by ID' })
  @ApiResponse({
    status: 200,
    description: 'Production entry retrieved successfully',
    type: ProductionEntryResponseDto
  })
  @ApiResponse({
    status: 404,
    description: 'Production entry not found'
  })
  async findOne(@Param('id') id: string): Promise<StandardApiResponse<ProductionEntryResponseDto>> {
    const result = await this.productionEntryService.getProductionEntryById(id);
    return createResponse(result);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a production entry' })
  @ApiResponse({
    status: 200,
    description: 'Production entry updated successfully',
    type: ProductionEntryResponseDto
  })
  @ApiResponse({
    status: 404,
    description: 'Production entry not found'
  })
  @ApiResponse({
    status: 409,
    description: 'Another production entry already exists for this lot, process, date, and shift'
  })
  async update(
    @Param('id') id: string,
    @Body() updateProductionEntryDto: UpdateProductionEntryDto
  ): Promise<StandardApiResponse<ProductionEntryResponseDto>> {
    const result = await this.productionEntryService.updateProductionEntry(id, updateProductionEntryDto);
    return createResponse(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a production entry' })
  @ApiResponse({
    status: 200,
    description: 'Production entry deleted successfully'
  })
  @ApiResponse({
    status: 404,
    description: 'Production entry not found'
  })
  async remove(@Param('id') id: string): Promise<StandardApiResponse<{ message: string }>> {
    await this.productionEntryService.deleteProductionEntry(id);
    return createResponse({ message: 'Production entry deleted successfully' });
  }
}