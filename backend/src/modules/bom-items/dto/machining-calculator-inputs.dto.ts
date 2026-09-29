import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class MachiningCalculatorInputsRequestDto {
  @ApiProperty({ description: 'The machining calculator (calculators.id) to resolve inputs for' })
  @IsUUID()
  calculatorId!: string;

  @ApiPropertyOptional({
    description: 'Key inputs the engineer entered (e.g. {"Hole Diameter": 6}); they replace the part CAD values when choosing lookup rows',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  @IsOptional()
  @IsObject()
  keys?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Digital factory location — when given, the part is costed and the calculator gets the inputs the engine used' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Batch size for that costing (the canonical resolver applies when absent)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  batchSize?: number;
}

export interface MachiningCalculatorInputsDto {
  calculatorId: string;
  /** Catalog operation the calculator is mapped to ("Drilling", "Parting", ...). */
  operation: string;
  materialClass: string;
  /** Input field name → value (CAD measurement, entered key, or lookup-table value). */
  inputs: Record<string, number>;
  /** Input field name → where the value came from. */
  provenance: Record<string, string>;
  /** Input field name → the lookup-table row(s) the value came from. */
  lookupMatches: Record<string, { table: string; row: Record<string, string | number> }>;
  /** Inputs that could not be resolved, each with the reason. */
  missing: string[];
}
