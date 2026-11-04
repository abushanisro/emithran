import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { OrgRole } from '../../common/authz/authz-policy';
import { SandVariableOverridesService } from './costing/casting/sand/sand-variable-overrides.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SetSandVariableOverrideDto {
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'The part\'s own value: a number for a numeric plant variable, text for an enum.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;

  @ApiProperty({ minLength: 3, maxLength: 500, description: 'Why this part differs from the plant value. Required, and kept in the audit trail.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

const VARIABLE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

/**
 * A sand-cast part's own values for plant variables. The costing uses them for this part only and shows the plant value beside them;
 * removing one returns the part to the plant value. Setting or removing is audited with the reason.
 */
@ApiTags('Sand casting')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'bom-items/:id/sand-variable-overrides', version: '1' })
export class SandVariableOverridesController {
  constructor(private readonly overrides: SandVariableOverridesService) {}

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'The part\'s own sand-casting variable values, each with the plant value, the reason, who and when.' })
  async list(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return { overrides: await this.overrides.list(id, token) };
  }

  @Put(':variable')
  @ApiOperation({ summary: 'Set one plant variable for this part (with the reason). The cost is recalculated with it. Audited.' })
  async set(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variable') variable: string,
    @Body() body: SetSandVariableOverrideDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    assertVariable(variable);
    return { overrides: await this.overrides.set({ bomItemId: id, userId: user.id, organizationId, token }, variable, body.value, body.reason) };
  }

  @Delete(':variable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return one variable to the plant value for this part. Audited.' })
  async clear(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variable') variable: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    assertVariable(variable);
    return { overrides: await this.overrides.clear({ bomItemId: id, userId: user.id, organizationId, token }, variable) };
  }
}

function assertVariable(variable: string): void {
  if (!VARIABLE.test(variable)) throw new BadRequestException('invalid variable name');
}
