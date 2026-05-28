import { IsString, IsOptional, IsArray, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the API key', example: 'Production Integration' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'Permission scopes', example: ['read', 'write'] })
  @IsArray()
  @IsOptional()
  scopes?: string[];
}

export class ApiKeyResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() keyPrefix: string;
  @ApiProperty() scopes: string[];
  @ApiPropertyOptional() lastUsedAt: string | null;
  @ApiPropertyOptional() expiresAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiPropertyOptional() rawKey?: string;
}
