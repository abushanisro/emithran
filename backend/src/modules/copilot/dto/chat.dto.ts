import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Body limits live here so the controller and the service share one set of numbers. */
export const COPILOT_MAX_MESSAGES = 8;
export const COPILOT_MAX_USER_CHARS = 2000;
/** Earlier answers are sent back as history and are much longer than a question. */
export const COPILOT_MAX_ASSISTANT_CHARS = 8000;
export const COPILOT_MAX_TURNS = 10_000;

/** Save or dismiss is the user's answer to a proposal shown in one conversation turn; the confirm call names both. */
export class ConfirmMemoryProposalDto {
  @IsUUID()
  conversationId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COPILOT_MAX_TURNS)
  turn: number;
}

export class DeleteMemoryItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  preference: string;
}

export class CopilotMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(COPILOT_MAX_ASSISTANT_CHARS)
  content: string;
}

/**
 * Identity, URLs and tokens are never accepted from the body: the user comes
 * from the verified JWT and every data read goes through that user's own
 * user's database client (RLS). batchSize / location / productionLifeYears are the
 * values the UI is currently showing, passed straight to the same costing
 * resolver the cost-summary endpoint uses (an absent batchSize is resolved
 * there, never defaulted here).
 */
export class CopilotChatDto {
  @IsUUID()
  bomItemId: string;

  /** The panel's conversation (a UUID it makes when the conversation starts). A memory proposal is bound to it. */
  @IsUUID()
  conversationId: string;

  /** Which user message of the conversation this is, from 1. A memory proposal is bound to it. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COPILOT_MAX_TURNS)
  turn: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  location: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  batchSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  productionLifeYears?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(COPILOT_MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => CopilotMessageDto)
  messages: CopilotMessageDto[];
}
