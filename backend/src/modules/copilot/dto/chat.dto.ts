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
