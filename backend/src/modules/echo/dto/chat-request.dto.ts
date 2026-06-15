import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { DomSnippetDto, PageContextDto } from './page-context.dto';

/**
 * Body of POST /api/echo/chat.
 *
 * If `conversationId` is omitted, the service creates a new conversation
 * keyed to the current user.
 */
export class ChatRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ example: 'Why is this part expensive?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiProperty({ type: () => PageContextDto })
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext!: PageContextDto;

  @ApiPropertyOptional({ type: () => DomSnippetDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DomSnippetDto)
  domSnippet?: DomSnippetDto;

  /**
   * Whether to force the deep model (Sonnet) instead of Haiku. The skill
   * router can also escalate automatically; this flag lets the user opt in.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deep?: boolean;
}
