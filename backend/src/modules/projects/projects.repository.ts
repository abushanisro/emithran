import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@/common/repositories/base.repository';
import { Logger } from '@/common/logger/logger.service';
import { SupabaseClient } from '@supabase/supabase-js';

export interface ProjectEntity {
  id: string;
  name: string;
  description?: string;
  status: string;
  country?: string;
  state?: string;
  city?: string;
  target_price?: number;
  industry?: string;
  estimated_annual_volume?: number;
  target_bom_cost?: number;
  target_bom_cost_currency?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ProjectsRepository extends BaseRepository<ProjectEntity> {
  constructor(logger: Logger) {
    super('projects', logger);
  }

  /**
   * Find projects by search term
   */
  async findBySearch(
    client: SupabaseClient,
    searchTerm: string,
    options: any = {}
  ) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const startTime = Date.now();

    try {
      let query = client
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
        .range(from, to);

      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending !== false });
      } else {
        query = query.order('updated_at', { ascending: false });
      }

      const { data, error, count } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.findBySearch: ${error.message}`);
        throw error;
      }

      return {
        data: (data as ProjectEntity[]) || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(`Unexpected error in ${this.tableName}.findBySearch`, error);
      throw error;
    }
  }

  /**
   * Find projects by status
   */
  async findByStatus(
    client: SupabaseClient,
    status: string,
    options: any = {}
  ) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const startTime = Date.now();

    try {
      let query = client
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .eq('status', status)
        .range(from, to);

      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending !== false });
      } else {
        query = query.order('updated_at', { ascending: false });
      }

      const { data, error, count } = await query;

      const duration = Date.now() - startTime;

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.findByStatus: ${error.message}`);
        throw error;
      }

      return {
        data: (data as ProjectEntity[]) || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(`Unexpected error in ${this.tableName}.findByStatus`, error);
      throw error;
    }
  }

  /**
   * Check if project name exists (excluding current project)
   */
  async isNameExists(
    client: SupabaseClient,
    name: string,
    excludeId?: string
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      let query = client
        .from(this.tableName)
        .select('id')
        .ilike('name', name);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data, error } = await query.limit(1);

      const duration = Date.now() - startTime;

      if (error) {
        this.logger.error(`Database error in ${this.tableName}.isNameExists: ${error.message}`);
        throw error;
      }

      return (data?.length || 0) > 0;
    } catch (error) {
      this.logger.error(`Unexpected error in ${this.tableName}.isNameExists`, error);
      throw error;
    }
  }

}