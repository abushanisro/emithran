import { Injectable, Logger } from '@nestjs/common';

import { SupabaseService } from '../../../common/supabase/supabase.service';

/**
 * Dispatcher: routes Claude tool_use blocks to the correct backend service
 * method, applies a hard timeout, and shapes the return for tool_result.
 *
 * All handlers are READ-ONLY in v1. Adding a write tool requires:
 *   1) explicit approval-gate in the controller (user confirms),
 *   2) audit logging via LoggerModule,
 *   3) bumping `credits_charged`.
 *
 * Each handler is kept ~30 lines: validate, fetch, shape, return. No business
 * logic lives here — we compose existing services.
 *
 * Why the queries are direct Supabase calls rather than service-injection:
 * Echo lives in a separate module and pulling 12 NestJS services into its
 * constructor would create import cycles (BOMItemsModule already depends on
 * ProcessesModule, which depends on Calculators, etc.). The Supabase view
 * surface is stable and already RLS-scoped, so direct queries with the user's
 * token are safe and decoupled.
 */
export interface ToolCallContext {
  userId: string;
  accessToken: string | null;
}

export interface ToolCallResult {
  ok: boolean;
  data: unknown;
  /** Short preview suitable for SSE — trimmed. */
  preview: string;
  /** Error string if ok=false. */
  error?: string;
}

const HARD_TIMEOUT_MS = 12_000;

@Injectable()
export class ToolDispatcherService {
  private readonly logger = new Logger(ToolDispatcherService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async dispatch(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    try {
      const result = await Promise.race([
        this.invoke(name, input, ctx),
        this.timeout(HARD_TIMEOUT_MS, name),
      ]);
      return result;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.warn(`tool ${name} failed: ${msg}`);
      return { ok: false, data: null, preview: msg.slice(0, 200), error: msg };
    }
  }

  private timeout(ms: number, name: string): Promise<ToolCallResult> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`tool ${name} exceeded ${ms}ms`)), ms),
    );
  }

  private async invoke(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    switch (name) {
      case 'get_part_cost_breakdown':
        return this.getPartCostBreakdown(input, ctx);
      case 'get_dfm_review':
        return this.getDfmReview(input, ctx);
      case 'run_dfm_deep_analysis':
        return this.runDfmDeepAnalysis(input, ctx);
      case 'get_process_candidates':
        return this.getProcessCandidates(input, ctx);
      case 'rank_suppliers_for_part':
        return this.rankSuppliersForPart(input, ctx);
      case 'find_suppliers_with_capability':
        return this.findSuppliersWithCapability(input, ctx);
      case 'compare_cost_to_benchmark':
        return this.compareCostToBenchmark(input, ctx);
      case 'get_rfq_status':
        return this.getRfqStatus(input, ctx);
      case 'get_production_lot_status':
        return this.getProductionLotStatus(input, ctx);
      case 'get_drawing_analysis':
        return this.getDrawingAnalysis(input, ctx);
      case 'get_vave_ideas':
        return this.getVaveIdeas(input, ctx);
      default:
        return {
          ok: false,
          data: null,
          preview: `unknown tool ${name}`,
          error: `Unknown tool: ${name}`,
        };
    }
  }

  // ── Tool handlers ────────────────────────────────────────────────────────

  private async getPartCostBreakdown(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    const { data: item, error: itemErr } = await client
      .from('bom_items')
      .select('id, part_number, name, item_type, total_cost, currency, unit_cost')
      .eq('id', bomItemId)
      .maybeSingle();
    if (itemErr) throw new Error(`bom_items: ${itemErr.message}`);
    if (!item) return missing(`BOM item ${bomItemId} not found`);

    const fetches = await Promise.all([
      client.from('raw_material_cost_records').select('total_cost_per_unit, net_material_cost, scrap_adjustment, overhead_cost').eq('bom_item_id', bomItemId).eq('is_active', true).maybeSingle(),
      client.from('process_cost_records').select('total_cycle_cost_per_part, setup_cost_per_part, scrap_adjustment').eq('bom_item_id', bomItemId).eq('is_active', true),
      client.from('tooling_cost_records').select('total_cost').eq('bom_item_id', bomItemId).eq('is_active', true),
      client.from('packaging_logistics_cost_records').select('total_cost_per_part').eq('bom_item_id', bomItemId).eq('is_active', true).maybeSingle(),
      client.from('procured_parts_cost_records').select('total_cost_per_part').eq('bom_item_id', bomItemId).eq('is_active', true).maybeSingle(),
    ]);

    const material = num(fetches[0].data?.total_cost_per_unit);
    const process = sum(fetches[1].data ?? [], (r: any) => num(r.total_cycle_cost_per_part) + num(r.setup_cost_per_part));
    const tooling = sum(fetches[2].data ?? [], (r: any) => num(r.total_cost));
    const packaging = num(fetches[3].data?.total_cost_per_part);
    const procured = num(fetches[4].data?.total_cost_per_part);

    const ownTotal = material + process + tooling + packaging + procured;
    const totalCost = num(item.total_cost) || ownTotal || num(item.unit_cost);
    const pct = (n: number) => (totalCost > 0 ? Math.round((n / totalCost) * 1000) / 10 : 0);
    const currency = item.currency ?? 'INR';

    const data = {
      bomItemId,
      partNumber: item.part_number,
      partName: item.name,
      currency,
      breakdown: {
        material: { value: material, percent: pct(material) },
        process: { value: process, percent: pct(process) },
        tooling: { value: tooling, percent: pct(tooling) },
        packaging: { value: packaging, percent: pct(packaging) },
        procured: { value: procured, percent: pct(procured) },
      },
      ownTotal,
      totalCostWithChildren: totalCost,
      hasCostData: ownTotal > 0 || totalCost > 0,
    };

    if (!data.hasCostData) {
      return {
        ok: true,
        data,
        preview: `${item.name ?? item.part_number}: no cost records yet`,
      };
    }

    return {
      ok: true,
      data,
      preview: `${item.name ?? item.part_number}: total ${totalCost} ${currency} (material ${pct(material)}% / process ${pct(process)}% / tooling ${pct(tooling)}%)`,
    };
  }

  private async getDfmReview(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    // DFM results are denormalised onto bom_items (migration 076).
    const { data, error } = await client
      .from('bom_items')
      .select(
        'id, name, part_number, manufacturability_score, difficulty_level, recommended_processes, dfm_analysis, cad_analysis_warnings, geometry_analysis, analysis_timestamp, file_3d_path, file_2d_path',
      )
      .eq('id', bomItemId)
      .maybeSingle();

    if (error) throw new Error(`bom_items: ${error.message}`);
    if (!data) return missing(`BOM item ${bomItemId} not found`);

    if (data.manufacturability_score == null && !data.analysis_timestamp) {
      const hasFile = !!data.file_3d_path || !!data.file_2d_path;
      return {
        ok: true,
        data: {
          bomItemId,
          partName: data.name,
          hasAnalysis: false,
          hasDrawing: hasFile,
        },
        preview: hasFile
          ? 'No DFM analysis yet — user can run one from the BOM-item UI.'
          : 'No drawing uploaded — DFM needs a drawing first.',
      };
    }

    const ageDays = data.analysis_timestamp
      ? (Date.now() - new Date(data.analysis_timestamp).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    const stale = ageDays > 7;

    // Score is 0..1 in the DB; rescale to 0..100 for human readability.
    const scoreRaw = data.manufacturability_score;
    const score100 = typeof scoreRaw === 'number'
      ? Math.round(scoreRaw <= 1 ? scoreRaw * 100 : scoreRaw)
      : null;

    return {
      ok: true,
      data: {
        bomItemId,
        partName: data.name,
        partNumber: data.part_number,
        hasAnalysis: true,
        stale,
        ageDays: Math.round(ageDays * 10) / 10,
        manufacturabilityScore: score100,
        difficultyLevel: data.difficulty_level,
        recommendedProcesses: data.recommended_processes,
        warnings: data.cad_analysis_warnings,
        dfm: data.dfm_analysis,
        geometry: data.geometry_analysis,
      },
      preview: `${data.name ?? data.part_number}: score ${score100 ?? '?'}/100 (${data.difficulty_level ?? 'unknown'})${stale ? ' [stale]' : ''}`,
    };
  }

  private async runDfmDeepAnalysis(
    input: Record<string, unknown>,
    _ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    // V1: not wiring the live cad-engine call from inside the tool to avoid
    // a multi-minute Echo turn. The tool returns guidance for the user to
    // trigger via the BOM-item UI's "Run DFM" button, which already invokes
    // CADAnalysisService.analyzeBOMItem(). When we wire it live, this is
    // the only function that changes.
    return {
      ok: true,
      data: {
        bomItemId,
        triggered: false,
        guidance:
          'Live deep DFM analysis takes 5-15s and is initiated from the BOM-item UI ("Run DFM"). Tell the user to click that button; results appear in this conversation as soon as they land.',
      },
      preview: 'guided user to run deep DFM from the BOM-item UI',
    };
  }

  private async getProcessCandidates(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    // Latest draft from the process-plan generator carries the considered set.
    const { data, error } = await client
      .from('process_plan_generations')
      .select('id, status, candidates, abstract_plan, created_at')
      .eq('bom_item_id', bomItemId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`process_plan_generations: ${error.message}`);
    if (!data) return missing('No process plan draft yet — recommend generating one.');

    const cands: any = data.candidates ?? {};
    const counts = {
      rawMaterials: (cands.rawMaterials ?? []).length,
      machines: (cands.machines ?? []).length,
      labour: (cands.labour ?? []).length,
      processes: (cands.processes ?? []).length,
      calculators: (cands.calculators ?? []).length,
    };
    return {
      ok: true,
      data: { bomItemId, status: data.status, counts, candidates: cands, abstractPlan: data.abstract_plan },
      preview: `materials ${counts.rawMaterials} / machines ${counts.machines} / processes ${counts.processes}`,
    };
  }

  private async rankSuppliersForPart(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const nominationId = optionalString(input, 'nominationId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    let query = client
      .from('part_wise_cost_analysis')
      .select('id, nomination_id, bom_item_id, vendor_id, vendor_name, net_price_unit, development_cost, lead_time_days, cost_competency_score, total_score, overall_rank, financial_risk')
      .eq('bom_item_id', bomItemId)
      .order('overall_rank', { ascending: true, nullsFirst: false })
      .limit(10);
    if (nominationId) query = query.eq('nomination_id', nominationId);
    const { data, error } = await query;
    if (error) throw new Error(`part_wise_cost_analysis: ${error.message}`);
    if (!data || data.length === 0) return missing('No supplier rankings — recommend creating a nomination.');

    const top = data.slice(0, 5).map((r: any) => ({
      vendor: r.vendor_name,
      netPriceUnit: r.net_price_unit,
      leadTimeDays: r.lead_time_days,
      developmentCost: r.development_cost,
      overallRank: r.overall_rank,
      totalScore: r.total_score,
      financialRisk: r.financial_risk,
    }));
    const lead = top[0];
    return {
      ok: true,
      data: { bomItemId, nominationId, top },
      preview: `Top: ${lead?.vendor} @ ${lead?.netPriceUnit} / ${lead?.leadTimeDays}d (rank ${lead?.overallRank})`,
    };
  }

  private async findSuppliersWithCapability(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);
    const process = optionalString(input, 'process');
    const country = optionalString(input, 'country');
    const certification = optionalString(input, 'certification');
    const limit = Math.min(25, Math.max(1, Number(input.limit ?? 10)));

    let query = client
      .from('vendor_summary')
      .select('id, name, city, state, country, supplier_code, status, vendor_type, process, industries, certifications')
      .eq('status', 'active')
      .limit(limit);
    if (process) query = query.contains('process', [process]);
    if (country) query = query.eq('country', country);
    if (certification) query = query.contains('certifications', [certification]);

    const { data, error } = await query;
    if (error) throw new Error(`vendor_summary: ${error.message}`);
    return {
      ok: true,
      data: { count: data?.length ?? 0, vendors: data ?? [] },
      preview: `${data?.length ?? 0} vendors matched`,
    };
  }

  private async compareCostToBenchmark(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const processCategory = optionalString(input, 'processCategory');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    const { data: caps, error: capErr } = await client
      .from('supplier_capability_benchmarks')
      .select('process_category, parameter_name, min_value, max_value, typical_value, unit')
      .eq(processCategory ? 'process_category' : 'is_active', processCategory ?? true)
      .limit(20);
    if (capErr) throw new Error(`supplier_capability_benchmarks: ${capErr.message}`);

    return {
      ok: true,
      data: { bomItemId, processCategory, benchmarks: caps ?? [] },
      preview: `${caps?.length ?? 0} benchmark rows`,
    };
  }

  private async getRfqStatus(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const rfqId = requireString(input, 'rfqId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    const { data: rfq, error: rfqErr } = await client
      .from('rfq_tracking')
      .select('id, status, vendor_count, part_count, sent_at, created_at')
      .eq('id', rfqId)
      .maybeSingle();
    if (rfqErr) throw new Error(`rfq_tracking: ${rfqErr.message}`);
    if (!rfq) return missing(`RFQ ${rfqId} not found`);

    const { data: vendors, error: vErr } = await client
      .from('rfq_tracking_vendors')
      .select('vendor_id, vendor_name, status, quoted_amount, lead_time_days, responded_at')
      .eq('rfq_tracking_id', rfqId);
    if (vErr) throw new Error(`rfq_tracking_vendors: ${vErr.message}`);

    const pending = (vendors ?? []).filter((v: any) => v.status === 'pending').length;
    const responded = (vendors ?? []).filter((v: any) => v.status === 'responded' || v.responded_at).length;
    const pendingDays = rfq.sent_at ? Math.floor((Date.now() - new Date(rfq.sent_at).getTime()) / 86_400_000) : null;

    return {
      ok: true,
      data: {
        rfqId,
        status: rfq.status,
        sentAt: rfq.sent_at,
        pendingDays,
        vendors: vendors ?? [],
        counts: { invited: rfq.vendor_count, pending, responded },
      },
      preview: `${rfq.status}; ${responded}/${rfq.vendor_count} responded${pendingDays ? `; pending ${pendingDays}d` : ''}`,
    };
  }

  private async getProductionLotStatus(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const lotId = requireString(input, 'lotId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    const { data: lot, error: lotErr } = await client
      .from('production_planning_lots')
      .select('id, name, status, planned_quantity, completed_quantity, target_date, updated_at, created_at')
      .eq('id', lotId)
      .maybeSingle();
    if (lotErr) throw new Error(`production_planning_lots: ${lotErr.message}`);
    if (!lot) return missing(`Production lot ${lotId} not found`);

    const { count: openSubtasks } = await client
      .from('production_planning_subtasks')
      .select('id', { count: 'exact', head: true })
      .eq('lot_id', lotId)
      .neq('status', 'done');

    const staleDays = lot.updated_at ? Math.floor((Date.now() - new Date(lot.updated_at).getTime()) / 86_400_000) : null;
    return {
      ok: true,
      data: { lotId, status: lot.status, plannedQuantity: lot.planned_quantity, completedQuantity: lot.completed_quantity, targetDate: lot.target_date, openSubtasks: openSubtasks ?? 0, staleDays },
      preview: `${lot.status}, ${openSubtasks ?? 0} open subtasks, ${staleDays}d since update`,
    };
  }

  private async getDrawingAnalysis(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const bomItemId = requireString(input, 'bomItemId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    const { data, error } = await client
      .from('bom_items')
      .select('id, name, part_number, file_2d_path, file_3d_path, drawing_extraction, geometry_analysis, manufacturability_score, dfm_analysis')
      .eq('id', bomItemId)
      .maybeSingle();

    if (error) throw new Error(`bom_items: ${error.message}`);
    if (!data) return missing(`BOM item ${bomItemId} not found`);

    const drawing: any = data.drawing_extraction ?? null;
    const geometry: any = data.geometry_analysis ?? null;
    const has2d = !!data.file_2d_path;
    const has3d = !!data.file_3d_path;

    // Summarise drawing for preview
    const dimCount: number = drawing?.dimensions?.length ?? 0;
    const gdtCount: number = drawing?.gdt?.length ?? 0;
    const missingTols: string[] = [];
    if (drawing?.dimensions) {
      for (const d of drawing.dimensions) {
        if (d.upperTol == null && d.lowerTol == null && !d.toleranceClass) {
          missingTols.push(d.label ?? `dim ${d.nominal}${d.unit}`);
        }
      }
    }

    return {
      ok: true,
      data: {
        bomItemId,
        partName: data.name,
        partNumber: data.part_number,
        files: { has2dDrawing: has2d, has3dModel: has3d, path2d: data.file_2d_path ?? null, path3d: data.file_3d_path ?? null },
        drawing: drawing
          ? {
              available: true,
              drawingNumber: drawing.drawingNumber ?? null,
              title: drawing.title ?? null,
              generalTolerance: drawing.generalTolerance ?? null,
              material: drawing.material ?? null,
              heatTreatment: drawing.heatTreatment ?? null,
              hardness: drawing.hardness ?? null,
              dimensions: drawing.dimensions ?? [],
              gdt: drawing.gdt ?? [],
              surfaceFinishes: drawing.surfaceFinishes ?? [],
              threads: drawing.threads ?? [],
              holes: drawing.holes ?? [],
              notes: drawing.notes ?? [],
              extractionWarnings: drawing.extractionWarnings ?? [],
              dimensionsWithoutTolerance: missingTols,
            }
          : { available: false, reason: has2d ? 'Drawing uploaded but not yet extracted — run process plan generation to extract tolerances.' : 'No 2D drawing uploaded for this part.' },
        geometry: geometry
          ? {
              available: true,
              partFamily: geometry.partFamily ?? geometry.family ?? null,
              volumeMm3: geometry.volumeMm3 ?? geometry.volume ?? null,
              surfaceAreaMm2: geometry.surfaceAreaMm2 ?? geometry.surfaceArea ?? null,
              boundingBox: geometry.boundingBox ?? null,
              holeCount: geometry.holeCount ?? null,
              pocketCount: geometry.pocketCount ?? null,
              thinWallCount: geometry.thinWallCount ?? null,
              undercutCount: geometry.undercutCount ?? null,
              raw: geometry,
            }
          : { available: false, reason: has3d ? '3D model uploaded but geometry not yet extracted.' : 'No 3D model uploaded for this part.' },
      },
      preview: `2D: ${has2d ? (drawing ? `${dimCount} dims, ${gdtCount} GD&T, ${missingTols.length} missing tols` : 'uploaded, not extracted') : 'none'} | 3D: ${has3d ? (geometry ? `${geometry.partFamily ?? 'part'}, vol ${geometry.volumeMm3 ?? '?'} mm³` : 'uploaded, not extracted') : 'none'}`,
    };
  }

  private async getVaveIdeas(
    input: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const projectId = requireString(input, 'projectId');
    const vaveProjectId = optionalString(input, 'vaveProjectId');
    const client = this.supabase.getClient(ctx.accessToken ?? undefined);

    let query = client
      .from('vave_ideas')
      .select('id, vave_project_id, title, description, est_savings_usd, status, affected_bom_item_id, created_at')
      .order('est_savings_usd', { ascending: false })
      .limit(20);
    if (vaveProjectId) query = query.eq('vave_project_id', vaveProjectId);
    const { data, error } = await query;
    if (error) throw new Error(`vave_ideas: ${error.message}`);

    return {
      ok: true,
      data: { projectId, vaveProjectId, ideas: data ?? [], totalIdeas: data?.length ?? 0 },
      preview: `${data?.length ?? 0} VAVE ideas; top savings $${data?.[0]?.est_savings_usd ?? 0}`,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || !v) {
    throw new Error(`tool input missing required string '${key}'`);
  }
  return v;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function sum<T>(arr: T[], pick: (t: T) => number): number {
  return arr.reduce((a, t) => a + pick(t), 0);
}

function missing(message: string): ToolCallResult {
  return { ok: true, data: { available: false, message }, preview: message };
}
