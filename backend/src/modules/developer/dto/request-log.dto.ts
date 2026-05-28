import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryLogsDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @ApiPropertyOptional({ description: 'Results per page', default: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() limit?: number = 50;
  @ApiPropertyOptional({ description: 'Filter by HTTP method' }) @IsString() @IsOptional() method?: string;
  @ApiPropertyOptional({ description: 'Filter by status code range start' }) @Type(() => Number) @IsInt() @IsOptional() statusMin?: number;
  @ApiPropertyOptional({ description: 'Filter by status code range end' }) @Type(() => Number) @IsInt() @IsOptional() statusMax?: number;
  @ApiPropertyOptional({ description: 'Filter from date-time (ISO 8601)' }) @IsString() @IsOptional() dateFrom?: string;
  @ApiPropertyOptional({ description: 'Filter to date-time (ISO 8601)' }) @IsString() @IsOptional() dateTo?: string;
  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'] }) @IsString() @IsOptional() sortOrder?: 'asc' | 'desc';
}

export class RequestLogDto {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number | null;
  createdAt: string;
  errorCode: string | null;
}

export class LogStatsDto {
  total: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
  topEndpoints: { path: string; count: number }[];
}
