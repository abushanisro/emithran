import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { SupabaseService } from '../../../common/supabase/supabase.service';

import type { DraftLine, DraftPackage, ProposedMaster } from '../dto/draft-line.dto';
import type {
  ApplyRequestDto,
  ApplyResultDto,
  CreateLineEditDto,
  LineOverrideDto,
  LineRemovalDto,
} from '../dto/apply-request.dto';

import { CreditMeterService } from './credit-meter.service';

/**
 * Stage 4 — transactional apply across the 5 cost-record tables, optional
 * master writes, line-edit capture.
 *
 * We sequence inserts and track inserted IDs so we can compensate (delete)
 * on a downstream failure. This is not true ACID across tables, but it's
 * the cleanest pattern given Supabase's JS-client constraint: we control
 * cleanup if the apply fails midway. For Phase 1 the failure surface is
 * narrow (FK violations from a master being deleted between draft and
 * apply); we accept this trade-off and note it. A follow-up can move the
 * apply into a Postgres function for true ACID.
 */
@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly creditMeter: CreditMeterService,
  ) {}

  async apply(
    generationId: string,
    body: ApplyRequestDto,
    userId: string,
    accessToken: string | null,
  ): Promise<ApplyResultDto> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);

    // ── Load the generation ────────────────────────────────────────────────
    const { data: gen, error: genErr } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('id', generationId)
      .single();

    if (genErr || !gen) {
      throw new NotFoundException(`Generation ${generationId} not found`);
    }
    if (gen.user_id !== userId) {
      throw new ForbiddenException('Generation does not belong to this user');
    }
    if (gen.status !== 'draft_ready') {
      throw new BadRequestException(`Generation is in status '${gen.status}', cannot apply`);
    }

    const draft: DraftPackage = gen.draft_lines as DraftPackage;
    if (!draft || !Array.isArray(draft.draftLines)) {
      throw new BadRequestException('Generation has no draft to apply');
    }

    // ── Apply user overrides + removals ────────────────────────────────────
    const removals = new Set<string>(
      (body.removals ?? []).map((r) => keyOf(r.kind, r.index)),
    );
    const overrides = new Map<string, LineOverrideDto>(
      (body.overrides ?? []).map((o) => [keyOf(o.kind, o.index), o]),
    );

    const linesToApply: DraftLine[] = draft.draftLines
      .filter((l) => !removals.has(keyOf(l.kind, l.index)))
      .map((l) => {
        const ov = overrides.get(keyOf(l.kind, l.index));
        if (!ov) return l;
        return { ...l, data: { ...l.data, ...ov.data } } as DraftLine;
      });

    // ── Approved proposed masters ──────────────────────────────────────────
    const approvalMap = new Map<string, boolean>(
      (body.proposedMasterApprovals ?? []).map((a) => [a.proposedMasterId, a.approved]),
    );
    const approvedMasters: ProposedMaster[] = (draft.proposedMasters ?? []).map((pm) => ({
      ...pm,
      approved: approvalMap.get(pm.proposedMasterId) ?? false,
    }));

    // ── Insert masters first so lines can reference their new IDs ──────────
    const newMasterIdByRef = new Map<string, string>();
    const insertedMasters = { rawMaterials: [] as string[], processes: [] as string[] };
    const insertedLines = { rawMaterials: [] as string[], processes: [] as string[], tooling: [] as string[], logistics: [] as string[], procuredParts: [] as string[] };

    const bomItemId = gen.bom_item_id as string;

    // Extract location from the stored brief (available at generation time from Digital Factory selection)
    const storedBriefForLocation = gen.brief as any;
    const appliedLocation: string | null =
      storedBriefForLocation?.context?.location ??
      storedBriefForLocation?.scope?.location ??
      null;

    try {
      for (const pm of approvedMasters.filter((m) => m.approved)) {
        if (pm.kind === 'raw_material') {
          const insertPayload = {
            user_id: userId,
            material_group: (pm.data as any).materialGroup,
            material: (pm.data as any).material,
            material_grade: (pm.data as any).grade,
            density_kg_m3: (pm.data as any).densityKgPerM3,
            cost: (pm.data as any).unitCostInrPerKg,
            currency: 'INR',
            location: (pm.data as any).location ?? 'India-Bangalore',
          };
          const { data, error } = await client.from('raw_materials').insert(insertPayload).select('id').single();
          if (error) throw new Error(`raw_materials insert failed: ${error.message}`);
          insertedMasters.rawMaterials.push(data.id);
          newMasterIdByRef.set(pm.proposedMasterId, data.id);
        } else if (pm.kind === 'process') {
          const insertPayload = {
            process_group: (pm.data as any).processGroup,
            process_route: (pm.data as any).processRoute,
            operation: (pm.data as any).operation,
            is_active: true,
          };
          const { data, error } = await client.from('process_calculator_mappings').insert(insertPayload).select('id').single();
          if (error) throw new Error(`process_calculator_mappings insert failed: ${error.message}`);
          insertedMasters.processes.push(data.id);
          newMasterIdByRef.set(pm.proposedMasterId, data.id);
        }
      }

      // ── Now insert all lines, resolving newMasterRef → real ID where needed
      for (const line of linesToApply) {
        switch (line.kind) {
          case 'raw_material': {
            const materialId = line.data.materialId ?? (line.data.newMasterRef ? newMasterIdByRef.get(line.data.newMasterRef) : null);
            const payload = {
              bom_item_id: bomItemId,
              user_id: userId,
              material_name: line.data.materialName,
              material_category: line.data.materialCategory,
              material_description: line.data.materialGrade ?? (line.data as any).materialDescription ?? null,
              unit_cost: line.data.unitCost,
              gross_usage: line.data.grossUsage,
              net_usage: line.data.netUsage,
              scrap: line.data.scrapPercentage,
              overhead: line.data.overheadPercentage,
              material_id: materialId ? String(materialId) : null,
              uom: (line.data as any).uom ?? 'KG',
              is_active: true,
            };
            const { data, error } = await client.from('raw_material_cost_records').insert(payload).select('id').single();
            if (error) throw new Error(`raw_material_cost_records insert failed: ${error.message}`);
            insertedLines.rawMaterials.push(data.id);
            break;
          }
          case 'process': {
            const processId = line.data.processId ?? (line.data.newMasterRef ? newMasterIdByRef.get(line.data.newMasterRef) : null);
            const payload = {
              bom_item_id: bomItemId,
              user_id: userId,
              process_id: processId,
              mhr_id: line.data.mhrId,
              lhr_id: line.data.lhrId,
              machine_name: line.data.machineName,
              labor_type: line.data.labourType,
              op_nbr: line.data.opNbr,
              direct_rate: line.data.directRate,
              machine_rate: line.data.machineRate,
              labor_rate: line.data.labourRate,
              setup_manning: line.data.setupManning,
              setup_time: line.data.setupTimeMinutes,
              batch_size: line.data.batchSize,
              heads: line.data.heads,
              cycle_time: line.data.cycleTimeSeconds,
              parts_per_cycle: line.data.partsPerCycle,
              scrap: line.data.scrapPercentage,
              currency: 'INR',
              is_active: true,
              process_group: line.data.processGroup ?? null,
              process_route: line.data.processRoute ?? null,
              operation: line.data.operation ?? null,
              feature_id:    line.data.featureId    ?? null,
              feature_type:  line.data.featureType  ?? null,
              feature_group: line.data.featureGroup ?? null,
              location:      appliedLocation,
              is_override:   false,
              timing_source: line.data.timingSource ?? null,
            };
            const { data, error } = await client.from('process_cost_records').insert(payload).select('id').single();
            if (error) throw new Error(`process_cost_records insert failed: ${error.message}`);
            insertedLines.processes.push(data.id);
            break;
          }
          case 'tooling': {
            const payload = {
              bom_item_id: bomItemId,
              user_id: userId,
              tooling_type: line.data.toolingType,
              description: line.data.description,
              specifications: line.data.specifications,
              unit_cost: line.data.unitCost,
              quantity: line.data.quantity,
              amortization_parts: line.data.amortizationParts,
              usage_percentage: line.data.usagePercentage,
              is_custom: line.data.isCustom,
            };
            const { data, error } = await client.from('tooling_cost_records').insert(payload).select('id').single();
            if (error) throw new Error(`tooling_cost_records insert failed: ${error.message}`);
            insertedLines.tooling.push(data.id);
            break;
          }
          case 'logistics': {
            const payload = {
              bom_item_id: bomItemId,
              user_id: userId,
              cost_name: line.data.costName,
              logistics_type: line.data.logisticsType,
              mode_of_transport: line.data.modeOfTransport,
              cost_basis: line.data.costBasis,
              unit_cost: line.data.unitCost,
              quantity: line.data.quantity,
              parameters: { notes: line.data.parameters ?? '' },
            };
            const { data, error } = await client.from('packaging_logistics_cost_records').insert(payload).select('id').single();
            if (error) throw new Error(`packaging_logistics_cost_records insert failed: ${error.message}`);
            insertedLines.logistics.push(data.id);
            break;
          }
          case 'procured_part': {
            const payload = {
              bom_item_id: bomItemId,
              user_id: userId,
              part_name: line.data.partName,
              part_number: line.data.partNumber,
              supplier_name: line.data.supplierName,
              unit_cost: line.data.unitCost,
              quantity: line.data.quantity,
              scrap_percentage: line.data.scrapPercentage,
              overhead_percentage: line.data.overheadPercentage,
              lead_time_days: line.data.leadTimeDays,
            };
            const { data, error } = await client.from('procured_parts_cost_records').insert(payload).select('id').single();
            if (error) throw new Error(`procured_parts_cost_records insert failed: ${error.message}`);
            insertedLines.procuredParts.push(data.id);
            break;
          }
        }
      }

      // ── Trigger bom_item_costs recompute via is_stale flag
      const { error: staleErr } = await client
        .from('bom_item_costs')
        .update({ is_stale: true, updated_at: new Date().toISOString() })
        .eq('bom_item_id', bomItemId);
      if (staleErr) {
        this.logger.warn(`Failed to mark bom_item_costs stale: ${staleErr.message}`);
        // Not fatal — the existing CRUD triggers should already handle this
      }

      const creditCost = this.creditMeter.costFor(userId, bomItemId);

      // ── Mark generation applied
      const appliedLineIds = {
        rawMaterials: insertedLines.rawMaterials,
        processes: insertedLines.processes,
        tooling: insertedLines.tooling,
        logistics: insertedLines.logistics,
        procuredParts: insertedLines.procuredParts,
        newRawMaterialMasters: insertedMasters.rawMaterials,
        newProcessMasters: insertedMasters.processes,
      };

      // Snapshot the exchange rate used — read from the brief stored on the generation.
      // This ensures the applied record is reproducible (correct cost even if rates change).
      const storedBrief = gen.brief as any;
      const exchangeRateSnapshot = storedBrief?.context?.exchangeRateSnapshot ?? null;

      await client
        .from('process_plan_generations')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          applied_line_ids: appliedLineIds,
          credit_cost: creditCost,
          exchange_rate_snapshot: exchangeRateSnapshot,
          costing_currency: 'INR',
        })
        .eq('id', generationId);

      return {
        appliedLineIds,
        creditCost,
        totalCost: draft.costPreview.total,
      };
    } catch (err: any) {
      this.logger.error(`Apply failed: ${err.message}. Rolling back ${insertedLines.rawMaterials.length + insertedLines.processes.length + insertedLines.tooling.length + insertedLines.logistics.length + insertedLines.procuredParts.length} lines + ${insertedMasters.rawMaterials.length + insertedMasters.processes.length} masters`);
      await this.compensate(client, insertedLines, insertedMasters);
      // Mark generation failed (status stays draft_ready so user can retry after fixing)
      await client
        .from('process_plan_generations')
        .update({ error_message: err.message?.slice(0, 500), error_stage: 'persistence' })
        .eq('id', generationId);
      throw new BadRequestException(`Apply failed: ${err.message}`);
    }
  }

  async selectRoute(
    generationId: string,
    routeId: string,
    userId: string,
    accessToken: string | null,
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);

    const { data: gen, error: genErr } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('id', generationId)
      .single();

    if (genErr || !gen) throw new NotFoundException(`Generation ${generationId} not found`);
    if (gen.user_id !== userId) throw new ForbiddenException('Generation does not belong to this user');
    if (gen.status !== 'draft_ready') {
      throw new BadRequestException(`Cannot select route on status '${gen.status}'`);
    }

    const draft = gen.draft_lines as DraftPackage;
    const alternative = (draft.alternatives ?? []).find((a: any) => a.routeId === routeId);
    if (!alternative) throw new BadRequestException(`Route '${routeId}' not found in alternatives`);

    const updated: DraftPackage = {
      ...draft,
      draftLines: (alternative as any).draft.draftLines,
      proposedMasters: (alternative as any).draft.proposedMasters ?? draft.proposedMasters,
      costPreview: alternative.costPreview,
      templateUsed: (alternative as any).templateName ?? draft.templateUsed,
      selectedRouteId: routeId,
    };

    const { error } = await client
      .from('process_plan_generations')
      .update({ draft_lines: updated })
      .eq('id', generationId);

    if (error) throw new BadRequestException(`Failed to select route: ${error.message}`);
  }

  async recordLineEdit(
    generationId: string,
    body: CreateLineEditDto,
    userId: string,
    accessToken: string | null,
  ): Promise<{ id: string }> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);

    // Light ownership check (RLS will also enforce on insert)
    const { data: gen, error: genErr } = await client
      .from('process_plan_generations')
      .select('id, user_id, bom_item_id')
      .eq('id', generationId)
      .single();
    if (genErr || !gen) throw new NotFoundException(`Generation ${generationId} not found`);
    if (gen.user_id !== userId) throw new ForbiddenException('Generation does not belong to this user');

    const payload = {
      generation_id: generationId,
      bom_item_id: gen.bom_item_id,
      user_id: userId,
      line_kind: body.lineKind,
      line_index: body.lineIndex,
      field_path: body.fieldPath,
      original_value: body.originalValue ?? null,
      new_value: body.newValue ?? null,
      edit_action: body.editAction ?? 'field_change',
      edit_reason: body.editReason ?? null,
    };

    const { data, error } = await client
      .from('process_plan_line_edits')
      .insert(payload)
      .select('id')
      .single();

    if (error) throw new BadRequestException(`Failed to record line edit: ${error.message}`);
    return { id: data.id };
  }

  // ── Compensating delete on apply failure ───────────────────────────────────
  private async compensate(
    client: any,
    lines: { rawMaterials: string[]; processes: string[]; tooling: string[]; logistics: string[]; procuredParts: string[] },
    masters: { rawMaterials: string[]; processes: string[] },
  ): Promise<void> {
    const deleteIn = async (table: string, ids: string[]) => {
      if (!ids.length) return;
      try {
        const { error } = await client.from(table).delete().in('id', ids);
        if (error) this.logger.warn(`Rollback delete from ${table} failed: ${error.message}`);
      } catch (e: any) {
        this.logger.warn(`Rollback delete from ${table} threw: ${e.message}`);
      }
    };

    // Order: lines first, then masters (lines may FK to masters)
    await Promise.all([
      deleteIn('raw_material_cost_records', lines.rawMaterials),
      deleteIn('process_cost_records', lines.processes),
      deleteIn('tooling_cost_records', lines.tooling),
      deleteIn('packaging_logistics_cost_records', lines.logistics),
      deleteIn('procured_parts_cost_records', lines.procuredParts),
    ]);
    await Promise.all([
      deleteIn('raw_materials', masters.rawMaterials),
      deleteIn('processes', masters.processes),
    ]);
  }
}

function keyOf(kind: LineRemovalDto['kind'] | LineOverrideDto['kind'], index: number): string {
  return `${kind}#${index}`;
}
