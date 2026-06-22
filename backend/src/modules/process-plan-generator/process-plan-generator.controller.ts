import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

import { OrchestratorService } from './services/orchestrator.service';
import { PersistenceService } from './services/persistence.service';
import {
  ApplyRequestDto,
  ApplyResultDto,
  CreateLineEditDto,
  GenerateRequestDto,
} from './dto/apply-request.dto';
import { GenerationResponse } from './dto/generation-response.dto';

interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

@ApiTags('Process Plan Generator')
@ApiBearerAuth()
@Controller({ path: 'api/process-plan-generator', version: '1' })
export class ProcessPlanGeneratorController {
  private readonly logger = new Logger(ProcessPlanGeneratorController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly persistence: PersistenceService,
  ) {}

  /**
   * POST /:bomItemId/generate
   *
   * Runs the full Stage 1 → 2 → 3 pipeline and returns a draft. Idempotent
   * within a short window: a second click with the same brief returns the
   * existing draft instead of running again.
   *
   * Long-running (~10–20 s typical). Frontend should also subscribe to the
   * SSE `/stream/:bomItemId` for live stage progress while this request is
   * outstanding.
   */
  @Post(':bomItemId/generate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Generate a process plan draft for a BOM item (AI)',
    description: 'Runs retrieval → reasoning → resolver and persists a draft. Returns the full GenerationResponse.',
  })
  @ApiResponse({ status: 200, description: 'Draft generated (or replayed from idempotency cache)' })
  async generate(
    @Param('bomItemId') bomItemId: string,
    @Body() body: GenerateRequestDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<GenerationResponse> {
    if (!bomItemId) throw new BadRequestException('bomItemId is required');
    if (!user?.id) throw new BadRequestException('User authentication required');

    this.logger.log(`Generate process plan: bomItemId=${bomItemId} userId=${user.id}`);
    return this.orchestrator.generate({
      bomItemId,
      userId: user.id,
      accessToken: token,
      forceRefresh: !!body?.forceRefresh,
      notes: body?.notes,
    });
  }

  /**
   * SSE stream of stage transitions for the most recent in-flight generation
   * on this BOM item. Emits `retrieval.done`, `reasoning.started`,
   * `reasoning.tool_call`, `resolver.done`, and `draft_ready` / `failed` /
   * `out_of_scope` events.
   */
  @Sse(':bomItemId/stream')
  @ApiOperation({ summary: 'Server-sent events for live generation progress' })
  stream(
    @Param('bomItemId') bomItemId: string,
    @CurrentUser() user: AuthUser,
  ): Observable<MessageEvent> {
    if (!bomItemId) throw new BadRequestException('bomItemId is required');
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.orchestrator.streamFor(bomItemId, user.id);
  }

  /**
   * GET /:bomItemId/draft
   *
   * Returns the latest draft_ready generation for a BOM item, or null.
   * Used by the frontend to reload an existing draft when navigating back.
   */
  @Get(':bomItemId/draft')
  @ApiOperation({ summary: 'Get the latest draft_ready generation for a BOM item (or null)' })
  async getLatestDraft(
    @Param('bomItemId') bomItemId: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<GenerationResponse | null> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.orchestrator.getLatestDraft(bomItemId, user.id, token);
  }

  /**
   * GET /generations/:id
   *
   * Replay endpoint — load a stored generation for the draft panel's
   * reasoning trail and per-line "candidates considered" drill-down.
   */
  @Get('generations/:id')
  @ApiOperation({ summary: 'Get a generation by id (replay / "why this?" view)' })
  async getGeneration(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<GenerationResponse> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    const gen = await this.orchestrator.getGeneration(id, user.id, token);
    if (!gen) throw new NotFoundException(`Generation ${id} not found`);
    return gen;
  }

  /**
   * POST /generations/:id/apply
   *
   * Commits the draft. The body carries optional per-line overrides, line
   * removals, and proposedMaster approval decisions. Runs inside a
   * transaction across the 5 cost-record tables (+ master writes if any
   * were approved). Charges credits.
   */
  @Post('generations/:id/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply a generated draft (transactional)' })
  @ApiResponse({ status: 200, description: 'Draft applied', type: ApplyResultDto })
  async applyGeneration(
    @Param('id') id: string,
    @Body() body: ApplyRequestDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<ApplyResultDto> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.persistence.apply(id, body, user.id, token);
  }

  /**
   * POST /generations/:id/discard
   *
   * Marks the draft as discarded. No credits charged. Frees the
   * idempotency-key window so a re-generate produces a fresh draft.
   */
  @Post('generations/:id/discard')
  @HttpCode(204)
  @ApiOperation({ summary: 'Discard a draft without applying' })
  async discardGeneration(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    await this.orchestrator.discard(id, user.id, token);
  }

  /**
   * POST /generations/:id/select-route
   *
   * Switches the active route within a draft that has alternatives. Updates
   * draft_lines.draftLines + costPreview to the selected alternative's values
   * so the existing apply() path always commits the currently selected route.
   */
  @Post('generations/:id/select-route')
  @HttpCode(200)
  @ApiOperation({ summary: 'Select an alternative route from a multi-route draft' })
  async selectRoute(
    @Param('id') id: string,
    @Body() body: { routeId: string },
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!body?.routeId) throw new BadRequestException('routeId is required');
    await this.persistence.selectRoute(id, body.routeId, user.id, token);
  }

  /**
   * POST /generations/:id/edits
   *
   * Captures a single user edit on a draft line. The frontend posts one of
   * these per field change as the user edits the draft. These rows are the
   * offline-eval dataset.
   */
  @Post('generations/:id/edits')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a user edit on a draft line (feedback capture)' })
  async recordEdit(
    @Param('id') id: string,
    @Body() body: CreateLineEditDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<{ id: string }> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.persistence.recordLineEdit(id, body, user.id, token);
  }
}
