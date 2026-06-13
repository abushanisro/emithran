import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProposedMasterApprovalDto {
  @IsString()
  proposedMasterId!: string;

  @IsBoolean()
  approved!: boolean;
}

export class LineOverrideDto {
  @IsString()
  @IsIn(['raw_material', 'process', 'tooling', 'logistics', 'procured_part'])
  kind!: 'raw_material' | 'process' | 'tooling' | 'logistics' | 'procured_part';

  @IsInt()
  @Min(0)
  index!: number;

  @IsObject()
  data!: Record<string, any>;
}

export class LineRemovalDto {
  @IsString()
  @IsIn(['raw_material', 'process', 'tooling', 'logistics', 'procured_part'])
  kind!: 'raw_material' | 'process' | 'tooling' | 'logistics' | 'procured_part';

  @IsInt()
  @Min(0)
  index!: number;
}

export class ApplyRequestDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedMasterApprovalDto)
  proposedMasterApprovals?: ProposedMasterApprovalDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineOverrideDto)
  overrides?: LineOverrideDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineRemovalDto)
  removals?: LineRemovalDto[];
}

export class ApplyResultDto {
  appliedLineIds!: {
    rawMaterials: string[];
    processes: string[];
    tooling: string[];
    logistics: string[];
    procuredParts: string[];
    newRawMaterialMasters: string[];
    newProcessMasters: string[];
  };
  creditCost!: number;
  totalCost!: number;
}

export class CreateLineEditDto {
  @IsString()
  @IsIn(['raw_material', 'process', 'tooling', 'logistics', 'procured_part'])
  lineKind!: 'raw_material' | 'process' | 'tooling' | 'logistics' | 'procured_part';

  @IsInt()
  @Min(0)
  lineIndex!: number;

  @IsString()
  fieldPath!: string;

  @IsOptional()
  originalValue?: unknown;

  @IsOptional()
  newValue?: unknown;

  @IsOptional()
  @IsString()
  @IsIn(['field_change', 'added_line', 'removed_line'])
  editAction?: 'field_change' | 'added_line' | 'removed_line';

  @IsOptional()
  @IsString()
  editReason?: string;
}

export class GenerateRequestDto {
  // Currently no inputs other than the URL :bomItemId param,
  // but kept as a DTO for future option flags (e.g., forceRefresh, dryRun).
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
