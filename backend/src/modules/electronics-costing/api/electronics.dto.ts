import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class StartUploadDto {
  // Optional: the files say what they are (a board file set, or a feature graph that states its kind).
  @IsOptional()
  @IsIn(['board', 'harness'])
  kind?: 'board' | 'harness';

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'])
  tier?: 'A' | 'B' | 'C' | 'D';

  // Add a revision to an existing design. Omitted: a new design is created.
  @IsOptional()
  @IsUUID()
  designId?: string;

  // Project a new design belongs to. Ignored when designId is given.
  @IsOptional()
  @IsUUID()
  projectId?: string;

  // Place a new design (or a whole uploaded folder) under this assembly or sub-assembly.
  @IsOptional()
  @IsUUID()
  parentDesignId?: string;

  // JSON array, one relative path per file (the browser's folder path), so a folder keeps its structure.
  @IsOptional()
  @IsString()
  @MaxLength(60000)
  paths?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  designName?: string;

  // Revision label (for example "A" or "REV-B"). Defaults to the next number for the design.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  revision?: string;

  // JSON: facts a person or document supplies, e.g. {"outline.thicknessMm":{"value":1.6,"note":"requirements document"}}.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supplied?: string;
}

export class RequestQuoteDto {
  @IsUUID()
  uploadId: string;

  // Required and explicit: the result is a function of the batch size, so it is never defaulted.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  batchSize: number;

  // Location, the HR Rates machine per step and the stated inputs; validated by the use case (validateScenario).
  @IsOptional()
  @IsObject()
  scenario?: Record<string, unknown>;
}

export class CreateContainerDto {
  @IsIn(['assembly', 'sub_assembly'])
  itemType: 'assembly' | 'sub_assembly';

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  // Required for an assembly; a sub-assembly takes its project from its parent.
  @IsOptional()
  @IsUUID()
  projectId?: string;

  // Required for a sub-assembly.
  @IsOptional()
  @IsUUID()
  parentDesignId?: string;
}

export class ListDesignsDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
