import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CreateContainerDto, ListDesignsDto, RequestQuoteDto, StartUploadDto } from './electronics.dto';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../../common/guards/organization-context.guard';
import { CreateContainerUseCase } from '../application/create-container.use-case';
import { DeleteDesignUseCase, type DeleteResult } from '../application/delete-design.use-case';
import { GetBoardPreviewUseCase } from '../application/get-board-preview.use-case';
import { GetJobStatusUseCase, type JobStatusView } from '../application/get-job-status.use-case';
import { GetReferenceCoverageUseCase, type ReferenceCoverageView } from '../application/get-reference-coverage.use-case';
import { ListDesignsUseCase, type DesignView } from '../application/list-designs.use-case';
import { RequestQuoteUseCase } from '../application/quote.use-cases';
import { ReparseUploadUseCase } from '../application/reparse-upload.use-case';
import { StartAssemblyUploadUseCase, type StartAssemblyResult } from '../application/start-assembly-upload.use-case';
import { StartUploadUseCase, type StartUploadResult } from '../application/start-upload.use-case';
import { validateSuppliedFacts, type SuppliedFacts } from '../domain/supplied-facts';
import { scenarioOptions, type ScenarioOptions } from '../domain/engines/assembly-steps.engine';
import { PLANNED_ENGINES } from '../domain/reference/engine-inputs';
import { isArchiveName } from '../../../common/archive/expand-archive';
import { isFolderUpload, parseUploadPaths } from '../domain/uploads/upload-paths';
import { acceptedFormats, MAX_UPLOAD_BYTES } from '../domain/uploads/validate-upload';
import { ElectronicsRepository, type CostResultRow, type RevisionRow } from '../infrastructure/repositories/electronics.repository';

interface User {
  id: string;
}

export const MAX_FILES_PER_UPLOAD = 30;
// Same bound as StartUploadDto.paths' @MaxLength — re-checked here, where it is used.
const MAX_PATHS_LENGTH = 60000;

/**
 * The uploaded files, checked as what they must be: an array of 1 to
 * MAX_FILES_PER_UPLOAD multer files. Explicit here (not only trusted to multer)
 * because the count bounds the loops below and a tampered request must not be
 * able to change its type.
 */
export function checkedUploadFiles(files: unknown): Express.Multer.File[] {
  if (!Array.isArray(files) || files.length === 0) throw new BadRequestException('files is required');
  if (files.length > MAX_FILES_PER_UPLOAD) throw new BadRequestException(`at most ${MAX_FILES_PER_UPLOAD} files per upload`);
  for (const f of files) {
    if (typeof f !== 'object' || f === null || typeof (f as { originalname?: unknown }).originalname !== 'string' || !Buffer.isBuffer((f as { buffer?: unknown }).buffer)) {
      throw new BadRequestException('files must be uploaded files');
    }
  }
  return files as Express.Multer.File[];
}

/** The `paths` form field: absent, or one string of bounded length — never an array or object from a tampered form. */
export function checkedUploadPaths(paths: unknown): string | undefined {
  if (paths === undefined) return undefined;
  if (typeof paths !== 'string') throw new BadRequestException('paths must be a JSON string');
  if (paths.length > MAX_PATHS_LENGTH) throw new BadRequestException(`paths must be at most ${MAX_PATHS_LENGTH} characters`);
  return paths;
}

// A stored cost result as the screen reads it. Column names are mapped here, once; numeric columns arrive as strings
// from PostgREST when they are numeric, so the per-unit cost is turned back into a number.
export interface CostResultView {
  id: string;
  uploadId: string;
  revisionId: string | null;
  rateVersion: string | null;
  ratesUsed: CostResultRow['rates_used'];
  batchSize: number;
  assemblyCostPerUnit: number | null;
  complete: boolean;
  result: CostResultRow['result'];
  createdAt: string;
}

export function toCostResultView(row: CostResultRow): CostResultView {
  return {
    id: row.id,
    uploadId: row.upload_id,
    revisionId: row.revision_id,
    rateVersion: row.rate_version,
    ratesUsed: row.rates_used,
    batchSize: Number(row.batch_size),
    assemblyCostPerUnit: row.assembly_cost_per_unit === null ? null : Number(row.assembly_cost_per_unit),
    complete: row.complete,
    result: row.result,
    createdAt: row.created_at,
  };
}

@ApiTags('Electronics costing')
@ApiBearerAuth()
@UseGuards(OrganizationContextGuard)
@Controller({ path: 'api/electronics', version: '1' })
export class ElectronicsController {
  constructor(
    private readonly startUpload: StartUploadUseCase,
    private readonly startAssembly: StartAssemblyUploadUseCase,
    private readonly requestQuote: RequestQuoteUseCase,
    private readonly jobStatus: GetJobStatusUseCase,
    private readonly referenceCoverage: GetReferenceCoverageUseCase,
    private readonly boardPreview: GetBoardPreviewUseCase,
    private readonly repository: ElectronicsRepository,
    private readonly designs: ListDesignsUseCase,
    private readonly createContainer: CreateContainerUseCase,
    private readonly deleter: DeleteDesignUseCase,
    private readonly reparse: ReparseUploadUseCase,
  ) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Store a PCBA or harness upload and queue its parse job' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_UPLOAD } }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: StartUploadDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<StartUploadResult | StartAssemblyResult> {
    files = checkedUploadFiles(files);
    const paths = checkedUploadPaths(body.paths);
    const archive = files.length === 1 && files[0] && isArchiveName(files[0].originalname) ? files[0] : null;
    if (archive) {
      // A design pack: unpacked and read as the folder it was made from (one board, or an assembly of several).
      return this.startAssembly.executeArchive({
        name: archive.originalname,
        bytes: archive.buffer,
        ...(body.projectId ? { projectId: body.projectId } : {}),
        ...(body.parentDesignId ? { parentDesignId: body.parentDesignId } : {}),
        ...(body.designId ? { designId: body.designId } : {}),
        organizationId,
        userId: user.id,
        token,
      });
    }
    if (paths !== undefined) {
      const parsed = parseUploadPaths(paths, files.length, files.map((f) => f.originalname));
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      if (isFolderUpload(parsed.paths)) {
        return this.startAssembly.execute({
          files: files.map((f, i) => ({ name: f.originalname, bytes: f.buffer, path: parsed.paths[i] })),
          ...(body.projectId ? { projectId: body.projectId } : {}),
          ...(body.parentDesignId ? { parentDesignId: body.parentDesignId } : {}),
          organizationId,
          userId: user.id,
          token,
        });
      }
    }
    return this.startUpload.execute({
      files: files.map((f) => ({ name: f.originalname, bytes: f.buffer })),
      ...(body.kind ? { kind: body.kind } : {}),
      ...(body.tier ? { tier: body.tier } : {}),
      designId: body.designId,
      projectId: body.projectId,
      parentDesignId: body.parentDesignId,
      designName: body.designName,
      revision: body.revision,
      supplied: this.parseSupplied(body.supplied),
      organizationId,
      userId: user.id,
      token,
    });
  }

  private parseSupplied(raw: string | undefined): SuppliedFacts | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('supplied must be valid JSON');
    }
    const result = validateSuppliedFacts(parsed);
    if (!result.ok) throw new BadRequestException(result.message);
    return result.facts;
  }

  @Post('quotes')
  @ApiOperation({ summary: 'Queue routing and costing for a parsed upload' })
  async quote(
    @Body() body: RequestQuoteDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<{ jobId: string }> {
    return this.requestQuote.execute({
      uploadId: body.uploadId,
      batchSize: body.batchSize,
      ...(body.scenario !== undefined ? { scenario: body.scenario } : {}),
      organizationId,
      userId: user.id,
      token,
    });
  }

  @Get('file-formats')
  @ApiOperation({ summary: 'The file types an upload accepts, with the role each board file extension has' })
  formats() {
    return acceptedFormats();
  }

  @Get('uploads/:uploadId/features')
  @ApiOperation({ summary: 'An upload with its file report, extracted feature graph (provenance, unresolved, findings) and attached documents' })
  async features(@Param('uploadId', ParseUUIDPipe) uploadId: string, @AccessToken() token: string) {
    const upload = await this.repository.getUpload(uploadId, token);
    const graph = await this.repository.getLatestFeatureGraph(uploadId, token);
    return {
      upload: {
        id: upload.id,
        kind: upload.kind,
        tier: upload.input_tier,
        status: upload.status,
        failure: upload.failure,
        revisionId: upload.revision_id,
        supplied: upload.params?.supplied ?? {},
        files: upload.files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, format: f.format, role: f.role ?? null })),
      },
      extraction: upload.extraction,
      featureGraph: graph ? { id: graph.id, reviewStatus: graph.review_status, graph: graph.graph } : null,
    };
  }

  @Get('uploads/:uploadId/preview')
  @ApiOperation({ summary: 'The layers of an uploaded board set drawn as SVG on one shared frame' })
  async preview(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    return this.boardPreview.execute(uploadId, organizationId, token);
  }

  @Get('uploads/:uploadId/thumbnail')
  @ApiOperation({ summary: 'A small SVG picture of the board for list cards, served from storage (svg is null when none can be shown)' })
  async thumbnail(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    return this.boardPreview.thumbnail(uploadId, organizationId, token);
  }

  @Get('designs')
  @ApiOperation({ summary: 'Designs of the organization (optionally one project), each with its revisions and their upload status' })
  async listDesigns(@Query() query: ListDesignsDto, @AccessToken() token: string): Promise<DesignView[]> {
    return this.designs.list({ projectId: query.projectId }, token);
  }

  @Post('designs')
  @ApiOperation({ summary: 'Create an empty assembly or sub-assembly (a container for child parts)' })
  async createDesign(
    @Body() body: CreateContainerDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<DesignView> {
    const created = await this.createContainer.execute({
      itemType: body.itemType,
      name: body.name,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.parentDesignId ? { parentDesignId: body.parentDesignId } : {}),
      organizationId,
      userId: user.id,
      token,
    });
    return this.designs.get(created.id, token);
  }

  @Delete('designs/:designId')
  @ApiOperation({ summary: 'Delete a design and everything below it, with its files (permanent)' })
  async deleteDesign(
    @Param('designId', ParseUUIDPipe) designId: string,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<DeleteResult> {
    return this.deleter.deleteDesign(designId, organizationId, token);
  }

  @Delete('designs/:designId/revisions/:revisionId')
  @ApiOperation({ summary: 'Delete one revision and its files; the last revision removes the part (permanent)' })
  async deleteRevision(
    @Param('designId', ParseUUIDPipe) designId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<DeleteResult> {
    return this.deleter.deleteRevision(designId, revisionId, organizationId, token);
  }

  @Post('uploads/:uploadId/reparse')
  @ApiOperation({ summary: 'Read the stored files of a revision again' })
  async reparseUpload(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<{ jobId: string }> {
    return this.reparse.execute({ uploadId, organizationId, userId: user.id, token });
  }

  @Get('designs/:designId')
  @ApiOperation({ summary: 'One design with its revisions and their upload status' })
  async getDesign(@Param('designId', ParseUUIDPipe) designId: string, @AccessToken() token: string): Promise<DesignView> {
    return this.designs.get(designId, token);
  }

  @Get('designs/:designId/revisions')
  @ApiOperation({ summary: 'Every revision of a design, with the input hash that identifies its files' })
  async revisions(@Param('designId', ParseUUIDPipe) designId: string, @AccessToken() token: string): Promise<RevisionRow[]> {
    await this.repository.getDesign(designId, token);
    return this.repository.listRevisions(designId, token);
  }

  @Get('reference-coverage')
  @ApiOperation({ summary: 'For every planned engine: which inputs are sourced, pending confirmation, or a written gap' })
  async coverage(): Promise<ReferenceCoverageView> {
    return this.referenceCoverage.execute();
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Status of a parse or quote job' })
  async job(@Param('jobId', ParseUUIDPipe) jobId: string, @AccessToken() token: string): Promise<JobStatusView> {
    return this.jobStatus.execute(jobId, token);
  }

  @Get('uploads/:uploadId/scenario-options')
  @ApiOperation({ summary: 'The assembly steps a scenario can price for this board, whether each applies, and the inputs each reads' })
  async scenarioOptions(@Param('uploadId', ParseUUIDPipe) uploadId: string, @AccessToken() token: string): Promise<ScenarioOptions | null> {
    const graph = await this.repository.getLatestFeatureGraph(uploadId, token);
    if (!graph || graph.graph.kind !== 'board') return null;
    return scenarioOptions(graph.graph, PLANNED_ENGINES);
  }

  @Get('uploads/:uploadId/latest-result')
  @ApiOperation({ summary: 'The most recent cost result of an upload (with the scenario it was priced with), or null' })
  async latestResult(@Param('uploadId', ParseUUIDPipe) uploadId: string, @AccessToken() token: string): Promise<CostResultView | null> {
    const row = await this.repository.getLatestCostResult(uploadId, token);
    return row ? toCostResultView(row) : null;
  }

  @Get('results/:resultId')
  @ApiOperation({ summary: 'A versioned cost result with its full trace' })
  async result(@Param('resultId', ParseUUIDPipe) resultId: string, @AccessToken() token: string): Promise<CostResultView> {
    return toCostResultView(await this.repository.getCostResult(resultId, token));
  }
}
