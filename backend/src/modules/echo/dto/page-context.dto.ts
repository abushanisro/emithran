import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Where the user currently is + which entity they are looking at.
 *
 * `route` is the Next.js pathname (e.g. `/projects/abc/bom/123`). Echo uses it
 * to pick a Skill. `entityType` + `entityId` let the backend hydrate a fresh
 * snapshot (cost breakdown, DFM status, RFQ state, ...) via the EntityHydrator.
 *
 * `breadcrumbs` is purely advisory — used in the prompt to help the model
 * narrate where the user is. Never persisted as authoritative state.
 */
export class PageContextDto {
  @ApiProperty({ example: '/projects/abc-123/bom/item-456' })
  @IsString()
  @MaxLength(280)
  route!: string;

  @ApiPropertyOptional({
    example: 'bom_item',
    description:
      "One of: 'project' | 'bom' | 'bom_item' | 'rfq' | 'lot' | 'vendor' | 'process_plan'",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  breadcrumbs?: string[];
}

/**
 * Opt-in slice of visible page text the user explicitly chose to attach.
 * Capped at 2 000 characters to bound prompt size.
 */
export class DomSnippetDto {
  @ApiProperty({ description: 'Plain text extracted from [data-echo-context] containers' })
  @IsString()
  @MaxLength(2000)
  text!: string;
}
