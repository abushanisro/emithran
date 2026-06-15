import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  skill?: string;

  @ApiProperty()
  pinned!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class ConversationMessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system', 'tool'] })
  role!: 'user' | 'assistant' | 'system' | 'tool';

  @ApiProperty()
  content!: string;

  @ApiPropertyOptional()
  toolCalls?: unknown;

  @ApiPropertyOptional()
  skill?: string;

  @ApiPropertyOptional()
  pageRoute?: string;

  @ApiProperty()
  tokensIn!: number;

  @ApiProperty()
  tokensOut!: number;

  @ApiProperty()
  createdAt!: string;
}

export class ConversationDetailDto extends ConversationSummaryDto {
  @ApiProperty({ type: () => [ConversationMessageDto] })
  messages!: ConversationMessageDto[];
}
