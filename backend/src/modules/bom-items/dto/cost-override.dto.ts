import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// 'mat_rate' | '<process>::rate' | '<process>::cycleMin' — process names come
// from ProcessLineCost.process (e.g. 'Laser Cutting'), validated against the
// live process lines server-side rather than an enum here since process names
// are family-dependent (sheet metal vs CNC milled vs CNC turned).
export class CostOverrideDto {
  @IsString()
  fieldKey!: string;

  // Omitted or null clears the override, reverting to the computed value.
  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number | null;

  @IsOptional()
  @IsString()
  location?: string;
}
