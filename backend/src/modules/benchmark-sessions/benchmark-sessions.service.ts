import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateBenchmarkSessionDto,
  UpdateBenchmarkSessionDto,
  BenchmarkSessionResponseDto,
} from './dto/benchmark-sessions.dto';

@Injectable()
export class BenchmarkSessionsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async findAll(userId: string, accessToken: string): Promise<BenchmarkSessionResponseDto[]> {
    this.logger.log('Fetching benchmark sessions', 'BenchmarkSessionsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('benchmark_sessions')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching benchmark sessions: ${error.message}`, 'BenchmarkSessionsService');
      throw new InternalServerErrorException(`Failed to fetch benchmark sessions: ${error.message}`);
    }

    return (data || []).map(row => BenchmarkSessionResponseDto.fromDatabase(row));
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<BenchmarkSessionResponseDto> {
    this.logger.log(`Fetching benchmark session ${id}`, 'BenchmarkSessionsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('benchmark_sessions')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Benchmark session ${id} not found`);
    }

    return BenchmarkSessionResponseDto.fromDatabase(data);
  }

  async create(dto: CreateBenchmarkSessionDto, userId: string, accessToken: string): Promise<BenchmarkSessionResponseDto> {
    this.logger.log('Creating benchmark session', 'BenchmarkSessionsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('benchmark_sessions')
      .insert({
        name: dto.name,
        description: dto.description ?? null,
        owner_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating benchmark session: ${error.message}`, 'BenchmarkSessionsService');
      throw new InternalServerErrorException(`Failed to create benchmark session: ${error.message}`);
    }

    return BenchmarkSessionResponseDto.fromDatabase(data);
  }

  async update(id: string, dto: UpdateBenchmarkSessionDto, userId: string, accessToken: string): Promise<BenchmarkSessionResponseDto> {
    const updates: Record<string, any> = {};
    if (dto.name !== undefined)             updates.name               = dto.name;
    if (dto.description !== undefined)      updates.description        = dto.description;
    if (dto.status !== undefined)           updates.status             = dto.status;
    if (dto.selectedProjects !== undefined) updates.selected_projects  = dto.selectedProjects;
    if (dto.selectedBoms !== undefined)     updates.selected_boms      = dto.selectedBoms;
    if (dto.bomCount !== undefined)         updates.bom_count          = dto.bomCount;
    if (dto.savedInsights !== undefined)    updates.saved_insights     = dto.savedInsights;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('benchmark_sessions')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException(`Benchmark session ${id} not found or access denied`);
    }

    return BenchmarkSessionResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('benchmark_sessions')
      .delete()
      .eq('id', id)
      .eq('owner_id', userId);

    if (error) {
      throw new InternalServerErrorException(`Failed to delete benchmark session: ${error.message}`);
    }
  }
}
