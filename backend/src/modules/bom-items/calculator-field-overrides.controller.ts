import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { OrgRole } from '../../common/authz/authz-policy';
import { CalculatorFieldOverridesService } from './services/calculator-field-overrides.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Which field of which stored calculator. */
export class CalculatorFieldRefDto {
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Injection Molding - Cycle Time' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  calculator!: string;

  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Cooling Time' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  field!: string;
}

export class SetCalculatorFieldOverrideDto extends CalculatorFieldRefDto {
  @ApiProperty({ description: 'The part\'s own value for the field, in the field\'s unit. Positive.' })
  @IsNumber()
  @IsPositive()
  value!: number;

  @ApiProperty({ minLength: 3, maxLength: 500, description: 'Why this part differs from the calculator. Required, and kept in the audit trail.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * A part's own values for fields of the stored calculators that compute its operations (an injection cycle's cooling time, a press dry cycle). The
 * costing uses them for this part only; the trace shows what the calculator would have used. Removing one returns the part to the calculator.
 * Setting or removing is audited with the reason.
 */
@ApiTags('Calculators')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'bom-items/:id/calculator-field-overrides', version: '1' })
export class CalculatorFieldOverridesController {
  constructor(private readonly overrides: CalculatorFieldOverridesService) {}

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'The part\'s own calculator field values, each with the reason, who and when.' })
  async list(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return { overrides: await this.overrides.list(id, token) };
  }

  @Put()
  @ApiOperation({ summary: 'Set one calculator field for this part (with the reason). The cost is recalculated with it. Audited.' })
  async set(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetCalculatorFieldOverrideDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    return { overrides: await this.overrides.set({ bomItemId: id, userId: user.id, organizationId, token }, body.calculator, body.field, body.value, body.reason) };
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Return one calculator field to the calculator for this part (?calculator=&field=). Audited.' })
  async clear(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() ref: CalculatorFieldRefDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    return { overrides: await this.overrides.clear({ bomItemId: id, userId: user.id, organizationId, token }, ref.calculator, ref.field) };
  }
}
