import { IsString, IsOptional, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import type { RouteId } from './route-comparison.dto';

const VALID_ROUTE_IDS: RouteId[] = [
  'sm-laser', 'sm-turret', 'sm-waterjet',
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

  @IsOptional()
  @IsString()
  location?: string;
}

export interface ApplyRouteResult {
  created: number;
  operations: string[];
  routeLabel: string;
  routeId: string;
}
