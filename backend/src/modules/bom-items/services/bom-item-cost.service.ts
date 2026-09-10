import { Injectable, NotFoundException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { ROLLUP_REPORTING_CURRENCY } from '../costing/shared/core/persisted-currency-contract';
import {
  computeCurrencyAwareRollup,
  RollupInputKind,
  RollupSourceAmount,
} from './bom-item-rollup';
import { BomItemCostDto, BomItemCostSummaryDto, UpdateBomItemCostDto } from '../dto/bom-item-cost.dto';
import { snakeCase } from 'snake-case';
import { camelCase } from 'camel-case';

@Injectable()
export class BomItemCostService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    // One FX snapshot per rollup comes from here. ExchangeRateModule is already
    // imported by BomItemsModule, so this needs no module change.
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  /**
   * Transform snake_case database fields to camelCase
   */
  private transformToCamelCase(obj: any): any {
    if (!obj) return obj;
    const transformed: any = {};
    for (const key in obj) {
      transformed[camelCase(key)] = obj[key];
    }
    return transformed;
  }

  /**
   * Transform camelCase fields to snake_case for database
   */
  private transformToSnakeCase(obj: any): any {
    if (!obj) return obj;
    const transformed: any = {};
    for (const key in obj) {
      transformed[snakeCase(key)] = obj[key];
    }
    return transformed;
  }

  /**
   * Get or create cost record for a BOM item
   */
  async getOrCreateCost(bomItemId: string, userId: string, accessToken: string, organizationId?: string): Promise<BomItemCostDto> {
    // Try to get existing record
    const { data: existing, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select('*')
      .eq('bom_item_id', bomItemId)
      .single();

    if (!fetchError && existing) {
      return this.transformToCamelCase(existing) as BomItemCostDto;
    }

    // Create new record if doesn't exist
    const { data: newRecord, error: createError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .insert({ bom_item_id: bomItemId, user_id: userId, organization_id: organizationId ?? null })
      .select()
      .single();

    if (createError || !newRecord) {
      this.logger.error(`Error creating cost record: ${createError?.message}`, 'BomItemCostService');
      throw new NotFoundException(`Failed to create cost record for BOM item ${bomItemId}`);
    }

    return this.transformToCamelCase(newRecord) as BomItemCostDto;
  }

  /**
   * Update cost record
   */
  async updateCost(
    bomItemId: string,
    userId: string,
    updateDto: UpdateBomItemCostDto,
    accessToken: string
  ): Promise<BomItemCostDto> {
    const snakeData = this.transformToSnakeCase(updateDto);

    // Calculate own_cost and selling_price
    const updateData: any = { ...snakeData };

    const { data: updated, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .update({
        ...updateData,
        is_stale: false,
        updated_at: new Date().toISOString(),
      })
      .eq('bom_item_id', bomItemId)
      .select()
      .single();

    if (error || !updated) {
      this.logger.error(`Error updating cost: ${error?.message}`, 'BomItemCostService');
      throw new NotFoundException(`Cost record not found for BOM item ${bomItemId}`);
    }

    // Trigger recalculation of parent costs
    await this.recalculateParentCosts(bomItemId, userId, accessToken);

    return this.transformToCamelCase(updated) as BomItemCostDto;
  }

  /**
   * Get all children costs for a BOM item
   */
  async getChildrenCosts(bomItemId: string, userId: string, accessToken: string): Promise<BomItemCostDto[]> {
    // First get all child items
    const { data: childItems, error: itemsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id')
      .eq('parent_item_id', bomItemId)
      .order('sort_order');

    if (itemsError) {
      this.logger.error(`Error fetching child items: ${itemsError.message}`, 'BomItemCostService');
      return [];
    }

    if (!childItems || childItems.length === 0) {
      return [];
    }

    const childIds = childItems.map(item => item.id);

    // Get costs for all children
    const { data: costs, error: costsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select('*')
      .in('bom_item_id', childIds);

    if (costsError) {
      this.logger.error(`Error fetching children costs: ${costsError.message}`, 'BomItemCostService');
      return [];
    }

    return (costs || []).map(row => this.transformToCamelCase(row) as BomItemCostDto);
  }

  /**
   * Recalculate costs for a BOM item and update the record
   */
  async recalculateCost(bomItemId: string, userId: string, accessToken: string, organizationId?: string): Promise<BomItemCostDto> {
    // Get item details
    const { data: item, error: itemError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, quantity, parent_item_id')
      .eq('id', bomItemId)
      .single();

    if (itemError || !item) {
      this.logger.error(`BOM item not found: ${bomItemId}`, 'BomItemCostService');
      throw new NotFoundException(`BOM item ${bomItemId} not found`);
    }

    // Get or create cost record
    const costRecord = await this.getOrCreateCost(bomItemId, userId, accessToken, organizationId);

    // Get all children and their costs
    const { data: children, error: childrenError} = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, quantity')
      .eq('parent_item_id', bomItemId);

    // ── P1b-iii: the one currency-aware rollup ───────────────────────────────
    //
    // Every monetary input is read from its SOURCE record together with the
    // currency declarations migrations 707/708 added, and handed to
    // computeCurrencyAwareRollup, which converts each trusted amount exactly
    // once through a SINGLE resolved FX snapshot. Nothing is summed here.
    //
    // This replaced a version that:
    //   * read raw_material_cost and process_cost off the aggregate row rather
    //     than from source records -- which stopped working the moment the
    //     P1b-ii triggers stopped writing them;
    //   * selected `total_cost_per_part` from packaging_logistics_cost_records
    //     and procured_parts_cost_records. That column does not exist on
    //     either table (verified live), so the query errored, the error was
    //     never checked, and BOTH categories silently rolled up as 0;
    //   * summed amounts of unknown denomination and then declared the result
    //     final by clearing is_stale.
    const client = this.supabaseService.getClient(accessToken);
    const amounts: RollupSourceAmount[] = [];

    // Children: a child total is denominated in that child reporting currency
    // and is only trustworthy if the child itself rolled up cleanly. Mapping
    // child integrity onto the basis vocabulary makes an untrusted child block
    // its parent, which is the correct behaviour for an assembly tree.
    if (!childrenError && children && children.length > 0) {
      const childIds = children.map(c => c.id);
      const { data: childCosts, error: costsError } = await client
        .from('bom_item_costs')
        .select('bom_item_id, total_cost, currency_code, currency_integrity')
        .in('bom_item_id', childIds);
      if (costsError) {
        this.logger.error(`Error fetching children costs: ${costsError.message}`, 'BomItemCostService');
        throw new NotFoundException(`Cannot roll up ${bomItemId}: children costs unavailable`);
      }
      for (const child of children) {
        const cc = childCosts?.find(x => x.bom_item_id === child.id);
        if (!cc) continue;
        amounts.push({
          kind: 'direct_children',
          amount: (parseFloat(cc.total_cost) || 0) * (parseFloat(child.quantity) || 1),
          currency: cc.currency_code ?? null,
          basis: cc.currency_integrity === 'consistent' ? 'local' : 'legacy_unverified',
          ref: child.id,
        });
      }
    }

    // The five source tables. Column names are the real ones, and every error
    // is checked -- an unreadable source must abort the rollup, never quietly
    // contribute zero.
    const sources: Array<{
      table: string; kind: RollupInputKind; amountCol: string; hasCurrency: boolean;
    }> = [
      { table: 'raw_material_cost_records',        kind: 'raw_material',        amountCol: 'total_cost',           hasCurrency: true },
      { table: 'packaging_logistics_cost_records', kind: 'packaging_logistics', amountCol: 'total_cost',           hasCurrency: true },
      { table: 'procured_parts_cost_records',      kind: 'procured_parts',      amountCol: 'total_cost',           hasCurrency: true },
      { table: 'tooling_cost_records',             kind: 'tooling',             amountCol: 'total_cost',           hasCurrency: true },
      { table: 'process_cost_records',             kind: 'process',             amountCol: 'total_cost_per_part',  hasCurrency: true },
    ];

    for (const src of sources) {
      const { data, error } = await client
        .from(src.table)
        .select(`id, ${src.amountCol}, currency, cost_currency_basis`)
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true);
      if (error) {
        this.logger.error(`Rollup source ${src.table} unreadable: ${error.message}`, 'BomItemCostService');
        throw new NotFoundException(
          `Cannot roll up ${bomItemId}: ${src.table} could not be read (${error.message})`,
        );
      }
      for (const row of data ?? []) {
        amounts.push({
          kind: src.kind,
          amount: parseFloat((row as Record<string, any>)[src.amountCol]) || 0,
          currency: (row as Record<string, any>).currency ?? null,
          basis: (row as Record<string, any>).cost_currency_basis ?? null,
          ref: (row as Record<string, any>).id ?? null,
        });
      }
    }

    // ONE snapshot for this entire rollup. convertOptional returns null rather
    // than guessing when the snapshot has no rate, which is what lets the core
    // fail closed instead of inventing an FX rate.
    const rates = await this.exchangeRateService.getSnapshot(accessToken);
    const reportingCurrency = ROLLUP_REPORTING_CURRENCY;
    const rollup = computeCurrencyAwareRollup({
      amounts,
      reportingCurrency,
      rateToReporting: (from) =>
        from === reportingCurrency ? 1 : (rates.convertOptional(from, reportingCurrency) ?? null),
    });

    // Provenance is written either way: a refusal is as much a result as a
    // total, and the row must be able to explain which input blocked it.
    const patch: Record<string, unknown> = {
      currency_integrity: rollup.integrity,
      rollup_provenance: rollup.provenance as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    if (rollup.trusted && rollup.totals) {
      const t = rollup.totals;
      const sgaPercentage = parseFloat(costRecord.sgaPercentage as any) || 0;
      const profitPercentage = parseFloat(costRecord.profitPercentage as any) || 0;
      Object.assign(patch, {
        currency_code:            rollup.reportingCurrency,
        raw_material_cost:        t.raw_material,
        packaging_logistics_cost: t.packaging_logistics,
        procured_parts_cost:      t.procured_parts,
        process_cost:             t.process,
        tooling_cost:             t.tooling,
        direct_children_cost:     t.direct_children,
        own_cost:                 t.own_cost,
        total_cost:               t.total_cost,
        unit_cost:                t.unit_cost,
        extended_cost:            t.total_cost * (parseFloat(item.quantity) || 1),
        selling_price:            t.total_cost * (1 + sgaPercentage / 100) * (1 + profitPercentage / 100),
        // Only a complete, fully-converted rollup clears staleness.
        is_stale:                 false,
        last_calculated_at:       new Date().toISOString(),
      });
    } else {
      // Fail closed. Existing money is left EXACTLY as it stands -- not zeroed,
      // not converted, not guessed -- and the aggregate stays stale so nothing
      // downstream mistakes it for a settled figure.
      patch.is_stale = true;
      this.logger.warn(
        `Rollup for ${bomItemId} left stale (${rollup.integrity}): untrusted inputs ` +
        `[${rollup.provenance.untrustedKinds.join(', ')}]`,
        'BomItemCostService',
      );
    }

    const { data: updated, error: updateError } = await client
      .from('bom_item_costs')
      .update(patch)
      .eq('bom_item_id', bomItemId)
      .select()
      .single();

    if (updateError || !updated) {
      this.logger.error(`Error updating cost: ${updateError?.message}`, 'BomItemCostService');
      throw new NotFoundException(`Failed to update cost for BOM item ${bomItemId}`);
    }

    this.logger.log(
      rollup.trusted && rollup.totals
        ? `Rolled up BOM item ${bomItemId}: total=${rollup.totals.total_cost} ${rollup.reportingCurrency} ` +
          `(integrity=${rollup.integrity}, rates=${JSON.stringify(rollup.provenance.fxRates)})`
        : `Rolled up BOM item ${bomItemId}: no total written (integrity=${rollup.integrity}), money left unchanged`,
      'BomItemCostService',
    );

    return this.transformToCamelCase(updated) as BomItemCostDto;
  }

  /**
   * Recursively recalculate costs for all parents up the tree
   */
  async recalculateParentCosts(bomItemId: string, userId: string, accessToken: string, organizationId?: string): Promise<void> {
    // Get parent item
    const { data: item, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('parent_item_id')
      .eq('id', bomItemId)
      .single();

    if (error || !item || !item.parent_item_id) {
      return; // No parent, we're done
    }

    const parentItemId = item.parent_item_id;

    // Recalculate parent cost
    await this.recalculateCost(parentItemId, userId, accessToken, organizationId);

    // Recursively recalculate grandparents
    await this.recalculateParentCosts(parentItemId, userId, accessToken, organizationId);
  }

  /**
   * Recalculate all costs for a BOM (bottom-up traversal)
   */
  async recalculateAllCosts(bomId: string, userId: string, accessToken: string, organizationId?: string): Promise<void> {
    this.logger.log(`Starting full cost recalculation for BOM ${bomId}`, 'BomItemCostService');

    // Get all items in the BOM
    const { data: allItems, error: itemsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, parent_item_id')
      .eq('bom_id', bomId);

    if (itemsError || !allItems) {
      this.logger.error(`Error fetching BOM items: ${itemsError?.message}`, 'BomItemCostService');
      return;
    }

    // Build parent-child map
    const children = new Map<string, string[]>();
    const roots: string[] = [];

    for (const item of allItems) {
      if (!item.parent_item_id) {
        roots.push(item.id);
      } else {
        if (!children.has(item.parent_item_id)) {
          children.set(item.parent_item_id, []);
        }
        children.get(item.parent_item_id)!.push(item.id);
      }
    }

    // Process bottom-up: start with leaf nodes
    const processOrder: string[] = [];
    const visited = new Set<string>();

    function dfs(itemId: string) {
      if (visited.has(itemId)) return;
      visited.add(itemId);

      // Process children first
      const itemChildren = children.get(itemId) || [];
      for (const childId of itemChildren) {
        dfs(childId);
      }

      // Then process this item
      processOrder.push(itemId);
    }

    // Start DFS from all roots
    for (const rootId of roots) {
      dfs(rootId);
    }

    // Recalculate costs in bottom-up order
    for (const itemId of processOrder) {
      await this.recalculateCost(itemId, userId, accessToken, organizationId);
    }

    this.logger.log(`Completed full cost recalculation for BOM ${bomId}: ${processOrder.length} items processed`, 'BomItemCostService');
  }

  /**
   * Get cost hierarchy for a BOM item
   */
  async getCostHierarchy(bomItemId: string, userId: string, accessToken: string): Promise<BomItemCostSummaryDto> {
    // Get item details
    const { data: item, error: itemError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, name, item_type')
      .eq('id', bomItemId)
      .single();

    if (itemError || !item) {
      this.logger.error(`BOM item not found: ${bomItemId}`, 'BomItemCostService');
      throw new NotFoundException(`BOM item ${bomItemId} not found`);
    }

    // Get cost with full breakdown
    const { data: cost } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select('total_cost, raw_material_cost, process_cost, tooling_cost, packaging_logistics_cost, procured_parts_cost, direct_children_cost, is_stale')
      .eq('bom_item_id', bomItemId)
      .single();

    // Get children count
    const { data: children } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id')
      .eq('parent_item_id', bomItemId);

    const summary: BomItemCostSummaryDto = {
      bomItemId: item.id,
      name: item.name,
      itemType: item.item_type,
      totalCost: parseFloat(cost?.total_cost || '0'),
      rawMaterialCost: parseFloat(cost?.raw_material_cost || '0'),
      processCost: parseFloat(cost?.process_cost || '0'),
      toolingCost: parseFloat(cost?.tooling_cost || '0'),
      packagingLogisticsCost: parseFloat(cost?.packaging_logistics_cost || '0'),
      procuredPartsCost: parseFloat(cost?.procured_parts_cost || '0'),
      directChildrenCost: parseFloat(cost?.direct_children_cost || '0'),
      isStale: cost?.is_stale || false,
      childrenCount: children?.length || 0,
    };

    // Get children recursively
    if (children && children.length > 0) {
      summary.children = await Promise.all(
        children.map(child => this.getCostHierarchy(child.id, userId, accessToken))
      );
    }

    return summary;
  }

  /**
   * Get all stale costs that need recalculation
   */
  async getStaleCosts(userId: string, accessToken: string): Promise<BomItemCostDto[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select('*')
      .eq('is_stale', true);

    if (error) {
      this.logger.error(`Error fetching stale costs: ${error.message}`, 'BomItemCostService');
      return [];
    }

    return (data || []).map(row => this.transformToCamelCase(row) as BomItemCostDto);
  }

  /**
   * Helper function to recursively get children with cost data
   */
  private async getChildrenCostSummary(
    parentItemId: string,
    userId: string,
    accessToken: string,
  ): Promise<BomItemCostSummaryDto[]> {
    // Get children with cost data
    const { data: childCosts, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select(`
        total_cost,
        raw_material_cost,
        process_cost,
        tooling_cost,
        packaging_logistics_cost,
        procured_parts_cost,
        direct_children_cost,
        is_stale,
        bom_item_id,
        bom_items!inner(id, name, item_type, parent_item_id)
      `)
      .eq('bom_items.parent_item_id', parentItemId);

    if (error || !childCosts) {
      return [];
    }

    const children: BomItemCostSummaryDto[] = [];

    for (const record of childCosts) {
      // bom_items is a single object from the join, not an array
      const item = Array.isArray(record.bom_items) ? record.bom_items[0] : record.bom_items;

      if (!item) continue;

      // Recursively get grandchildren
      const grandchildren = await this.getChildrenCostSummary(item.id, userId, accessToken);

      children.push({
        bomItemId: item.id,
        name: item.name,
        itemType: item.item_type,
        totalCost: parseFloat(record.total_cost || '0'),
        rawMaterialCost: parseFloat(record.raw_material_cost || '0'),
        processCost: parseFloat(record.process_cost || '0'),
        toolingCost: parseFloat(record.tooling_cost || '0'),
        packagingLogisticsCost: parseFloat(record.packaging_logistics_cost || '0'),
        procuredPartsCost: parseFloat(record.procured_parts_cost || '0'),
        directChildrenCost: parseFloat(record.direct_children_cost || '0'),
        isStale: record.is_stale || false,
        childrenCount: grandchildren.length,
        children: grandchildren.length > 0 ? grandchildren : undefined,
      });
    }

    return children;
  }

  /**
   * Get cost summary for a BOM (all top-level assemblies with recursive children)
   */
  async getBomCostSummary(bomId: string, userId: string, accessToken: string): Promise<BomItemCostSummaryDto[]> {
    // Get all root items (no parent) that have cost data
    const { data: costsWithItems, error: costsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select(`
        total_cost,
        raw_material_cost,
        process_cost,
        tooling_cost,
        packaging_logistics_cost,
        procured_parts_cost,
        direct_children_cost,
        is_stale,
        bom_item_id,
        bom_items!inner(id, name, item_type, parent_item_id, bom_id)
      `)
      .eq('bom_items.bom_id', bomId)
      .is('bom_items.parent_item_id', null);

    if (costsError || !costsWithItems) {
      this.logger.error(`Error fetching cost data: ${costsError?.message}`, 'BomItemCostService');
      return [];
    }

    const summaries: BomItemCostSummaryDto[] = [];

    for (const record of costsWithItems) {
      // bom_items is a single object from the join, not an array
      const item = Array.isArray(record.bom_items) ? record.bom_items[0] : record.bom_items;

      if (!item) continue;

      // Recursively get children with cost data
      const children = await this.getChildrenCostSummary(item.id, userId, accessToken);

      summaries.push({
        bomItemId: item.id,
        name: item.name,
        itemType: item.item_type,
        totalCost: parseFloat(record.total_cost || '0'),
        rawMaterialCost: parseFloat(record.raw_material_cost || '0'),
        processCost: parseFloat(record.process_cost || '0'),
        toolingCost: parseFloat(record.tooling_cost || '0'),
        packagingLogisticsCost: parseFloat(record.packaging_logistics_cost || '0'),
        procuredPartsCost: parseFloat(record.procured_parts_cost || '0'),
        directChildrenCost: parseFloat(record.direct_children_cost || '0'),
        isStale: record.is_stale || false,
        childrenCount: children.length,
        children: children.length > 0 ? children : undefined,
      });
    }

    return summaries;
  }

  /**
   * Get comprehensive cost report for a BOM
   */
  async getBomCostReport(bomId: string, userId: string, accessToken: string): Promise<any> {
    this.logger.log(`Generating cost report for BOM ${bomId}`, 'BomItemCostService');

    // Get BOM details
    const { data: bom, error: bomError } = await this.supabaseService
      .getClient(accessToken)
      .from('boms')
      .select('id, name')
      .eq('id', bomId)
      .single();

    if (bomError || !bom) {
      this.logger.error(`BOM not found: ${bomId}`, 'BomItemCostService');
      throw new NotFoundException(`BOM ${bomId} not found`);
    }

    // Get all items in the BOM
    const { data: allItems, error: itemsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, name, item_type, parent_item_id')
      .eq('bom_id', bomId);

    if (itemsError || !allItems) {
      this.logger.error(`Error fetching BOM items: ${itemsError?.message}`, 'BomItemCostService');
      return this.getEmptyReport(bomId, bom.name);
    }

    const totalItems = allItems.length;
    const itemIds = allItems.map(item => item.id);

    // Get all cost records for these items
    const { data: costs, error: costsError } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_item_costs')
      .select('*')
      .in('bom_item_id', itemIds);

    if (costsError) {
      this.logger.error(`Error fetching costs: ${costsError.message}`, 'BomItemCostService');
      return this.getEmptyReport(bomId, bom.name);
    }

    const costsMap = new Map(costs?.map(c => [c.bom_item_id, c]) || []);
    const itemsWithCosts = costs?.length || 0;
    const staleCosts = costs?.filter(c => c.is_stale).length || 0;

    // Calculate cost by type
    const costByType = new Map<string, any>();

    for (const item of allItems) {
      const cost = costsMap.get(item.id);
      const itemType = item.item_type;

      if (!costByType.has(itemType)) {
        costByType.set(itemType, {
          itemType,
          count: 0,
          rawMaterialCost: 0,
          processCost: 0,
          toolingCost: 0,
          packagingLogisticsCost: 0,
          procuredPartsCost: 0,
          ownCost: 0,
          totalCost: 0,
        });
      }

      const typeData = costByType.get(itemType);
      typeData.count += 1;

      if (cost) {
        typeData.rawMaterialCost += parseFloat(cost.raw_material_cost || '0');
        typeData.processCost += parseFloat(cost.process_cost || '0');
        typeData.toolingCost += parseFloat(cost.tooling_cost || '0');
        typeData.packagingLogisticsCost += parseFloat(cost.packaging_logistics_cost || '0');
        typeData.procuredPartsCost += parseFloat(cost.procured_parts_cost || '0');
        typeData.ownCost += parseFloat(cost.own_cost || '0');
        typeData.totalCost += parseFloat(cost.total_cost || '0');
      }
    }

    // Calculate breakdown components from ALL items (to show full project breakdown)
    // But calculate total_cost from ROOT items only (to avoid double counting)
    let totalRawMaterialCost = 0;
    let totalProcessCost = 0;
    let totalToolingCost = 0;
    let totalPackagingLogisticsCost = 0;
    let totalProcuredPartsCost = 0;

    // Sum component costs from ALL items to show full project breakdown
    for (const cost of costs || []) {
      totalRawMaterialCost += parseFloat(cost.raw_material_cost || '0');
      totalProcessCost += parseFloat(cost.process_cost || '0');
      totalToolingCost += parseFloat(cost.tooling_cost || '0');
      totalPackagingLogisticsCost += parseFloat(cost.packaging_logistics_cost || '0');
      totalProcuredPartsCost += parseFloat(cost.procured_parts_cost || '0');
    }

    // Calculate totals from ROOT items only (to avoid double counting in total_cost)
    const rootItems = allItems.filter(item => !item.parent_item_id);
    let rootTotalCost = 0;
    let totalSgaPercentage = 0;
    let totalProfitPercentage = 0;
    let rootSellingPrice = 0;
    let rootItemsWithCostCount = 0;

    for (const rootItem of rootItems) {
      const cost = costsMap.get(rootItem.id);
      if (cost) {
        rootTotalCost += parseFloat(cost.total_cost || '0');

        // Sum SGA and profit percentages for averaging
        totalSgaPercentage += parseFloat(cost.sga_percentage || '0');
        totalProfitPercentage += parseFloat(cost.profit_percentage || '0');

        // Calculate selling price with SGA and profit margins
        const totalCost = parseFloat(cost.total_cost || '0');
        const sgaPercentage = parseFloat(cost.sga_percentage || '0');
        const profitPercentage = parseFloat(cost.profit_percentage || '0');

        // Selling Price = Total Cost × (1 + SGA%) × (1 + Profit%)
        const sellingPrice = totalCost * (1 + sgaPercentage / 100) * (1 + profitPercentage / 100);
        rootSellingPrice += sellingPrice;

        rootItemsWithCostCount += 1;
      }
    }

    const averageSgaPercentage = rootItemsWithCostCount > 0 ? totalSgaPercentage / rootItemsWithCostCount : 0;
    const averageProfitPercentage = rootItemsWithCostCount > 0 ? totalProfitPercentage / rootItemsWithCostCount : 0;

    // Get top-level assemblies
    const topLevelAssemblies = rootItems.map(item => {
      const cost = costsMap.get(item.id);
      const totalCost = parseFloat(cost?.total_cost || '0');
      const sgaPercentage = parseFloat(cost?.sga_percentage || '0');
      const profitPercentage = parseFloat(cost?.profit_percentage || '0');

      // Calculate selling price with margins
      const sellingPrice = totalCost * (1 + sgaPercentage / 100) * (1 + profitPercentage / 100);

      return {
        id: item.id,
        name: item.name,
        itemType: item.item_type,
        totalCost,
        sellingPrice,
      };
    });

    return {
      bomId: bom.id,
      bomName: bom.name,
      totalItems,
      itemsWithCosts,
      staleCosts,
      costByType: Array.from(costByType.values()),
      breakdown: {
        totalRawMaterialCost,
        totalProcessCost,
        totalToolingCost,
        totalPackagingLogisticsCost,
        totalProcuredPartsCost,
        overallTotalCost: rootTotalCost, // Use root total cost to avoid double counting
        averageSgaPercentage,
        averageProfitPercentage,
        totalSellingPrice: rootSellingPrice, // Use root selling price
      },
      topLevelAssemblies,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get empty report structure
   */
  private getEmptyReport(bomId: string, bomName: string): any {
    return {
      bomId,
      bomName,
      totalItems: 0,
      itemsWithCosts: 0,
      staleCosts: 0,
      costByType: [],
      breakdown: {
        totalRawMaterialCost: 0,
        totalProcessCost: 0,
        totalToolingCost: 0,
        totalPackagingLogisticsCost: 0,
        totalProcuredPartsCost: 0,
        totalDirectChildrenCost: 0,
        overallTotalCost: 0,
        averageSgaPercentage: 0,
        averageProfitPercentage: 0,
        totalSellingPrice: 0,
      },
      topLevelAssemblies: [],
      generatedAt: new Date().toISOString(),
    };
  }
}
