import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMDto, UpdateBOMDto, QueryBOMsDto } from './dto/boms.dto';
import { BOMResponseDto, BOMListResponseDto } from './dto/bom-response.dto';
import { validate as isValidUUID } from 'uuid';

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

    // Fetch BOMs with embedded bom_items count for live item totals
    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .select('id, name, description, project_id, version, status, user_id, created_at, updated_at, bom_items(count)', { count: 'exact' })
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
      throw new InternalServerErrorException('Unable to retrieve BOMs. Please try again later.');
    }

    // Aggregate costs from the cost records tables — the same source the
    // process planning view uses — so totals always match what the user sees.
    const bomIds = (data || []).map((row: any) => row.id);
    const costMap = await this.computeBomsCosts(accessToken, bomIds);

    // Transform using static DTO method with live counts
    const boms = (data || []).map((row: any) => {
      const itemCount = Array.isArray(row.bom_items) ? (row.bom_items[0]?.count ?? 0) : 0;
      return BOMResponseDto.fromDatabase({
        ...row,
        total_items: itemCount,
        total_cost: costMap.get(row.id) || undefined,
      });
    });

    return {
      boms,
      total: count || 0,
      page,
      limit,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<BOMResponseDto> {
    this.logger.log(`Fetching BOM: ${id}`, 'BOMsService');

    // Validate UUID format
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format provided: ${id}`, 'BOMsService');
      throw new BadRequestException('Please provide a valid BOM ID.');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .select('id, name, description, project_id, version, status, user_id, created_at, updated_at, bom_items(count)')
      .eq('id', id)
      .single();

    if (error || !data) {
      // Distinguish between different error types
      if (error?.code === 'PGRST116') {
        // PostgreSQL "no rows returned" error
        this.logger.warn(`BOM not found: ${id}`, 'BOMsService');
      } else if (error) {
        this.logger.error(`Database error while fetching BOM ${id}: ${error.message}`, 'BOMsService');
      } else {
        this.logger.warn(`BOM not found (no data): ${id}`, 'BOMsService');
      }
      throw new NotFoundException('The requested BOM could not be found or you do not have access to it.');
    }

    const row = data as any;
    const itemCount = Array.isArray(row.bom_items) ? (row.bom_items[0]?.count ?? 0) : 0;

    const costMap = await this.computeBomsCosts(accessToken, [id]);
    const totalCost = costMap.get(id);

    return BOMResponseDto.fromDatabase({
      ...row,
      total_items: itemCount,
      total_cost: totalCost,
    });
  }

  private async computeBomsCosts(accessToken: string, bomIds: string[]): Promise<Map<string, number>> {
    const costMap = new Map<string, number>();
    if (!bomIds.length) return costMap;

    for (const id of bomIds) {
      costMap.set(id, 0);
    }

    const client = this.supabaseService.getClient(accessToken);
    const { data: allItems } = await client
      .from('bom_items')
      .select('id, bom_id, make_buy, unit_cost, quantity, parent_item_id')
      .in('bom_id', bomIds);

    if (!allItems || allItems.length === 0) return costMap;

    const allItemIds = allItems.map((i: any) => i.id);
    const recordCostMap = new Map<string, number>();
    const tableCostMap = new Map<string, number>();

    if (allItemIds.length > 0) {
      const { data: rmRows } = await client
        .from('raw_material_cost_records')
        .select('bom_item_id, gross_usage, unit_cost, overhead')
        .in('bom_item_id', allItemIds)
        .eq('is_active', true);

      for (const r of rmRows ?? []) {
        const grossUsage = parseFloat(r.gross_usage) || 0;
        const unitCost   = parseFloat(r.unit_cost)   || 0;
        const overhead   = parseFloat(r.overhead)    || 0;
        const cost = grossUsage * unitCost * (1 + overhead / 100);
        recordCostMap.set(r.bom_item_id, (recordCostMap.get(r.bom_item_id) || 0) + cost);
      }

      const { data: pcRows } = await client
        .from('process_cost_records')
        .select('bom_item_id, machine_rate, labor_rate, setup_manning, setup_time, batch_size, heads, cycle_time, parts_per_cycle, scrap')
        .in('bom_item_id', allItemIds)
        .eq('is_active', true);

      for (const r of pcRows ?? []) {
        const machineRate  = parseFloat(r.machine_rate)    || 0;
        const laborRate    = parseFloat(r.labor_rate)      || 0;
        const setupManning = parseFloat(r.setup_manning)   || 0;
        const setupTimeMin = parseFloat(r.setup_time)      || 0;
        const batchSize    = parseFloat(r.batch_size)      || 1;
        const heads        = parseFloat(r.heads)           || 0;
        const cycleTimeSec = parseFloat(r.cycle_time)      || 0;
        const ppc          = parseFloat(r.parts_per_cycle) || 1;
        const scrap        = parseFloat(r.scrap)           || 0;
        const setupCost = batchSize > 0
          ? (setupTimeMin / 60) * (machineRate + laborRate * setupManning) / batchSize : 0;
        const cycleCost = ppc > 0
          ? (cycleTimeSec / 3600) * (machineRate + laborRate * heads) / ppc : 0;
        const cost = (setupCost + cycleCost) * (1 + scrap / 100);
        recordCostMap.set(r.bom_item_id, (recordCostMap.get(r.bom_item_id) || 0) + cost);
      }

      const { data: bcRows } = await client
        .from('bom_item_costs')
        .select('bom_item_id, total_cost')
        .in('bom_item_id', allItemIds);

      for (const r of bcRows ?? []) {
        const tc = parseFloat(r.total_cost) || 0;
        if (tc > 0) tableCostMap.set(r.bom_item_id, tc);
      }
    }

    // Group items by bom_id
    const itemsByBom = new Map<string, any[]>();
    for (const item of allItems) {
      const arr = itemsByBom.get(item.bom_id) || [];
      arr.push(item);
      itemsByBom.set(item.bom_id, arr);
    }

    for (const [bomId, items] of itemsByBom.entries()) {
      const parentIds = new Set<string>();
      for (const item of items) {
        if (item.parent_item_id) parentIds.add(item.parent_item_id);
      }

      let leafSum = 0;
      let rootSum = 0;
      let allSum = 0;

      for (const item of items) {
        const qty = parseFloat(item.quantity) || 1;
        const recCost = recordCostMap.get(item.id) || 0;
        const tblCost = tableCostMap.get(item.id) || 0;
        const unitCost = parseFloat(item.unit_cost) || 0;
        const bestUnitCost = recCost > 0 ? recCost : (tblCost > 0 ? tblCost : unitCost);
        const itemTotal = bestUnitCost * qty;

        allSum += itemTotal;
        if (!parentIds.has(item.id)) {
          leafSum += itemTotal;
        }
        if (!item.parent_item_id) {
          rootSum += itemTotal;
        }
      }

      const bomCost = Math.max(leafSum, rootSum) > 0 ? Math.max(leafSum, rootSum) : allSum;
      costMap.set(bomId, bomCost);
    }

    return costMap;
  }

  /**
   * Validate UUID format to prevent invalid queries
   */
  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
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
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('boms_name')) {
        throw new BadRequestException('A BOM with this name already exists in this project. Please choose a different name.');
      }
      if (error.message.includes('foreign key') && error.message.includes('project_id')) {
        throw new BadRequestException('The specified project does not exist or you do not have access to it.');
      }
      throw new InternalServerErrorException('Unable to create the BOM. Please try again later.');
    }

    return BOMResponseDto.fromDatabase(data);
  }

  async update(id: string, updateBOMDto: UpdateBOMDto, userId: string, accessToken: string): Promise<BOMResponseDto> {
    this.logger.log(`Updating BOM: ${id}`, 'BOMsService');

    // Validate UUID format early
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for update: ${id}`, 'BOMsService');
      throw new BadRequestException('Please provide a valid BOM ID.');
    }

    // Verify BOM exists and belongs to user
    await this.findOne(id, userId, accessToken);

    const updateData: Partial<{
      name: string;
      description: string;
      version: string;
      status: string;
    }> = {};
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
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('boms_name')) {
        throw new BadRequestException('A BOM with this name already exists in this project. Please choose a different name.');
      }
      throw new InternalServerErrorException('Unable to update the BOM. Please try again later.');
    }

    return BOMResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting BOM: ${id}`, 'BOMsService');

    // Validate UUID format early
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for delete: ${id}`, 'BOMsService');
      throw new BadRequestException('Please provide a valid BOM ID.');
    }

    // Verify BOM exists and belongs to user
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting BOM: ${error.message}`, 'BOMsService');
      // Check for specific database errors
      if (error.message.includes('foreign key') || error.message.includes('violates')) {
        throw new BadRequestException('Cannot delete this BOM because it contains items or is referenced by other data. Please remove all BOM items first.');
      }
      throw new InternalServerErrorException('Unable to delete the BOM. Please try again later.');
    }

    return { message: 'BOM deleted successfully' };
  }
}
