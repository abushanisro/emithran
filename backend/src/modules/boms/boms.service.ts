import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMDto, UpdateBOMDto, QueryBOMsDto } from './dto/boms.dto';
import { BOMResponseDto, BOMListResponseDto } from './dto/bom-response.dto';
import { validate as isValidUUID } from 'uuid';
import { PERSISTED_PROCESS_COST_COLUMNS, resolvePersistedProcessCost } from '../bom-items/costing/shared/core/persisted-process-cost';
import { ROLLUP_REPORTING_CURRENCY } from '../bom-items/costing/shared/core/persisted-currency-contract';
import { ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';
import { computeBomTotal, type BomCostRow } from './bom-total';

@Injectable()
export class BOMsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    private readonly exchangeRates: ExchangeRateService,
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

  /**
   * Each BOM's total in the reporting currency, or null when it cannot be
   * established (see bom-total.ts): cost rows are converted from the currency
   * they declare, never summed as if they shared one.
   */
  private async computeBomsCosts(accessToken: string, bomIds: string[]): Promise<Map<string, number | null>> {
    const costMap = new Map<string, number | null>();
    if (!bomIds.length) return costMap;
    for (const id of bomIds) costMap.set(id, 0);

    const client = this.supabaseService.getClient(accessToken);
    const { data: allItems, error: itemsError } = await client
      .from('bom_items')
      .select('id, bom_id, make_buy, unit_cost, quantity, parent_item_id')
      .in('bom_id', bomIds);

    // A cost read that failed is not "no cost": every total becomes unavailable.
    const unavailable = (what: string, message: string) => {
      this.logger.error(`BOM totals unavailable: ${what} could not be read (${message})`, 'BOMsService');
      for (const id of bomIds) costMap.set(id, null);
      return costMap;
    };
    if (itemsError) return unavailable('bom_items', itemsError.message);
    if (!allItems || allItems.length === 0) return costMap;

    const allItemIds = allItems.map((i: any) => i.id);
    const rows: BomCostRow[] = [];
    const trustedBasis = (basis: unknown) => basis === 'local' || basis === 'converted';

    const { data: rmRows, error: rmError } = await client
      .from('raw_material_cost_records')
      .select('bom_item_id, gross_usage, unit_cost, overhead, currency, cost_currency_basis')
      .in('bom_item_id', allItemIds)
      .eq('is_active', true);
    if (rmError) return unavailable('raw_material_cost_records', rmError.message);

    for (const r of rmRows ?? []) {
      const grossUsage = parseFloat(r.gross_usage) || 0;
      const unitCost   = parseFloat(r.unit_cost)   || 0;
      const overhead   = parseFloat(r.overhead)    || 0;
      rows.push({
        itemId: r.bom_item_id, kind: 'material',
        amount: grossUsage * unitCost * (1 + overhead / 100),
        currency: r.currency ?? null, trusted: trustedBasis(r.cost_currency_basis),
      });
    }

    // P1b-iv-b: prefer the cost the engine already computed and persisted (labour, QA
    // sampling, yield loss), falling back to the rate-column formula only for rows that
    // have nothing stored -- see resolvePersistedProcessCost.
    const { data: pcRows, error: pcError } = await client
      .from('process_cost_records')
      .select(`bom_item_id, currency, cost_currency_basis, ${PERSISTED_PROCESS_COST_COLUMNS}`)
      .in('bom_item_id', allItemIds)
      .eq('is_active', true);
    if (pcError) return unavailable('process_cost_records', pcError.message);

    for (const r of pcRows ?? []) {
      const { totalCostPerPart } = resolvePersistedProcessCost(r);
      rows.push({
        itemId: r.bom_item_id, kind: 'process', amount: totalCostPerPart,
        currency: r.currency ?? null, trusted: trustedBasis(r.cost_currency_basis),
      });
    }

    const { data: bcRows, error: bcError } = await client
      .from('bom_item_costs')
      .select('bom_item_id, total_cost, currency_code, currency_integrity, is_stale')
      .in('bom_item_id', allItemIds);
    if (bcError) return unavailable('bom_item_costs', bcError.message);

    for (const r of bcRows ?? []) {
      rows.push({
        itemId: r.bom_item_id, kind: 'aggregate', amount: parseFloat(r.total_cost) || 0,
        // a stale aggregate no longer reflects its inputs
        currency: r.currency_code ?? null, trusted: r.currency_integrity === 'consistent' && r.is_stale !== true,
      });
    }

    // ONE FX snapshot for every BOM in this response. If no rates are available the
    // totals are simply unavailable (null); a cost list must not fail on that.
    const reporting = ROLLUP_REPORTING_CURRENCY;
    let rateToReporting: (from: string) => number | null = (from) => (from === reporting ? 1 : null);
    try {
      const snapshot = await this.exchangeRates.getSnapshot(accessToken);
      rateToReporting = (from) => (from === reporting ? 1 : snapshot.convertOptional(from, reporting) ?? null);
    } catch (e) {
      this.logger.warn(`BOM totals: FX snapshot unavailable (${e instanceof Error ? e.message : String(e)}); non-${reporting} amounts stay unresolved`, 'BOMsService');
    }

    const itemsByBom = new Map<string, any[]>();
    for (const item of allItems) {
      const arr = itemsByBom.get(item.bom_id) || [];
      arr.push(item);
      itemsByBom.set(item.bom_id, arr);
    }

    for (const [bomId, items] of itemsByBom.entries()) {
      const ids = new Set(items.map((i: any) => i.id));
      const result = computeBomTotal({
        items,
        rows: rows.filter((r) => ids.has(r.itemId)),
        reportingCurrency: reporting,
        rateToReporting,
      });
      costMap.set(bomId, result.total);
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

  async create(createBOMDto: CreateBOMDto, userId: string, accessToken: string, organizationId?: string): Promise<BOMResponseDto> {
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
        organization_id: organizationId ?? null,
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
