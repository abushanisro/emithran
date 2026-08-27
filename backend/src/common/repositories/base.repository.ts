/**
 * Base Repository
 *
 * Provides common database operations with:
 * - Proper error handling (no throw on empty results)
 * - Tenant scoping enforcement
 * - Query logging
 * - Type safety
 *
 * Following industry best practices for repository pattern
 */

import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../logger/logger.service';

export interface QueryOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  ascending?: boolean;
}

export interface QueryResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Base repository with common CRUD operations
 * All queries are automatically scoped to the authenticated user via RLS
 */
export abstract class BaseRepository<T> {
  constructor(
    protected readonly tableName: string,
    protected readonly logger: Logger,
  ) {}

  /**
   * Find all records with pagination
   * Returns empty array if no records found (NOT an error)
   */
  async findAll(
    client: SupabaseClient,
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const startTime = Date.now();

    try {
      let query = client
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .range(from, to);

      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending !== false });
      }

      const { data, error, count } = await query;

      const duration = Date.now() - startTime;
      this.logQuery('findAll', { page, limit }, duration, data?.length || 0);

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.findAll: ${error.message}`);
        throw new InternalServerErrorException(`Failed to fetch ${this.tableName} records`);
      }

      // Return empty array if no records (NOT an error)
      return {
        data: (data as T[]) || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Unexpected error in ${this.tableName}.findAll`, error);
      throw new InternalServerErrorException(`Failed to fetch ${this.tableName} records`);
    }
  }

  /**
   * Find single record by ID
   * Throws NotFoundException if not found (correct semantics)
   */
  async findById(client: SupabaseClient, id: string): Promise<T> {
    const startTime = Date.now();

    try {
      const { data, error } = await client
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      const duration = Date.now() - startTime;
      this.logQuery('findById', { id }, duration, data ? 1 : 0);

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.findById: ${error.message}`);
        throw new InternalServerErrorException(`Failed to fetch ${this.tableName} record`);
      }

      // Throw 404 only if record not found (correct HTTP semantics)
      if (!data) {
        throw new NotFoundException(`${this.tableName} record with ID ${id} not found`);
      }

      return data as T;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Unexpected error in ${this.tableName}.findById`, error);
      throw new InternalServerErrorException(`Failed to fetch ${this.tableName} record`);
    }
  }

  /**
   * Create new record
   */
  async create(
    client: SupabaseClient,
    data: Partial<T>,
    userId: string,
    organizationId?: string,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // organization_id only added to the payload when the caller actually
      // resolved one — BaseRepository is generic infra, and not every future
      // subclass is guaranteed to have this column.
      const { data: created, error } = await client
        .from(this.tableName)
        .insert({
          ...data,
          user_id: userId,
          ...(organizationId !== undefined ? { organization_id: organizationId } : {}),
        } as any)
        .select()
        .single();

      const duration = Date.now() - startTime;
      this.logQuery('create', { userId }, duration, 1);

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.create: ${error.message}`);
        throw new InternalServerErrorException(`Failed to create ${this.tableName} record`);
      }

      return created as T;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Unexpected error in ${this.tableName}.create`, error);
      throw new InternalServerErrorException(`Failed to create ${this.tableName} record`);
    }
  }

  /**
   * Update existing record
   */
  async update(
    client: SupabaseClient,
    id: string,
    data: Partial<T>,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Verify record exists (will throw NotFoundException if not)
      await this.findById(client, id);

      const { data: updated, error } = await client
        .from(this.tableName)
        .update(data as any)
        .eq('id', id)
        .select()
        .single();

      const duration = Date.now() - startTime;
      this.logQuery('update', { id }, duration, 1);

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.update: ${error.message}`);
        throw new InternalServerErrorException(`Failed to update ${this.tableName} record`);
      }

      return updated as T;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Unexpected error in ${this.tableName}.update`, error);
      throw new InternalServerErrorException(`Failed to update ${this.tableName} record`);
    }
  }

  /**
   * Delete record
   */
  async delete(client: SupabaseClient, id: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Verify record exists (will throw NotFoundException if not)
      await this.findById(client, id);

      const { error } = await client
        .from(this.tableName)
        .delete()
        .eq('id', id);

      const duration = Date.now() - startTime;
      this.logQuery('delete', { id }, duration, 1);

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.delete: ${error.message}`);
        throw new InternalServerErrorException(`Failed to delete ${this.tableName} record`);
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Unexpected error in ${this.tableName}.delete`, error);
      throw new InternalServerErrorException(`Failed to delete ${this.tableName} record`);
    }
  }

  /**
   * Log query execution with metrics
   */
  private logQuery(operation: string, params: any, duration: number, rowCount: number): void {
    this.logger.log(
      `${this.tableName}.${operation} - Duration: ${duration}ms, Rows: ${rowCount}, Params: ${JSON.stringify(params)}`,
    );
  }
}
