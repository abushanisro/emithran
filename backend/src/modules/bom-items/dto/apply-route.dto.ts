import { IsString, IsOptional, IsInt, Min, IsIn, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { RouteId } from './route-comparison.dto';
import { getCuttingRouteIds, getFormingRouteIds } from '../costing/shared/core/manufacturing-process-registry';
import { LOCATION_INFO } from '../costing/shared/core/default-rates.constants';

// The locations this system holds real rate and material-cost data for, taken
// from LOCATION_INFO itself so the validator can never drift from the table
// that actually resolves currency and the raw_materials cost column.
const SUPPORTED_LOCATIONS = Object.keys(LOCATION_INFO);

// Sheet-metal cutting/forming ids come from MANUFACTURING_PROCESS_REGISTRY
// (via getCuttingRouteIds/getFormingRouteIds) — the same single source of
// truth getRouteComparison's route loop uses — so a registered engine is
// valid here with no separate edit. CNC/injection-molding ids are unrelated
// route families with their own fixed, real machine/tonnage tiers — not part
// of this registry.
const VALID_ROUTE_IDS: RouteId[] = [
  ...getCuttingRouteIds(),
  ...getFormingRouteIds(),
  'cnc-3ax', 'cnc-4ax', 'cnc-5ax',
  'cnc-lathe', 'cnc-lathe-lt', 'cnc-mill-turn',
  'injection-molding', 'im-small-50t', 'im-standard-200t', 'im-large-500t',
];

export class ApplyRouteDto {
  @IsString()
  @IsIn(VALID_ROUTE_IDS)
  routeId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  batchSize?: number;

  /**
   * Required, and restricted to a location this system actually has rates for.
   *
   * Applying a route WRITES a costing commitment: machine rates, labour rates
   * and the raw_materials cost column are all resolved per location, and the
   * resolved figures are persisted. This was `@IsOptional()`, and the handler
   * read `dto.location ?? 'USA'` — so an apply that stated no location was
   * priced against USA rates in USD and saved that way, with nobody having
   * chosen USA. `@IsIn` closes the second half of the same hole: an
   * unrecognised string fell through LOCATION_INFO's own `?? LOCATION_INFO.USA`
   * to the cost_usa column just the same.
   */
  @IsString()
  @IsIn(SUPPORTED_LOCATIONS)
  location!: string;
}

export interface ApplyRouteResult {
  created: number;
  operations: string[];
  routeLabel: string;
  routeId: string;
}

// Custom, dynamically-assembled route from the Workflow Builder.
// baseCuttingRouteId still picks one of the 3 real engine-computed routes
// (its cutting line + its full processLines, identical for everything else
// across all 3 — see getRouteComparison). Each entry in `steps` is EITHER:
//   - a real, already-engine-computed operation for this part (just `process`
//     set) — its real cycleTimeMin/hourlyRate are reused verbatim, or
//   - a real catalog operation with no geometric trigger on this part yet
//     (processGroup/processRoute/machineClass also set) — validated against
//     process_calculator_mappings server-side (never an arbitrary string), a
//     REAL machine rate is resolved for machineClass, but cycleTimeMin is
//     honestly 0 (no real geometry to derive it from) rather than fabricated.
// See bom-items.controller.ts's applyCustomRoute for both paths.
const VALID_BASE_CUTTING_ROUTE_IDS = getCuttingRouteIds();

export class ApplyCustomRouteStepDto {
  @IsString()
  process!: string;

  @IsOptional()
  @IsString()
  processGroup?: string;

  @IsOptional()
  @IsString()
  processRoute?: string;

  @IsOptional()
  @IsString()
  machineClass?: string;
}

export class ApplyCustomRouteDto {
  @IsString()
  @IsIn(VALID_BASE_CUTTING_ROUTE_IDS)
  baseCuttingRouteId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApplyCustomRouteStepDto)
  steps!: ApplyCustomRouteStepDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  batchSize?: number;

  /** Required and validated — see ApplyRouteDto.location. */
  @IsString()
  @IsIn(SUPPORTED_LOCATIONS)
  location!: string;
}

export interface ApplyCustomRouteResult {
  created: number;
  operations: string[];
  routeLabel: string;
  // Steps written with cycleTimeMin=0 because this part has no real geometric
  // trigger for them yet — surfaced so the frontend can show a clear "set
  // cycle time via Edit Process Cost" prompt instead of a silent $0.
  needsManualCycleTime: string[];
}
