import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { OrgRole } from '../../common/authz/authz-policy';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { type PullAxis } from './costing/plastic-molding/override/pull-direction';
import { BomItemReanalysisService } from './services/bom-item-reanalysis.service';
import { PlasticPullDirectionService } from './services/plastic-pull-direction.service';

export class SetPullDirectionDto {
  @ApiProperty({ enum: ['x', 'y', 'z'], description: 'The axis along which the mold opens. To return to the automatic choice, remove the pull direction.' })
  @IsIn(['x', 'y', 'z'])
  axis!: PullAxis;

  @ApiProperty({ minLength: 3, maxLength: 500, description: 'Why the engineer overrides the automatic choice. Required, and kept in the audit trail.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * The engineer's pull (mold-opening) axis of a plastic part. Without one the CAD engine chooses it. Setting or removing it analyses the part again
 * along the new choice (the stored analysis is what recognition and costing read) and is recorded in the audit trail with the reason.
 */
@ApiTags('Plastic molding')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'bom-items/:id/pull-direction', version: '1' })
export class BomItemPullDirectionController {
  constructor(
    private readonly pullDirections: PlasticPullDirectionService,
    private readonly reanalysis: BomItemReanalysisService,
  ) {}

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: "The part's pull direction: the engineer's axis with the reason, who and when, or none (the engine chooses)." })
  async get(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return this.pullDirections.get(id, token);
  }

  @Put()
  @ApiOperation({ summary: 'Fix the pull axis of the part (with the reason) and analyse it again along it. Audited.' })
  async set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPullDirectionDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    const pullDirection = await this.pullDirections.set({ bomItemId: id, userId: user.id, organizationId, token }, body.axis, body.reason);
    await this.reanalysis.reanalyze(id, user.id, token);
    return { pullDirection };
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Return the part to the automatic pull direction and analyse it again. Audited.' })
  async clear(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    const pullDirection = await this.pullDirections.clear({ bomItemId: id, userId: user.id, organizationId, token });
    await this.reanalysis.reanalyze(id, user.id, token);
    return { pullDirection };
  }
}
