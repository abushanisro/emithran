/**
 * Standardized API Response DTOs
 *
 * Ensures consistent response format across all endpoints
 * Following industry best practices for API contract design
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard pagination metadata
 */
class PaginationMeta {
  @ApiProperty({ description: 'Total number of records', example: 100 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Records per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 10 })
  totalPages: number;

  @ApiProperty({ description: 'Has next page', example: true })
  hasNext: boolean;

  @ApiProperty({ description: 'Has previous page', example: false })
  hasPrevious: boolean;
}

/**
 * Standard API response wrapper for single resources
 */
export class ApiResponse<T> {
  @ApiProperty({ description: 'Response data' })
  data: T;

  @ApiPropertyOptional({ description: 'Error message if request failed' })
  error?: string | null;

  @ApiProperty({ description: 'Request timestamp' })
  timestamp: string;

  @ApiProperty({ description: 'Request correlation ID for tracing' })
  correlationId?: string;

  constructor(data: T, correlationId?: string) {
    this.data = data;
    this.error = null;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId;
  }
}

/**
 * Standard API response wrapper for list/collection resources
 */
class ApiListResponse<T> {
  @ApiProperty({ description: 'Array of data items', isArray: true })
  data: T[];

  @ApiProperty({ description: 'Pagination metadata' })
  meta: PaginationMeta;

  @ApiPropertyOptional({ description: 'Error message if request failed' })
  error?: string | null;

  @ApiProperty({ description: 'Request timestamp' })
  timestamp: string;

  @ApiProperty({ description: 'Request correlation ID for tracing' })
  correlationId?: string;

  constructor(data: T[], total: number, page: number, limit: number, correlationId?: string) {
    this.data = data;
    this.meta = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrevious: page > 1,
    };
    this.error = null;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId;
  }
}

/**
 * Standard error response
 */
class ApiErrorResponse {
  @ApiProperty({ description: 'Error message' })
  error: string;

  @ApiPropertyOptional({ description: 'Error code for client-side handling' })
  errorCode?: string;

  @ApiProperty({ description: 'HTTP status code' })
  statusCode: number;

  @ApiPropertyOptional({ description: 'Field-specific validation errors' })
  errors?: Record<string, string[]>;

  @ApiProperty({ description: 'Request timestamp' })
  timestamp: string;

  @ApiProperty({ description: 'Request path' })
  path: string;

  @ApiPropertyOptional({ description: 'Request correlation ID for tracing' })
  correlationId?: string;

  constructor(
    error: string,
    statusCode: number,
    path: string,
    correlationId?: string,
    errorCode?: string,
    errors?: Record<string, string[]>,
  ) {
    this.error = error;
    this.statusCode = statusCode;
    this.path = path;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId;
    if (errorCode) this.errorCode = errorCode;
    if (errors) this.errors = errors;
  }
}

/**
 * Helper to create successful list responses
 */
export function createListResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  correlationId?: string,
): ApiListResponse<T> {
  return new ApiListResponse(data, total, page, limit, correlationId);
}

/**
 * Helper to create successful single resource responses
 */
export function createResponse<T>(data: T, correlationId?: string): ApiResponse<T> {
  return new ApiResponse(data, correlationId);
}

/**
 * Helper to create error responses
 */
export function createErrorResponse(
  error: string,
  statusCode: number,
  path: string,
  correlationId?: string,
  errorCode?: string,
  errors?: Record<string, string[]>,
): ApiErrorResponse {
  return new ApiErrorResponse(error, statusCode, path, correlationId, errorCode, errors);
}
