import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Paging rules (docs/API.md rule 6). A list returns a page, never everything. */
export const PAGE_LIMIT_DEFAULT = 50;
/** The most a new list returns in one page. */
export const PAGE_LIMIT_MAX = 200;
/**
 * The most any list may be asked for. Picker screens (vendors, process catalog, BOM item search) load a whole short list in one
 * request and ask for up to 1000; a limit above this is refused instead of read from the database.
 */
export const PAGE_LIMIT_PICKER_MAX = 1000;

/** `?page=2&limit=50&sort=+name,-createdAt` for a new list endpoint: extend it with the filters of that list. */
export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: PAGE_LIMIT_MAX, default: PAGE_LIMIT_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_LIMIT_MAX)
  limit: number = PAGE_LIMIT_DEFAULT;

  @ApiPropertyOptional({ description: 'Fields to sort by, `+` ascending and `-` descending, e.g. +name,-createdAt', example: '+name,-createdAt' })
  @IsOptional()
  @IsString()
  sort?: string;
}

export interface SortTerm { field: string; ascending: boolean }

/**
 * Reads `sort=+field,-field` against the fields the endpoint documents. A field that is not on the list is refused (400): sorting by a
 * column nobody meant to expose would reveal it and could be slow. `map` turns the public field name into the column when they differ.
 * A bare field name sorts ascending (a `+` in a URL arrives as a space, so both are accepted).
 */
export function parseSort(sort: string | undefined, allowed: readonly string[], map: Readonly<Record<string, string>> = {}): SortTerm[] {
  if (!sort) return [];
  const terms: SortTerm[] = [];
  for (const raw of sort.split(',').map((t) => t.trim()).filter(Boolean)) {
    const ascending = !raw.startsWith('-');
    const field = raw.replace(/^[+-]/, '').trim();
    if (!allowed.includes(field)) throw new BadRequestException(`Cannot sort by "${field}". Allowed: ${allowed.join(', ')}.`);
    terms.push({ field: map[field] ?? field, ascending });
  }
  return terms;
}

/** The zero-based first and last row of a page, as PostgREST `range(from, to)` takes them. */
export function pageRange(page: number, limit: number): [number, number] {
  const from = (page - 1) * limit;
  return [from, from + limit - 1];
}
