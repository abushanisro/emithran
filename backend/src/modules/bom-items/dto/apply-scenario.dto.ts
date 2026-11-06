import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';

import { LOCATION_INFO } from '../costing/shared/core/default-rates.constants';
import { ApplyCustomRouteStepDto, VALID_ROUTE_IDS } from './apply-route.dto';

const SUPPORTED_LOCATIONS = Object.keys(LOCATION_INFO);

/** How the scenario's route is applied. */
export const SCENARIO_ROUTE_MODES = ['auto', 'keep', 'route', 'custom'] as const;
export type ScenarioRouteMode = (typeof SCENARIO_ROUTE_MODES)[number];

export class ScenarioRouteDto {
  @ApiProperty({
    enum: SCENARIO_ROUTE_MODES,
    description:
      "auto: the engine's recommendation. keep: the route already applied (the engine's recommendation when there is none). route: a chosen route (routeId). custom: a Workflow Builder route (baseCuttingRouteId and steps).",
  })
  @IsIn([...SCENARIO_ROUTE_MODES])
  mode!: ScenarioRouteMode;

  @ApiPropertyOptional({ description: "mode 'route': the chosen route's id" })
  @ValidateIf((o: ScenarioRouteDto) => o.mode === 'route')
  @IsString()
  @IsIn(VALID_ROUTE_IDS)
  routeId?: string;

  @ApiPropertyOptional({ description: "mode 'custom': the engine-computed cutting route the Workflow Builder route is based on" })
  @ValidateIf((o: ScenarioRouteDto) => o.mode === 'custom')
  @IsString()
  baseCuttingRouteId?: string;

  @ApiPropertyOptional({ type: [ApplyCustomRouteStepDto], description: "mode 'custom': the steps, in order" })
  @ValidateIf((o: ScenarioRouteDto) => o.mode === 'custom')
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApplyCustomRouteStepDto)
  steps?: ApplyCustomRouteStepDto[];
}

export class ScenarioMachineOverrideDto {
  @IsString()
  processKey!: string;

  @ApiPropertyOptional({ description: 'The machine to force for that process line; null clears the override' })
  @IsOptional()
  @IsString()
  mhrRecordId?: string | null;
}

/**
 * The scenario the engineer staged, to be applied as one operation: the analysis is made current, the scenario fields are written, the material cost
 * record and the route are computed from the engine's own results and written, and the outcome is stored on the item (scenario_overrides.appliedScenario).
 */
export class ApplyScenarioDto {
  @ApiProperty({ description: 'The Digital Factory. Required: an apply prices and persists against it.' })
  @IsString()
  @IsIn(SUPPORTED_LOCATIONS)
  location!: string;

  @ApiPropertyOptional({
    description: 'The revision of the applied scenario the caller read. When another apply has moved it since, the request is refused (409 scenario_revision_conflict). Omitted: not checked.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @ApiPropertyOptional({ nullable: true, description: 'A number fixes the batch size; null returns it to the one derived from the annual volume; omitted leaves it as it is.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Type(() => Number)
  batchSize?: number | null;

  @ApiPropertyOptional({ description: 'Written to the item before the batch size is resolved from it.' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  annualVolume?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  @Type(() => Number)
  productionLifeYears?: number;

  @ApiPropertyOptional({ description: 'The material grade to cost. Its Raw Material cost record is made (or kept when still right) from the engine\'s results.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  materialGrade?: string;

  @ApiPropertyOptional({ description: 'Other scenario keys to merge in one step (processRouting, dieCastingProcess, currency and ask price...). appliedScenario is reserved.' })
  @IsOptional()
  @IsObject()
  scenarioPatch?: Record<string, unknown>;

  @ApiProperty({ type: ScenarioRouteDto })
  @ValidateNested()
  @Type(() => ScenarioRouteDto)
  route!: ScenarioRouteDto;

  @ApiPropertyOptional({ type: [ScenarioMachineOverrideDto], description: 'Machines picked in the Workflow Builder, saved after the route is written.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScenarioMachineOverrideDto)
  machineOverrides?: ScenarioMachineOverrideDto[];
}

/** The state stored on the item and returned by an apply: the one canonical record of the applied scenario. */
export interface AppliedScenarioState {
  /** Successful applies so far. */
  revision: number;
  status: 'applying' | 'applied' | 'failed';
  startedAt?: string;
  appliedAt?: string;
  failedAt?: string;
  error?: string;
  /** The feature-graph version the analysis behind this apply was at. */
  analysisVersion?: number;
}

export interface ScenarioApplicationResult {
  scenario: AppliedScenarioState;
  analysis: { ran: string[] };
  material: { grade: string; action: 'kept' | 'replaced'; recordId: string | null } | null;
  /** The mold (and die) the engine priced, written as tooling items. */
  tooling: { action: 'kept' | 'replaced' | 'none'; items: string[] };
  route: { mode: ScenarioRouteMode; routeId: string | null; routeLabel: string; created: number; operations: string[] };
  machineOverrides: { saved: number; failed: Array<{ processKey: string; message: string }> };
  warnings: string[];
}
