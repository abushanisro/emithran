import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestAuthGuard } from '../../../common/guards/request-auth.guard';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { OrgRole } from '../../../common/authz/authz-policy';
import { ToolingCatalogService } from '../services/tooling-catalog.service';

/**
 * The tooling items a domain's staged reference data prices (mold components, die components, coreboxes, tool steel,
 * cutting tools), for the Add Tooling dialog: picking one fills its name and unit cost, with the source table and row.
 * Reference data only, the same for every organization.
 */
@ApiTags('Tooling Costs')
@ApiBearerAuth()
@OrgRole('viewer')
@Controller({ path: 'tooling-catalogs', version: '1' })
@UseGuards(RequestAuthGuard)
export class ToolingCatalogController {
  constructor(private readonly catalogs: ToolingCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'The domains that have a tooling catalog' })
  list() {
    return this.catalogs.domains();
  }

  @Get(':domain')
  @ApiOperation({ summary: 'The priced tooling items of one domain, from its staged reference data' })
  findOne(@Param('domain') domain: string, @AccessToken() accessToken: string) {
    return this.catalogs.catalog(domain, accessToken);
  }
}
