import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { OrgRole } from '../../common/authz/authz-policy';
import { BOMItemsService } from './bom-items.service';
import { SAND_CASTING_SOURCE_VERSION } from './costing/casting/sand/sand-reference';
import { SandSnapshotsService } from './costing/casting/sand/sand-snapshots.service';
import { SandVariableOverridesService } from './costing/casting/sand/sand-variable-overrides.service';
import { DatabaseService } from '../../common/database/database.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSandSnapshotDto {
  @ApiProperty({ minLength: 3, maxLength: 120, description: 'What this freeze is, for example the quote it supports.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  label!: string;

  @ApiProperty({ description: 'The digital factory location the cost is computed for.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  location!: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  batchSize?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  productionLifeYears?: number;
}

export class ReviewSandSnapshotDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiProperty({ minLength: 3, maxLength: 500, description: 'Why. Required, and kept in the audit trail.' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

/**
 * Frozen cost results of a sand-cast part. A member freezes the cost the server computes now (never one the browser supplies); a different member
 * approves or rejects it, once, with a note. Both are audited.
 */
@ApiTags('Sand casting')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'bom-items/:id/sand-snapshots', version: '1' })
export class SandSnapshotsController {
  constructor(
    private readonly snapshots: SandSnapshotsService,
    private readonly items: BOMItemsService,
    private readonly overrides: SandVariableOverridesService,
    private readonly database: DatabaseService,
  ) {}

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'The frozen cost results of the part, newest first, with their review.' })
  async list(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return { snapshots: await this.snapshots.list(id, token) };
  }

  @Post()
  @ApiOperation({ summary: 'Freeze the part\'s cost as the server computes it now, with what it was computed with. Audited.' })
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateSandSnapshotDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    if (!body.location) throw new BadRequestException('location is required');
    const summary = await this.items.getCostSummary(id, user.id, token, body.batchSize, body.location, body.productionLifeYears);
    const rows = await SandVariableOverridesService.rows(this.database.getUserClient(token), id);
    const snapshot = await this.snapshots.create(
      { bomItemId: id, userId: user.id, organizationId, token },
      body.label,
      JSON.parse(JSON.stringify(summary)) as Record<string, unknown>,
      {
        location: body.location,
        batchSize: summary.resolvedInputs.batchSize ?? null,
        productionLifeYears: body.productionLifeYears ?? null,
        plantOverrides: rows.map((r) => ({ variable: r.variable, value: r.value })),
        referenceSourceVersion: SAND_CASTING_SOURCE_VERSION,
      },
    );
    return { snapshot };
  }

}

/** The review of a frozen cost: its own resource, so it needs no BOM item in the path (the snapshot knows its item). */
@ApiTags('Sand casting')
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'sand-snapshots', version: '1' })
export class SandSnapshotReviewController {
  constructor(private readonly snapshots: SandSnapshotsService) {}

  @Post(':snapshotId/review')
  @ApiOperation({ summary: 'A different member approves or rejects a submitted snapshot, with a note, once. Audited.' })
  async review(
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Body() body: ReviewSandSnapshotDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    return { snapshot: await this.snapshots.review({ userId: user.id, organizationId, token }, snapshotId, body.decision, body.note) };
  }
}
