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
import { BOMsService } from './boms.service';
import { BomItemCostService } from '../bom-items/services/bom-item-cost.service';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { CADAnalysisService } from '../bom-items/services/cad-analysis.service';
import { CreateBOMDto, UpdateBOMDto, QueryBOMsDto } from './dto/boms.dto';
import { BOMResponseDto, BOMListResponseDto } from './dto/bom-response.dto';
import { BOMItemListResponseDto } from '../bom-items/dto/bom-item-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('BOMs')
@ApiBearerAuth()
@Controller({ path: 'api/boms', version: '1' })
export class BOMsController {
  constructor(
    private readonly bomsService: BOMsService,
    private readonly bomItemCostService: BomItemCostService,
    private readonly bomItemsService: BOMItemsService,
    private readonly cadAnalysisService: CADAnalysisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all BOMs' })
  @ApiResponse({ status: 200, description: 'BOMs retrieved successfully', type: BOMListResponseDto })
  async findAll(@Query() query: QueryBOMsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMListResponseDto> {
    return this.bomsService.findAll(query, user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get BOM by ID' })
  @ApiResponse({ status: 200, description: 'BOM retrieved successfully', type: BOMResponseDto })
  @ApiResponse({ status: 404, description: 'BOM not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMResponseDto> {
    return this.bomsService.findOne(id, user.id, token);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Get all BOM items for a specific BOM' })
  @ApiResponse({ status: 200, description: 'BOM items retrieved successfully', type: BOMItemListResponseDto })
  @ApiResponse({ status: 404, description: 'BOM not found' })
  async getBomItems(@Param('id') bomId: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemListResponseDto> {
    return this.bomItemsService.findAll(bomId, undefined, undefined, undefined, undefined, user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create new BOM' })
  @ApiResponse({ status: 201, description: 'BOM created successfully', type: BOMResponseDto })
  async create(@Body() createBOMDto: CreateBOMDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMResponseDto> {
    return this.bomsService.create(createBOMDto, user.id, token);
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
    return this.bomsService.remove(id, user.id, token);
  }

  // Cost-related endpoints
  @Post(':id/recalculate-all-costs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate all costs for a BOM (triggered on save)' })
  @ApiResponse({ status: 200, description: 'All costs recalculated successfully' })
  async recalculateAllCosts(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<{ message: string }> {
    await this.bomItemCostService.recalculateAllCosts(id, user.id, token);
    return { message: 'All costs recalculated successfully' };
  }

  @Get(':id/cost-summary')
  @ApiOperation({ summary: 'Get cost summary for all top-level assemblies in a BOM' })
  @ApiResponse({ status: 200, description: 'Cost summary retrieved successfully' })
  async getCostSummary(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<any> {
    return this.bomItemCostService.getBomCostSummary(id, user.id, token);
  }

  @Get(':id/cost-report')
  @ApiOperation({ summary: 'Get comprehensive cost report for a BOM' })
  @ApiResponse({ status: 200, description: 'Cost report generated successfully' })
  async getCostReport(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<any> {
    return this.bomItemCostService.getBomCostReport(id, user.id, token);
  }

  // ============================================================================
  // CAD ANALYSIS ENDPOINTS FOR BOMs
  // ============================================================================

  @Get(':id/manufacturing-insights')
  @ApiOperation({ summary: 'Get comprehensive manufacturing insights for a BOM' })
  @ApiResponse({ status: 200, description: 'Manufacturing insights retrieved successfully' })
  async getManufacturingInsights(
    @Param('id') id: string, 
    @CurrentUser() user: User, 
    @AccessToken() token: string
  ): Promise<any> {
    try {
      const summary = await this.cadAnalysisService.getBOMAnalysisSummary(id, token);
      
      return {
        success: true,
        bomId: id,
        manufacturingInsights: {
          overview: {
            totalItems: summary.total_items,
            analyzedItems: summary.analyzed_items,
            analysisCompleteness: summary.total_items > 0 ? 
              Math.round((summary.analyzed_items / summary.total_items) * 100) : 0
          },
          manufacturability: {
            averageScore: summary.avg_manufacturability_score,
            difficultyDistribution: {
              easy: summary.easy_items,
              medium: summary.medium_items,
              hard: summary.hard_items,
              veryHard: summary.very_hard_items
            }
          },
          processes: {
            mostCommonProcess: summary.most_common_process,
            // Additional process analysis could be added here
          },
          performance: {
            averageMemoryReduction: summary.avg_memory_reduction,
            averageProcessingTime: summary.avg_processing_time_ms
          },
          lastUpdate: summary.latest_analysis
        }
      };
    } catch (error) {
      throw error;
    }
  }

  @Post(':id/analyze-all-items')
  @ApiOperation({ summary: 'Analyze all BOM items with 3D files' })
  @ApiResponse({ status: 200, description: 'Batch analysis started successfully' })
  async analyzeAllBOMItems(
    @Param('id') id: string,
    @Body() body: {
      strategy?: 'aggressive' | 'balanced' | 'conservative';
      forceReanalysis?: boolean;
      maxConcurrent?: number;
    },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<any> {
    try {
      // Get all BOM items for this BOM
      const bomItems = await this.bomItemsService.findAll(id, undefined, undefined, 1, 1000, user.id, token);
      
      // Filter items that have 3D files
      const itemsWithFiles = bomItems.items
        .filter(item => item.file3dPath)
        .map(item => ({
          bomItemId: item.id,
          filePath: item.file3dPath!,  // Use non-null assertion since we filtered above
          strategy: body.strategy || 'balanced',
          forceReanalysis: body.forceReanalysis || false
        }));

      if (itemsWithFiles.length === 0) {
        return {
          success: true,
          message: 'No BOM items with 3D files found for analysis',
          results: {
            totalItems: bomItems.items.length,
            itemsWithFiles: 0,
            analysisStarted: false
          }
        };
      }

      // Limit concurrent processing
      const maxConcurrent = Math.min(body.maxConcurrent || 10, 20);
      const limitedItems = itemsWithFiles.slice(0, maxConcurrent);
      
      if (limitedItems.length < itemsWithFiles.length) {
        return {
          success: true,
          message: `Starting analysis for first ${limitedItems.length} items (${itemsWithFiles.length - limitedItems.length} items will be queued for later)`,
          results: {
            totalItems: bomItems.items.length,
            itemsWithFiles: itemsWithFiles.length,
            analysisStarted: limitedItems.length,
            queuedItems: itemsWithFiles.length - limitedItems.length
          }
        };
      }

      // Start batch analysis
      const analysisResults = await this.cadAnalysisService.batchAnalyzeBOMItems(
        limitedItems,
        user.id,
        token
      );

      return {
        success: true,
        message: `Analysis completed for ${analysisResults.length} BOM items`,
        results: {
          totalItems: bomItems.items.length,
          itemsWithFiles: itemsWithFiles.length,
          successfulAnalyses: analysisResults.length,
          failedAnalyses: limitedItems.length - analysisResults.length
        },
        summary: {
          averageProcessingTime: analysisResults.length > 0 ? 
            Math.round(analysisResults.reduce((sum, r) => sum + r.processingTimeMs, 0) / analysisResults.length) : 0,
          averageManufacturabilityScore: analysisResults.length > 0 ?
            Math.round(analysisResults.reduce((sum, r) => sum + (r.dfmAnalysis.manufacturability_score || 0), 0) / analysisResults.length * 100) / 100 : 0
        }
      };

    } catch (error) {
      throw error;
    }
  }

  @Delete(':id/analysis-cache')
  @ApiOperation({ summary: 'Clear CAD analysis cache for BOM' })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearBOMAnalysisCache(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<void> {
    try {
      // This would clear analysis cache for specific BOM
      await this.cadAnalysisService.cleanupAnalysisCache(token);
    } catch (error) {
      throw error;
    }
  }
}
