import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMDto, UpdateBOMDto, QueryBOMsDto } from './dto/boms.dto';
import { BOMResponseDto, BOMListResponseDto } from './dto/bom-response.dto';

@Injectable()
export class BOMsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async findAll(query: QueryBOMsDto, userId: string, accessToken: string): Promise<BOMListResponseDto> {
    this.logger.log('Fetching all BOMs', 'BOMsService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100); // Cap at 100 for performance
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Filter by project if specified
    if (query.projectId) {
      queryBuilder = queryBuilder.eq('project_id', query.projectId);
    }

    // Apply search filter
    if (query.search) {
      queryBuilder = queryBuilder.ilike('name', `%${query.search}%`);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching BOMs: ${error.message}`, 'BOMsService');
      throw new InternalServerErrorException(`Failed to fetch BOMs: ${error.message}`);
    }

    // Transform using static DTO method (type-safe)
    const boms = (data || []).map(row => BOMResponseDto.fromDatabase(row));

    return {
      boms,
      total: count || 0,
      page,
      limit,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<BOMResponseDto> {
    this.logger.log(`Fetching BOM: ${id}`, 'BOMsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`BOM not found: ${id}`, 'BOMsService');
      throw new NotFoundException(`BOM with ID ${id} not found`);
    }

    return BOMResponseDto.fromDatabase(data);
  }

  async create(createBOMDto: CreateBOMDto, userId: string, accessToken: string): Promise<BOMResponseDto> {
    this.logger.log('Creating BOM', 'BOMsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .insert({
        name: createBOMDto.name,
        description: createBOMDto.description,
        project_id: createBOMDto.projectId,
        version: createBOMDto.version || '1.0',
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating BOM: ${error.message}`, 'BOMsService');
      throw new InternalServerErrorException(`Failed to create BOM: ${error.message}`);
    }

    return BOMResponseDto.fromDatabase(data);
  }

  async update(id: string, updateBOMDto: UpdateBOMDto, userId: string, accessToken: string): Promise<BOMResponseDto> {
    this.logger.log(`Updating BOM: ${id}`, 'BOMsService');

    // Verify BOM exists and belongs to user
    await this.findOne(id, userId, accessToken);

    const updateData: any = {};
    if (updateBOMDto.name !== undefined) updateData.name = updateBOMDto.name;
    if (updateBOMDto.description !== undefined) updateData.description = updateBOMDto.description;
    if (updateBOMDto.version !== undefined) updateData.version = updateBOMDto.version;
    if (updateBOMDto.status !== undefined) updateData.status = updateBOMDto.status;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating BOM: ${error.message}`, 'BOMsService');
      throw new InternalServerErrorException(`Failed to update BOM: ${error.message}`);
    }

    return BOMResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting BOM: ${id}`, 'BOMsService');

    // Verify BOM exists and belongs to user
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting BOM: ${error.message}`, 'BOMsService');
      throw new InternalServerErrorException(`Failed to delete BOM: ${error.message}`);
    }

    return { message: 'BOM deleted successfully' };
  }
}
