import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../../common/guards/organization-context.guard';
import { OrgRole } from '../../../common/authz/authz-policy';
import { SpendsAi } from '../../../common/throttling/throttlers';
import type { AiCaller } from '../../../common/ai/ai-budget.service';
import { VaveBomAnalysisDto } from './vave-ai.dto';
import { VaveAiService, type CostAnalysisResult } from './vave-ai.service';
import type { ShouldCostResult, VaveIdeaDraft } from './vave-ai.results';

/**
 * VAVE AI analyses. Each spends the caller's AI budget (429 when it is used up, 503 when AI is off) and is charged to the
 * organization the request acts for. Nothing is saved here: the UI saves what the user keeps through the VAVE endpoints.
 */
@ApiTags('VAVE')
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: '', version: '1' })
@UseGuards(OrganizationContextGuard)
export class VaveAiController {
  constructor(private readonly vaveAi: VaveAiService) {}

  @Post('vave-projects/:id/ai/cost-analysis')
  @HttpCode(200)
  @SpendsAi()
  @ApiOperation({ summary: 'AI cost analysis (affinity groups, focus areas, QFD) of a VAVE project BOM, with its Pareto' })
  costAnalysis(
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<CostAnalysisResult> {
    return this.vaveAi.costAnalysis(projectId, caller(user, organizationId, token));
  }

  @Post('vave-projects/:id/ai/ideation')
  @HttpCode(200)
  @SpendsAi()
  @ApiOperation({ summary: 'AI VAVE ideas for a project, from its BOM and should-cost gaps (not saved)' })
  ideation(
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<VaveIdeaDraft[]> {
    return this.vaveAi.ideation(projectId, caller(user, organizationId, token));
  }

  @Post('vave-projects/:id/should-cost-estimates/:itemId')
  @HttpCode(200)
  @SpendsAi()
  @ApiOperation({ summary: 'AI should-cost estimate of one VAVE BOM item (not saved)' })
  shouldCost(
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<ShouldCostResult> {
    return this.vaveAi.shouldCost(projectId, itemId, caller(user, organizationId, token));
  }

  @Post('vave-bom-analyses')
  @HttpCode(200)
  @SpendsAi()
  @ApiOperation({ summary: 'AI VAVE insights for one benchmark BOM, from its structured metrics' })
  bomAnalysis(
    @Body() dto: VaveBomAnalysisDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<Record<string, unknown>> {
    return this.vaveAi.bomAnalysis(dto, caller(user, organizationId, token));
  }
}

const caller = (user: { id: string }, organizationId: string, accessToken: string): AiCaller => ({ userId: user.id, organizationId, accessToken });
