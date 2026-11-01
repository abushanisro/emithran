import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { API_KEY_DEFAULT_DAYS, API_KEY_MAX_DAYS, API_KEY_SCOPES, type ApiKeyScope } from '../../../common/api-keys/api-key-scopes';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the API key', example: 'ERP integration' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'What the key may do', enum: API_KEY_SCOPES, isArray: true, example: ['projects:read'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes: ApiKeyScope[];

  @ApiPropertyOptional({ description: `Days until the key expires (1-${API_KEY_MAX_DAYS})`, default: API_KEY_DEFAULT_DAYS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(API_KEY_MAX_DAYS)
  expiresInDays?: number;
}

export class ApiKeyResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() keyPrefix: string;
  @ApiProperty() scopes: string[];
  @ApiProperty() organizationId: string;
  @ApiPropertyOptional() lastUsedAt: string | null;
  @ApiProperty() expiresAt: string;
  @ApiProperty() createdAt: string;
  @ApiPropertyOptional({ description: 'The key itself: returned once, at creation, and never stored' }) rawKey?: string;
}
