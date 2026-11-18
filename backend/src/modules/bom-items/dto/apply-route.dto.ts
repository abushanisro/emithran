import { SAND_CASTING_ROUTE_ID } from '../costing/casting/sand/sand-route-comparison';
import { INVESTMENT_CASTING_ROUTE_ID } from '../costing/casting/investment/investment-route-comparison';
import { POWDER_METAL_ROUTE_ID } from '../costing/powder-metal/powder-metal-route-comparison';
import { TWO_MODEL_ROUTE_ID } from '../costing/two-model/two-model-route-comparison';
import { OTHER_MOLDING_ROUTE_IDS } from '../costing/plastic-molding/molding-route-projection';
import { IsString, IsOptional, IsInt, Min, IsIn, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { RouteId } from './route-comparison.dto';
import { getCuttingRouteIds, getFormingRouteIds, getMachiningRouteIds } from '../costing/shared/core/manufacturing-process-registry';
import { LOCATION_INFO } from '../costing/shared/core/default-rates.constants';
import { DIE_CASTING_PROCESSES, dieCastingRouteId } from '../costing/casting/die-casting-process-choice';
import { FORGING_ROUTE_IDS } from '../costing/forging/forging-route-comparison';
import { COMPOSITES_ROUTE_IDS } from '../costing/composites/composites-route-comparison';
import { ADDITIVE_ROUTE_IDS } from '../costing/additive/additive-route-comparison';
import { ASSEMBLY_ROUTE_IDS } from '../costing/assembly/assembly-route-comparison';
import { INSERT_MOLDING_ROUTE_IDS } from '../costing/plastic-molding/insert/insert-molding';

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
export const VALID_ROUTE_IDS: RouteId[] = [
  ...getCuttingRouteIds(),
  ...getFormingRouteIds(),
  ...getMachiningRouteIds(),
  'injection-molding', 'im-small-50t', 'im-standard-200t', 'im-large-500t',
  // The other molding processes, each priced by its own engine in the route comparison; apply still refuses one that is not feasible (material or process not compatible, no machine rate)
  ...OTHER_MOLDING_ROUTE_IDS,
  ...DIE_CASTING_PROCESSES.map(dieCastingRouteId),
  // Each forging route, priced by the forging engine (forging-route-comparison.ts).
  ...FORGING_ROUTE_IDS,
  // Each composites layup route, priced by the composites engine (composites-route-comparison.ts).
  ...COMPOSITES_ROUTE_IDS,
  ...ADDITIVE_ROUTE_IDS,
  // An assembly's routes (manual, robotic welding), priced by the assembly engine (assembly-route-comparison.ts).
  ...ASSEMBLY_ROUTE_IDS,
  // An insert-molded part's load methods (manual, 3-axis, 6-axis), priced by the insert molding engine.
  ...INSERT_MOLDING_ROUTE_IDS,
  // The one-route processes: the cost summary as quoted, as one route (the Workflow Builder sets them like any complete route).
  SAND_CASTING_ROUTE_ID, INVESTMENT_CASTING_ROUTE_ID, POWDER_METAL_ROUTE_ID, TWO_MODEL_ROUTE_ID,
];

/**
 * Apply whichever route the engine recommends for this part. Resolved on the
 * server from the same comparison the apply runs on, so the choice and the
 * costing it is applied with can never come from two different computations.
 */
export const AUTO_ROUTE_ID = 'auto';

export class ApplyRouteDto {
  @IsString()
  @IsIn([...VALID_ROUTE_IDS, AUTO_ROUTE_ID])
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
  /** The route asked for, when it was no longer one of the part's routes and the recommendation was applied instead (fallbackToRecommended). */
  replacedRouteId?: string;
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
