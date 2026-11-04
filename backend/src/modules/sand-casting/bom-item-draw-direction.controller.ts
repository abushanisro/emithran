import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

import { AccessToken } from "../../common/decorators/access-token.decorator";
import { CurrentOrganization } from "../../common/decorators/current-organization.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { OrganizationContextGuard } from "../../common/guards/organization-context.guard";
import { OrgRole } from "../../common/authz/authz-policy";
import { type DrawAxis } from "./casting-analysis.types";
import { analysisListView } from "./casting-view";
import { SandCastingService } from "./sand-casting.service";

export class SetDrawDirectionDto {
  @ApiProperty({
    enum: ["x", "y", "z"],
    description:
      "The axis along which the mould opens. To return to the automatic choice, remove the draw direction.",
  })
  @IsIn(["x", "y", "z"])
  axis!: DrawAxis;

  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    description:
      "Why the engineer overrides the automatic choice. Required, and kept in the audit trail.",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * The engineer's draw direction of a sand-cast part. Without one the casting worker chooses the axis itself. Setting or removing it asks for
 * the analysis along the new choice (the other analyses of the part are kept) and is recorded in the audit trail with the reason.
 */
@ApiTags("Casting analyses")
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole("member")
@Controller({ path: "bom-items/:id/draw-direction", version: "1" })
export class BomItemDrawDirectionController {
  constructor(private readonly casting: SandCastingService) {}

  @OrgRole("viewer")
  @Get()
  @ApiOperation({
    summary:
      "The part's draw direction: the engineer's axis with the reason, who and when, or none (the worker chooses).",
  })
  async get(@Param("id", ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return this.casting.drawDirection(id, token);
  }

  @Put()
  @ApiOperation({
    summary:
      "Fix the draw axis of the part (with the reason) and ask for the casting analysis along it. Audited.",
  })
  async set(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetDrawDirectionDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ) {
    const { drawDirection, analysis, reused } = await this.casting.setDrawDirection(
      { bomItemId: id, userId: user.id, organizationId, token },
      body.axis,
      body.reason,
    );
    return { drawDirection, analysis: { ...analysisListView(analysis), reused } };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Return the part to the automatic draw direction (and ask for that analysis). Audited.",
  })
  async clear(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
  ): Promise<void> {
    await this.casting.clearDrawDirection({
      bomItemId: id,
      userId: user.id,
      organizationId,
      token,
    });
  }
}
