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
  BadRequestException
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupplierNominationsService } from './supplier-nominations.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import {
  CreateSupplierNominationDto,
  CreateCriteriaDto,
  UpdateVendorEvaluationDto,
  CreateEvaluationScoreDto,
  SupplierNominationDto,
  SupplierNominationSummaryDto,
  VendorEvaluationDto,
  NominationCriteriaDto,
  EvaluationScoreDto
} from './dto/supplier-nomination.dto';
import {
  CostCompetencyAnalysisDto,
  BulkUpdateCostDataDto,
  UpdateCostValueDto
} from './dto/cost-competency.dto';
import {
  VendorAssessmentCriteriaDto,
  BatchAssessmentUpdateDto
} from './dto/vendor-assessment.dto';
import {
  VendorRatingMatrixDto,
  BatchVendorRatingUpdateDto,
  UpdateVendorRatingDto,
  VendorRatingOverallScoresDto,
  UpdateCapabilityCriteriaDto
} from './dto/vendor-rating-matrix.dto';
import {
  PartWiseCostAnalysisDto,
  PartWiseCostBaseDataDto,
  CreatePartWiseCostAnalysisDto,
  CreatePartWiseCostBaseDataDto,
  BulkUpdatePartWiseCostAnalysisDto
} from './dto/part-wise-cost-analysis.dto';

@ApiTags('supplier-nominations')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('api/supplier-nominations')
export class SupplierNominationsController {
  constructor(
    private readonly supplierNominationsService: SupplierNominationsService
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new supplier nomination' })
  @ApiResponse({
    status: 201,
    description: 'Supplier nomination created successfully',
    type: SupplierNominationDto
  })
  create(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Body() createDto: CreateSupplierNominationDto
  ): Promise<SupplierNominationDto> {
    return this.supplierNominationsService.create(userId, createDto, token);
  }


  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all nominations for a project' })
  @ApiResponse({
    status: 200,
    description: 'Nominations retrieved successfully',
    type: [SupplierNominationSummaryDto]
  })
  findByProject(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('projectId') projectId: string
  ): Promise<SupplierNominationSummaryDto[]> {
    return this.supplierNominationsService.findByProject(userId, projectId, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier nomination by ID' })
  @ApiResponse({
    status: 200,
    description: 'Supplier nomination retrieved successfully',
    type: SupplierNominationDto
  })
  findOne(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string
  ): Promise<SupplierNominationDto> {
    // Secure logging - no sensitive data in production
    return this.supplierNominationsService.findOne(userId, id, token);
  }

  @Put(':id/criteria')
  @ApiOperation({ summary: 'Update nomination criteria' })
  @ApiResponse({
    status: 200,
    description: 'Criteria updated successfully',
    type: [NominationCriteriaDto]
  })
  updateCriteria(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Body() criteria: CreateCriteriaDto[]
  ): Promise<NominationCriteriaDto[]> {
    return this.supplierNominationsService.updateCriteria(
      userId,
      nominationId,
      criteria,
      token
    );
  }

  @Put('evaluations/:evaluationId')
  @ApiOperation({ summary: 'Update vendor evaluation' })
  @ApiResponse({
    status: 200,
    description: 'Vendor evaluation updated successfully',
    type: VendorEvaluationDto
  })
  updateVendorEvaluation(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string,
    @Body() updateDto: UpdateVendorEvaluationDto
  ): Promise<VendorEvaluationDto> {
    return this.supplierNominationsService.updateVendorEvaluation(
      userId,
      evaluationId,
      updateDto,
      token
    );
  }

  @Put('evaluations/:evaluationId/scores')
  @ApiOperation({ summary: 'Update evaluation scores for a vendor' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation scores updated successfully',
    type: [EvaluationScoreDto]
  })
  updateEvaluationScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string,
    @Body() scores: CreateEvaluationScoreDto[]
  ): Promise<EvaluationScoreDto[]> {
    return this.supplierNominationsService.updateEvaluationScores(
      userId,
      evaluationId,
      scores,
      token
    );
  }

  @Post(':id/vendors')
  @ApiOperation({ summary: 'Add vendors to nomination' })
  @ApiResponse({
    status: 200,
    description: 'Vendors added successfully',
    type: [VendorEvaluationDto]
  })
  addVendors(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Body('vendorIds') vendorIds: string[]
  ): Promise<VendorEvaluationDto[]> {
    return this.supplierNominationsService.addVendorsToNomination(
      userId,
      nominationId,
      vendorIds,
      token
    );
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete nomination process' })
  @ApiResponse({
    status: 200,
    description: 'Nomination completed successfully',
    type: SupplierNominationDto
  })
  complete(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string
  ): Promise<SupplierNominationDto> {
    return this.supplierNominationsService.completeNomination(
      userId,
      nominationId,
      token
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update supplier nomination' })
  @ApiResponse({
    status: 200,
    description: 'Supplier nomination updated successfully',
    type: SupplierNominationDto
  })
  update(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateSupplierNominationDto>
  ): Promise<SupplierNominationDto> {
    return this.supplierNominationsService.update(userId, id, updateDto, token);
  }

  @Post('evaluations/:evaluationId/data')
  @ApiOperation({ summary: 'Store complete evaluation data (Overview, Cost Analysis, Rating Engine, Capability, Technical)' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation data stored successfully'
  })
  storeEvaluationData(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string,
    @Body() evaluationData: {
      overview?: any;
      costAnalysis?: any;
      ratingEngine?: any;
      capability?: any;
      technical?: any;
    }
  ): Promise<any> {
    return this.supplierNominationsService.storeEvaluationData(
      userId,
      evaluationId,
      evaluationData,
      token
    );
  }

  @Get('evaluations/:evaluationId/data')
  @ApiOperation({ summary: 'Get complete evaluation data' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation data retrieved successfully'
  })
  getEvaluationData(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string
  ): Promise<any> {
    return this.supplierNominationsService.getEvaluationData(
      userId,
      evaluationId,
      'overview',
      token
    );
  }

  @Put('evaluations/:evaluationId/sections/:section')
  @ApiOperation({ summary: 'Update specific evaluation section (overview, cost_analysis, rating_engine, capability)' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation section updated successfully'
  })
  updateEvaluationSection(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string,
    @Param('section') section: string,
    @Body() sectionData: any
  ): Promise<any> {
    return this.supplierNominationsService.updateEvaluationSection(
      userId,
      evaluationId,
      section,
      sectionData,
      token
    );
  }

  @Get('evaluations/:evaluationId/scores')
  @ApiOperation({ summary: 'Get calculated evaluation scores for all sections' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation scores retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        overall_score: { type: 'number' },
        cost_score: { type: 'number' },
        rating_score: { type: 'number' },
        capability_score: { type: 'number' },
        overview_score: { type: 'number' }
      }
    }
  })
  getEvaluationScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('evaluationId') evaluationId: string
  ): Promise<any> {
    return this.supplierNominationsService.getEvaluationScores(
      userId,
      evaluationId,
      token
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete supplier nomination' })
  @ApiResponse({
    status: 200,
    description: 'Supplier nomination deleted successfully'
  })
  remove(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') id: string
  ): Promise<void> {
    return this.supplierNominationsService.remove(userId, id, token);
  }

  // Ranking Factor Weights Management Endpoints
  @Get(':nominationId/factor-weights')
  @ApiOperation({ summary: 'Get ranking factor weights for a nomination' })
  @ApiResponse({
    status: 200,
    description: 'Factor weights retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        costFactor: { type: 'number', example: 33.33 },
        developmentCostFactor: { type: 'number', example: 33.33 },
        leadTimeFactor: { type: 'number', example: 33.34 }
      }
    }
  })
  getFactorWeights(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string
  ): Promise<{ costFactor: number; developmentCostFactor: number; leadTimeFactor: number }> {
    return this.supplierNominationsService.getFactorWeights(userId, nominationId, token);
  }

  @Put(':nominationId/factor-weights')
  @ApiOperation({ summary: 'Update ranking factor weights for a nomination' })
  @ApiResponse({
    status: 200,
    description: 'Factor weights updated successfully'
  })
  updateFactorWeights(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Body() weights: {
      costFactor: number;
      developmentCostFactor: number;
      leadTimeFactor: number;
    }
  ): Promise<boolean> {
    return this.supplierNominationsService.updateFactorWeights(userId, nominationId, weights, token);
  }

  // Supplier Ranking Calculation Endpoints
  @Post(':nominationId/calculate-rankings')
  @ApiOperation({ summary: 'Calculate supplier rankings based on current data and weights' })
  @ApiResponse({
    status: 200,
    description: 'Supplier rankings calculated successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vendorId: { type: 'string' },
          costRank: { type: 'number' },
          developmentCostRank: { type: 'number' },
          leadTimeRank: { type: 'number' },
          totalScore: { type: 'number' },
          overallRank: { type: 'number' }
        }
      }
    }
  })
  calculateSupplierRankings(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string
  ): Promise<Array<{
    vendorId: string;
    costRank: number;
    developmentCostRank: number;
    leadTimeRank: number;
    totalScore: number;
    overallRank: number;
  }>> {
    return this.supplierNominationsService.calculateSupplierRankings(userId, nominationId, token);
  }

  @Post(':nominationId/store-rankings')
  @ApiOperation({ summary: 'Calculate and store supplier rankings in database' })
  @ApiResponse({
    status: 200,
    description: 'Supplier rankings stored successfully'
  })
  storeSupplierRankings(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string
  ): Promise<boolean> {
    return this.supplierNominationsService.storeSupplierRankings(userId, nominationId, token);
  }

  @Get(':nominationId/rankings')
  @ApiOperation({ summary: 'Get stored supplier rankings' })
  @ApiResponse({
    status: 200,
    description: 'Stored rankings retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vendorId: { type: 'string' },
          netPriceUnit: { type: 'number' },
          developmentCost: { type: 'number' },
          leadTimeDays: { type: 'number' },
          costRank: { type: 'number' },
          developmentCostRank: { type: 'number' },
          leadTimeRank: { type: 'number' },
          totalScore: { type: 'number' },
          overallRank: { type: 'number' },
          calculatedAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  getStoredRankings(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string
  ): Promise<Array<{
    vendorId: string;
    netPriceUnit: number;
    developmentCost: number;
    leadTimeDays: number;
    costRank: number;
    developmentCostRank: number;
    leadTimeRank: number;
    totalScore: number;
    overallRank: number;
    calculatedAt: string;
  }>> {
    return this.supplierNominationsService.getStoredRankings(userId, nominationId, token);
  }

  @Get('approved-vendors/bom-part/:bomPartId')
  @ApiOperation({ summary: 'Get approved vendors for a specific BOM part from supplier nominations' })
  @ApiResponse({
    status: 200,
    description: 'Approved vendors retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vendorId: { type: 'string' },
          vendorName: { type: 'string' },
          supplierCode: { type: 'string' },
          nominationId: { type: 'string' },
          nominationName: { type: 'string' },
          overallScore: { type: 'number' },
          recommendation: { type: 'string' },
          approvalDate: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  getApprovedVendorsByBomPart(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('bomPartId') bomPartId: string,
    @Query('projectId') projectId?: string
  ): Promise<Array<{
    vendorId: string;
    vendorName: string;
    supplierCode?: string;
    nominationId: string;
    nominationName: string;
    overallScore: number;
    recommendation: string;
    approvalDate?: string;
  }>> {
    return this.supplierNominationsService.getApprovedVendorsByBomPart(userId, bomPartId, projectId, token);
  }

  // Cost Competency Analysis Endpoints
  @Get(':id/cost-analysis')
  @ApiOperation({ summary: 'Get cost competency analysis data for nomination' })
  @ApiResponse({
    status: 200,
    description: 'Cost analysis data retrieved successfully',
    type: [CostCompetencyAnalysisDto]
  })
  getCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string
  ): Promise<CostCompetencyAnalysisDto[]> {
    return this.supplierNominationsService.getCostAnalysis(userId, nominationId, token);
  }

  @Post(':id/cost-analysis/init')
  @ApiOperation({ summary: 'Initialize cost competency analysis data for nomination' })
  @ApiResponse({
    status: 201,
    description: 'Cost analysis data initialized successfully'
  })
  initializeCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string
  ): Promise<void> {
    return this.supplierNominationsService.initializeCostAnalysis(userId, nominationId, token);
  }

  @Put(':id/cost-analysis')
  @ApiOperation({ summary: 'Bulk update cost competency analysis data' })
  @ApiResponse({
    status: 200,
    description: 'Cost analysis data updated successfully'
  })
  updateCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Body() updateDto: BulkUpdateCostDataDto
  ): Promise<CostCompetencyAnalysisDto[]> {
    return this.supplierNominationsService.updateCostAnalysis(userId, nominationId, updateDto, token);
  }

  @Put(':id/cost-analysis/:component')
  @ApiOperation({ summary: 'Update specific cost component' })
  @ApiResponse({
    status: 200,
    description: 'Cost component updated successfully'
  })
  updateCostComponent(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Param('component') costComponent: string,
    @Body() updateDto: UpdateCostValueDto
  ): Promise<void> {
    return this.supplierNominationsService.updateCostComponent(userId, nominationId, costComponent, updateDto, token);
  }

  @Put(':id/cost-analysis/:component/vendor/:vendorId')
  @ApiOperation({ summary: 'Update vendor-specific cost value' })
  @ApiResponse({
    status: 200,
    description: 'Vendor cost value updated successfully'
  })
  updateVendorCostValue(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Param('component') costComponent: string,
    @Param('vendorId') vendorId: string,
    @Body() updateDto: { numericValue?: number; textValue?: string }
  ): Promise<void> {
    return this.supplierNominationsService.updateVendorCostValue(userId, nominationId, costComponent, vendorId, updateDto, token);
  }

  @Put(':id/cost-analysis/batch')
  @ApiOperation({ summary: 'Batch update cost competency analysis data - ENTERPRISE BEST PRACTICE' })
  @ApiResponse({
    status: 200,
    description: 'Cost analysis data updated successfully in batch'
  })
  batchUpdateCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Body() updateDto: BulkUpdateCostDataDto
  ): Promise<CostCompetencyAnalysisDto[]> {
    return this.supplierNominationsService.batchUpdateCostAnalysis(userId, nominationId, updateDto, token);
  }

  // Capability Scoring Endpoints
  @Get(':id/capability-scores')
  @ApiOperation({ summary: 'Get capability scoring data for nomination' })
  @ApiResponse({
    status: 200,
    description: 'Capability scores retrieved successfully'
  })
  getCapabilityScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string
  ): Promise<any> {
    return this.supplierNominationsService.getCapabilityScores(userId, nominationId, token);
  }

  @Post(':id/capability-scores/init')
  @ApiOperation({ summary: 'Initialize capability scoring criteria for nomination' })
  @ApiResponse({
    status: 201,
    description: 'Capability criteria initialized successfully'
  })
  initializeCapabilityScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string
  ): Promise<void> {
    return this.supplierNominationsService.initializeCapabilityScores(userId, nominationId, token);
  }

  @Put(':id/capability-scores/:criteriaId/vendor/:vendorId')
  @ApiOperation({ summary: 'Update capability score for specific vendor and criteria' })
  @ApiResponse({
    status: 200,
    description: 'Capability score updated successfully'
  })
  updateCapabilityScore(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Param('criteriaId') criteriaId: string,
    @Param('vendorId') vendorId: string,
    @Body() updateDto: { score: number }
  ): Promise<void> {
    return this.supplierNominationsService.updateCapabilityScore(userId, nominationId, criteriaId, vendorId, updateDto.score, token);
  }

  @Put(':id/capability-scores/batch')
  @ApiOperation({ summary: 'Batch update capability scores - ENTERPRISE BEST PRACTICE' })
  @ApiResponse({
    status: 200,
    description: 'Capability scores updated successfully in batch'
  })
  batchUpdateCapabilityScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Body() updateDto: {
      updates: Array<{
        criteriaId: string;
        vendorId: string;
        score: number;
      }>
    }
  ): Promise<void> {
    return this.supplierNominationsService.batchUpdateCapabilityScores(userId, nominationId, updateDto.updates, token);
  }

  @Put(':id/capability-scores/:criteriaId')
  @ApiOperation({ summary: 'Update capability criteria name' })
  @ApiResponse({
    status: 200,
    description: 'Capability criteria updated successfully'
  })
  updateCapabilityCriteria(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('id') nominationId: string,
    @Param('criteriaId') criteriaId: string,
    @Body() updateDto: UpdateCapabilityCriteriaDto
  ): Promise<void> {
    return this.supplierNominationsService.updateCapabilityCriteria(userId, nominationId, criteriaId, updateDto.criteriaName, token);
  }

  // Vendor Assessment Matrix Endpoints
  @Get(':nominationId/vendors/:vendorId/assessment')
  @ApiOperation({ summary: 'Get vendor assessment criteria' })
  @ApiResponse({
    status: 200,
    description: 'Assessment criteria retrieved successfully',
    type: [VendorAssessmentCriteriaDto]
  })
  getVendorAssessmentCriteria(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<VendorAssessmentCriteriaDto[]> {
    return this.supplierNominationsService.getVendorAssessmentCriteria(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  @Post(':nominationId/vendors/:vendorId/assessment/init')
  @ApiOperation({ summary: 'Initialize vendor assessment criteria' })
  @ApiResponse({
    status: 201,
    description: 'Assessment criteria initialized successfully'
  })
  initializeVendorAssessmentCriteria(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<void> {
    return this.supplierNominationsService.initializeVendorAssessmentCriteria(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  @Put(':nominationId/vendors/:vendorId/assessment/:criteriaId')
  @ApiOperation({ summary: 'Update individual assessment criterion' })
  @ApiResponse({
    status: 200,
    description: 'Assessment criterion updated successfully'
  })
  updateVendorAssessmentCriterion(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string,
    @Param('criteriaId') criteriaId: string,
    @Body() updateDto: Partial<{
      actualScore: number;
      totalScore: number;
      riskSectionTotal: number;
      riskActualScore: number;
      minorNC: number;
      majorNC: number;
    }>
  ): Promise<void> {
    return this.supplierNominationsService.updateVendorAssessmentCriterion(
      userId,
      nominationId,
      vendorId,
      criteriaId,
      updateDto,
      token
    );
  }

  @Put(':nominationId/vendors/:vendorId/assessment/batch')
  @ApiOperation({ summary: 'Batch update vendor assessment criteria - ENTERPRISE BEST PRACTICE' })
  @ApiResponse({
    status: 200,
    description: 'Assessment criteria updated successfully in batch',
    type: [VendorAssessmentCriteriaDto]
  })
  batchUpdateVendorAssessmentCriteria(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string,
    @Body() updateDto: BatchAssessmentUpdateDto
  ): Promise<VendorAssessmentCriteriaDto[]> {
    return this.supplierNominationsService.batchUpdateVendorAssessmentCriteria(
      userId,
      nominationId,
      vendorId,
      updateDto.updates,
      token
    );
  }

  @Get(':nominationId/vendors/:vendorId/assessment/metrics')
  @ApiOperation({ summary: 'Get calculated assessment metrics for vendor' })
  @ApiResponse({
    status: 200,
    description: 'Assessment metrics calculated successfully',
    schema: {
      type: 'object',
      properties: {
        overallScore1: { type: 'number' },
        overallScore2: { type: 'number' },
        totalActual: { type: 'number' },
        totalPossible: { type: 'number' },
        totalMinorNC: { type: 'number' },
        totalMajorNC: { type: 'number' },
        ratingStatus: { type: 'string', enum: ['excellent', 'good', 'needs_improvement'] }
      }
    }
  })
  getVendorAssessmentMetrics(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<{
    overallScore1: number;
    overallScore2: number;
    totalActual: number;
    totalPossible: number;
    totalMinorNC: number;
    totalMajorNC: number;
    ratingStatus: 'excellent' | 'good' | 'needs_improvement';
  }> {
    return this.supplierNominationsService.getVendorAssessmentMetrics(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  // =======================================
  // Vendor Rating Matrix Endpoints (ENTERPRISE GRADE - CLEANED UP)
  // =======================================

  @Get(':nominationId/vendors/:vendorId/rating-matrix')
  @ApiOperation({ 
    summary: 'Get vendor rating matrix data',
    description: 'Retrieve complete rating matrix for vendor assessment'
  })
  @ApiResponse({
    status: 200,
    description: 'Rating matrix retrieved successfully',
    type: [VendorRatingMatrixDto]
  })
  @ApiResponse({
    status: 404,
    description: 'Rating matrix not found'
  })
  getVendorRatingMatrix(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<VendorRatingMatrixDto[]> {
    return this.supplierNominationsService.getVendorRatingMatrix(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  @Post(':nominationId/vendors/:vendorId/rating-matrix/init')
  @ApiOperation({ 
    summary: 'Initialize vendor rating matrix',
    description: 'Create rating matrix with default criteria for vendor assessment'
  })
  @ApiResponse({
    status: 201,
    description: 'Rating matrix initialized successfully',
    type: [VendorRatingMatrixDto]
  })
  @ApiResponse({
    status: 409,
    description: 'Rating matrix already exists'
  })
  initializeVendorRatingMatrix(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<VendorRatingMatrixDto[]> {
    return this.supplierNominationsService.initializeVendorRatingMatrix(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  @Put(':nominationId/vendors/:vendorId/rating-matrix/batch')
  @ApiOperation({ 
    summary: 'Batch update rating matrix - ATOMIC ENTERPRISE OPERATION',
    description: 'Atomically update multiple rating matrix items in single transaction'
  })
  @ApiResponse({
    status: 200,
    description: 'Rating matrix updated successfully in batch',
    type: [VendorRatingMatrixDto]
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid update data or batch operation failed'
  })
  async batchUpdateVendorRatingMatrix(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string,
    @Body() updateDto: BatchVendorRatingUpdateDto
  ): Promise<VendorRatingMatrixDto[]> {
    if (!updateDto?.updates || updateDto.updates.length === 0) {
      throw new BadRequestException('No updates provided in batch request');
    }

    if (updateDto.updates.length > 50) {
      throw new BadRequestException('Maximum 50 updates allowed per batch');
    }

    return this.supplierNominationsService.batchUpdateVendorRatingMatrix(
      userId,
      nominationId,
      vendorId,
      updateDto.updates,
      token
    );
  }

  @Get(':nominationId/vendors/:vendorId/rating-matrix/overall-scores')
  @ApiOperation({ 
    summary: 'Get calculated overall scores for vendor rating',
    description: 'Calculate and return aggregated scores from rating matrix data'
  })
  @ApiResponse({
    status: 200,
    description: 'Overall scores calculated successfully',
    type: VendorRatingOverallScoresDto
  })
  @ApiResponse({
    status: 404,
    description: 'No rating data found for score calculation'
  })
  getVendorRatingOverallScores(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('vendorId') vendorId: string
  ): Promise<VendorRatingOverallScoresDto> {
    return this.supplierNominationsService.getVendorRatingOverallScores(
      userId,
      nominationId,
      vendorId,
      token
    );
  }

  // =======================================
  // Part-wise Cost Analysis Endpoints (ENTERPRISE GRADE)
  // =======================================

  @Get(':nominationId/parts/:bomItemId/cost-analysis')
  @ApiOperation({ 
    summary: 'Get part-wise cost analysis for specific BOM part',
    description: 'Retrieve cost analysis data for all vendors for a specific BOM part within nomination'
  })
  @ApiResponse({
    status: 200,
    description: 'Part-wise cost analysis retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        costAnalysis: { type: 'array', items: { $ref: '#/components/schemas/PartWiseCostAnalysisDto' } },
        baseData: { $ref: '#/components/schemas/PartWiseCostBaseDataDto' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Part-wise cost analysis not found'
  })
  getPartWiseCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('bomItemId') bomItemId: string
  ): Promise<{
    costAnalysis: PartWiseCostAnalysisDto[];
    baseData: PartWiseCostBaseDataDto | null;
  }> {
    return this.supplierNominationsService.getPartWiseCostAnalysis(
      userId,
      nominationId,
      bomItemId,
      token
    );
  }

  @Post(':nominationId/parts/:bomItemId/cost-analysis/init')
  @ApiOperation({ 
    summary: 'Initialize part-wise cost analysis for BOM part',
    description: 'Create cost analysis records for all vendors for a specific BOM part'
  })
  @ApiResponse({
    status: 201,
    description: 'Part-wise cost analysis initialized successfully'
  })
  @ApiResponse({
    status: 409,
    description: 'Part-wise cost analysis already exists'
  })
  initializePartWiseCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('bomItemId') bomItemId: string
  ): Promise<void> {
    return this.supplierNominationsService.initializePartWiseCostAnalysis(
      userId,
      nominationId,
      bomItemId,
      token
    );
  }

  @Put(':nominationId/parts/:bomItemId/cost-analysis/bulk')
  @ApiOperation({ 
    summary: 'Bulk update part-wise cost analysis - ATOMIC ENTERPRISE OPERATION',
    description: 'Atomically update cost analysis data for all vendors for a specific BOM part'
  })
  @ApiResponse({
    status: 200,
    description: 'Part-wise cost analysis updated successfully in batch',
    schema: {
      type: 'object',
      properties: {
        costAnalysis: { type: 'array', items: { $ref: '#/components/schemas/PartWiseCostAnalysisDto' } },
        baseData: { $ref: '#/components/schemas/PartWiseCostBaseDataDto' }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid update data or batch operation failed'
  })
  async bulkUpdatePartWiseCostAnalysis(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string,
    @Param('bomItemId') bomItemId: string,
    @Body() updateDto: BulkUpdatePartWiseCostAnalysisDto
  ): Promise<{
    costAnalysis: PartWiseCostAnalysisDto[];
    baseData: PartWiseCostBaseDataDto | null;
  }> {
    if (!updateDto || (!updateDto.baseData && (!updateDto.vendorCostData || updateDto.vendorCostData.length === 0))) {
      throw new BadRequestException('No update data provided in bulk request');
    }

    if (updateDto.vendorCostData && updateDto.vendorCostData.length > 20) {
      throw new BadRequestException('Maximum 20 vendor updates allowed per batch');
    }

    return this.supplierNominationsService.bulkUpdatePartWiseCostAnalysis(
      userId,
      nominationId,
      bomItemId,
      updateDto,
      token
    );
  }

  @Get(':nominationId/part-wise-analysis-summary')
  @ApiOperation({ 
    summary: 'Get part-wise analysis summary for dashboard',
    description: 'Retrieve summary statistics for all BOM parts in the nomination'
  })
  @ApiResponse({
    status: 200,
    description: 'Part-wise analysis summary retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bomItemId: { type: 'string' },
          bomItemName: { type: 'string' },
          partNumber: { type: 'string' },
          vendorCount: { type: 'number' },
          vendors: { type: 'array' },
          lowestNetPrice: { type: 'number' },
          lowestDevelopmentCost: { type: 'number' },
          shortestLeadTime: { type: 'number' },
          topVendor: { type: 'object' }
        }
      }
    }
  })
  getPartWiseAnalysisSummary(
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Param('nominationId') nominationId: string
  ): Promise<any[]> {
    return this.supplierNominationsService.getPartWiseAnalysisSummary(
      userId,
      nominationId,
      token
    );
  }
}