interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeysService } from '../services/api-keys.service';
import { CreateApiKeyDto, ApiKeyResponseDto } from '../dto/api-key.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';

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
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new API key — raw key returned only once' })
  @ApiResponse({ status: 201, description: 'API key created. The rawKey field is returned only in this response.' })
  async create(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ApiKeyResponseDto> {
    return this.apiKeysService.create(dto, user.id, token);
  }

  @Delete(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 204, description: 'API key revoked' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.apiKeysService.revoke(id, user.id, token);
  }
}
