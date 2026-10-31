interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeysService } from '../services/api-keys.service';
import { CreateApiKeyDto, ApiKeyResponseDto } from '../dto/api-key.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../../common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '../../../common/guards/organization-context.guard';

// No @ApiKeyScopes here on purpose: managing keys needs a person signed in, so an API key cannot issue or revoke keys.
@ApiTags('Developer - API Keys')
@ApiBearerAuth()
@Controller({ path: 'api/developer/api-keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List all active API keys for the authenticated user' })
  @ApiResponse({ status: 200, description: 'API keys retrieved' })
  async findAll(@CurrentUser() user: User, @AccessToken() token: string): Promise<ApiKeyResponseDto[]> {
    return this.apiKeysService.findAll(user.id, token);
  }

  @Post()
  @UseGuards(OrganizationContextGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an API key for your organization; the raw key is returned only once' })
  @ApiResponse({ status: 201, description: 'API key created. The rawKey field is returned only in this response.' })
  @ApiResponse({ status: 403, description: 'The account belongs to more than one organization' })
  async create(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: User,
    @CurrentOrganization() organizationId: string,
    @AccessToken() token: string,
  ): Promise<ApiKeyResponseDto> {
    return this.apiKeysService.create(dto, user.id, organizationId, token);
  }

  @Delete(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 204, description: 'API key revoked' })
  @ApiResponse({ status: 404, description: 'No active key with this id' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.apiKeysService.revoke(id, user.id, token);
  }
}
