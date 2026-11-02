import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** At most this many BOM items go into one benchmark VAVE analysis. */
export const MAX_VAVE_ANALYSIS_ITEMS = 50;
const TEXT = 200;

export class VaveAnalysisItemDto {
  @IsOptional() @IsString() @MaxLength(TEXT) name?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) partNumber?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) material?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() unitCost?: number;
  @IsOptional() @IsNumber() totalCost?: number;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsString() @MaxLength(TEXT) makeBuy?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) supplier?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) manufacturingProcess?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) toleranceGrade?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) surfaceFinish?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) heatTreatment?: string;
}

export class VaveMakeVsBuyDto {
  @IsOptional() @IsNumber() make?: number;
  @IsOptional() @IsNumber() buy?: number;
}

/**
 * Structured metrics of one benchmark BOM. Unknown fields are stripped by the global ValidationPipe (whitelist), every string is
 * bounded, and the server builds the prompt from what is left: the endpoint is not a general-purpose proxy to the model.
 */
export class VaveBomAnalysisDto {
  @IsOptional() @IsString() @MaxLength(TEXT) bomName?: string;
  @IsOptional() @IsNumber() totalParts?: number;
  @IsOptional() @IsNumber() totalCost?: number;
  @IsOptional() @IsNumber() totalWeight?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => VaveMakeVsBuyDto)
  makeVsBuy?: VaveMakeVsBuyDto;

  @IsArray()
  @ArrayMaxSize(MAX_VAVE_ANALYSIS_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => VaveAnalysisItemDto)
  items: VaveAnalysisItemDto[];
}
