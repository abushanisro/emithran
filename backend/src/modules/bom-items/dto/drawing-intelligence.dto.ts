import { Type } from 'class-transformer';
import {
  IsString, IsNumber, IsArray, IsOptional, ValidateNested, Min, Max,
} from 'class-validator';

// Mirrors cad-engine/drawing_analyzer.py's real POST /drawing/analyze response
// (PyMuPDF text-block extraction — vector PDFs only, never OCR/image drawings).
// Stored as-is (validated, not reshaped) into bom_items.drawing_intelligence —
// the parser is treated as the authoritative source; this DTO's job is to
// reject a malformed/unexpected response before it's ever persisted, not to
// translate its field names or invent structure it doesn't produce.
//
// gdt_callouts/clearanceHoles are typed as unknown[] deliberately: the Python
// analyzer hardcodes both to [] today (no real GD&T/clearance-hole extraction
// exists yet, only the placeholder fields) — giving them a detailed nested
// shape now would describe data that doesn't exist.

export class ThreadCalloutDto {
  @IsString()
  size!: string;

  @IsOptional()
  @IsNumber()
  pitch?: number;

  @IsNumber()
  @Min(1)
  count!: number;

  @IsString()
  standard!: string; // 'metric' | 'imperial'

  @IsNumber()
  @Min(0)
  @Max(1)
  extractionConfidence!: number;

  @IsString()
  extractionSource!: string;
}

export class DrawingDimensionsDto {
  @IsNumber()
  L!: number;

  @IsNumber()
  W!: number;

  @IsNumber()
  H!: number;
}

export class DrawingIntelligenceDto {
  @IsString()
  material!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  material_confidence!: number;

  @IsString()
  process!: string;

  @ValidateNested()
  @Type(() => DrawingDimensionsDto)
  dimensions_mm!: DrawingDimensionsDto;

  @IsNumber()
  tightest_tolerance_mm!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  tolerance_confidence!: number;

  @IsNumber()
  surface_finish_ra!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  surface_finish_confidence!: number;

  @IsNumber()
  sheet_thickness_mm!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  sheet_thickness_confidence!: number;

  @IsNumber()
  bend_count!: number;

  @IsString()
  heat_treatment!: string;

  @IsString()
  coating!: string;

  @IsString()
  complexity!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreadCalloutDto)
  threads!: ThreadCalloutDto[];

  // Always [] today — see class-level comment.
  @IsArray()
  gdt_callouts!: unknown[];

  @IsArray()
  clearanceHoles!: unknown[];

  @IsString()
  general_tolerances!: string;

  @IsString()
  drawing_revision!: string;

  @IsString()
  drawing_number!: string;

  @IsString()
  drawing_notes!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  drawing_intelligence_confidence!: number;

  @IsString()
  analyzedAt!: string;

  // Added by the NestJS integration layer, not by the Python parser itself —
  // bumped whenever drawing-intelligence.dto.ts's shape changes, so a future
  // consumer can tell which parser-response shape a given stored row used.
  @IsString()
  parserVersion!: string;
}
