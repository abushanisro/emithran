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
import { ApplyRouteDto, type ApplyRouteResult } from './dto/apply-route.dto';
import { DEFAULT_COSTING_LOCATION, defaultLHRRate, LOCATION_INFO } from './costing/default-rates';
import { deriveImplications } from '../process-plan-generator/dto/manufacturing-implication.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
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

  @Get(':id/dfm-scores')
  @ApiOperation({ summary: 'Compute per-occurrence DFM risk scores from stored feature_graph_v2 metrics' })
  @ApiResponse({ status: 200, description: 'DFM scores returned' })
  async getDFMScores(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    const item = await this.bomItemsService.findOne(id, user.id, token);
    const fg = item.featureGraph as any;
    const v2features: any[] = fg?.feature_graph_v2?.features ?? [];
    const t: number = (item as any).sheetThicknessMm ?? 1;
    return {
      bomItemId: id,
      sheetThicknessMm: t,
      features: this.dfmScoringService.score(v2features, t),
      scoredAt: new Date().toISOString(),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create new BOM item' })
  @ApiResponse({ status: 201, description: 'BOM item created successfully', type: BOMItemResponseDto })
  async create(@Body() createBOMItemDto: CreateBOMItemDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemResponseDto> {
    try {
      if (!user?.id) {
        throw new BadRequestException('User authentication required');
      }
      return await this.bomItemsService.create(createBOMItemDto, user.id, token);
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
    const result = await this.autoFillService.analyzeAndSuggest(fileBuffer, fileName, user.id, token);

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
        assemblyItem.id,
        projectId,
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
    return this.bomItemsService.getCostSummary(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location || DEFAULT_COSTING_LOCATION,
    );
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
    return this.bomItemsService.getRouteComparison(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location || DEFAULT_COSTING_LOCATION,
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
    return this.bomItemsService.getCandidateRoutes(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
      location || DEFAULT_COSTING_LOCATION,
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
    return this.bomItemsService.setMachineOverride(
      id,
      user.id,
      token,
      dto.processKey,
      dto.mhrRecordId ?? null,
      dto.location || DEFAULT_COSTING_LOCATION,
    );
  }

  @Post(':id/cost-override')
  @ApiOperation({
    summary: 'aPriori-style manual override for one cost field (null/omitted value clears it)',
  })
  @ApiResponse({ status: 201, description: 'Override saved (or cleared) — next cost summary uses it' })
  async setCostOverride(
    @Param('id') id: string,
    @Body() dto: CostOverrideDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.bomItemsService.setCostOverride(
      id,
      user.id,
      token,
      dto.fieldKey,
      dto.value ?? null,
      dto.location || DEFAULT_COSTING_LOCATION,
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
        ops.push({ operation: 'press_brake', processGroup: 'Sheet Metal', geometry: { bendCount: item.bendCount, materialThicknessMm: t, bendLengthMm: 300, tensileStrengthMpa: 400 } });
      }
      if ((item.holeCount ?? 0) > 0) {
        ops.push({ operation: 'drilling', processGroup: 'Sheet Metal', geometry: { diameterMm: 6, depthMm: t, holeCount: item.holeCount } });
      }
    } else if (isPlastic) {
      const vol = item.volume ?? 10000;
      ops.push({ operation: 'injection_molding', processGroup: 'Plastics', geometry: { polymerId: materialGrade, wallThicknessMm: 2.5, projectedAreaMm2: item.flatPatternAreaMm2 ?? Math.pow(vol / 50, 0.67) * 100, shotVolumeCm3: (vol / 1000) * 1.2 } });
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

    const db = this.supabaseService.getClient(token);

    // 4. Idempotent: remove ALL previous auto-fill records so re-applying is safe
    await db.from('process_cost_records').delete().eq('bom_item_id', id).eq('notes', 'auto_fill_from_cad');
    await db.from('process_cost_records').delete().eq('bom_item_id', id).ilike('notes', 'auto_fill_from_route:%');

    // 5. Insert one record per process line from the selected route
    // process_cost_records.machine_rate is always stored in USD — convert from local currency here.
    // LHR (lhr_usd_effective) is already in USD from lhr_benchmark_rates; machine rate is not.
    const locInfo     = LOCATION_INFO[location] ?? LOCATION_INFO['USA']!;
    const INR_PER_USD = 83.5;
    const toUsd = (localRate: number) => localRate * locInfo.defaultInrRate / INR_PER_USD;

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
    // Falls back to defaultLHRRate() (static table in default-rates.ts) if the DB table is empty.
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
      ({ id: null, lhr: lhrByGroup.get(group) ?? defaultLHRRate(location, group) });

    for (const line of route.processLines) {
      const operation    = line.process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const processGroup = this.deriveProcessGroupFromMachineClass(line.machineClass);
      // Store machine_rate in USD always. line.hourlyRate is in the selected location's local
      // currency (INR for India, USD for USA, EUR for Germany, etc.).
      // toUsd() normalises via the INR pivot: localRate × defaultInrRate / 83.5
      const machineRate  = toUsd(line.hourlyRate);
      const cycleTimeSec = Math.round(line.cycleTimeMin * 60);
      const lhr = pickLHR(processGroup);

      const { error } = await db.from('process_cost_records').insert({
        bom_item_id:    id,
        user_id:        user.id,
        op_nbr:         opNbr,
        operation,
        process_group:  processGroup,
        machine_name:   line.machineName ?? null,
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
        notes:          `auto_fill_from_route:${dto.routeId}`,
      });

      if (error) {
        this.logger.error(`[apply-route] insert failed op=${operation}: ${error.message}`);
      } else {
        insertedOps.push(line.process);
        opNbr += 10;
      }
    }

    this.logger.log(`[apply-route] partId=${id} route=${dto.routeId} wrote ${insertedOps.length} ops`);

    return {
      created:    insertedOps.length,
      operations: insertedOps,
      routeLabel: route.routeLabel,
      routeId:    dto.routeId,
    };
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

  private deriveProcessGroupFromMachineClass(machineClass: string): string {
    if (['fiber_laser', 'turret_punch', 'waterjet', 'press_brake'].includes(machineClass)) return 'Sheet Metal';
    if (machineClass.startsWith('im_') || machineClass === 'injection_molding') return 'Plastics';
    if (['cmm', 'inspection'].includes(machineClass)) return 'Quality';
    return 'CNC Machining';
  }
}
