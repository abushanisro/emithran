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
  Optional,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as path from 'path';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { BOMItemsService } from './bom-items.service';
import { CreateBOMItemDto, UpdateBOMItemDto, QueryBOMItemsDto, BOMItemType } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import { AutoFillResponseDto } from './dto/auto-fill.dto';
import { MachineOverrideDto } from './dto/machine-selection.dto';
import { CostOverrideDto } from './dto/cost-override.dto';
import { ApplyRouteDto, type ApplyRouteResult, ApplyCustomRouteDto, type ApplyCustomRouteResult } from './dto/apply-route.dto';
import type { PhysicsGap } from './dto/cost-breakdown.dto';
import { LOCATION_INFO } from './costing/shared/core/default-rates.constants';
import { ExchangeRateService, RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { deriveImplications } from '../process-plan-generator/dto/manufacturing-implication.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { DFMScoringService } from './services/dfm-scoring.service';
import { MaterialIntelligenceService, type MaterialCandidate } from './services/material-intelligence.service';
import { ManufacturingRulesService } from '../manufacturing-rules/manufacturing-rules.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import axios from 'axios';

// Define User type if not available
interface User {
  id: string;
  email?: string;
  [key: string]: any;
}

// machine_class → process_group, mirroring the fuller vocabulary already used
// for display in manufacturing-intelligence/page.tsx's
// deriveProcessGroupFromMachineClass, and the process_group set
// lhr_benchmark_rates actually has coverage for (migrations 369/371/375:
// Sheet Metal, Machining, Assembly, Post Processing, Plastic & Rubber,
// Quality). Built once at module load — a single Map.get() per line instead
// of scanning several arrays with .includes() on every call.
const MACHINE_CLASS_TO_PROCESS_GROUP: ReadonlyMap<string, string> = new Map([
  ...['cmm', 'inspection'].map((c) => [c, 'Quality'] as const),
  ...['fiber_laser', 'co2_laser', 'plasma', 'waterjet', 'press_brake', 'turret_punch', 'roll_forming', 'deep_draw', 'band_saw']
    .map((c) => [c, 'Sheet Metal'] as const),
  ...['cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn', 'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'grinding', 'drill_press', 'tapping', 'edm']
    .map((c) => [c, 'Machining'] as const),
  ...['welding', 'manual_assembly', 'adhesive_bonding', 'electrical_assembly'].map((c) => [c, 'Assembly'] as const),
  ...['ndt_test', 'heat_treat_furnace', 'anodize', 'powder_coat', 'plating', 'chem_treatment', 'laser_marking', 'deburring', 'cleaning']
    .map((c) => [c, 'Post Processing'] as const),
  ...['injection_molding', 'thermoforming', 'blow_molding', 'extrusion', 'rotational_molding', 'rubber_molding', 'compression_molding']
    .map((c) => [c, 'Plastic & Rubber'] as const),
]);

@ApiTags('BOM Items')
@ApiBearerAuth()
@Controller({ path: 'api/bom-items', version: '1' })
export class BOMItemsController {
  private readonly logger = new Logger(BOMItemsController.name);

  constructor(
    private readonly bomItemsService: BOMItemsService,
    private readonly fileStorageService: FileStorageService,
    private readonly stepConverterService: StepConverterService,
    private readonly cadAnalysisService: CADAnalysisService,
    private readonly autoFillService: AutoFillService,
    private readonly dfmScoringService: DFMScoringService,
    private readonly materialIntelligenceService: MaterialIntelligenceService,
    @Optional() private readonly manufacturingRules: ManufacturingRulesService | undefined,
    private readonly supabaseService: SupabaseService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  // ── Stateless CAD auto-fill (no DB writes) ──────────────────────────────────
  @Post('analyze-for-autofill')
  @ApiOperation({ summary: 'Analyze a 3D file and return auto-fill suggestions (stateless, no DB write)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Auto-fill suggestions returned', type: AutoFillResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async analyzeForAutoFill(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('location') location?: string,
  ): Promise<AutoFillResponseDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const allowedExts = ['.step', '.stp', '.stl', '.iges', '.igs', '.obj', '.sldprt'];
    const ext = path.extname(file.originalname ?? '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext || '(none)'}. Allowed: ${allowedExts.join(', ')}`);
    }
    if (!user?.id) {
      throw new BadRequestException('User authentication required');
    }
    return this.autoFillService.analyzeAndSuggest(file.buffer, file.originalname, user.id, token, location);
  }

  // ── Background variant: for large/complex files where CAD analysis can take
  // minutes (mostly OCC's own STEP transfer). Returns a jobId immediately;
  // poll GET analyze-for-autofill/:jobId for the result. ──────────────────────
  @Post('analyze-for-autofill/start')
  @ApiOperation({ summary: 'Start a background 3D file analysis; returns a jobId to poll' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async startAnalyzeForAutoFill(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('location') location?: string,
  ): Promise<{ jobId: string }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const allowedExts = ['.step', '.stp', '.stl', '.iges', '.igs', '.obj', '.sldprt'];
    const ext = path.extname(file.originalname ?? '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext}`);
    }
    const jobId = this.autoFillService.startAnalysis(file.buffer, file.originalname, user.id, token, location);
    return { jobId };
  }

  @Get('analyze-for-autofill/:jobId')
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

  @Get('material-density')
  @ApiOperation({ summary: 'Look up density for a material grade from the reference table' })
  @ApiResponse({ status: 200, description: 'Density result' })
  async getMaterialDensity(
    @Query('grade') grade: string,
    @AccessToken() token: string,
  ): Promise<{ density_g_cm3: number | null; material_name: string | null; material_grade: string | null }> {
    if (!grade?.trim()) {
      return { density_g_cm3: null, material_name: null, material_grade: null };
    }
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
      const g = grade.trim();

      // 1. Exact match in curated lookup table
      let { data } = await client
        .from('material_density_lookup')
        .select('material_name, material_grade, density_g_cm3')
        .ilike('material_grade', g)
        .limit(1)
        .maybeSingle();

      // 2. Partial match in lookup table
      if (!data) {
        ({ data } = await client
          .from('material_density_lookup')
          .select('material_name, material_grade, density_g_cm3')
          .or(`material_grade.ilike.%${g}%,material_name.ilike.%${g}%`)
          .limit(1)
          .maybeSingle());
      }

      // 3. Fallback to raw_materials (user's own data, density in g/cm³)
      if (!data) {
        const rm = await client
          .from('raw_materials')
          .select('material, material_grade, density')
          .or(`material_grade.ilike.%${g}%,material.ilike.%${g}%`)
          .not('density', 'is', null)
          .limit(1)
          .maybeSingle();
        if (rm.data) {
          const d = parseFloat(rm.data.density);
          // Reject implausible densities — real engineering materials are 0.5–22 g/cm³
          if (isFinite(d) && d >= 0.5 && d <= 22) {
            return { density_g_cm3: d, material_name: rm.data.material, material_grade: rm.data.material_grade };
          }
        }
      }

      if (!data) return { density_g_cm3: null, material_name: null, material_grade: null };
      return {
        density_g_cm3: parseFloat(data.density_g_cm3),
        material_name: data.material_name,
        material_grade: data.material_grade,
      };
    } catch {
      return { density_g_cm3: null, material_name: null, material_grade: null };
    }
  }

  @Get('analysis-version')
  @ApiOperation({ summary: 'Return the current feature graph version the backend produces' })
  @ApiResponse({ status: 200, description: 'Current analysis version' })
  getAnalysisVersion(): { version: number; cad_engine_version: string } {
    return {
      version: parseInt(process.env.FEATURE_GRAPH_VERSION ?? '4', 10),
      cad_engine_version: process.env.CAD_ENGINE_VERSION ?? 'geo_v5',
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get BOM item by ID' })
  @ApiResponse({ status: 200, description: 'BOM item retrieved successfully', type: BOMItemResponseDto })
  @ApiResponse({ status: 404, description: 'BOM item not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemResponseDto> {
    return this.bomItemsService.findOne(id, user.id, token);
  }

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
    const utsMpa = await this.resolveUtsMpaForDfm(item.materialGrade, token);
    return {
      bomItemId: id,
      sheetThicknessMm: t,
      features: this.dfmScoringService.score(v2features, t, item.materialGrade, utsMpa),
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * Real UTS lookup for the min-hole-diameter DFM check (dfm-scoring.service.ts)
   * — same precedence real cost calculation uses (uts_mpa preferred over the
   * legacy ultimate_tensile_strength column — see bom-items.service.ts's
   * resolveMaterialForFamily for why), but deliberately NOT the full
   * cost-critical resolution chain (that also needs rate/currency/family
   * context this DFM-only lookup has no reason to carry). Alias lookup first
   * (material_aliases, migration 382/383) since many real grades only match
   * that way, then an exact case-insensitive grade match; no fuzzy/tokenized
   * fallback — an unresolved grade returns null and the DFM check is simply
   * skipped for that item rather than guessing.
   */
  private async resolveUtsMpaForDfm(materialGrade: string | null | undefined, token: string): Promise<number | null> {
    if (!materialGrade) return null;
    const db = this.supabaseService.getClient(token);
    const g = materialGrade.trim();
    if (!g) return null;

    const aliasNormalized = g.toUpperCase().replace(/[\s-]/g, '');
    if (aliasNormalized) {
      const { data: aliasRow } = await db
        .from('material_aliases')
        .select('raw_material_id')
        .eq('alias_normalized', aliasNormalized)
        .maybeSingle();
      if (aliasRow?.raw_material_id) {
        const { data } = await db
          .from('raw_materials')
          .select('uts_mpa, ultimate_tensile_strength')
          .eq('id', aliasRow.raw_material_id)
          .maybeSingle();
        const uts = (data?.uts_mpa as number | null) ?? (data?.ultimate_tensile_strength as number | null);
        if (uts != null) return uts;
      }
    }

    const { data } = await db
      .from('raw_materials')
      .select('uts_mpa, ultimate_tensile_strength')
      .ilike('material_grade', g)
      .limit(1)
      .maybeSingle();
    return (data?.uts_mpa as number | null) ?? (data?.ultimate_tensile_strength as number | null) ?? null;
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
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);

    if (!bomItem.file3dPath && !bomItem.fileStepPath) {
      throw new BadRequestException('No 3D file found for this item — upload a STEP/STL file first');
    }

    // Prefer the original STEP (full OCC topology) over the browser-viewable STL
    const analysisPath = bomItem.fileStepPath ?? bomItem.file3dPath!;
    const signedUrl = await this.fileStorageService.getSignedUrl(analysisPath, 3600);

    let fileBuffer: Buffer;
    try {
      const response = await axios.get(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
      });
      fileBuffer = Buffer.from(response.data);
    } catch (err) {
      this.logger.error(`[reanalyze] Failed to download file: ${err.message}`);
      throw new BadRequestException('Failed to download 3D file from storage');
    }

    const fileName = analysisPath.split('/').pop() ?? 'model.stp';
    const result = await this.autoFillService.analyzeAndSuggest(fileBuffer, fileName, user.id, token, undefined, true);

    const geo = result.geometry;
    const sug = result.suggestions;

    // Sync all geometry + classification fields, not just featureGraph.
    // material / materialGrade are intentionally excluded — those come from 2D drawing analysis and user input.
    const updateData: UpdateBOMItemDto = {
      featureGraph: result.featureGraph as object,
      holeCount: geo.holeCount,
      bendCount: geo.bendCount,
      cutLengthMm: geo.cutLengthMm,
      sheetThicknessMm: geo.sheetThicknessMm,
      pierceCount: geo.pierceCount,
      flatPatternAreaMm2: geo.flatPatternAreaMm2,
      ...(geo.weight > 0 && { weight: geo.weight }),
      ...(geo.volume > 0 && { volume: geo.volume }),
      ...(geo.surfaceArea > 0 && { surfaceArea: geo.surfaceArea }),
      ...(geo.boundingBox.length > 0 && { maxLength: geo.boundingBox.length }),
      ...(geo.boundingBox.width > 0 && { maxWidth: geo.boundingBox.width }),
      ...(geo.boundingBox.height > 0 && { maxHeight: geo.boundingBox.height }),
      ...(sug.familyClassification && { familyClassification: sug.familyClassification }),
      ...(sug.familyConfidence != null && { familyConfidence: sug.familyConfidence }),
    };

    return this.bomItemsService.update(id, updateData, user.id, token);
  }

  // Manual re-trigger, mirroring /reanalyze's pattern for the 3D file — for
  // items whose 2D drawing was already uploaded before drawing-intelligence
  // extraction existed (upload-files only calls this automatically for NEW
  // uploads going forward), or to re-run after the parser itself improves.
  @Post(':id/analyze-drawing')
  @ApiOperation({ summary: 'Re-run drawing intelligence extraction on the stored 2D file and update drawing_intelligence in DB' })
  @ApiResponse({ status: 200, description: 'Drawing analysis complete', type: BOMItemResponseDto })
  @ApiResponse({ status: 400, description: 'No 2D file found for this item, or it is not a PDF' })
  async analyzeDrawing(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);

    if (!bomItem.file2dPath) {
      throw new BadRequestException('No 2D drawing found for this item — upload a PDF drawing first');
    }
    if (!bomItem.file2dPath.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Drawing intelligence extraction requires a vector PDF (text extraction, not OCR) — this file is not a PDF');
    }

    const signedUrl = await this.fileStorageService.getSignedUrl(bomItem.file2dPath, 3600);

    let fileBuffer: Buffer;
    try {
      const response = await axios.get(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
      });
      fileBuffer = Buffer.from(response.data);
    } catch (err: any) {
      this.logger.error(`[analyze-drawing] Failed to download file: ${err.message}`);
      throw new BadRequestException('Failed to download 2D file from storage');
    }

    const drawingResult = await this.autoFillService.analyzeDrawing(fileBuffer, bomItem.partNumber);

    return this.bomItemsService.update(
      id,
      { drawingIntelligence: drawingResult as unknown as Record<string, any> },
      user.id,
      token,
    );
  }

  @Get(':id/dependencies')
  @ApiOperation({ summary: 'Check BOM item delete dependencies' })
  @ApiResponse({ status: 200, description: 'Dependencies checked successfully' })
  async checkDeleteDependencies(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.bomItemsService.checkDeleteDependencies(id, user.id, token);
  }

  @Delete(':id/force')
  @ApiOperation({ summary: 'Force delete BOM item with cascade cleanup' })
  @ApiResponse({ status: 200, description: 'BOM item force deleted successfully' })
  async forceRemove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    // This calls the same cascade delete but with explicit force intent
    return this.bomItemsService.remove(id, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete BOM item' })
  @ApiResponse({ status: 200, description: 'BOM item deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete - item has dependencies' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.bomItemsService.remove(id, user.id, token);
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

  @Get(':id/file-url/:fileType')
  @ApiOperation({ summary: 'Get signed URL for BOM item file' })
  @ApiResponse({ status: 200, description: 'Signed URL generated successfully' })
  async getFileUrl(
    @Param('id') id: string,
    @Param('fileType') fileType: '2d' | '3d',
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ url: string }> {
    const bomItem = await this.bomItemsService.findOne(id, user.id, token);

    const filePath = fileType === '2d' ? bomItem.file2dPath : bomItem.file3dPath;

    if (!filePath) {
      throw new BadRequestException(`No ${fileType} file found for this item`);
    }

    const signedUrl = await this.fileStorageService.getSignedUrl(filePath, 3600);

    return { url: signedUrl };
  }

  @Post(':id/upload-files')
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
        limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
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

  @Post(':id/convert-step')
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
      throw new BadRequestException('File is not a supported CAD file. Only .step, .stp, .iges, .igs, .sldprt files can be converted');
    }

    // Get project ID from BOM
    const projectId = await this.bomItemsService.getProjectIdForBOM(bomItem.bomId, token);

    // Download the STEP file from Supabase
    const stepUrl = await this.fileStorageService.getSignedUrl(bomItem.file3dPath, 3600);

    let stepBuffer: Buffer;
    try {
      const stepResponse = await axios.get(stepUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout for large CAD files
        maxContentLength: 100 * 1024 * 1024, // 100MB max file size
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

    // Update BOM item with STL path
    const updateData: UpdateBOMItemDto = {
      file3dPath: stlUploadResult.storagePath,
    };

    return this.bomItemsService.update(id, updateData, user.id, token);
  }

  // ============================================================================
  // CAD ANALYSIS ENDPOINTS
  // ============================================================================

  @Post(':id/analyze-cad')
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

  @Post('batch-analyze-cad')
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

  private readonly cadEngineUrl    = process.env.CAD_ENGINE_URL     || 'http://localhost:5000';
  private readonly cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';

  @Post('process-step-file')
  @ApiOperation({ summary: 'Process STEP file and create a single assembly BOM item' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Assembly BOM item created' })
  @ApiResponse({ status: 400, description: 'Invalid file or CAD engine error' })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'stepFile', maxCount: 1 }]))
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
        'Invalid file type. Supported: .step, .stp, .iges, .igs, .sldprt',
      );
    }

    if (stepFile.size > 100 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 100 MB limit');
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

    const cadResponse = await fetch(`${this.cadEngineUrl}/analyze/geometry`, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
        ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
      },
    });

    if (!cadResponse.ok) {
      throw new BadRequestException(
        `CAD engine failed: ${cadResponse.statusText}`,
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
        annualVolume: 1000,
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

  @Get(':id/cost-summary')
  @ApiOperation({ summary: 'Deterministic cost breakdown — material + process lines, no LLM' })
  @ApiResponse({ status: 200, description: 'Cost summary returned' })
  async getCostSummary(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    return this.bomItemsService.getCostSummary(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location,
    );
  }

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

  @Get(':id/route-comparison')
  @ApiOperation({
    summary: 'Compare Fiber Laser vs Turret Punch vs Waterjet routes with real cost numbers',
  })
  @ApiResponse({ status: 200, description: 'Route comparison returned' })
  async getRouteComparison(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    return this.bomItemsService.getRouteComparison(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location,
    );
  }

  @Get(':id/candidate-routes')
  @ApiOperation({
    summary: 'Compare feasible manufacturing routes across blank types (sheet, bar, billet)',
  })
  @ApiResponse({ status: 200, description: 'Candidate route comparison returned' })
  async getCandidateRoutes(
    @Param('id') id: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!location) throw new BadRequestException('location query param is required — send the digital factory location with each costing request');
    return this.bomItemsService.getCandidateRoutes(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location,
    );
  }

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

  @Post(':id/auto-fill-processes')
  @ApiOperation({ summary: 'Deterministically map CAD features → process cost records using the rules engine (no AI, no credits)' })
  @ApiResponse({ status: 201, description: 'Auto-filled process records created' })
  async autoFillProcesses(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ created: number; operations: string[] }> {
    if (!this.manufacturingRules) {
      throw new InternalServerErrorException('ManufacturingRulesService not available');
    }

    const item = await this.bomItemsService.findOne(id, user.id, token);
    const db = this.supabaseService.getClient(token);

    const materialGrade = item.materialGrade ?? 'IS2062 E250';
    const family = (item.familyClassification ?? 'machined').toLowerCase();
    const isSheetMetal = family.includes('sheet') || family.includes('metal');
    const isPlastic = family.includes('plastic') || family.includes('injection') || family.includes('polymer');

    // Build operation list from CAD features
    const ops: Array<{ operation: string; processGroup: string; geometry: Record<string, unknown> }> = [];

    if (isSheetMetal) {
      const t = item.sheetThicknessMm ?? 2;
      const cutLen = item.cutLengthMm ?? Math.sqrt(item.flatPatternAreaMm2 ?? 50000) * 4;
      const pierces = (item.pierceCount ?? 0) + (item.holeCount ?? 0) + 1;
      ops.push({ operation: 'laser_cutting', processGroup: 'Sheet Metal', geometry: { thicknessMm: t, cutLengthMm: cutLen, pierceCount: pierces } });
      if ((item.bendCount ?? 0) > 0) {
        ops.push({ operation: 'press_brake', processGroup: 'Sheet Metal', geometry: { bendCount: item.bendCount, materialThicknessMm: t, bendLengthMm: item.maxLength ?? 300, tensileStrengthMpa: 400 } });
      }
      if ((item.holeCount ?? 0) > 0) {
        ops.push({ operation: 'drilling', processGroup: 'Sheet Metal', geometry: { diameterMm: 6, depthMm: t, holeCount: item.holeCount } });
      }
    } else if (isPlastic) {
      const vol = item.volume ?? 10000;
      ops.push({ operation: 'injection_molding', processGroup: 'Plastic & Rubber', geometry: { polymerId: materialGrade, wallThicknessMm: 2.5, projectedAreaMm2: item.flatPatternAreaMm2 ?? Math.pow(vol / 50, 0.67) * 100, shotVolumeCm3: (vol / 1000) * 1.2 } });
    } else {
      const vol = item.volume ?? 100000;
      const sizeMm = Math.cbrt(vol);
      ops.push({ operation: 'milling', processGroup: 'CNC Machining', geometry: { cutterDiameterMm: 16, cuttingLengthMm: sizeMm * 3, widthMm: sizeMm * 0.5, depthMm: sizeMm * 0.4 } });
      if ((item.holeCount ?? 0) > 0) {
        ops.push({ operation: 'drilling', processGroup: 'CNC Machining', geometry: { diameterMm: 8, depthMm: sizeMm * 0.5, holeCount: item.holeCount } });
      }
      ops.push({ operation: 'turning', processGroup: 'CNC Machining', geometry: { diameterMm: sizeMm, lengthMm: sizeMm * 1.5, materialRemovalMm: sizeMm * 0.05 } });
    }

    ops.push({ operation: 'inspection', processGroup: 'Quality', geometry: {} });

    // Delete previous auto-fill records for this item
    await db.from('process_cost_records').delete().eq('bom_item_id', id).eq('notes', 'auto_fill_from_cad');

    const insertedOps: string[] = [];
    let opNbr = 10;

    for (const op of ops) {
      let cycleTimeSec = 300; // 5-minute default for inspection / fallback
      let machineRate = 0;
      let mhrId: string | null = null;
      let machineName: string | null = null;

      if (op.operation !== 'inspection') {
        try {
          const result = await this.manufacturingRules!.evaluate({
            operation: op.operation,
            materialGrade,
            featureGeometry: op.geometry,
          });
          cycleTimeSec = result.totalCycleTimeSec;

          // Look up best matching MHR by machine category hint
          const hint = result.machineRequirements?.machineCategoryHint ?? op.operation;
          const searchTerm = this.getMhrSearchTerm(hint);
          const { data: mhrRows } = await db
            .from('mhr_records')
            .select('id, machine_name, total_machine_hour_rate')
            .or(`process_group.ilike.%${searchTerm}%,machine_name.ilike.%${searchTerm}%`)
            .not('total_machine_hour_rate', 'is', null)
            .order('total_machine_hour_rate', { ascending: true })
            .limit(1);

          if (mhrRows && mhrRows.length > 0) {
            const mhr = mhrRows[0] as { id: string; machine_name: string | null; total_machine_hour_rate: number };
            mhrId = mhr.id;
            machineName = mhr.machine_name;
            machineRate = (Number(mhr.total_machine_hour_rate) / 3600) * cycleTimeSec;
          }
        } catch (err) {
          this.logger.warn(`[auto-fill] Rules engine failed for ${op.operation}: ${(err as Error).message}`);
        }
      }

      const { error } = await db.from('process_cost_records').insert({
        bom_item_id: id,
        user_id: user.id,
        mhr_id: mhrId,
        machine_name: machineName,
        op_nbr: opNbr,
        machine_rate: machineRate,
        labor_rate: 0,
        setup_manning: 1,
        setup_time: 15,
        batch_size: 1,
        heads: 1,
        cycle_time: cycleTimeSec,
        parts_per_cycle: 1,
        scrap: 0,
        currency: 'INR',
        is_active: true,
        process_group: op.processGroup,
        operation: op.operation,
        notes: 'auto_fill_from_cad',
      });

      if (error) {
        this.logger.error(`[auto-fill] Insert failed for ${op.operation}: ${error.message}`);
      } else {
        insertedOps.push(op.operation);
        opNbr += 10;
      }
    }

    return { created: insertedOps.length, operations: insertedOps };
  }

  // ── Apply a selected manufacturing route → write process_cost_records ─────────
  @Post(':id/apply-route')
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
    const batchSize = dto.batchSize ?? 1;
    const location  = dto.location  ?? 'USA';

    // 1. Fetch the authoritative route comparison from the engine
    const comparison = await this.bomItemsService.getRouteComparison(
      id, user.id, token, batchSize, location,
    );

    // 2. Find the requested route
    const route = comparison.routes.find((r) => r.routeId === dto.routeId);
    if (!route) {
      throw new NotFoundException(
        `Route '${dto.routeId}' not available for this part. ` +
        `Available: ${comparison.routes.map((r) => r.routeId).join(', ')}`,
      );
    }

    // 3. Reject infeasible routes — the engine already did the capability check
    if (!route.isFeasible) {
      const reason = route.warnings?.[0] ?? 'machine capability constraints not met';
      throw new BadRequestException(
        `Route '${dto.routeId}' (${route.routeLabel}) is not feasible for this part: ${reason}`,
      );
    }

    if (!route.processLines?.length) {
      throw new BadRequestException(
        `Route '${dto.routeId}' returned no process lines — cannot create cost records`,
      );
    }

    const insertedOps = await this.writeProcessLinesAsRecords(
      id, route.processLines, batchSize, location, user, token, `auto_fill_from_route:${dto.routeId}`,
    );

    this.logger.log(`[apply-route] partId=${id} route=${dto.routeId} wrote ${insertedOps.length} ops`);

    return {
      created:    insertedOps.length,
      operations: insertedOps,
      routeLabel: route.routeLabel,
      routeId:    dto.routeId,
    };
  }

  // ── Apply a dynamically-assembled Workflow Builder route → write real process_cost_records ─
  // Deliberately NOT a free-form cost-line author: baseCuttingRouteId still picks one of the
  // 3 real engine-computed routes (its cutting line + its full processLines set — every other
  // real operation is identical across all 3, since they're gated purely by this part's real
  // geometry, not by cutting method — see getRouteComparison's "shared process lines" comment).
  // includedProcesses is a subset + custom order of THAT real, already-computed set — filtering
  // and reordering, never inventing a cost line the engine didn't already derive from real
  // geometry. Reuses the exact same insert logic as applyRoute (writeProcessLinesAsRecords) —
  // no new cost formulas anywhere in this endpoint.
  @Post(':id/apply-custom-route')
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
    const batchSize = dto.batchSize ?? 1;
    const location  = dto.location  ?? 'USA';

    const comparison = await this.bomItemsService.getRouteComparison(
      id, user.id, token, batchSize, location,
    );
    // Own snapshot for resolveRealMachineRate below — getRouteComparison already
    // took its own internally; both read the same short-TTL cache in practice.
    const rates = await this.exchangeRateService.getSnapshot(token);
    const baseRoute = comparison.routes.find((r) => r.routeId === dto.baseCuttingRouteId);
    if (!baseRoute) {
      throw new NotFoundException(
        `Base cutting route '${dto.baseCuttingRouteId}' not available for this part. ` +
        `Available: ${comparison.routes.map((r) => r.routeId).join(', ')}`,
      );
    }
    if (!baseRoute.processLines?.length) {
      throw new BadRequestException(
        `Base cutting route '${dto.baseCuttingRouteId}' returned no process lines — cannot build a custom route from it`,
      );
    }

    // Two kinds of step, resolved in order:
    //   1. A real, already-engine-computed operation for this part — reuse its
    //      real cycleTimeMin/hourlyRate verbatim, exactly as before.
    //   2. A real catalog operation with no geometric trigger on this part yet
    //      — validated against process_calculator_mappings (never an arbitrary
    //      string), a REAL machine rate resolved for its machineClass, but
    //      cycleTimeMin honestly 0 — no real geometry to derive it from, and
    //      this endpoint never fabricates one.
    const availableByName = new Map(baseRoute.processLines.map((l) => [l.process, l]));
    const db = this.supabaseService.getClient(token);
    const orderedLines: Array<{
      process: string; machineClass: string; machineName: string | null; hourlyRate: number;
      cycleTimeMin: number; machineSelection?: { balanced?: { candidate?: { machineId?: string | null } } };
    }> = [];
    const needsManualCycleTime: string[] = [];

    for (const step of dto.steps) {
      const real = availableByName.get(step.process);
      if (real) {
        orderedLines.push(real);
        continue;
      }
      if (!step.processGroup || !step.processRoute || !step.machineClass) {
        throw new BadRequestException(
          `'${step.process}' is not a real, geometry-computed operation for this part, and no real ` +
          `process identity (processGroup/processRoute/machineClass) was supplied to resolve it from the catalog. ` +
          `Geometry-computed operations available: ${[...availableByName.keys()].join(', ')}`,
        );
      }
      // Validate it's a REAL, active row in the catalog — not an arbitrary string.
      const { data: mappingRows } = await db
        .from('process_calculator_mappings')
        .select('id')
        .eq('process_group', step.processGroup)
        .eq('process_route', step.processRoute)
        .eq('operation', step.process)
        .eq('machine_class', step.machineClass)
        .eq('is_active', true)
        .limit(1);
      if (!mappingRows?.length) {
        throw new BadRequestException(
          `'${step.process}' (${step.processGroup} / ${step.processRoute} / ${step.machineClass}) is not a ` +
          `real, active operation in process_calculator_mappings.`,
        );
      }
      const rate = await this.resolveRealMachineRate(step.machineClass, location, token, rates);
      orderedLines.push({
        process: step.process,
        machineClass: step.machineClass,
        machineName: rate?.machineName ?? null,
        hourlyRate: rate?.rate ?? 0,
        cycleTimeMin: 0,
      });
      needsManualCycleTime.push(step.process);
    }

    const routeLabel = `Custom: ${dto.steps.map((s) => s.process).join(' + ')}`;
    const insertedOps = await this.writeProcessLinesAsRecords(
      id, orderedLines, batchSize, location, user, token, `auto_fill_from_custom_route:${id}`,
    );

    this.logger.log(`[apply-custom-route] partId=${id} wrote ${insertedOps.length} ops: ${insertedOps.join(', ')}` +
      (needsManualCycleTime.length ? ` (needs manual cycle time: ${needsManualCycleTime.join(', ')})` : ''));

    return {
      created:    insertedOps.length,
      operations: insertedOps,
      routeLabel,
      needsManualCycleTime,
    };
  }

  // Real machine rate for a machine class with no geometric trigger on this
  // part yet — used only by applyCustomRoute's catalog-operation path. Same
  // fallback order as everywhere else in this codebase: cheapest real
  // mhr_records row for this location > cheapest mhr_benchmark_rates row
  // (converted from its USD storage convention to local currency) > null
  // (honest no-rate-on-file, never a fabricated number).
  // Returns rate in USD — matches getRouteComparison's processLines (also USD,
  // see BOMItemsService.normalizeRouteComparisonToUsd), since this is merged
  // with those lines before writeProcessLinesAsRecords inserts them together.
  private async resolveRealMachineRate(
    machineClass: string,
    location: string,
    token: string,
    rates: RateSnapshot,
  ): Promise<{ machineName: string | null; rate: number } | null> {
    const db = this.supabaseService.getClient(token);
    const { data: ownRows } = await db
      .from('mhr_records')
      .select('machine_name, total_machine_hour_rate')
      .eq('machine_class', machineClass)
      .eq('location', location)
      .order('total_machine_hour_rate', { ascending: true })
      .limit(1);
    if (ownRows?.length) {
      const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['USA']!;
      return {
        machineName: ownRows[0].machine_name ?? null,
        rate: rates.toUsd(Number(ownRows[0].total_machine_hour_rate ?? 0), locInfo.code),
      };
    }

    const { data: benchRows } = await db
      .from('mhr_benchmark_rates')
      .select('machine_name, mhr_usd')
      .eq('machine_class', machineClass)
      .eq('location', location)
      .order('mhr_usd', { ascending: true })
      .limit(1);
    if (benchRows?.length) {
      // mhr_benchmark_rates.mhr_usd is already USD-native — no conversion needed.
      return { machineName: benchRows[0].machine_name ?? null, rate: Number(benchRows[0].mhr_usd ?? 0) };
    }

    return null;
  }

  // Shared by applyRoute and applyCustomRoute — writes one process_cost_records row per
  // process line, in array order (op_nbr 10, 20, 30...). Idempotent: replaces the part's
  // ENTIRE active process routing, not just previously-auto-filled rows (re-applying a
  // route must not duplicate op_nbr 10/20/30/40 rows alongside the old ones).
  private async writeProcessLinesAsRecords(
    id: string,
    lines: Array<{
      process: string; machineClass: string; machineName?: string | null; hourlyRate: number;
      cycleTimeMin: number; machineSelection?: { balanced?: { candidate?: { machineId?: string | null } } };
      physicsGap?: PhysicsGap | null;
      // Inspection (and any other class priced via a flat resolved resource
      // rate, not the CNC/laser-style machineSelection candidate list) has no
      // machineSelection candidate at all — finalizeInspectionLine() sets
      // these directly on the line instead (see inspection-engine.ts).
      mhrId?: string | null;
      benchmarkMhrId?: string | number | null;
    }>,
    batchSize: number,
    location: string,
    user: User,
    token: string,
    notesTag: string,
  ): Promise<string[]> {
    // Manufacturing Physics Calculator architecture: process_cost_records.cycle_time
    // is NUMERIC(12,2) NOT NULL CHECK (cycle_time >= 1) (migration 034) — a line
    // whose cycle time couldn't be resolved (physicsGap set, or cycleTimeMin <=~0
    // for a process that was still included in the route) is schema-impossible to
    // persist. Reject the WHOLE apply-route request before touching any existing
    // data — previously an insert failure here was only logged and the loop moved
    // on, which (after the delete below already ran) silently dropped that one
    // process line from the part's active routing with no error surfaced to the
    // user and no way to recover the deleted prior rows.
    for (const line of lines) {
      const cycleTimeSecRounded = Math.round(line.cycleTimeMin * 60 * 100) / 100;
      if (line.physicsGap || cycleTimeSecRounded < 1) {
        const gap = line.physicsGap;
        const reason = gap
          ? (gap.gapType === 'missing_lookup'
              ? gap.requiredAction
              : gap.reason)
          : 'cycle time resolved to less than 1 second, which this system cannot persist as a real machine cycle';
        throw new BadRequestException(
          `Cannot apply this route — '${line.process}' cycle time is unavailable: ${reason}. ` +
          `No records were written.`,
        );
      }
    }

    const db = this.supabaseService.getClient(token);

    await db.from('process_cost_records').delete().eq('bom_item_id', id).eq('is_active', true);

    // process_cost_records.machine_rate is always stored in USD. Every `lines`
    // entry is already USD by the time it reaches here — real geometry-computed
    // lines come from getRouteComparison (normalizeRouteComparisonToUsd), catalog-
    // only lines come from resolveRealMachineRate (also returns USD) — so no
    // conversion happens in this function anymore (a local-currency static pivot
    // used to run here, double-converting once both sources became USD-native).

    const insertedOps: string[] = [];
    let opNbr = 10;

    // Pre-fetch benchmark labour rates for this location from the global shared table.
    // lhr_benchmark_rates has no user_id — readable by all authenticated users without RLS workarounds.
    // lhr_usd_effective is always stored so the rate is location-agnostic for cost comparison.
    const { data: benchmarkRows } = await db
      .from('lhr_benchmark_rates')
      .select('id, lhr, lhr_usd_effective, currency, process_group')
      .eq('location', location)
      .order('lhr', { ascending: true });

    // Build group-keyed lookup: processGroup → benchmark LHR for that group.
    // When DB has no row for a group, LHR defaults to 0 — visible as a gap, not a silently wrong rate.
    const lhrByGroup = new Map<string, number>();
    for (const row of benchmarkRows ?? []) {
      const group = row.process_group as string;
      if (!lhrByGroup.has(group)) {
        const effectiveLhr =
          row.currency && row.currency !== 'USD' && Number(row.lhr_usd_effective) > 0
            ? Number(row.lhr_usd_effective)
            : Number(row.lhr);
        lhrByGroup.set(group, effectiveLhr);
      }
    }
    const pickLHR = (group: string): { id: null; lhr: number } =>
      ({ id: null, lhr: lhrByGroup.get(group) ?? 0 });

    for (const line of lines) {
      // The real process hierarchy (Group/Route/Operation) that the manual
      // "Edit Process Cost" dialog's picker matches against lives in
      // process_calculator_mappings, keyed by machine_class (migrations
      // 368/369). This used to just slugify line.process ("Waterjet Cutting"
      // -> "waterjet_cutting") into `operation` and never set `process_route`
      // at all -- a real, indexed column (migration 041) that stayed NULL for
      // every route-applied line. The dialog's "Saved process" panel only
      // renders a Route line when one is set, so every applied-route process
      // showed an incomplete hierarchy (Group + Operation, no Route) and could
      // never be correctly re-matched against the picker's own Group -> Route
      // -> Operation cascade. Resolve the real triple from the same table the
      // picker itself reads, picking the lowest display_order row for this
      // machine_class (mirrors the frontend's own defaultCalculatorForOperation
      // "sort by displayOrder, take first" convention) -- falling back to the
      // slug only when a machine class genuinely has no mapping row at all.
      const { data: hierarchyRows } = await db
        .from('process_calculator_mappings')
        .select('process_group, process_route, operation, lhr_process_group, display_order')
        .eq('machine_class', line.machineClass)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .limit(1);
      const hierarchyRow = hierarchyRows?.[0] as
        | { process_group: string; process_route: string; operation: string; lhr_process_group: string | null }
        | undefined;
      const operation    = hierarchyRow?.operation
        ?? line.process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const processGroup = hierarchyRow?.process_group
        ?? this.deriveProcessGroupFromMachineClass(line.machineClass);
      const processRoute = hierarchyRow?.process_route ?? null;
      // Store machine_rate in USD always — line.hourlyRate already is (see comment above).
      const machineRate  = line.hourlyRate;
      // process_cost_records.cycle_time is NUMERIC(12,2) — round to 2dp, not
      // to a whole integer. Rounding to an integer here silently threw away
      // real precision the schema already supports on every applied route —
      // confirmed live: a genuine 19.2s Inspection line saved as 19s, then
      // visibly disagreed with its own calculator's exact recomputation.
      const cycleTimeSec = Math.round(line.cycleTimeMin * 60 * 100) / 100;
      // Labour-wage tier vs. routing category are different things that happen
      // to share the same process_calculator_mappings.process_group column for
      // most machine classes — but several classes (cmm, deburring,
      // turret_punch, the CNC classes, injection_molding) bill a genuinely
      // different, more specific labour tier than their ROUTING group.
      // lhr_process_group (migration 424) is the single DB-driven source for
      // this, shared with BOMItemsService.resolveLHRRates — same row already
      // fetched above, no second query.
      const lhr = pickLHR(hierarchyRow?.lhr_process_group ?? processGroup);

      const { error } = await db.from('process_cost_records').insert({
        bom_item_id:    id,
        user_id:        user.id,
        op_nbr:         opNbr,
        operation,
        process_group:  processGroup,
        process_route:  processRoute,
        // Added by migration 343 specifically so the Edit Process Cost dialog
        // knows which Digital Factory location to filter its MHR/LHR dropdowns
        // by on reopen -- never wired up here despite `location` already being
        // computed above. Left NULL, every route-applied row's dialog defaulted
        // to "All locations" (no filter), which is why the Machine/Labour
        // dropdowns showed every country's rows mixed together (raw local-
        // currency figures under one flat "$" label, e.g. Vietnam's
        // 471560 VND showing as "$471560.00/hr") instead of just the applied
        // location's real rate.
        location,
        // machine_class was never persisted here despite line.machineClass
        // being available (already used above for deriveProcessGroupFromMachineClass) —
        // every route-applied row's machine_class came back NULL, so the frontend's
        // matchedEngineLine lookup (which requires proc.machineClass === l.machineClass)
        // always failed and every applied row silently lost the live MachineSelector
        // (alternatives, "Why" reasoning, capability checks), falling back to a
        // read-only display of whatever machine_name happened to be stored.
        machine_class:  line.machineClass ?? null,
        machine_name:   line.machineName ?? null,
        // The route engine already selected a real machine per line (see
        // attachMachineSelections() in bom-items.service.ts) — persist its
        // mhr_records id so the ProcessCostDialog's MHR dropdown can find and
        // pre-select it on the next load. Without this, only machine_name (a
        // display string) was stored and the dropdown always showed "no
        // machine selected" for a route-applied line.
        //
        // Inspection-class lines have no machineSelection candidate at all —
        // falling back to line.mhrId/benchmarkMhrId (set directly by
        // finalizeInspectionLine, see inspection-engine.ts) is required, or
        // this always wrote NULL for them. Confirmed live: an Inspect line's
        // real, resolved CMM/bench machine link was correctly written on the
        // FIRST apply (via autoAddProcessCosts, the frontend's own ad-hoc
        // default-route path, which already had this same fallback), then
        // silently dropped back to "Manual rate — not linked to a machine"
        // on every SUBSEQUENT apply, once an auto_fill_from_route note
        // existed and this endpoint (missing the fallback) took over.
        mhr_id:         line.machineSelection?.balanced?.candidate?.machineId ?? line.mhrId ?? null,
        benchmark_mhr_id: (!line.machineSelection?.balanced?.candidate?.machineId && !line.mhrId)
          ? (line.benchmarkMhrId ?? null)
          : null,
        machine_rate:   machineRate,
        labor_rate:     lhr.lhr,
        lhr_id:         null,
        direct_rate:    machineRate + lhr.lhr,
        setup_manning:  1,
        setup_time:     15,
        batch_size:     batchSize,
        heads:          1,
        cycle_time:     cycleTimeSec,
        parts_per_cycle: 1,
        scrap:          0,
        currency:       'USD',
        is_active:      true,
        notes:          notesTag,
      });

      if (error) {
        this.logger.error(`[apply-route] insert failed op=${operation}: ${error.message}`);
        // Previously this only logged and moved on, leaving the loop to report
        // overall success (201, full insertedOps-based toast) while this one
        // operation was silently absent from the applied route with no trace
        // for the user — confirmed live: Press Brake and Hole Extrusion
        // (Burring) both vanished from an "applied successfully" custom route
        // with no error shown, because their inserts individually failed here
        // and nothing downstream ever saw that. Row deletion above has already
        // committed, so surfacing this loudly (instead of pretending the whole
        // route applied) is the only way the user finds out re-applying is
        // needed rather than trusting an incomplete, wrongly-"successful" route.
        throw new InternalServerErrorException(
          `Failed to write process cost record for '${operation}': ${error.message}. ` +
          `${insertedOps.length} operation(s) were written before this failure — re-apply the route to retry.`,
        );
      }
      insertedOps.push(line.process);
      opNbr += 10;
    }

    return insertedOps;
  }

  private getMhrSearchTerm(machineCategoryHint: string): string {
    const map: Record<string, string> = {
      laser_6kw: 'laser',
      press_brake: 'press',
      vmc_3ax: 'mill',
      cnc_lathe: 'lathe',
      im_100t: 'injection',
      drill_press: 'drill',
      radial_drill: 'drill',
    };
    return map[machineCategoryHint] ?? machineCategoryHint.split('_')[0];
  }

  // The old version only recognised 4 machine classes and silently
  // miscategorized everything else — including 'deburring' — as the
  // 'CNC Machining' catch-all, pulling the wrong (real-CNC-machinist) labour
  // rate onto e.g. a Hand Deburring line instead of the correct Post
  // Processing rate. im_* is kept as a prefix check since MACHINE_CLASS_TO_
  // PROCESS_GROUP only has exact-match entries.
  private deriveProcessGroupFromMachineClass(machineClass: string): string {
    if (machineClass.startsWith('im_')) return 'Plastic & Rubber';
    return MACHINE_CLASS_TO_PROCESS_GROUP.get(machineClass) ?? 'CNC Machining';
  }
}
