import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength } from "class-validator";
import type { Response } from "express";

import { AccessToken } from "../../common/decorators/access-token.decorator";
import { CurrentOrganization } from "../../common/decorators/current-organization.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { OrganizationContextGuard } from "../../common/guards/organization-context.guard";
import { OrgRole } from "../../common/authz/authz-policy";
import { analysisListView, analysisView } from "./casting-view";
import { SandCastingService } from "./sand-casting.service";

export class RequestCastingAnalysisDto {
  @ApiProperty({
    format: "uuid",
    description: "The BOM item whose 3D file is to be analysed.",
  })
  @IsUUID()
  bomItemId!: string;
}

export class CastingMeshQuery {
  @ApiProperty({ description: "A 3D file the analysis's result lists, e.g. parts/0-1-1-1.glb (its part mesh) or parts/0-1-1-1-cores.glb (its cores)." })
  @IsString()
  @MaxLength(255)
  name!: string;
}

export class CastingAnalysesQuery {
  @ApiProperty({ format: "uuid", description: "The BOM item whose analyses are listed." })
  @IsUUID()
  bomItemId!: string;
}

@ApiTags("Casting analyses")
@UseGuards(OrganizationContextGuard)
@ApiBearerAuth()
@OrgRole("member")
@Controller({ path: "casting-analyses", version: "1" })
export class SandCastingController {
  constructor(private readonly casting: SandCastingService) {}

  @Post()
  @ApiOperation({
    summary:
      "Ask for the casting analysis of a BOM item's 3D file. It runs in the background; an identical request returns the existing analysis (200), a new one answers 201.",
  })
  async request(
    @Body() body: RequestCastingAnalysisDto,
    @CurrentUser() user: { id: string },
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { analysis, reused } = await this.casting.request({
      bomItemId: body.bomItemId,
      userId: user.id,
      organizationId,
      token,
    });
    res.status(reused ? 200 : 201);
    return { ...analysisView(analysis), reused };
  }

  @OrgRole("viewer")
  @Get()
  @ApiOperation({
    summary:
      "The casting analyses of a BOM item, newest first. An empty list means not requested, never passed.",
  })
  async list(@Query() query: CastingAnalysesQuery, @AccessToken() token: string) {
    return (await this.casting.listForItem(query.bomItemId, token)).map(analysisListView);
  }

  @OrgRole("viewer")
  @Get(":id/meshes")
  @ApiOperation({
    summary:
      "A short-lived signed URL for one 3D file of an analysis (its part mesh or its cores), for the viewer. Only a file the analysis's result lists.",
  })
  async mesh(@Param("id", ParseUUIDPipe) id: string, @Query() query: CastingMeshQuery, @AccessToken() token: string) {
    return this.casting.meshUrl(id, query.name, token);
  }

  @OrgRole("viewer")
  @Get(":id")
  @ApiOperation({
    summary:
      "One casting analysis: queued, running, succeeded or partial (with the result) or failed (with a code).",
  })
  async get(@Param("id", ParseUUIDPipe) id: string, @AccessToken() token: string) {
    return analysisView(await this.casting.get(id, token));
  }
}
