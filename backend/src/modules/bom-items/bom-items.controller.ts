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
  Patch,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { BOMItemsService } from './bom-items.service';
import { CreateBOMItemDto, UpdateBOMItemDto, QueryBOMItemsDto } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import axios from 'axios';

@ApiTags('BOM Items')
@ApiBearerAuth()
@Controller({ path: 'api/bom-items', version: '1' })
export class BOMItemsController {
  private readonly logger = new Logger(BOMItemsController.name);

  constructor(
    private readonly bomItemsService: BOMItemsService,
    private readonly fileStorageService: FileStorageService,
    private readonly stepConverterService: StepConverterService,
  ) {}

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

  @Get(':id')
  @ApiOperation({ summary: 'Get BOM item by ID' })
  @ApiResponse({ status: 200, description: 'BOM item retrieved successfully', type: BOMItemResponseDto })
  @ApiResponse({ status: 404, description: 'BOM item not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<BOMItemResponseDto> {
    return this.bomItemsService.findOne(id, user.id, token);
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
  @ApiOperation({ summary: 'Upload 2D/3D files for BOM item' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Files uploaded successfully', type: BOMItemResponseDto })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file2d', maxCount: 1 },
      { name: 'file3d', maxCount: 1 },
    ]),
  )
  async uploadFiles(
    @Param('id') id: string,
    @UploadedFiles() files: { file2d?: any[]; file3d?: any[] },
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<BOMItemResponseDto> {
    // Validate files are provided before processing
    if (!files?.file2d?.[0] && !files?.file3d?.[0]) {
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

          // Store the converted STL path for viewing
          updateData.file3dPath = stlUploadResult.storagePath;
        } catch (error) {
          // Conversion failed - keep original STEP file for manual conversion later
          this.logger.warn(`Auto-conversion failed for ${file3d.originalname}, keeping original file`);
          updateData.file3dPath = uploadResult.storagePath;
        }
      } else {
        // Not a STEP file - use original upload
        updateData.file3dPath = uploadResult.storagePath;
      }
    }

    // Update BOM item with file paths
    return this.bomItemsService.update(id, updateData, user.id, token);
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
      throw new BadRequestException('File is not a STEP file. Only .step, .stp, .iges, .igs files can be converted');
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


}

