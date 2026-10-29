import { Controller, Get, Param, ParseUUIDPipe, Post, Body, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';

import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';
import { type CadUploadRow } from './cad-upload.types';
import { CadUploadsService } from './cad-uploads.service';

function view(row: CadUploadRow) {
  return {
    id: row.id,
    bomId: row.bom_id,
    fileName: row.file_name,
    status: row.status,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    createdItemIds: row.created_item_ids,
    result: row.result,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

@ApiTags('CAD uploads')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@Controller({ path: 'api/cad-uploads', version: '1' })
export class CadUploadsController {
  constructor(private readonly uploads: CadUploadsService) {}

  @Post()
  @ApiOperation({ summary: 'Upload a .zip of STEP files, or one STEP file; it is processed in the background' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_CAD_FILE_BYTES } }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { bomId?: string },
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) throw new BadRequestException({ code: 'no_file', message: 'Attach the file as "file".' });
    if (!body.bomId) throw new BadRequestException({ code: 'no_bom', message: 'bomId is required.' });
    const { upload, duplicate } = await this.uploads.create({
      fileName: file.originalname,
      bytes: file.buffer,
      bomId: body.bomId,
      userId: user.id,
      organizationId,
      token,
    });
    res.status(duplicate ? 200 : 201);
    return { ...view(upload), duplicate };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Status of an upload: queued, running, done (with the result) or failed (with a code)' })
  async get(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return view(await this.uploads.get(id, token));
  }
}
