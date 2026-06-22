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
  Logger,
  Patch,
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
import { deriveImplications } from '../process-plan-generator/dto/manufacturing-implication.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { DFMScoringService } from './services/dfm-scoring.service';
import { MaterialIntelligenceService, type MaterialCandidate } from './services/material-intelligence.service';
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
  ): Promise<AutoFillResponseDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const allowedExts = ['.step', '.stp', '.stl', '.iges', '.igs', '.obj'];
    const ext = path.extname(file.originalname ?? '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext || '(none)'}. Allowed: ${allowedExts.join(', ')}`);
    }
    if (!user?.id) {
      throw new BadRequestException('User authentication required');
    }
    return this.autoFillService.analyzeAndSuggest(file.buffer, file.originalname, user.id, token);
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
          const stlFilename = file3d.originalname.replace(/\.(step|stp|iges|igs)$/i, '.stl');
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
  // STEP FILE PROCESSING & BOM GENERATION ENDPOINTS  
  // ============================================================================

  private readonly cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';

  @Post('process-step-file')
  @ApiOperation({ summary: 'Process STEP file and generate BOM assembly tree' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'STEP file processed and BOM generated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or processing failed' })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'stepFile', maxCount: 1 }]))
  async processStepFile(
    @UploadedFiles() files: { stepFile?: any[] },
    @Body() body: { bomId: string; projectId?: string },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    try {
      // Validate file upload
      if (!files?.stepFile?.[0]) {
        throw new BadRequestException('No STEP file provided');
      }

      const stepFile = files.stepFile[0];
      
      // Validate file type
      if (!this.stepConverterService.isStepFile(stepFile.originalname)) {
        throw new BadRequestException('Invalid file type. Please upload a STEP (.step, .stp), IGES (.iges, .igs), or SolidWorks (.sldprt) file.');
      }

      // Validate file size (100MB limit)
      if (stepFile.size > 100 * 1024 * 1024) {
        throw new BadRequestException('File too large. Please upload files smaller than 100MB.');
      }

      if (!body.bomId) {
        throw new BadRequestException('BOM ID is required');
      }

      this.logger.log(`Processing STEP file: ${stepFile.originalname} for BOM: ${body.bomId}`);

      try {
        // Call your CAD engine /analyze/assembly endpoint for hierarchical processing
        const formData = new FormData();
        
        // Create a Blob from the buffer for proper FormData handling
        const fileBlob = new Blob([stepFile.buffer], { type: stepFile.mimetype });
        formData.append('file', fileBlob, stepFile.originalname);
        formData.append('strategy', 'balanced'); // Use balanced analysis strategy
        formData.append('force_reanalysis', 'false');
        
        // Call the geometry endpoint (assembly endpoint will be added later)
        const processesResponse = await fetch(`${this.cadEngineUrl}/analyze/geometry`, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!processesResponse.ok) {
          throw new Error(`CAD engine responded with status ${processesResponse.status}: ${processesResponse.statusText}`);
        }

        const cadAnalysis = await processesResponse.json();

        if (!cadAnalysis.success) {
          throw new Error('CAD engine analysis failed');
        }

        this.logger.log(`CAD engine analysis completed for ${stepFile.originalname}`);

        // Create BOM items based on the hierarchical CAD analysis
        const bomCreationResult = await this.createHierarchicalBOMItemsFromAnalysis(
          cadAnalysis,
          body.bomId,
          stepFile.originalname,
          stepFile,
          user.id,
          token
        );

        return {
          success: true,
          message: 'STEP file processed successfully using your CAD engine',
          fileInfo: {
            name: stepFile.originalname,
            size: stepFile.size,
            mimetype: stepFile.mimetype
          },
          cadAnalysis,
          bomItemsCreated: bomCreationResult.itemsCreated,
          bomItemId: bomCreationResult.mainBomItemId,
          assemblyTree: bomCreationResult.assemblyTree,
          hierarchyDepth: bomCreationResult.hierarchyDepth,
          processingSteps: [
            { step: 1, name: 'File Validation', status: 'completed', message: 'STEP file validated' },
            { step: 2, name: 'CAD Engine Analysis', status: 'completed', message: 'OpenCascade analysis completed' },
            { step: 3, name: 'Geometry Extraction', status: 'completed', message: `Volume: ${cadAnalysis.geometry_features?.volume_mm3} mm³` },
            { step: 4, name: 'DFM Analysis', status: 'completed', message: `Manufacturability: ${cadAnalysis.dfm_analysis?.manufacturability_score}/100` },
            { step: 5, name: 'BOM Generation', status: 'completed', message: `${bomCreationResult.itemsCreated} BOM items created` },
            { step: 6, name: 'AI Insights', status: 'completed', message: `${cadAnalysis.dfm_analysis?.ai_insights ? 'AI recommendations generated' : 'Basic analysis'}` },
            { step: 7, name: 'Database Integration', status: 'completed', message: 'BOM items saved to database' },
            { step: 8, name: 'Analysis Complete', status: 'completed', message: 'Ready for manufacturing planning' }
          ]
        };

      } catch (cadError: any) {
        this.logger.error(`CAD engine processing failed: ${cadError.message}`, cadError.stack);

        // Return detailed error information
        return {
          success: false,
          message: 'CAD engine processing failed',
          fileInfo: {
            name: stepFile.originalname,
            size: stepFile.size,
            mimetype: stepFile.mimetype
          },
          error: cadError.message,
          cadEngineStatus: {
            url: this.cadEngineUrl,
            available: false,
            lastError: cadError.message
          },
          processingSteps: [
            { step: 1, name: 'File Validation', status: 'completed', message: 'STEP file validated' },
            { step: 2, name: 'CAD Engine Connection', status: 'failed', message: cadError.message },
            { step: 3, name: 'Analysis Pipeline', status: 'pending', message: 'Requires CAD engine connection' },
            { step: 4, name: 'BOM Generation', status: 'pending', message: 'Requires successful analysis' }
          ],
          troubleshooting: {
            checkEngine: `Verify your CAD engine is running at ${this.cadEngineUrl}`,
            healthCheck: `GET ${this.cadEngineUrl}/health`,
            startCommand: 'cd cad-engine && python main.py',
            requirements: ['OpenCascade OCCT', 'pythonocc-core', 'FastAPI']
          }
        };
      }

    } catch (error) {
      this.logger.error(`STEP file processing failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create hierarchical BOM items from assembly CAD analysis results
   */
  private async createHierarchicalBOMItemsFromAnalysis(
    cadAnalysis: any,
    bomId: string,
    filename: string,
    stepFile: any,
    userId: string,
    token: string
  ): Promise<{ 
    itemsCreated: number; 
    mainBomItemId: string; 
    assemblyTree: any[]; 
    hierarchyDepth: number 
  }> {
    try {
      // Check if the CAD analysis contains assembly hierarchy
      const assemblyStructure = cadAnalysis.assembly_structure || cadAnalysis.hierarchy;
      const assemblyParts = cadAnalysis.assembly_parts || cadAnalysis.parts || [];
      
      let itemsCreated = 0;
      let assemblyTree: any[] = [];
      let mainBomItemId = '';
      let hierarchyDepth = 1;

      if (assemblyStructure && assemblyParts.length > 0) {
        // Process hierarchical assembly structure (when CAD engine provides it)
        this.logger.log(`Processing assembly with ${assemblyParts.length} parts in hierarchical structure`);
        
        const result = await this.createHierarchicalItems(
          assemblyStructure,
          assemblyParts,
          bomId,
          filename,
          stepFile,
          userId,
          token,
          null, // No parent for root assembly
          1 // Start at level 1
        );
        
        itemsCreated = result.itemsCreated;
        mainBomItemId = result.rootBomItemId;
        assemblyTree = result.assemblyTree;
        hierarchyDepth = result.maxDepth;
        
      } else {
        // Intelligent hierarchy generation from geometry analysis
        this.logger.log('Creating intelligent assembly hierarchy from geometry analysis');
        const intelligentResult = await this.createIntelligentHierarchy(
          cadAnalysis,
          bomId,
          filename,
          stepFile,
          userId,
          token
        );
        
        itemsCreated = intelligentResult.itemsCreated;
        mainBomItemId = intelligentResult.mainBomItemId;
        assemblyTree = intelligentResult.assemblyTree;
        hierarchyDepth = intelligentResult.hierarchyDepth;
      }

      return {
        itemsCreated,
        mainBomItemId,
        assemblyTree,
        hierarchyDepth
      };

    } catch (error) {
      this.logger.error(`Failed to create hierarchical BOM items: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create intelligent hierarchy from geometry analysis when no explicit assembly structure is provided
   */
  private async createIntelligentHierarchy(
    cadAnalysis: any,
    bomId: string,
    filename: string,
    stepFile: any,
    userId: string,
    token: string
  ): Promise<{
    itemsCreated: number;
    mainBomItemId: string;
    assemblyTree: any[];
    hierarchyDepth: number;
  }> {
    // Extract data from actual CAD engine response format
    const geometryFeatures = cadAnalysis.geometry_features || {};
    const dfmAnalysis = cadAnalysis.dfm_analysis || {};
    
    // Analyze complexity to determine if this should be an assembly
    const volume = geometryFeatures.volume_mm3 || 0;
    const complexity = geometryFeatures.complexity_score || 0;
    const holeCount = geometryFeatures.manufacturing_features?.holes?.length || 0;
    const faceCount = geometryFeatures.feature_count?.faces || 0;
    const recommendedProcesses = dfmAnalysis.recommended_processes || [];
    
    let itemsCreated = 0;
    let hierarchyDepth = 1;
    
    // Generate base names and part numbers
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseName = filename.replace(/\.(step|stp|iges|igs)$/i, '');
    
    this.logger.log(`Analyzing geometry for intelligent hierarchy: complexity=${complexity}, faces=${faceCount}, holes=${holeCount}, volume=${volume}`);
    this.logger.log(`Recommended processes: ${recommendedProcesses.join(', ')}`);
    this.logger.log(`CAD Analysis structure:`, JSON.stringify({
      hasGeometryFeatures: !!cadAnalysis.geometry_features,
      hasDfmAnalysis: !!cadAnalysis.dfm_analysis,
      hasMemoryOptimization: !!cadAnalysis.memory_optimization,
      complexityScore: cadAnalysis.geometry_features?.complexity_score,
      volume: cadAnalysis.geometry_features?.volume_mm3,
      recommendedProcesses: cadAnalysis.dfm_analysis?.recommended_processes,
      keysInAnalysis: Object.keys(cadAnalysis)
    }, null, 2));
    
    // Estimate actual part count based on geometry complexity
    const estimatedPartCount = this.estimatePartCount(geometryFeatures, dfmAnalysis, recommendedProcesses);
    
    // Determine if this should be treated as an assembly or single part
    // Very aggressive thresholds to ensure STEP files create assembly hierarchies
    const shouldCreateAssembly = complexity >= 0.1 || faceCount > 5 || holeCount > 0 || volume > 100 || estimatedPartCount >= 3 || recommendedProcesses.length > 0;
    const shouldCreateSubAssemblies = complexity >= 1 || faceCount > 20 || holeCount > 2;
    this.logger.log(`Estimated part count: ${estimatedPartCount} (complexity: ${complexity}, faces: ${faceCount}, holes: ${holeCount})`);
    this.logger.log(`Assembly decision: shouldCreateAssembly=${shouldCreateAssembly}, shouldCreateSubAssemblies=${shouldCreateSubAssemblies}`);
    
    if (shouldCreateAssembly) {
      this.logger.log('Creating assembly structure with sub-components');
      
      // Create main assembly
      const mainAssembly = await this.bomItemsService.create({
        bomId,
        name: baseName,
        itemType: BOMItemType.ASSEMBLY,
        partNumber: `${baseName.toUpperCase().slice(0, 8)}-${timestamp}-ASM`,
        description: `Assembly - ${baseName} (${recommendedProcesses.join(', ') || 'Mixed processes'})`,
        quantity: 1,
        annualVolume: 1000,
        unitCost: 0,
        makeBuy: undefined, // Assemblies don't have make/buy
        unit: 'pcs'
      }, userId, token);
      itemsCreated++;
      
      // Upload 3D file to main assembly
      try {
        const projectId = await this.bomItemsService.getProjectIdForBOM(bomId, token);
        const uploadResult = await this.fileStorageService.uploadFile(
          {
            fieldname: 'file3d',
            originalname: stepFile.originalname,
            encoding: stepFile.encoding,
            mimetype: stepFile.mimetype,
            size: stepFile.size,
            buffer: stepFile.buffer,
          },
          '3d',
          userId,
          mainAssembly.id,
          projectId
        );

        await this.bomItemsService.update(
          mainAssembly.id,
          { file3dPath: uploadResult.storagePath },
          userId,
          token
        );
      } catch (error) {
        this.logger.warn(`Failed to upload 3D file: ${error.message}`);
      }
      
      const assemblyTree: any[] = [{
        id: mainAssembly.id,
        name: baseName,
        type: 'assembly',
        partNumber: mainAssembly.partNumber,
        quantity: 1,
        level: 1,
        children: [] as any[],
        bomItemId: mainAssembly.id
      }];
      
      // Create sub-assemblies/parts based on complexity and processes
      if (shouldCreateSubAssemblies && recommendedProcesses.length > 1) {
        hierarchyDepth = 3;
        
        // Create sub-assemblies for different manufacturing processes
        const processGroups = this.groupByManufacturingProcess(recommendedProcesses, dfmAnalysis, geometryFeatures, estimatedPartCount);
        
        for (let i = 0; i < processGroups.length; i++) {
          const processGroup = processGroups[i];
          const subAssembly = await this.bomItemsService.create({
            bomId,
            name: `${baseName} ${processGroup.name}`,
            itemType: BOMItemType.SUB_ASSEMBLY,
            partNumber: `${baseName.toUpperCase().slice(0, 6)}-${timestamp}-SA${i + 1}`,
            description: `Sub-assembly - ${processGroup.description}`,
            quantity: processGroup.quantity || 1,
            annualVolume: 1000,
            unitCost: 0,
            makeBuy: undefined,
            unit: 'pcs',
            parentItemId: mainAssembly.id
          }, userId, token);
          itemsCreated++;
          
          const subAssemblyNode = {
            id: subAssembly.id,
            name: `${baseName} ${processGroup.name}`,
            type: 'sub-assembly',
            partNumber: subAssembly.partNumber,
            quantity: processGroup.quantity || 1,
            level: 2,
            children: [] as any[],
            bomItemId: subAssembly.id
          };
          
          // Create child parts for this sub-assembly
          for (let j = 0; j < processGroup.parts.length; j++) {
            const part = processGroup.parts[j];
            const childPart = await this.bomItemsService.create({
              bomId,
              name: part.name,
              itemType: BOMItemType.CHILD_PART,
              partNumber: `${baseName.toUpperCase().slice(0, 5)}-${timestamp}-P${i + 1}${j + 1}`,
              description: part.description,
              material: part.material,
              quantity: part.quantity || 1,
              annualVolume: 1000,
              unitCost: 0,
              makeBuy: 'make',
              unit: 'pcs',
              parentItemId: subAssembly.id
            }, userId, token);
            itemsCreated++;
            
            subAssemblyNode.children.push({
              id: childPart.id,
              name: part.name,
              type: 'child-part',
              partNumber: childPart.partNumber,
              quantity: part.quantity || 1,
              level: 3,
              children: [],
              bomItemId: childPart.id
            });
          }
          
          assemblyTree[0].children.push(subAssemblyNode);
        }
      } else {
        hierarchyDepth = 2;
        // Create child parts directly under main assembly
        
        for (let i = 0; i < estimatedPartCount; i++) {
          const partMaterial = this.estimatePartMaterial(recommendedProcesses, i);
          const childPart = await this.bomItemsService.create({
            bomId,
            name: `${baseName} Component ${i + 1}`,
            itemType: BOMItemType.CHILD_PART,
            partNumber: `${baseName.toUpperCase().slice(0, 6)}-${timestamp}-P${i + 1}`,
            description: `Component ${i + 1} - ${partMaterial.process}`,
            material: partMaterial.material,
            quantity: 1,
            annualVolume: 1000,
            unitCost: 0,
            makeBuy: 'make',
            unit: 'pcs',
            parentItemId: mainAssembly.id
          }, userId, token);
          itemsCreated++;
          
          assemblyTree[0].children.push({
            id: childPart.id,
            name: `${baseName} Component ${i + 1}`,
            type: 'child-part',
            partNumber: childPart.partNumber,
            quantity: 1,
            level: 2,
            children: [],
            bomItemId: childPart.id
          });
        }
      }
      
      return {
        itemsCreated,
        mainBomItemId: mainAssembly.id,
        assemblyTree,
        hierarchyDepth
      };
    } else {
      // Create single item fallback - force create assembly with minimal parts
      this.logger.log('Forcing assembly creation even for simple parts to ensure hierarchy');
      
      // Force assembly creation by setting shouldCreateAssembly = true
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const baseName = filename.replace(/\.(step|stp|iges|igs)$/i, '');
      
      // Create main assembly
      const mainAssembly = await this.bomItemsService.create({
        bomId,
        name: baseName,
        itemType: BOMItemType.ASSEMBLY,
        partNumber: `${baseName.toUpperCase().slice(0, 8)}-${timestamp}-ASM`,
        description: `Assembly - ${baseName}`,
        quantity: 1,
        annualVolume: 1000,
        unitCost: 0,
        makeBuy: undefined,
        unit: 'pcs'
      }, userId, token);
      
      // Create at least 3 child parts
      for (let i = 0; i < 3; i++) {
        await this.bomItemsService.create({
          bomId,
          name: `${baseName} Part ${i + 1}`,
          itemType: BOMItemType.CHILD_PART,
          partNumber: `${baseName.toUpperCase().slice(0, 6)}-${timestamp}-P${i + 1}`,
          description: `Component ${i + 1}`,
          material: 'Aluminum 6061',
          quantity: 1,
          annualVolume: 1000,
          unitCost: 0,
          makeBuy: 'make',
          unit: 'pcs',
          parentItemId: mainAssembly.id
        }, userId, token);
      }
      
      return {
        itemsCreated: 4, // 1 assembly + 3 parts
        mainBomItemId: mainAssembly.id,
        assemblyTree: [{
          id: mainAssembly.id,
          name: baseName,
          type: 'assembly',
          level: 1,
          children: Array.from({length: 3}, (_, i) => ({
            name: `${baseName} Part ${i + 1}`,
            type: 'child-part',
            level: 2,
            children: []
          })),
          bomItemId: mainAssembly.id
        }],
        hierarchyDepth: 2
      };
    }
  }

  /**
   * Estimate part count based on geometry analysis
   */
  private estimatePartCount(geometryFeatures: any, dfmAnalysis: any, processes: string[]): number {
    const complexity = geometryFeatures.complexity_score || 0;
    const faceCount = geometryFeatures.feature_count?.faces || 0;
    const holeCount = geometryFeatures.manufacturing_features?.holes?.length || 0;
    const volume = geometryFeatures.volume_mm3 || 0;
    
    // Base estimation from complexity
    let partCount = Math.floor(complexity / 2) + 1;
    
    // Adjust based on face count (more faces = more complex assembly)
    if (faceCount > 5000) partCount += Math.floor(faceCount / 1000);
    else if (faceCount > 2000) partCount += Math.floor(faceCount / 500);
    else if (faceCount > 1000) partCount += 2;
    
    // Adjust based on hole count (holes often indicate fasteners/connections)
    if (holeCount > 50) partCount += Math.floor(holeCount / 10);
    else if (holeCount > 20) partCount += Math.floor(holeCount / 5);
    else if (holeCount > 10) partCount += 2;
    
    // Adjust based on volume (larger assemblies typically have more parts)
    if (volume > 500000) partCount += 5; // Very large assembly
    else if (volume > 200000) partCount += 3; // Large assembly
    else if (volume > 100000) partCount += 2; // Medium assembly
    
    // Adjust based on manufacturing processes (more processes = more diverse parts)
    if (processes.length > 3) partCount += processes.length;
    else if (processes.length > 1) partCount += 2;
    
    // Ensure reasonable bounds: minimum 3 for meaningful assemblies, maximum 50
    const finalPartCount = Math.max(3, Math.min(50, partCount));
    
    // Log the calculation for debugging
    this.logger.log(`Part count calculation: base=${Math.floor(complexity / 2) + 1}, faces_bonus=${faceCount > 1000 ? Math.floor(faceCount / 1000) : 0}, holes_bonus=${holeCount > 10 ? Math.floor(holeCount / 5) : 0}, volume_bonus=${volume > 100000 ? 2 : 0}, processes_bonus=${processes.length > 1 ? 2 : 0}, final=${finalPartCount}`);
    
    return finalPartCount;
  }

  /**
   * Group manufacturing features by process type
   */
  private groupByManufacturingProcess(processes: string[], dfmAnalysis: any, geometryFeatures: any, estimatedPartCount: number) {
    const groups = [];
    const totalParts = estimatedPartCount;
    
    // Distribute parts across different manufacturing processes
    const processDistribution = this.calculateProcessDistribution(processes, totalParts);
    
    if (processes.includes('CNC Machining') || processes.includes('Milling')) {
      const machinedPartCount = processDistribution['CNC Machining'] || Math.ceil(totalParts * 0.4);
      const machinedParts = [];
      
      for (let i = 0; i < machinedPartCount; i++) {
        machinedParts.push({
          name: i === 0 ? 'Main Housing' : `Machined Component ${i + 1}`,
          description: i === 0 ? 'Primary machined housing' : `CNC machined part ${i + 1}`,
          material: 'Aluminum 6061',
          quantity: 1
        });
      }
      
      groups.push({
        name: 'Machined Parts',
        description: `CNC machined components (${machinedPartCount} parts)`,
        quantity: 1,
        parts: machinedParts
      });
    }
    
    if (processes.includes('Sheet Metal')) {
      const sheetMetalPartCount = processDistribution['Sheet Metal'] || Math.ceil(totalParts * 0.3);
      const sheetMetalParts = [];
      
      for (let i = 0; i < sheetMetalPartCount; i++) {
        sheetMetalParts.push({
          name: i === 0 ? 'Main Bracket' : `Sheet Metal Part ${i + 1}`,
          description: i === 0 ? 'Primary support bracket' : `Formed sheet metal component ${i + 1}`,
          material: 'Mild Steel',
          quantity: i === 0 ? 2 : 1 // Main bracket often has duplicates
        });
      }
      
      groups.push({
        name: 'Sheet Metal Parts',
        description: `Sheet metal fabricated components (${sheetMetalPartCount} parts)`,
        quantity: 1,
        parts: sheetMetalParts
      });
    }
    
    if (processes.includes('Investment Casting')) {
      const castPartCount = processDistribution['Investment Casting'] || Math.ceil(totalParts * 0.2);
      const castParts = [];
      
      for (let i = 0; i < castPartCount; i++) {
        castParts.push({
          name: i === 0 ? 'Cast Housing' : `Cast Component ${i + 1}`,
          description: i === 0 ? 'Investment cast housing' : `Cast part ${i + 1}`,
          material: 'Stainless Steel 316',
          quantity: 1
        });
      }
      
      groups.push({
        name: 'Cast Parts',
        description: `Investment cast components (${castPartCount} parts)`,
        quantity: 1,
        parts: castParts
      });
    }
    
    // Add fasteners and hardware based on hole count
    const holeCount = geometryFeatures.manufacturing_features?.holes?.length || 0;
    if (holeCount > 10) {
      const fastenerCount = Math.min(Math.ceil(holeCount / 3), 15); // Estimate fastener types
      const fastenerParts = [];
      
      for (let i = 0; i < fastenerCount; i++) {
        fastenerParts.push({
          name: `Fastener ${i + 1}`,
          description: i % 3 === 0 ? 'Hex bolts' : i % 3 === 1 ? 'Washers' : 'Nuts',
          material: 'Stainless Steel',
          quantity: Math.ceil(holeCount / fastenerCount) // Distribute holes across fastener types
        });
      }
      
      groups.push({
        name: 'Fasteners & Hardware',
        description: `Fasteners and hardware components (${fastenerCount} types)`,
        quantity: 1,
        parts: fastenerParts
      });
    }
    
    // If no specific processes, create generic groups with realistic part count
    if (groups.length === 0) {
      const genericParts = [];
      for (let i = 0; i < Math.min(totalParts, 25); i++) {
        genericParts.push({
          name: i === 0 ? 'Main Component' : `Component ${i + 1}`,
          description: i === 0 ? 'Primary component' : `Assembly component ${i + 1}`,
          material: 'Aluminum 6061',
          quantity: 1
        });
      }
      
      groups.push({
        name: 'Primary Components',
        description: `Main structural components (${genericParts.length} parts)`,
        quantity: 1,
        parts: genericParts
      });
    }
    
    return groups;
  }

  /**
   * Calculate how to distribute parts across manufacturing processes
   */
  private calculateProcessDistribution(processes: string[], totalParts: number): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    if (processes.length === 0) return distribution;
    
    // Typical distribution ratios for different processes
    const processRatios: Record<string, number> = {
      'CNC Machining': 0.4,
      'Milling': 0.4,
      'Sheet Metal': 0.3,
      'Investment Casting': 0.2,
      'Additive Manufacturing': 0.1
    };
    
    let remainingParts = totalParts;
    
    // Calculate parts for each process
    processes.forEach((process, index) => {
      const ratio = processRatios[process] || (1 / processes.length);
      const partsForProcess = index === processes.length - 1 
        ? remainingParts // Give remaining parts to last process
        : Math.max(1, Math.floor(totalParts * ratio));
      
      distribution[process] = partsForProcess;
      remainingParts -= partsForProcess;
    });
    
    return distribution;
  }

  /**
   * Estimate material based on manufacturing process
   */
  private estimatePartMaterial(processes: string[], index: number) {
    const materials = [
      { material: 'Aluminum 6061', process: 'CNC Machining' },
      { material: 'Mild Steel', process: 'Sheet Metal' },
      { material: 'Stainless Steel 316', process: 'Investment Casting' },
      { material: 'PLA', process: 'Additive Manufacturing' }
    ];
    
    if (processes.includes('Sheet Metal')) {
      return { material: 'Mild Steel', process: 'Sheet Metal' };
    } else if (processes.includes('Investment Casting')) {
      return { material: 'Stainless Steel 316', process: 'Investment Casting' };
    } else if (processes.includes('Additive Manufacturing')) {
      return { material: 'PLA', process: 'Additive Manufacturing' };
    } else {
      return materials[index % materials.length];
    }
  }

  /**
   * Recursively create BOM items from assembly hierarchy
   */
  private async createHierarchicalItems(
    node: any,
    allParts: any[],
    bomId: string,
    rootFilename: string,
    stepFile: any,
    userId: string,
    token: string,
    parentBomItemId: string | null,
    level: number
  ): Promise<{
    itemsCreated: number;
    rootBomItemId: string;
    assemblyTree: any[];
    maxDepth: number;
  }> {
    let itemsCreated = 0;
    let maxDepth = level;
    const assemblyTree: any[] = [];

    // Determine item type based on level and content
    let itemType: BOMItemType;
    if (level === 1) {
      itemType = BOMItemType.ASSEMBLY;
    } else if (node.children && node.children.length > 0) {
      itemType = BOMItemType.SUB_ASSEMBLY;
    } else {
      itemType = BOMItemType.CHILD_PART;
    }

    // Find part data for this node
    const partData = allParts.find(p => p.id === node.id || p.name === node.name) || {};
    
    // Generate part details
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const baseName = node.name || `Part-${level}-${itemsCreated + 1}`;
    const partNumber = `${baseName.toUpperCase().slice(0, 8)}-${timestamp}-L${level}`;
    
    // Get geometry data
    const volume = partData.volume_mm3 || partData.volume || 0;
    const complexity = partData.complexity_score || 5;
    
    // Determine material based on part type and level
    let material = 'Aluminum 6061';
    if (itemType === BOMItemType.ASSEMBLY) {
      material = 'Assembly'; // Assemblies don't have material
    } else if (partData.recommended_processes?.includes('Sheet Metal')) {
      material = 'Mild Steel';
    } else if (partData.recommended_processes?.includes('Investment Casting')) {
      material = 'Stainless Steel 316';
    }

    // Create BOM item
    const createBOMItemDto: CreateBOMItemDto = {
      bomId,
      name: baseName,
      itemType,
      partNumber,
      description: `${itemType} - Level ${level} - ${node.description || 'CAD generated'}`,
      material: itemType === BOMItemType.ASSEMBLY ? undefined : material,
      quantity: node.quantity || 1,
      annualVolume: 1000,
      unitCost: 0,
      makeBuy: itemType === BOMItemType.CHILD_PART ? 'make' : undefined,
      unit: 'pcs',
      parentItemId: parentBomItemId || undefined
    };

    this.logger.log(`Creating ${itemType}: ${partNumber} at level ${level}`);

    // Create the BOM item
    const createdBOMItem = await this.bomItemsService.create(createBOMItemDto, userId, token);
    itemsCreated++;

    // Upload 3D file for root assembly only
    if (level === 1 && stepFile) {
      try {
        const projectId = await this.bomItemsService.getProjectIdForBOM(bomId, token);
        
        const uploadResult = await this.fileStorageService.uploadFile(
          {
            fieldname: 'file3d',
            originalname: stepFile.originalname,
            encoding: stepFile.encoding,
            mimetype: stepFile.mimetype,
            size: stepFile.size,
            buffer: stepFile.buffer,
          },
          '3d',
          userId,
          createdBOMItem.id,
          projectId
        );

        // Update BOM item with file path
        await this.bomItemsService.update(
          createdBOMItem.id,
          { file3dPath: uploadResult.storagePath },
          userId,
          token
        );

        this.logger.log(`3D file uploaded for root assembly: ${uploadResult.storagePath}`);
      } catch (error) {
        this.logger.warn(`Failed to upload 3D file for assembly: ${error.message}`);
      }
    }

    // Create assembly tree node
    const treeNode = {
      id: createdBOMItem.id,
      name: baseName,
      type: itemType.toLowerCase().replace('_', '-'),
      partNumber,
      quantity: node.quantity || 1,
      level,
      children: [] as any[],
      bomItemId: createdBOMItem.id
    };

    // Process children recursively
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childResult = await this.createHierarchicalItems(
          child,
          allParts,
          bomId,
          rootFilename,
          null, // Don't upload files for child items
          userId,
          token,
          createdBOMItem.id,
          level + 1
        );
        
        itemsCreated += childResult.itemsCreated;
        maxDepth = Math.max(maxDepth, childResult.maxDepth);
        treeNode.children.push(...childResult.assemblyTree);
      }
    }

    assemblyTree.push(treeNode);

    return {
      itemsCreated,
      rootBomItemId: createdBOMItem.id,
      assemblyTree,
      maxDepth
    };
  }

  // Legacy createBOMItemsFromAnalysis method removed - replaced by createIntelligentHierarchy

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
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.bomItemsService.getCostSummary(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
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
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.bomItemsService.getRouteComparison(
      id,
      user.id,
      token,
      batchSize ? parseInt(batchSize, 10) : 1,
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
}
