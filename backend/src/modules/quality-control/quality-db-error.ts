import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** PostgREST / Postgres codes for "the table does not exist". */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);

export interface DbError {
  code?: string;
  message?: string;
}

/**
 * The HTTP error for a failed quality-control query. A missing table is reported as such (the quality schema is not set up) and
 * never turned into an empty result; a row-level-security refusal is a 403, a lookup of a row the caller cannot see a 404.
 */
export function qualityDbError(error: DbError, action: string): HttpException {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    return new ServiceUnavailableException(`Cannot ${action}: the quality-control tables are not set up in this database.`);
  }
  if (error.code === 'PGRST116') return new NotFoundException('Inspection not found');
  if (error.code === '42501') return new ForbiddenException(`You do not have permission to ${action}.`);
  if (error.code === '22P02') return new BadRequestException(`Cannot ${action}: invalid identifier.`);
  return new InternalServerErrorException(`Failed to ${action}.`);
}
