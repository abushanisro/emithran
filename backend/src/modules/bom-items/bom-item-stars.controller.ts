import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OrgRole } from '../../common/authz/authz-policy';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { BomItemStarDto, BomItemStarsDto, BomItemStarsQueryDto } from './dto/bom-item-stars.dto';
import { BomItemStarsService } from './services/bom-item-stars.service';

/**
 * Starred BOM items, each person's own (as Gmail's stars). A star changes nothing in the BOM, so anyone who can view the BOM may star its
 * items; row-level security keeps every star to the person who set it.
 */
@ApiTags('BOM Items')
@ApiBearerAuth()
@OrgRole('viewer')
@Controller({ path: 'bom-item-stars', version: '1' })
export class BomItemStarsController {
  constructor(private readonly stars: BomItemStarsService) {}

  @Get()
  @ApiOperation({ summary: 'The items of a BOM the caller starred.' })
  @ApiResponse({ status: 200, type: BomItemStarsDto })
  async list(@Query() query: BomItemStarsQueryDto, @AccessToken() token: string): Promise<BomItemStarsDto> {
    return { bomItemIds: await this.stars.list(query.bomId, token) };
  }

  @Put(':bomItemId')
  @ApiOperation({ summary: 'Star a BOM item for the caller (starring a starred item changes nothing).' })
  @ApiResponse({ status: 200, type: BomItemStarDto })
  @ApiResponse({ status: 404, description: 'No such item, or not one the caller can see.' })
  async star(@Param('bomItemId', ParseUUIDPipe) bomItemId: string, @AccessToken() token: string): Promise<BomItemStarDto> {
    await this.stars.star(bomItemId, token);
    return { bomItemId, starred: true };
  }

  @Delete(':bomItemId')
  @HttpCode(200)
  @ApiOperation({ summary: "Remove the caller's star from a BOM item (an item without one changes nothing)." })
  @ApiResponse({ status: 200, type: BomItemStarDto })
  async unstar(@Param('bomItemId', ParseUUIDPipe) bomItemId: string, @AccessToken() token: string): Promise<BomItemStarDto> {
    await this.stars.unstar(bomItemId, token);
    return { bomItemId, starred: false };
  }
}
