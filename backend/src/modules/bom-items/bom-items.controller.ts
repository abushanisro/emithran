import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../../common/audit/audit.service';
import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';
import { breakerFor, CAD_ENGINE, isServiceUnavailable } from '../../common/resilience/circuit-breaker';
import { catalogRowForLine, identityRows, type CatalogRow } from './process-catalog/catalog-row-for-line';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UploadedFiles,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  Logger,
  Patch,
  InternalServerErrorException,
  ServiceUnavailableException,
  ConflictException,
  UseGuards,
  ParseUUIDPipe,
  ParseEnumPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as path from 'path';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { BOMItemsService } from './bom-items.service';
import { FeatureToleranceService } from './services/feature-tolerance.service';
import { AnalysisStatusService } from './services/analysis-status.service';
import { currentFeatureGraphVersion, MISSING_ANALYSIS_TEXT, type AnalysisStatus } from './analysis-status';
import { CreateBOMItemDto, UpdateBOMItemDto, QueryBOMItemsDto, BOMItemType } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import { AutoFillResponseDto } from './dto/auto-fill.dto';
import { MachineOverrideDto } from './dto/machine-selection.dto';
import { CostOverrideDto } from './dto/cost-override.dto';
import { ApplyRouteDto, AUTO_ROUTE_ID, type ApplyRouteResult, ApplyCustomRouteDto, type ApplyCustomRouteResult } from './dto/apply-route.dto';
import type { PhysicsGap } from './dto/cost-breakdown.dto';
import { LOCATION_INFO } from './costing/shared/core/default-rates.constants';
import { ExchangeRateService, RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { deriveImplications } from './intelligence/manufacturing-implication.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PmiReviewService, type PmiReviewRequest } from './services/pmi-review.service';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { SecondaryProcessService } from './services/secondary-process.service';
import { NreService } from './services/nre.service';
import { resolveCostingInputs } from './costing/shared/physics/costing-inputs';
import { DFMScoringService } from './services/dfm-scoring.service';
import { MaterialIntelligenceService, type MaterialCandidate } from './services/material-intelligence.service';
import { MaterialResolutionService } from './services/material-resolution.service';
import { DatabaseService } from '../../common/database/database.service';
import { findRouteDataGaps, formatNearestRowsDisclosure, isPerPartCharge } from './costing/shared/core/engine-kernel';
import { RouteResultDto } from './dto/route-comparison.dto';
import {
  PersistedLineCurrency,
  resolvePersistedCostCurrencyBasis,
} from './costing/shared/core/persisted-currency-contract';
import { COST_ENGINE_CONTRACT_VERSION } from './costing/shared/core/persisted-process-cost';
import axios from 'axios';
import { RouteApplicationService } from './services/route-application.service';
import { ScenarioApplicationService } from './services/scenario-application.service';
import { CostTableService } from './services/cost-table.service';
import type { CostTable } from './costing/shared/cost-table';
import { ApplyScenarioDto, type ScenarioApplicationResult } from './dto/apply-scenario.dto';
import { AnalysisRunService, type AnalysisRunResult } from './services/analysis-run.service';
import { BomItemReanalysisService } from './services/bom-item-reanalysis.service';
import { CalculatorInputsRequestDto, MachiningCalculatorInputsRequestDto } from './dto/machining-calculator-inputs.dto';
import { SIGNED_URL_TTL_SEC, getReusableSignedUrl, rememberSignedUrl } from './services/signed-url-cache';
import { DEFAULT_CAD_ENGINE_URL } from '../../common/engine-urls';
import { OrgRole } from '../../common/authz/authz-policy';

// Define User type if not available
interface User {
  id: string;
  email?: string;
  [key: string]: any;
}

// The persisted-money currency contract (migration 707) lives in
// costing/shared/core/persisted-currency-contract.ts, next to the cost kernel
// it describes, so its two decisions can be tested against real currency codes
// without standing up a controller and a database.


/** The files served by the generic signed-URL route; 'dxf' has its own route above it. */
const SIGNED_FILE_TYPES = { TWO_D: '2d', THREE_D: '3d' } as const;

@ApiTags('BOM Items')
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'bom-items', version: '1' })
export class BOMItemsController {
  private readonly logger = new Logger(BOMItemsController.name);

  constructor(
    private readonly bomItemsService: BOMItemsService,
    private readonly fileStorageService: FileStorageService,
    private readonly stepConverterService: StepConverterService,
    private readonly cadAnalysisService: CADAnalysisService,
    private readonly autoFillService: AutoFillService,
    private readonly reanalysis: BomItemReanalysisService,
    private readonly analysisRuns: AnalysisRunService,
    private readonly secondaryProcessService: SecondaryProcessService,
    private readonly nreService: NreService,
    private readonly dfmScoringService: DFMScoringService,
    private readonly materialIntelligenceService: MaterialIntelligenceService,
    private readonly databaseService: DatabaseService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly featureToleranceService: FeatureToleranceService,
    private readonly pmiReviewService: PmiReviewService,
    private readonly materialResolutionService: MaterialResolutionService,
    private readonly audit: AuditService,
    private readonly analysisStatusService: AnalysisStatusService,
    private readonly routeApplications: RouteApplicationService,
    private readonly scenarioApplications: ScenarioApplicationService,
    private readonly costTables: CostTableService,
  ) {}

  // ── Stateless CAD auto-fill (no DB writes) ──────────────────────────────────
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // heavy: parses or analyses a file
  @Post('autofill-analyses')
  @ApiOperation({ summary: 'Analyze a 3D file and return auto-fill suggestions (stateless, no DB write)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Auto-fill suggestions returned', type: AutoFillResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CAD_FILE_BYTES },
    }),
  )
  async analyzeForAutoFill(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('location') location?: string,
    // Create BOM Item's process dropdown: a manual, disclosed family override
    // for when auto-detection gets it wrong or doesn't run at all. Passed
    // through unvalidated -- cad-engine's own ALL_FAMILIES check (shared/
    // memory_optimizer.py) is the single source of truth for which values are
    // real and silently ignores anything else, so there is nothing to
    // duplicate or fabricate here.
    @Body('familyHint') familyHint?: string,
  ): Promise<AutoFillResponseDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (!this.stepConverterService.isStepFile(file.originalname ?? '')) {
      const ext = path.extname(file.originalname ?? '').toLowerCase();
      throw new BadRequestException(
        `Unsupported file type: ${ext || '(none)'}. The CAD engine can analyse: ` +
        `${this.stepConverterService.getSupportedExtensions().map((e) => '.' + e).join(', ')}`,
      );
    }
    if (!user?.id) {
      throw new BadRequestException('User authentication required');
    }
    return this.autoFillService.analyzeAndSuggest(file.buffer, file.originalname, user.id, token, location, false, familyHint);
  }

  // ── Measurement only (no process yet): Name, Part Number, volume, surface
  // area and bounding box of a dropped model. Stateless, no DB write.
  @Post('measure-for-autofill')
  @ApiOperation({ summary: 'Measure a 3D file (volume, surface, bounding box) before its process is known' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_CAD_FILE_BYTES } }))
  async measureForAutoFill(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (!this.stepConverterService.isStepFile(file.originalname ?? '')) {
      const ext = path.extname(file.originalname ?? '').toLowerCase();
      throw new BadRequestException(`Unsupported file type: ${ext || '(none)'}.`);
    }
    return this.autoFillService.measureForAutoFill(file.buffer, file.originalname);
  }

  // ── Background variant: for large/complex files where CAD analysis can take
  // minutes (mostly OCC's own STEP transfer). Returns a jobId immediately;
  // poll GET analyze-for-autofill/:jobId for the result. ──────────────────────
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // heavy: parses or analyses a file
  @Post('autofill-analysis-jobs')
  @ApiOperation({ summary: 'Start a background 3D file analysis; returns a jobId to poll' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CAD_FILE_BYTES },
    }),
  )
  async startAnalyzeForAutoFill(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('location') location?: string,
    // See analyzeForAutoFill's own comment — same manual family override.
    @Body('familyHint') familyHint?: string,
  ): Promise<{ jobId: string }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (!this.stepConverterService.isStepFile(file.originalname ?? '')) {
      const ext = path.extname(file.originalname ?? '').toLowerCase();
      throw new BadRequestException(
        `Unsupported file type: ${ext || '(none)'}. The CAD engine can analyse: ` +
        `${this.stepConverterService.getSupportedExtensions().map((e) => '.' + e).join(', ')}`,
      );
    }
    const jobId = this.autoFillService.startAnalysis(file.buffer, file.originalname, user.id, token, location, familyHint);
    return { jobId };
  }

  @OrgRole('viewer')
  @Get('autofill-analysis-jobs/:jobId')
  @ApiOperation({ summary: 'Poll the status/result of a background analysis job' })
  async getAnalyzeForAutoFillStatus(
    @Param('jobId') jobId: string,
  ): Promise<{ status: 'processing' | 'ready' | 'error'; result?: AutoFillResponseDto; error?: string }> {
    const job = this.autoFillService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException('Analysis job not found or expired');
    }
    return { status: job.status, result: job.result, error: job.error };
  }

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'Get all BOM items' })
  @ApiResponse({ status: 200, description: 'BOM items retrieved successfully', type: BOMItemListResponseDto })
  async findAll(@Query() query: QueryBOMItemsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemListResponseDto> {
    try {
      this.logger.log(`Finding BOM items for user: ${user?.id || 'unknown'}`);
      
      if (!user?.id) {
        throw new BadRequestException('User authentication required');
      }
      
      const { bomId, search, itemType, page, limit } = query;
      return await this.bomItemsService.findAll(bomId, search, itemType, page, limit, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to find BOM items: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get('material-density')
  @ApiOperation({ summary: 'Look up density for a material grade from the reference table' })
  @ApiResponse({ status: 200, description: 'Density result' })
  async getMaterialDensity(
    @Query('grade') grade: string,
    @AccessToken() token: string,
  ): Promise<{ density_g_cm3: number | null; material_name: string | null; material_grade: string | null }> {
    try {
      return await this.bomItemsService.materialDensity(grade ?? '', token);
    } catch (error) {
      // A lookup that fails leaves Weight for the user to fill in; it never blocks the form.
      this.logger.warn(`Material density lookup failed for "${grade}": ${error instanceof Error ? error.message : String(error)}`);
      return { density_g_cm3: null, material_name: null, material_grade: null };
    }
  }

  @OrgRole('viewer')
  @Get('analysis-version')
  @ApiOperation({ summary: 'Return the current feature graph version the backend produces' })
  @ApiResponse({ status: 200, description: 'Current analysis version' })
  getAnalysisVersion(): { version: number; cad_engine_version: string } {
    return {
      version: currentFeatureGraphVersion(),
      cad_engine_version: process.env.CAD_ENGINE_VERSION ?? 'geo_v5',
    };
  }

  @OrgRole('viewer')
  @Get(':id/analysis-status')
  @ApiOperation({ summary: "Whether the item's required analyses (CAD features, and the casting analysis for a sand-cast part) are finished and current; what to run when not" })
  @ApiResponse({ status: 200, description: 'Analysis status' })
  async getAnalysisStatus(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<AnalysisStatus> {
    return this.analysisStatusService.forItem(await this.bomItemsService.findOne(id, user.id, token), token);
  }

  @OrgRole('viewer')
  @Get(':id/cost-table')
  @ApiOperation({ summary: "The part's applied cost as a table: cost objects (part, material, process groups, processes, logistics, procured parts, tooling) by column, in USD" })
  @ApiResponse({ status: 200, description: 'The cost table; a column the cost model has no data for is declared modelled: false with the reason' })
  async getCostTable(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string): Promise<CostTable> {
    return this.costTables.forItem(id, token);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationContextGuard)
  @Post(':id/scenario-applications')
  @ApiOperation({
    summary: 'Apply a scenario as one operation: make the analysis current, write the scenario, the material cost record and the route, and store the outcome',
    description:
      'One apply at a time per item, against the revision the caller read (409 scenario_revision_conflict / scenario_apply_in_progress). ' +
      "The outcome is stored in scenario_overrides.appliedScenario: revision (successful applies), status applying | applied | failed, the reason when failed. " +
      'Not one database transaction: a failure keeps the earlier writes and says so; applying again converges.',
  })
  @ApiResponse({ status: 200, description: 'The applied scenario state, what ran, and what was written' })
  @ApiResponse({ status: 409, description: 'analysis_not_ready, scenario_revision_conflict or scenario_apply_in_progress' })
  async applyScenario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: ApplyScenarioDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<ScenarioApplicationResult> {
    return this.scenarioApplications.apply({ bomItemId: id, userId: user.id, organizationId, token, request });
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationContextGuard)
  @Post(':id/analysis-runs')
  @ApiOperation({ summary: "Make the item's analysis current: run what analysis-status says is missing (CAD features, drawing, casting analysis) and nothing else" })
  @ApiResponse({ status: 200, description: 'What ran, and the analysis status after it' })
  async runAnalysis(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<AnalysisRunResult> {
    return this.analysisRuns.ensureCurrent({ bomItemId: id, userId: user.id, organizationId, token });
  }

  @OrgRole('viewer')
  @Get(':id')
  @ApiOperation({ summary: 'Get BOM item by ID' })
  @ApiResponse({ status: 200, description: 'BOM item retrieved successfully', type: BOMItemResponseDto })
  @ApiResponse({ status: 404, description: 'BOM item not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemResponseDto> {
    return this.bomItemsService.findOne(id, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id/material-intelligence')
  @ApiOperation({ summary: 'Return top-3 material candidates scored against geometry and family' })
  @ApiResponse({ status: 200, description: 'Material candidates returned' })
  async getMaterialIntelligence(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<MaterialCandidate[]> {
    const item = await this.bomItemsService.findOne(id, user.id, token);
    const hint = `${item.materialGrade ?? ''} ${item.material ?? ''}`.trim() || null;
    return this.materialIntelligenceService.getCandidates(
      token,
      item.familyClassification ?? 'sheet_metal',
      item.sheetThicknessMm ?? 0,
      item.holeCount ?? 0,
      item.bendCount ?? 0,
      null,   // surfaceFinish not yet in BOMItemResponseDto; wire up once DTO exposes it
      hint,
    );
  }

  // P0.5 audit (documented capability gap, not an oversight): DFM has NO
  // persistence layer at all today. This endpoint always fully recomputes —
  // reading whatever feature_graph_v2/sheetThicknessMm/materialGrade is
  // currently on the item — and writes nothing back (no dfm_scores table
  // exists). Consequences worth knowing before ever changing this:
  //   - CAD/material/thickness changes can never surface a STALE backend DFM
  //     result, because there is no snapshot to go stale — every call is
  //     already "live." (The one real staleness bug this audit found was a
  //     frontend React Query cache gap — useUpdateBOMItem's onSuccess wasn't
  //     invalidating the dfm-scores query key after a material-grade edit —
  //     fixed separately in useBOMItems.ts's invalidateBOMItemUpdateQueries.)
  //   - There is no DFM rule-version concept (no ruleVersion/schema-version
  //     field anywhere) — moot today since nothing is persisted, but a real
  //     gap to close FIRST if persistence is ever introduced, or a rule
  //     change could apply invisibly to old stored results.
  //   - `scoredAt` below is a response timestamp only (stamped at request
  //     time) — it does not represent "freshness of a snapshot" the way it
  //     would if this were ever persisted.
  // If a future requirement needs an audit trail / point-in-time DFM record
  // (e.g. "what did DFM say when this quote was issued"), that is new
  // capability to design deliberately (a real table + rule-version stamping +
  // explicit save action), not something to bolt on by caching this endpoint.
  // The Edit Process Cost dialog's machining calculator: every input from the
  // database for this part (CAD keys + lookup-table rows via the same
  // resolvers the cost engine uses) instead of blank fields.
  @Post(':id/machining-calculator-inputs')
  @ApiOperation({ summary: 'Resolve a machining calculator inputs for this part from CAD and the machining lookup tables' })
  @ApiResponse({ status: 200, description: 'Inputs, their sources, lookup rows, and anything unresolved' })
  async resolveMachiningCalculatorInputs(
    @Param('id') id: string,
    @Body() body: MachiningCalculatorInputsRequestDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    const keys = Object.fromEntries(Object.entries(body.keys ?? {})
      .map(([k, v]) => [k, Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v)));
    return this.bomItemsService.resolveMachiningCalculatorInputs(id, body.calculatorId, keys, user.id, token, body.location, body.batchSize);
  }

  // Any reference calculator (Machining, Die Casting): its inputs for this
  // part, from the cost engine's own run, with sources and lookup rows.
  @Post(':id/calculator-inputs')
  @ApiOperation({ summary: 'Resolve a reference calculator inputs for this part from the cost engine run' })
  @ApiResponse({ status: 200, description: 'Inputs, their sources, lookup rows, and anything unresolved' })
  async resolveCalculatorInputs(
    @Param('id') id: string,
    @Body() body: CalculatorInputsRequestDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    const keys = Object.fromEntries(Object.entries(body.keys ?? {})
      .map(([k, v]) => [k, Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v)));
    return this.bomItemsService.resolveCalculatorInputs(id, body.calculatorId, keys, user.id, token, body.location, body.batchSize, body.runKey);
  }

  // ── Required tolerances per feature instance (GD&T tab, migration 881) ────
  @OrgRole('viewer')
  @Get(':id/feature-tolerances')
  @ApiOperation({ summary: 'Every detected feature instance with its required tolerances (Manual values, then the Tolerance Policy), each with its source' })
  async getFeatureTolerances(@Param('id') id: string, @AccessToken() token: string) {
    return this.featureToleranceService.get(id, token);
  }

  @Put(':id/feature-tolerances/:featureKey')
  @ApiOperation({ summary: 'Set Manual tolerances of one feature instance: { values: { category: number | null } }, null returns the category to Auto' })
  async setFeatureTolerances(
    @Param('id') id: string,
    @Param('featureKey') featureKey: string,
    @Body('values') values: Record<string, unknown>,
    @AccessToken() token: string,
  ) {
    return this.featureToleranceService.setFeature(id, featureKey, values, token);
  }

  // ── Engineer review of PMI values decoded from drawn glyphs (migration 908) ──
  @OrgRole('viewer')
  @Get(':id/pmi-records')
  @ApiOperation({ summary: 'The part PMI engineering records with their review state, and whether the caller may approve or reject' })
  async getPmiRecords(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.pmiReviewService.get(id, user.id, token);
  }

  @Post(':id/pmi-records/review')
  @ApiOperation({ summary: 'Approve or reject one decoded PMI record or a frame datum references (organization owners only; stale or ineligible records are refused)' })
  async reviewPmiRecord(@Param('id') id: string, @Body() body: PmiReviewRequest, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.pmiReviewService.review(id, user.id, token, body);
  }


  @OrgRole('viewer')
  @Get(':id/machining-need')
  @ApiOperation({ summary: 'Features the primary process leaves short of their required tolerances (or cannot form), with the machining operations able to finish each' })
  async getMachiningNeed(@Param('id') id: string, @AccessToken() token: string) {
    return this.featureToleranceService.getMachiningNeed(id, token);
  }

  @OrgRole('viewer')
  @Get(':id/sand-dfm')
  @ApiOperation({ summary: "Design-for-casting checks of the item's sand casting analysis (severity, measured value, threshold, the rule's note, the faces); rules the analysis cannot measure are listed as not evaluated" })
  async getSandDfm(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.bomItemsService.getSandDfm(id, user.id, token);
  }

  @Put(':id/tolerance-policy')
  @ApiOperation({ summary: 'Set the Tolerance Policy for Auto categories: assume_achieved | uniform {values} | cad {replaceBelow}' })
  async setTolerancePolicy(@Param('id') id: string, @Body() policy: unknown, @AccessToken() token: string) {
    return this.featureToleranceService.setPolicy(id, policy, token);
  }

  @OrgRole('viewer')
  @Get(':id/dfm-scores')
  @ApiOperation({ summary: 'Compute per-occurrence DFM risk scores from stored feature_graph_v2 metrics' })
  @ApiResponse({ status: 200, description: 'DFM scores returned' })
  async getDFMScores(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    const item = await this.bomItemsService.findOne(id, user.id, token);
    const fg = item.featureGraph as any;
    const v2features: any[] = fg?.feature_graph_v2?.features ?? [];
    // Real value, possibly null — DFMScoringService.score() distinguishes
    // "genuinely unknown" (null/undefined) from "0 = CNC part" and flags
    // every affected occurrence's riskFactors rather than silently scoring
    // against a fabricated 1mm (see that method's own doc comment).
    const t: number | null = (item as any).sheetThicknessMm ?? null;
    const { utsMpa } = await this.resolveMaterialStrengths(item, token);
    return {
      bomItemId: id,
      sheetThicknessMm: t,
      features: this.dfmScoringService.score(v2features, t, item.materialGrade, utsMpa),
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * The part's material strengths from the SAME matched raw_materials row and
   * family narrowing its quote prices from (MaterialResolutionService), so DFM,
   * the calculator dialog and the quote can never read two different rows.
   */
  private async resolveMaterialStrengths(item: BOMItemResponseDto, token: string) {
    const fg = item.featureGraph as any;
    const { family } = this.materialResolutionService.resolveEffectiveFamily({
      item, fg, grade: item.materialGrade ?? null, sheetThicknessMm: (item as any).sheetThicknessMm ?? 0,
    });
    return this.materialResolutionService.resolveMaterialStrengths(token, item.materialGrade ?? null, family);
  }

  @OrgRole('viewer')
  @Get(':id/material-strengths')
  @ApiOperation({ summary: 'Tensile, shear and yield strength of the part material, from the row its quote uses' })
  async getMaterialStrengths(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    const item = await this.bomItemsService.findOne(id, user.id, token);
    return this.resolveMaterialStrengths(item, token);
  }

  @Post()
  @UseGuards(OrganizationContextGuard)
  @ApiOperation({ summary: 'Create new BOM item' })
  @ApiResponse({ status: 201, description: 'BOM item created successfully', type: BOMItemResponseDto })
  async create(
    @Body() createBOMItemDto: CreateBOMItemDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<BOMItemResponseDto> {
    try {
      if (!user?.id) {
        throw new BadRequestException('User authentication required');
      }
      return await this.bomItemsService.create(createBOMItemDto, user.id, token, organizationId);
    } catch (error) {
      this.logger.error(`Failed to create BOM item: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update BOM item' })
  @ApiResponse({ status: 200, description: 'BOM item updated successfully', type: BOMItemResponseDto })
  async update(@Param('id') id: string, @Body() updateBOMItemDto: UpdateBOMItemDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemResponseDto> {
    return this.bomItemsService.update(id, updateBOMItemDto, user.id, token);
  }

  @Post(':id/reanalyze')
  @ApiOperation({ summary: 'Re-run CAD analysis on the stored 3D file and update featureGraph in DB' })
  @ApiResponse({ status: 200, description: 'Re-analysis complete', type: BOMItemResponseDto })
  @ApiResponse({ status: 400, description: 'No 3D file found for this item' })
  async reanalyze(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    return this.reanalysis.reanalyze(id, user.id, token);
  }

  // Manual re-trigger, mirroring /reanalyze's pattern for the 3D file — for
  // items whose 2D drawing was already uploaded before drawing-intelligence
  // extraction existed (upload-files only calls this automatically for NEW
  // uploads going forward), or to re-run after the parser itself improves.
  @Post(':id/drawing-analyses')
  @ApiOperation({ summary: 'Re-run drawing intelligence extraction on the stored 2D file and update drawing_intelligence in DB' })
  @ApiResponse({ status: 200, description: 'Drawing analysis complete', type: BOMItemResponseDto })
  @ApiResponse({ status: 400, description: 'No 2D file found for this item, or it is not a PDF' })
  async analyzeDrawing(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    return this.reanalysis.analyzeDrawing(id, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id/dependencies')
  @ApiOperation({ summary: 'Check BOM item delete dependencies' })
  @ApiResponse({ status: 200, description: 'Dependencies checked successfully' })
  async checkDeleteDependencies(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.bomItemsService.checkDeleteDependencies(id, user.id, token);
  }

  /**
   * An organization admin deletes an item even though other members' production lots use it: the lot references go with it. The
   * database function checks the admin role in the item's own organization and writes the audit event (migration 945).
   */
  @HttpCode(HttpStatus.OK)
  @Delete(':id/force')
  @OrgRole('admin')
  @ApiOperation({ summary: 'Force delete a BOM item still used in production lots (organization admins)' })
  @ApiResponse({ status: 200, description: 'BOM item deleted; how many lot materials and lots referenced it' })
  @ApiResponse({ status: 403, description: 'Not an admin of the item\'s organization' })
  async forceRemove(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return this.bomItemsService.forceRemove(id, token);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete BOM item' })
  @ApiResponse({ status: 200, description: 'BOM item deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete - item has dependencies' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.audit.auditedRowChange('bom_items', id, 'bom_item.deleted', async () => {
    return this.bomItemsService.remove(id, user.id, token);
  });
  }

  @Patch(':id/thumbnail')
  @ApiOperation({ summary: 'Persist thumbnail URL for a BOM item (captured from 3D viewer)' })
  @ApiResponse({ status: 200, description: 'Thumbnail URL saved' })
  async updateThumbnail(
    @Param('id') id: string,
    @Body() body: { thumbnailUrl: string },
    @AccessToken() token: string,
  ): Promise<{ ok: boolean }> {
    return this.bomItemsService.updateThumbnailUrl(id, body.thumbnailUrl, token);
  }

  @Patch(':id/scenario-overrides')
  @ApiOperation({ summary: 'Merge Cost Guide manual overrides (e.g. sheetThicknessMm) — a null value clears that key, reverting to the CAD/auto-detected value' })
  @ApiResponse({ status: 200, description: 'Scenario overrides updated successfully', type: BOMItemResponseDto })
  async patchScenarioOverrides(
    @Param('id') id: string,
    @Body() patch: Record<string, unknown>,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    return this.bomItemsService.patchScenarioOverrides(id, patch, token);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Update BOM items sort order (drag and drop)' })
  @ApiResponse({ status: 200, description: 'Sort order updated successfully' })
  async updateSortOrder(
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.bomItemsService.updateSortOrder(body.items, user.id, token);
  }

  // Registered before the generic route below: ':fileType' would otherwise swallow 'dxf'.
  @OrgRole('viewer')
  @Get(':id/file-url/dxf')
  @ApiOperation({ summary: 'Get signed URL for BOM item DXF drawing' })
  @ApiResponse({ status: 200, description: 'Signed URL generated successfully' })
  async getDxfFileUrl(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ url: string }> {
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);
    if (!bomItem.fileDxfPath) {
      throw new BadRequestException('No DXF file found for this item');
    }
    const signedUrl = await this.fileStorageService.getSignedUrl(bomItem.fileDxfPath, 3600);
    return { url: signedUrl };
  }

  @OrgRole('viewer')
  @Get(':id/file-url/:fileType')
  @ApiOperation({ summary: 'Get signed URL for BOM item file' })
  @ApiResponse({ status: 200, description: 'Signed URL generated successfully' })
  async getFileUrl(
    @Param('id') id: string,
    @Param('fileType', new ParseEnumPipe(SIGNED_FILE_TYPES)) fileType: '2d' | '3d',
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ url: string }> {
    const filePath = await this.bomItemsService.findFilePath(id, fileType, token);

    if (!filePath) {
      throw new BadRequestException(`No ${fileType} file found for this item`);
    }

    // The same link is handed out again while it has plenty of life left, so
    // the browser's HTTP cache serves repeat views instead of downloading the
    // file from the object store each time (see signed-url-cache.ts). Keyed by user:
    // a link only ever goes back to someone whose access was checked above.
    const cacheKey = `${user.id}:${filePath}`;
    const reused = getReusableSignedUrl(cacheKey);
    if (reused) return { url: reused };

    const signedUrl = await this.fileStorageService.getSignedUrl(filePath, SIGNED_URL_TTL_SEC);
    rememberSignedUrl(cacheKey, signedUrl, SIGNED_URL_TTL_SEC);

    return { url: signedUrl };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // heavy: parses or analyses a file
  @Post(':id/files')
  @ApiOperation({ summary: 'Upload 2D/3D/DXF files for BOM item' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Files uploaded successfully', type: BOMItemResponseDto })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file2d', maxCount: 1 },
        { name: 'file3d', maxCount: 1 },
        { name: 'fileDxf', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_CAD_FILE_BYTES }, // 100 MB
      },
    ),
  )
  async uploadFiles(
    @Param('id') id: string,
    @UploadedFiles() files: { file2d?: any[]; file3d?: any[]; fileDxf?: any[] },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    // Validate files are provided before processing
    if (!files?.file2d?.[0] && !files?.file3d?.[0] && !files?.fileDxf?.[0]) {
      throw new BadRequestException('No files provided');
    }

    // Get BOM item to retrieve BOM ID
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);

    // Get project ID from BOM
    const projectId = await this.bomItemsService.getProjectIdForBOM(bomItem.bomId, token);

    const updateData: UpdateBOMItemDto = {};

    // Upload 2D file if provided
    if (files.file2d?.[0]) {
      const file2d = files.file2d[0];
      const uploadResult = await this.fileStorageService.uploadFile(
        {
          fieldname: file2d.fieldname,
          originalname: file2d.originalname,
          encoding: file2d.encoding,
          mimetype: file2d.mimetype,
          size: file2d.size,
          buffer: file2d.buffer,
        },
        '2d',
        user.id,
        projectId,
        id,
      );
      updateData.file2dPath = uploadResult.storagePath;

      // Drawing intelligence extraction (cad-engine/drawing_analyzer.py) —
      // vector-PDF text extraction only; the parser itself returns an honest
      // "requires OCR" fallback for image/scanned drawings rather than an
      // error, so it's still safe to call for any file2d mimetype. Non-fatal:
      // a failed/unavailable drawing parse must never block the file upload
      // itself — same convention as reanalyze's 3D CAD engine call.
      if (file2d.mimetype === 'application/pdf') {
        try {
          const drawingResult = await this.autoFillService.analyzeDrawing(
            file2d.buffer,
            bomItem.partNumber,
          );
          updateData.drawingIntelligence = drawingResult as unknown as Record<string, any>;
        } catch (err: any) {
          this.logger.warn(`[upload-files] drawing analysis failed (non-fatal): ${err?.message}`);
        }
      }
    }

    // Upload 3D file if provided
    if (files.file3d?.[0]) {
      const file3d = files.file3d[0];

      // Upload original file
      const uploadResult = await this.fileStorageService.uploadFile(
        {
          fieldname: file3d.fieldname,
          originalname: file3d.originalname,
          encoding: file3d.encoding,
          mimetype: file3d.mimetype,
          size: file3d.size,
          buffer: file3d.buffer,
        },
        '3d',
        user.id,
        projectId,
        id,
      );

      // Check if this is a STEP file that needs conversion
      if (this.stepConverterService.isStepFile(file3d.originalname)) {
        try {
          // Convert STEP to STL for browser viewing
          const stlBuffer = await this.stepConverterService.convertStepToStl(
            file3d.buffer,
            file3d.originalname,
          );

          // Upload converted STL file
          const stlFilename = file3d.originalname.replace(/\.(step|stp|iges|igs|sldprt)$/i, '.stl');
          const stlUploadResult = await this.fileStorageService.uploadFile(
            {
              fieldname: 'file3d_converted',
              originalname: stlFilename,
              encoding: file3d.encoding,
              mimetype: 'model/stl',
              size: stlBuffer.length,
              buffer: stlBuffer,
            },
            '3d',
            user.id,
            projectId,
            id,
          );

          // STL for browser viewing; preserve original STEP for reanalysis
          updateData.file3dPath = stlUploadResult.storagePath;
          updateData.fileStepPath = uploadResult.storagePath;

          // Pre-warm the CAD engine geometry cache now while the user fills in BOM
          // details. Fire-and-forget — the result lands in the disk cache so the
          // subsequent analyze-for-autofill call returns in < 1 s instead of 30–70 s.
          this.cadAnalysisService.prewarmCache(file3d.buffer, file3d.originalname);
        } catch (error) {
          // Conversion failed — keep original STEP as the viewable file; it's also the analysis source
          this.logger.warn(`Auto-conversion failed for ${file3d.originalname}, keeping original file`);
          updateData.file3dPath = uploadResult.storagePath;
          updateData.fileStepPath = uploadResult.storagePath;
        }
      } else {
        // Not a STEP file - use original upload
        updateData.file3dPath = uploadResult.storagePath;
      }
    }

    // Upload DXF/DWG file if provided (stored in fileDxfPath, independent of file2dPath)
    if (files.fileDxf?.[0]) {
      const fileDxf = files.fileDxf[0];
      const uploadResult = await this.fileStorageService.uploadFile(
        {
          fieldname: fileDxf.fieldname,
          originalname: fileDxf.originalname,
          encoding: fileDxf.encoding,
          mimetype: fileDxf.mimetype,
          size: fileDxf.size,
          buffer: fileDxf.buffer,
        },
        'dxf',
        user.id,
        projectId,
        id,
      );
      updateData.fileDxfPath = uploadResult.storagePath;
    }

    // Update BOM item with file paths
    return this.bomItemsService.update(id, updateData, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id/dxf-content')
  @ApiOperation({ summary: 'Download decompressed DXF content for browser rendering' })
  @ApiResponse({ status: 200, description: 'Raw DXF content' })
  async getDxfContent(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Res() res: Response,
  ): Promise<void> {
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);
    if (!bomItem.fileDxfPath) {
      throw new BadRequestException('No DXF file found for this item');
    }

    const signedUrl = await this.fileStorageService.getSignedUrl(bomItem.fileDxfPath, 3600);

    const response = await axios.get(signedUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });

    const rawBuffer = Buffer.from(response.data);
    const isGzipped = bomItem.fileDxfPath.endsWith('.gz');
    const content = isGzipped
      ? await promisify(gunzip)(rawBuffer)
      : rawBuffer;

    const filename = (bomItem.fileDxfPath.split('/').pop() ?? 'drawing.dxf').replace(/\.gz$/, '');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', content.length);
    res.send(content);
  }

  @OrgRole('viewer')
  @Get(':id/dxf-content-legacy')
  @ApiOperation({ summary: 'Download decompressed DXF from legacy file2dPath (migration helper)' })
  @ApiResponse({ status: 200, description: 'Raw DXF content' })
  async getDxfContentLegacy(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Res() res: Response,
  ): Promise<void> {
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);
    const filePath = bomItem.file2dPath;
    if (!filePath) {
      throw new BadRequestException('No 2D file found for this item');
    }

    const signedUrl = await this.fileStorageService.getSignedUrl(filePath, 3600);
    const response = await axios.get(signedUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });

    const rawBuffer = Buffer.from(response.data);
    const isGzipped = filePath.endsWith('.gz');
    const content = isGzipped ? await promisify(gunzip)(rawBuffer) : rawBuffer;

    const filename = (filePath.split('/').pop() ?? 'drawing.dxf').replace(/\.gz$/, '');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', content.length);
    res.send(content);
  }

  @Post(':id/step-conversions')
  @ApiOperation({ summary: 'Manually convert STEP file to STL for 3D viewing' })
  @ApiResponse({ status: 200, description: 'STEP file converted successfully' })
  @ApiResponse({ status: 400, description: 'No STEP file found or CAD engine unavailable' })
  async convertStepFile(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    // Get BOM item
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);

    // Check if item has a 3D file
    if (!bomItem.file3dPath) {
      throw new BadRequestException('No 3D file found for this item');
    }

    // Check if it's a STEP file
    const isStepFile = this.stepConverterService.isStepFile(bomItem.file3dPath);
    if (!isStepFile) {
      throw new BadRequestException('File is not a supported CAD file. Only .step and .stp files can be converted');
    }

    // Get project ID from BOM
    const projectId = await this.bomItemsService.getProjectIdForBOM(bomItem.bomId, token);

    // Download the STEP file from the object store
    const stepUrl = await this.fileStorageService.getSignedUrl(bomItem.file3dPath, 3600);

    let stepBuffer: Buffer;
    try {
      const stepResponse = await axios.get(stepUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout for large CAD files
        maxContentLength: MAX_CAD_FILE_BYTES,
      });
      stepBuffer = Buffer.from(stepResponse.data);
    } catch (error) {
      this.logger.error(`Failed to download STEP file from storage: ${error.message}`);
      throw new BadRequestException('Failed to download STEP file from storage. Please ensure the file is accessible.');
    }

    // Extract filename with fallback to prevent undefined
    const originalFilename = bomItem.file3dPath.split('/').pop() || 'model.step';
    const stlFilename = originalFilename.replace(/\.(step|stp|iges|igs)$/i, '.stl');

    // Convert STEP to STL (throws error if fails)
    const stlBuffer = await this.stepConverterService.convertStepToStl(
      stepBuffer,
      originalFilename,
    );

    // Upload converted STL
    const stlUploadResult = await this.fileStorageService.uploadFile(
      {
        fieldname: 'file3d_converted',
        originalname: stlFilename,
        encoding: '7bit',
        mimetype: 'model/stl',
        size: stlBuffer.length,
        buffer: stlBuffer,
      },
      '3d',
      user.id,
      projectId,
      id,
    );

    // STL for browser viewing; the STEP stays the analysis source (the CAD engine cannot analyse a mesh), as on upload
    const updateData: UpdateBOMItemDto = {
      file3dPath: stlUploadResult.storagePath,
      fileStepPath: bomItem.fileStepPath ?? bomItem.file3dPath,
    };

    return this.bomItemsService.update(id, updateData, user.id, token);
  }

  // ============================================================================
  // CAD ANALYSIS ENDPOINTS
  // ============================================================================

  @Post(':id/cad-analyses')
  @ApiOperation({ summary: 'Perform advanced CAD analysis on BOM item' })
  @ApiResponse({ status: 200, description: 'CAD analysis completed successfully' })
  @ApiResponse({ status: 400, description: 'No 3D file found or invalid request' })
  @ApiResponse({ status: 500, description: 'CAD analysis failed' })
  async analyzeBOMItemCAD(
    @Param('id') id: string,
    @Body() body: { 
      strategy?: 'aggressive' | 'balanced' | 'conservative';
      forceReanalysis?: boolean;
    },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    try {
      // Get BOM item to check for 3D file
      const bomItem = await this.bomItemsService.findOne(id, user.id, token);
      
      if (!bomItem.file3dPath) {
        throw new BadRequestException('No 3D file found for this BOM item. Please upload a STEP/IGES file first.');
      }

      // Perform CAD analysis
      const analysisResult = await this.cadAnalysisService.analyzeBOMItem({
        bomItemId: id,
        filePath: bomItem.file3dPath,
        strategy: body.strategy || 'balanced',
        forceReanalysis: body.forceReanalysis || false,
        userId: user.id,
        accessToken: token
      });

      this.logger.log(`CAD analysis completed for BOM item: ${bomItem.partNumber || id}`);

      return {
        success: true,
        message: `CAD analysis completed for ${bomItem.partNumber || 'BOM item'}`,
        analysis: analysisResult
      };

    } catch (error) {
      this.logger.error(`CAD analysis failed for BOM item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get(':id/cad-analysis')
  @ApiOperation({ summary: 'Get CAD analysis results for BOM item' })
  @ApiResponse({ status: 200, description: 'CAD analysis results retrieved successfully' })
  @ApiResponse({ status: 404, description: 'BOM item or analysis not found' })
  async getBOMItemCADAnalysis(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    try {
      const analysis = await this.cadAnalysisService.getBOMItemAnalysis(id, token);
      
      if (!analysis || !analysis.analysis_timestamp) {
        return { success: false, analysis: null };
      }

      return {
        success: true,
        analysis: {
          id: analysis.id,
          partNumber: analysis.part_number,
          analysisTimestamp: analysis.analysis_timestamp,
          analysisVersion: analysis.analysis_version,
          optimizationStrategy: analysis.optimization_strategy,
          
          // Geometry features - only real CAD analysis data
          geometryFeatures: {
            volumeMm3: analysis.volume_mm3 || analysis.geometry_analysis?.volume_mm3,
            surfaceAreaMm2: analysis.surface_area_mm2 || analysis.geometry_analysis?.surface_area_mm2,
            complexityScore: analysis.complexity_score || analysis.geometry_analysis?.complexity_score,
            boundingBox: analysis.geometry_analysis?.bounding_box,
            manufacturingFeatures: analysis.geometry_analysis?.manufacturing_features,
            fullAnalysis: analysis.geometry_analysis
          },
          
          // DFM analysis - only real AI-generated data
          dfmAnalysis: {
            manufacturabilityScore: analysis.manufacturability_score || analysis.dfm_analysis?.manufacturability_score,
            difficultyLevel: analysis.difficulty_level || analysis.dfm_analysis?.difficulty_level,
            recommendedProcesses: analysis.recommended_processes || analysis.dfm_analysis?.recommended_processes,
            warnings: analysis.warnings_details || analysis.dfm_analysis?.warnings,
            aiInsights: analysis.dfm_analysis?.ai_insights,
            competitiveAnalysis: analysis.dfm_analysis?.competitive_analysis,
            sustainabilityMetrics: analysis.dfm_analysis?.sustainability_metrics,
            costFactors: analysis.dfm_analysis?.cost_factors,
            geometricConstraints: analysis.dfm_analysis?.geometric_constraints,
            fullAnalysis: analysis.dfm_analysis
          },
          
          // Memory optimization - only real optimization data
          memoryOptimization: {
            memoryReductionPercent: analysis.memory_reduction_percent || analysis.memory_metrics?.memory_reduction_percent,
            processingTimeMs: analysis.processing_time_ms || analysis.memory_metrics?.processing_time_ms,
            lodLevelsAvailable: analysis.lod_levels_available || analysis.memory_metrics?.lod_levels_available,
            cacheEfficiency: analysis.memory_metrics?.cache_efficiency,
            compressionRatio: analysis.memory_metrics?.compression_ratio,
            fullMetrics: analysis.memory_metrics
          },
          
          // Analysis freshness
          analysisFreshness: analysis.analysis_freshness,
          manufacturingReadiness: analysis.manufacturing_readiness
        }
      };

    } catch (error) {
      this.logger.error(`Failed to get CAD analysis for BOM item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get(':id/cad-analysis/history')
  @ApiOperation({ summary: 'Get CAD analysis history for BOM item' })
  @ApiResponse({ status: 200, description: 'Analysis history retrieved successfully' })
  async getBOMItemAnalysisHistory(
    @Param('id') id: string,
    @Query('limit') limit: number = 10,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    try {
      const history = await this.cadAnalysisService.getAnalysisHistory(id, token, limit);
      
      return {
        success: true,
        history: history.map(entry => ({
          id: entry.id,
          analysisVersion: entry.analysis_version,
          optimizationStrategy: entry.optimization_strategy,
          processingTimeMs: entry.processing_time_ms,
          memoryReductionPercent: entry.memory_reduction_percent,
          cacheHit: entry.cache_hit,
          manufacturabilityScore: entry.manufacturability_score,
          difficultyLevel: entry.difficulty_level,
          warningsCount: entry.warnings_count,
          recommendationsCount: entry.recommendations_count,
          createdAt: entry.created_at
        }))
      };

    } catch (error) {
      this.logger.error(`Failed to get analysis history for BOM item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // heavy: parses or analyses a file
  @Post('cad-analysis-batches')
  @ApiOperation({ summary: 'Perform batch CAD analysis on multiple BOM items' })
  @ApiResponse({ status: 200, description: 'Batch CAD analysis completed' })
  async batchAnalyzeCAD(
    @Body() body: {
      bomItemIds: string[];
      strategy?: 'aggressive' | 'balanced' | 'conservative';
      forceReanalysis?: boolean;
    },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    try {
      if (!body.bomItemIds || body.bomItemIds.length === 0) {
        throw new BadRequestException('No BOM item IDs provided for batch analysis');
      }

      if (body.bomItemIds.length > 50) {
        throw new BadRequestException('Maximum 50 BOM items allowed for batch analysis');
      }

      this.logger.log(`Starting batch CAD analysis for ${body.bomItemIds.length} BOM items`);

      // Get all BOM items with 3D files
      const bomItems = await Promise.all(
        body.bomItemIds.map(async (id) => {
          try {
            const item = await this.bomItemsService.findOne(id, user.id, token);
            return item.file3dPath ? { 
              bomItemId: id, 
              filePath: item.file3dPath,
              partNumber: item.partNumber 
            } : null;
          } catch (error) {
            this.logger.warn(`BOM item ${id} not found or inaccessible`);
            return null;
          }
        })
      );

      const validItems = bomItems.filter(item => item !== null);
      
      if (validItems.length === 0) {
        throw new BadRequestException('No valid BOM items with 3D files found for analysis');
      }

      // Prepare batch analysis requests
      const batchRequests = validItems.map(item => ({
        bomItemId: item.bomItemId,
        filePath: item.filePath,
        strategy: body.strategy || 'balanced',
        forceReanalysis: body.forceReanalysis || false
      }));

      // Execute batch analysis
      const results = await this.cadAnalysisService.batchAnalyzeBOMItems(
        batchRequests,
        user.id,
        token
      );

      this.logger.log(`Batch CAD analysis completed. ${results.length}/${validItems.length} items analyzed successfully`);

      return {
        success: true,
        message: `Batch analysis completed for ${results.length}/${validItems.length} BOM items`,
        results: {
          totalRequested: body.bomItemIds.length,
          validItemsFound: validItems.length,
          successfulAnalyses: results.length,
          failedAnalyses: validItems.length - results.length
        },
        analyses: results.map(result => ({
          bomItemId: validItems.find(item => 
            result.analysisId.includes(item.bomItemId.substring(0, 8))
          )?.bomItemId || 'unknown',
          analysisId: result.analysisId,
          processingTimeMs: result.processingTimeMs,
          manufacturabilityScore: result.dfmAnalysis.manufacturability_score,
          difficultyLevel: result.dfmAnalysis.difficulty_level,
          memoryReductionPercent: result.memoryOptimization.memory_reduction_percent
        }))
      };

    } catch (error) {
      this.logger.error(`Batch CAD analysis failed: ${error.message}`, error.stack);
      throw error;
    }
  }


  // ============================================================================
  // STEP FILE PROCESSING
  // ============================================================================

  private readonly cadEngineUrl    = process.env.CAD_ENGINE_URL     || DEFAULT_CAD_ENGINE_URL;
  private readonly cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';

  @Post('process-step-file')
  @ApiOperation({ summary: 'Process STEP file and create a single assembly BOM item' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Assembly BOM item created' })
  @ApiResponse({ status: 400, description: 'Invalid file or CAD engine error' })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'stepFile', maxCount: 1 }], { limits: { fileSize: MAX_CAD_FILE_BYTES, files: 1 } }))
  async processStepFile(
    @UploadedFiles() files: { stepFile?: any[] },
    @Body() body: { bomId: string; projectId?: string },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!files?.stepFile?.[0]) {
      throw new BadRequestException('No STEP file provided');
    }

    const stepFile = files.stepFile[0];

    if (!this.stepConverterService.isStepFile(stepFile.originalname)) {
      throw new BadRequestException(
        'Invalid file type. Supported: .step, .stp',
      );
    }

    if (stepFile.size > MAX_CAD_FILE_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_CAD_FILE_BYTES / 1024 / 1024} MB limit`);
    }

    if (!body.bomId) {
      throw new BadRequestException('bomId is required');
    }

    this.logger.log(`Processing STEP file: ${stepFile.originalname} for BOM: ${body.bomId}`);

    // ── 1. CAD geometry analysis ─────────────────────────────────────────────
    const formData = new FormData();
    const fileBlob = new Blob([stepFile.buffer], { type: stepFile.mimetype });
    formData.append('file', fileBlob, stepFile.originalname);
    formData.append('strategy', 'balanced');
    formData.append('force_reanalysis', 'false');

    let cadResponse: globalThis.Response;
    try {
      // Behind the cad-engine breaker: while the engine is down this fails at once instead of hanging.
      cadResponse = await breakerFor(CAD_ENGINE).exec(async () => {
        const r = await fetch(`${this.cadEngineUrl}/analyze/geometry`, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json',
            ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
          },
        });
        if (r.status >= 500) throw Object.assign(new Error(`CAD engine answered ${r.status}`), { response: { status: r.status } });
        return r;
      }, isServiceUnavailable);
    } catch (e: any) {
      throw new ServiceUnavailableException(
        `CAD engine is not reachable, so ${stepFile.originalname} was not processed. Start the CAD engine and try again (${e?.message ?? e}).`,
      );
    }

    if (!cadResponse.ok) {
      const detail = await cadResponse.json().then((b: any) => b?.detail).catch(() => undefined);
      throw new BadRequestException(
        `CAD engine could not analyse ${stepFile.originalname}: ${detail ?? cadResponse.statusText}`,
      );
    }

    const cadAnalysis = await cadResponse.json();
    if (!cadAnalysis.success) {
      throw new BadRequestException('CAD engine analysis returned unsuccessful result');
    }

    this.logger.log(`CAD analysis complete for ${stepFile.originalname}`);

    // ── 2. Create a single ASSEMBLY BOM item ─────────────────────────────────
    const baseName  = stepFile.originalname.replace(/\.(step|stp|iges|igs|sldprt)$/i, '');
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const assemblyItem = await this.bomItemsService.create(
      {
        bomId:       body.bomId,
        name:        baseName,
        itemType:    BOMItemType.ASSEMBLY,
        partNumber:  `${baseName.toUpperCase().slice(0, 8)}-${timestamp}-ASM`,
        description: `Assembly — ${baseName}`,
        quantity:    1,
        // No annualVolume. This is an assembly shell created to hold imported
        // children; nobody has stated its yearly demand, and writing 1000 here
        // made that up. It now stays unresolved until someone sets it.
        unitCost:    0,
        unit:        'pcs',
      },
      user.id,
      token,
    );

    // ── 3. Upload STEP file to the assembly item ──────────────────────────────
    try {
      const projectId = body.projectId
        ?? await this.bomItemsService.getProjectIdForBOM(body.bomId, token);

      const uploaded = await this.fileStorageService.uploadFile(
        {
          fieldname:    'file3d',
          originalname: stepFile.originalname,
          encoding:     stepFile.encoding,
          mimetype:     stepFile.mimetype,
          size:         stepFile.size,
          buffer:       stepFile.buffer,
        },
        '3d',
        user.id,
        projectId,
        assemblyItem.id,
      );

      await this.bomItemsService.update(
        assemblyItem.id,
        { file3dPath: uploaded.storagePath },
        user.id,
        token,
      );
    } catch (uploadErr: any) {
      this.logger.warn(`STEP file upload failed: ${uploadErr.message}`);
    }

    return {
      success:         true,
      message:         'STEP file processed successfully',
      fileInfo:        { name: stepFile.originalname, size: stepFile.size, mimetype: stepFile.mimetype },
      cadAnalysis,
      bomItemId:       assemblyItem.id,
      bomItemsCreated: 1,
      assemblyTree: [
        {
          id:         assemblyItem.id,
          name:       baseName,
          type:       'assembly',
          partNumber: assemblyItem.partNumber,
          quantity:   1,
          level:      1,
          children:   [],
          bomItemId:  assemblyItem.id,
        },
      ],
      hierarchyDepth: 1,
    };
  }

  @OrgRole('viewer')
  @Get(':id/manufacturing-implications')
  @ApiOperation({ summary: 'Get deterministic manufacturing implications from drawing intelligence' })
  @ApiResponse({ status: 200, description: 'Implications derived from drawing-confirmed data' })
  async getManufacturingImplications(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    const item = await this.bomItemsService.findOne(id, user.id, token);
    const implications = deriveImplications({
      tightestToleranceMm: item.tightestToleranceMm ?? null,
      coating: item.coating ?? null,
      sheetThicknessMm: item.sheetThicknessMm ?? null,
      drawingMaterial: (item.drawingIntelligence as any)?.material ?? null,
      partName: item.name ?? null,
      drawingIntelligence: item.drawingIntelligence as any,
    });
    return { bomItemId: id, implications };
  }

  @OrgRole('viewer')
  @Get(':id/cost-summary')
  @ApiOperation({ summary: 'Deterministic cost breakdown — material + process lines, no LLM' })
  @ApiResponse({ status: 200, description: 'Cost summary returned' })
  async getCostSummary(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @Query('productionLifeYears') productionLifeYears: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    // No `?? 1` here any more: an absent batch size is passed through as
    // undefined so the canonical resolver (costing-inputs.ts) applies the one
    // default. A fallback here would be a second, competing default.
    return this.bomItemsService.getCostSummary(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : undefined,
      location,
      productionLifeYears ? Number(productionLifeYears) : undefined,
    );
  }

  @OrgRole('viewer')
  @Get(':id/secondary-processes')
  @ApiOperation({ summary: 'Every secondary process (inspection, NDT, cleaning, packaging) for this part: applicability, machine, cycle time and cost from the reference data and CAD facts' })
  async getSecondaryProcesses(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required');
    const item = await this.bomItemsService.findOne(id, user.id, token);
    // The same canonical batch size the cost summary uses.
    const inputs = resolveCostingInputs({
      requested: { batchSize: batchSize ? parseInt(batchSize, 10) : undefined, location },
      scenarioOverrides: item.scenarioOverrides,
      item,
    });
    return this.secondaryProcessService.compute({
      item,
      location: inputs.location ?? location,
      batchSize: inputs.batchSize,
      accessToken: token,
      organizationId: await this.bomItemsService.organizationOfItem(id, token),
    });
  }

  @OrgRole('viewer')
  @Get(':id/nre')
  @ApiOperation({ summary: 'One-time investment (NC programming, fixture, CMM programming) from reference data, with amortization' })
  async getNre(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @Query('productionLifeYears') productionLifeYears: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required');
    return this.nreService.compute({
      itemId: id, userId: user.id, accessToken: token, location,
      batchSize: batchSize ? parseInt(batchSize, 10) : undefined,
      productionLifeYears: productionLifeYears ? Number(productionLifeYears) : undefined,
    });
  }

  @OrgRole('viewer')
  @Get(':id/true-nest')
  @ApiOperation({ summary: 'True (real polygon) 2D nesting placement — visualization only, not a cost source. On-demand; call only when the Nest view opens.' })
  @ApiResponse({ status: 200, description: 'True nest computed' })
  async getTrueNest(
    @Param('id') id: string,
    @Query('quantity') quantity: string,
    @Query('sheetWidthMm') sheetWidthMm: string,
    @Query('sheetLengthMm') sheetLengthMm: string,
    @Query('kerfMm') kerfMm: string,
    @Query('edgeMarginMm') edgeMarginMm: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!sheetWidthMm || !sheetLengthMm) {
      throw new BadRequestException('sheetWidthMm and sheetLengthMm query params are required — pass the sheet already selected by the existing nesting/cost result');
    }
    const { result, reason } = await this.bomItemsService.getTrueNest(
      id,
      user.id,
      token,
      quantity ? parseInt(quantity, 10) : 1,
      parseFloat(sheetWidthMm),
      parseFloat(sheetLengthMm),
      kerfMm ? parseFloat(kerfMm) : undefined,
      edgeMarginMm ? parseFloat(edgeMarginMm) : undefined,
    );
    if (!result) {
      this.logger.warn(`[true-nest] ${id}: ${reason}`);
      throw new NotFoundException(`True nest could not be computed for this part: ${reason}`);
    }
    return result;
  }

  @OrgRole('viewer')
  @Get(':id/route-comparison')
  @ApiOperation({
    summary: 'Compare Fiber Laser vs Turret Punch vs Waterjet routes with real cost numbers',
  })
  @ApiResponse({ status: 200, description: 'Route comparison returned' })
  async getRouteComparison(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @Query('productionLifeYears') productionLifeYears: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    // No `?? 1` here any more: an absent batch size is passed through as
    // undefined so the canonical resolver (costing-inputs.ts) applies the one
    // default. A fallback here would be a second, competing default.
    return this.bomItemsService.getRouteComparison(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : undefined,
      location,
      productionLifeYears ? Number(productionLifeYears) : undefined,
    );
  }

  @OrgRole('viewer')
  @Get(':id/candidate-routes')
  @ApiOperation({
    summary: 'Compare feasible manufacturing routes across blank types (sheet, bar, billet)',
  })
  @ApiResponse({ status: 200, description: 'Candidate route comparison returned' })
  async getCandidateRoutes(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @Query('productionLifeYears') productionLifeYears: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    // No `?? 1` here any more: an absent batch size is passed through as
    // undefined so the canonical resolver (costing-inputs.ts) applies the one
    // default. A fallback here would be a second, competing default.
    return this.bomItemsService.getCandidateRoutes(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : undefined,
      location,
      productionLifeYears ? Number(productionLifeYears) : undefined,
    );
  }

  @OrgRole('viewer')
  @Get(':id/gdt-analysis')
  @ApiOperation({ summary: 'GD&T severity analysis derived from drawing intelligence' })
  @ApiResponse({ status: 200, description: 'GD&T analysis returned' })
  async getGdtAnalysis(
    @Param('id') id: string,
    @AccessToken() token: string,
  ) {
    return this.bomItemsService.getGdtAnalysis(id, token);
  }

  @Post(':id/machine-override')
  @ApiOperation({
    summary: 'Force a specific machine for one process line (null mhrRecordId clears the override)',
  })
  @ApiResponse({ status: 201, description: 'Override saved (or cleared) — next cost summary uses it' })
  async setMachineOverride(
    @Param('id') id: string,
    @Body() dto: MachineOverrideDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!dto.location) throw new BadRequestException('location is required in the request body — send the digital factory location');
    return this.bomItemsService.setMachineOverride(
      id,
      user.id,
      token,
      dto.processKey,
      dto.mhrRecordId ?? null,
      dto.location,
    );
  }

  @Post(':id/cost-override')
  @ApiOperation({
    summary: 'eMithran-style manual override for one cost field (null/omitted value clears it)',
  })
  @ApiResponse({ status: 201, description: 'Override saved (or cleared) — next cost summary uses it' })
  async setCostOverride(
    @Param('id') id: string,
    @Body() dto: CostOverrideDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!dto.location) throw new BadRequestException('location is required in the request body — send the digital factory location');
    return this.bomItemsService.setCostOverride(
      id,
      user.id,
      token,
      dto.fieldKey,
      dto.value ?? null,
      dto.location,
    );
  }

  // POST :id/auto-fill-processes was removed here (2026-09-06).
  //
  // It created process_cost_records directly from invented manufacturing
  // inputs when the real ones were absent:
  //   materialGrade ?? 'IS2062 E250'      a steel grade for a missing material
  //   sheetThicknessMm ?? 2               an invented thickness
  //   flatPatternAreaMm2 ?? 50000         an invented blank area
  //   tensileStrengthMpa: 400             an invented material property
  //   diameterMm: 6                       an invented hole size
  // Those five values then drove cutting length, bend force and cycle time, so
  // a part with incomplete CAD data received a fully-costed routing built on
  // numbers nobody had measured.
  //
  // Removed rather than repaired, on evidence: no frontend or backend caller,
  // no test, and no row in process_cost_records has ever carried its
  // `auto_fill_from_cad` marker (0 rows, against 26 auto_fill_from_route and
  // 20 auto_fill_from_custom_route). The real, engine-backed paths that
  // replaced it are apply-route and apply-custom-route, which refuse to
  // persist an operation whose costing data is missing (findRouteDataGaps).

  @Post(':id/route-applications')
  @ApiOperation({
    summary: 'Write process cost records from a user-selected manufacturing route',
    description:
      'Re-runs the route comparison engine (deterministic, no AI), validates the chosen ' +
      'routeId is feasible for this part, then replaces any previous auto-fill records with ' +
      'one process_cost_record per processLine in the selected route.',
  })
  @ApiResponse({ status: 201, description: 'Process cost records written for the selected route' })
  async applyRoute(
    @Param('id') id: string,
    @Body() dto: ApplyRouteDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ApplyRouteResult> {
    return this.routeApplications.applyRoute(id, dto, user, token);
  }

  @Post(':id/custom-route-applications')
  @ApiOperation({
    summary: 'Write process cost records from a dynamically-assembled Workflow Builder route',
    description:
      'Takes a real, already-engine-computed route (by cutting method) and writes only the ' +
      'processLines the user selected, in their chosen order. Rejects any requested process ' +
      'not present in the real computed set — never fabricates a cost line.',
  })
  @ApiResponse({ status: 201, description: 'Process cost records written for the custom route' })
  async applyCustomRoute(
    @Param('id') id: string,
    @Body() dto: ApplyCustomRouteDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ApplyCustomRouteResult> {
    return this.routeApplications.applyCustomRoute(id, dto, user, token);
  }
}
