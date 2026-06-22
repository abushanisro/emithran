import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

import {
  EngineeringBrief,
  BriefBomItem,
  BriefDfm,
} from '../dto/engineering-brief.dto';
import { CandidateSet } from '../dto/candidate-set.dto';
import { UNAVAILABLE_DRAWING_BRIEF } from '../dto/drawing-brief.dto';

import { rankMaterials } from '../ranking/material-ranker';
import { rankMachines } from '../ranking/machine-ranker';
import { rankLabour } from '../ranking/labour-ranker';
import { rankProcesses } from '../ranking/process-ranker';
import { rankCalculators } from '../ranking/calculator-ranker';
import { rankTooling } from '../ranking/tooling-ranker';

import { ScopeClassifierService } from './scope-classifier.service';
import { DrawingExtractorService } from './drawing-extractor.service';
import { ExchangeRateService } from './exchange-rate.service';
import { FeatureGraphService } from './feature-graph.service';
import { RuleEngineService } from './rule-engine.service';
import { ManufacturingKnowledgeService } from '../../../modules/manufacturing-knowledge/manufacturing-knowledge.service';
import { CADAnalysisService } from '../../bom-items/services/cad-analysis.service';

/**
 * Stage 1 — assembles the EngineeringBrief and a tenant-scoped CandidateSet.
 *
 * Every query here applies user_id (or RLS via the user-authenticated client)
 * so candidates leaving this stage are already tenant-safe. Stage 3 re-checks
 * ownership at apply time as defence-in-depth.
 *
 * The candidate counts (8 materials / 6 machines / 4 labour / 6 processes /
 * 4 calculators) are tuned to keep the LLM prompt under ~12K tokens with
 * caching enabled.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  // Top-N caps per kind — see plan section "Stage 1 RETRIEVAL & SCOPE GATE"
  static readonly TOP_N_MATERIALS = 8;
  static readonly TOP_N_MACHINES = 10;  // raised from 6: bench/inspection machines must coexist with CNC candidates
  static readonly TOP_N_LABOUR = 4;
  static readonly TOP_N_PROCESSES = 25;
  static readonly TOP_N_CALCULATORS = 6;  // raised from 4: drilling/tapping/thread-milling calculators must coexist with generic ones
  static readonly TOP_N_TOOLING = 8;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly scopeClassifier: ScopeClassifierService,
    private readonly drawingExtractor: DrawingExtractorService,
    private readonly fx: ExchangeRateService,
    private readonly featureGraph: FeatureGraphService,
    private readonly ruleEngine: RuleEngineService,
    private readonly knowledgeService: ManufacturingKnowledgeService,
    private readonly cadAnalysis: CADAnalysisService,
  ) {}

  async assemble(
    bomItemId: string,
    userId: string,
    accessToken: string | null,
  ): Promise<{ brief: EngineeringBrief; candidates: CandidateSet }> {
    // ── Load budget exchange rates (must happen before candidate queries) ───
    await this.fx.loadRates(accessToken);

    const client = this.supabaseService.getClient(accessToken ?? undefined);

    // ── Load BOM item ──────────────────────────────────────────────────────
    const { data: bomRow, error: bomErr } = await client
      .from('bom_items')
      .select('*')
      .eq('id', bomItemId)
      .single();

    if (bomErr || !bomRow) {
      throw new NotFoundException(`BOM item ${bomItemId} not found`);
    }

    // Tenancy guard (defence in depth — RLS should already enforce this)
    if (bomRow.user_id && bomRow.user_id !== userId) {
      throw new NotFoundException(`BOM item ${bomItemId} not found`);
    }

    // ── Resolve organization location ──────────────────────────────────────
    const orgLocation = await this.resolveOrgLocation(client, userId, bomRow);

    // ── Build BriefBomItem from row ────────────────────────────────────────
    const bomBrief: BriefBomItem = {
      id: String(bomRow.id),
      partNumber: String(bomRow.part_number ?? bomRow.partNumber ?? bomItemId),
      partName: String(bomRow.name ?? bomRow.part_name ?? ''),
      itemType: this.normaliseItemType(bomRow.item_type),
      quantity: numberOr(bomRow.quantity, 1),
      unit: String(bomRow.unit ?? 'pcs'),
      annualVolume: numberOr(bomRow.annual_volume ?? bomRow.annualVolume, 1000),
      unitWeightKg: numberOr(bomRow.unit_weight ?? bomRow.weight, 0),
      dimensions: {
        lengthMm: numberOr(bomRow.max_length ?? bomRow.length, 0),
        widthMm: numberOr(bomRow.max_width ?? bomRow.width, 0),
        heightMm: numberOr(bomRow.max_height ?? bomRow.height, 0),
      },
      tolerance: bomRow.tolerance ?? null,
      surfaceFinishRa: bomRow.surface_finish ?? null,
      heatTreatment: bomRow.heat_treatment ?? null,
      hardnessHrc: numberOr(bomRow.hardness, null),
      materialHint: bomRow.material ?? bomRow.material_grade ?? null,
      coating: bomRow.coating ?? null,
      tightestToleranceMm: bomRow.tightest_tolerance_mm != null
        ? parseFloat(bomRow.tightest_tolerance_mm)
        : null,
    };

    // ── On-demand STL analysis when geometry_analysis is absent ──────────────
    // geometry_analysis is normally populated when the user clicks "Analyse"
    // on the BOM item page. When that step was skipped, run it now so the
    // real mesh volume feeds into weight/cost instead of the bbox fill estimate.
    const hasGeometry = !!(bomRow.geometry_analysis && Object.keys(bomRow.geometry_analysis).length > 0);
    if (!hasGeometry && bomRow.file_3d_path && accessToken) {
      try {
        this.logger.log(`[assemble] geometry_analysis absent — triggering on-demand CAD analysis for ${bomItemId}`);
        const cadResult = await this.cadAnalysis.analyzeBOMItem({
          bomItemId,
          filePath: bomRow.file_3d_path,
          strategy: 'balanced',
          forceReanalysis: false,
          userId,
          accessToken,
        });
        if (cadResult?.geometryFeatures) {
          bomRow.geometry_analysis = cadResult.geometryFeatures;
          this.logger.log(
            `[assemble] On-demand CAD analysis done — ` +
            `volume=${cadResult.geometryFeatures.estimated_volume_mm3?.toFixed(0) ?? '?'}mm³, ` +
            `triangles=${cadResult.geometryFeatures.triangle_count ?? '?'}`,
          );
        }
      } catch (e: any) {
        this.logger.warn(`[assemble] On-demand CAD analysis failed (${e.message}) — falling back to bbox estimate`);
      }
    }

    // ── Pull DFM features from cached geometry_analysis / dfm_analysis ────
    const dfm = this.extractDfm(bomRow);

    // ── Extract 2D drawing data (cached or fresh from Claude vision) ──────
    // Done in parallel-ish with scope classification since neither depends on
    // the other. Drawing extraction is the longest single step when fresh
    // (~5–15s), so failing fast here avoids stalling the whole pipeline.
    const drawing = await this.drawingExtractor
      .getBriefFor(bomItemId, bomRow, accessToken)
      .catch((e) => {
        this.logger.warn(`Drawing extraction threw, continuing without it: ${e.message}`);
        return { ...UNAVAILABLE_DRAWING_BRIEF };
      });

    // ── Promote drawing fields — drawing is authoritative source of truth ──
    if (drawing.available) {
      // Material: drawing overrides BOM (BOM field is often a default placeholder)
      if (drawing.material) {
        bomBrief.materialHint = drawing.material;
      }
      // These fill gaps only (additive, not override)
      bomBrief.tolerance = bomBrief.tolerance ?? drawing.generalTolerance;
      bomBrief.heatTreatment = bomBrief.heatTreatment ?? drawing.heatTreatment;
      if (!bomBrief.hardnessHrc && drawing.hardness) {
        const m = drawing.hardness.match(/(\d{1,2}(?:\.\d)?)\s*-?\s*(\d{1,2}(?:\.\d)?)?\s*HRC/i);
        if (m) {
          const lo = parseFloat(m[1]);
          const hi = m[2] ? parseFloat(m[2]) : lo;
          bomBrief.hardnessHrc = (lo + hi) / 2;
        }
      }
      if (!bomBrief.surfaceFinishRa && drawing.surfaceFinishes.length > 0) {
        const finest = drawing.surfaceFinishes
          .filter((s) => typeof s.raMicrons === 'number')
          .sort((a, b) => (a.raMicrons ?? 99) - (b.raMicrons ?? 99))[0];
        if (finest?.raMicrons != null) {
          bomBrief.surfaceFinishRa = `Ra ${finest.raMicrons} μm`;
        }
      }
    }

    // Tolerance fallthrough: if the BOM tolerance field is empty but drawing_intelligence
    // recorded a tightest tolerance, synthesise a ±x mm string so the planner prompt
    // can apply its "tolerance ≤ 0.02 → add finish op" rules.
    if (!bomBrief.tolerance && bomBrief.tightestToleranceMm != null && bomBrief.tightestToleranceMm > 0) {
      bomBrief.tolerance = `±${bomBrief.tightestToleranceMm} mm`;
    }

    // ── Augment DFM hole count from 2D drawing when 3D scan missed holes ──
    if (drawing.available && drawing.holes.length > 0 && dfm.holeCount === 0) {
      dfm.holeCount = drawing.holes.length;
    }

    // ── Correct unit weight from geometry when BOM weight is absent or wrong ──
    // BOM weight is often 0 (not entered) or copied from an incorrect default.
    // When DFM volume is available, compute density-based weight and override when
    // the discrepancy is > 50 % of the geometry estimate.
    if (dfm.volumeMm3 > 0) {
      const densityKgPerM3 = estimateDensityKgPerM3(bomBrief.materialHint);
      const geomWeightKg = dfm.volumeMm3 * densityKgPerM3 * 1e-9;
      if (geomWeightKg > 0.0001) {
        const bomWeight = bomBrief.unitWeightKg;
        const discrepancyRatio = bomWeight > 0
          ? Math.abs(geomWeightKg - bomWeight) / Math.max(geomWeightKg, bomWeight)
          : 1.0;
        if (discrepancyRatio > 0.5) {
          this.logger.log(
            `[assemble] Unit weight: BOM=${bomWeight.toFixed(4)}kg → geometry=${geomWeightKg.toFixed(4)}kg` +
            ` (density=${Math.round(densityKgPerM3)}kg/m³, material="${bomBrief.materialHint ?? 'unknown'}", discrepancy=${(discrepancyRatio * 100).toFixed(0)}%)`,
          );
          bomBrief.unitWeightKg = geomWeightKg;
        }
      }
    }

    // ── Log drawing extraction status for traceability ─────────────────────
    if (!drawing.available && bomRow.file_2d_path) {
      this.logger.warn(
        `[assemble] Drawing at ${bomRow.file_2d_path} exists but extraction failed — ` +
        `plan will use BOM data only. Material: "${bomBrief.materialHint ?? 'unknown'}" (from BOM, not verified by drawing)`,
      );
    }

    // ── Run scope classifier (now with drawing-promoted fields) ────────────
    // If the user has pinned a manufacturing family, skip the classifier entirely.
    const familyOverride = bomRow.manufacturing_family_override as string | null | undefined;
    const scope = familyOverride
      ? (() => {
          this.logger.log(`[assemble] Manual family override "${familyOverride}" for ${bomItemId} — skipping classifier`);
          return { family: familyOverride as any, inScope: true, reason: `Manual override: user set family to "${familyOverride}"`, confidence: 1.0 };
        })()
      : this.scopeClassifier.classify(bomBrief, dfm);

    // ── Sheet metal volume correction ─────────────────────────────────────────
    // When no CAD volume exists, extractDfm uses 0.45 fill (calibrated for milled
    // blocks). Sheet metal frames/panels are mostly open air — 0.05 fill is more
    // accurate for a perimeter frame with cutouts. Correcting here (after scope is
    // known) keeps the 0.45 estimate available for the classifier above.
    if (scope.family === 'sheet_metal' && !dfm.fromCadEngine && dfm.volumeMm3 > 0) {
      const bboxVol =
        (dfm.boundingBox.lengthMm || 1) *
        (dfm.boundingBox.widthMm  || 1) *
        (dfm.boundingBox.heightMm || 1);
      if (bboxVol > 0) {
        const revised = bboxVol * 0.05;
        this.logger.log(
          `[assemble] Sheet metal fill correction: ${dfm.volumeMm3.toFixed(0)}mm³ (0.45 fill) → ${revised.toFixed(0)}mm³ (0.05 fill)`,
        );
        dfm.volumeMm3 = revised;
        const densityKgPerM3 = estimateDensityKgPerM3(bomBrief.materialHint);
        bomBrief.unitWeightKg = revised * densityKgPerM3 * 1e-9;
      }
    }

    // ── Load routing template from KB (null-safe: falls back to prompt defaults) ──
    let routingTemplate = null;
    if (scope.inScope) {
      routingTemplate = await this.knowledgeService
        .getTemplate(accessToken ?? '', scope.family)
        .catch(() => null);
      if (routingTemplate) {
        this.logger.log(`[assemble] Routing template: "${routingTemplate.template_name}" (${routingTemplate.routing_sequence.length} steps)`);
      }
    }

    // ── Build feature graph + mandatory ops from drawing + geometry ────────
    // Construct a partial brief first so feature-graph service can read it.
    const partialBrief = { bomItem: bomBrief, dfm, drawing, scope,
      context: { organizationLocation: orgLocation, currency: 'INR' as const, language: 'en' as const },
      featureGraph: { features: [], buildSources: [] as ('drawing' | 'geometry' | 'bom')[], overallConfidence: 1 },
      mandatoryOps: [],
    };
    const featureGraph = this.featureGraph.build(partialBrief as EngineeringBrief);
    const drawingNotes =
      typeof bomRow.drawing_intelligence === 'object' && bomRow.drawing_intelligence !== null
        ? String((bomRow.drawing_intelligence as any).drawing_notes ?? '')
        : '';
    const mandatoryOps = this.ruleEngine.evaluate(featureGraph, bomBrief, drawingNotes);

    const brief: EngineeringBrief = {
      bomItem: bomBrief,
      dfm,
      drawing,
      featureGraph,
      mandatoryOps,
      context: { organizationLocation: orgLocation, currency: 'INR', language: 'en', exchangeRateSnapshot: this.fx.snapshot() },
      scope,
      routingTemplate,
    };

    // ── If out of scope, skip candidate retrieval ─────────────────────────
    if (!scope.inScope) {
      return {
        brief,
        candidates: {
          rawMaterials: [],
          machines: [],
          labour: [],
          processes: [],
          calculators: [],
          tooling: [],
        },
      };
    }

    const family = scope.family as Exclude<typeof scope.family, 'out_of_scope'>;

    // ── Query masters in parallel ──────────────────────────────────────────
    const [materialsRaw, mhrRaw, lsrRaw, processesRaw, calculatorsRaw, toolingRaw] = await Promise.all([
      this.queryRawMaterials(client, userId, family),
      this.queryMhr(client, userId),
      this.queryLsr(client, userId),
      this.queryProcesses(client, userId, family),
      this.queryCalculators(client, userId),
      this.queryTooling(client, userId),
    ]);

    // ── Rank to top-N per kind ─────────────────────────────────────────────
    const rankedProcesses = rankProcesses(processesRaw, family, dfm, RetrievalService.TOP_N_PROCESSES);

    // ── Enrich process candidates with their lookup reference tables ────────
    // These tables contain shop-floor standard times the user has entered for
    // each process (e.g. "Swiss CNC Turning Time Standards"). When present,
    // Claude reads them to use real setup/cycle times instead of fallbacks.
    await this.enrichProcessReferenceTables(client, rankedProcesses);

    const candidates: CandidateSet = {
      rawMaterials: rankMaterials(materialsRaw, family, bomBrief.materialHint, orgLocation, RetrievalService.TOP_N_MATERIALS, {
        sheetThicknessMm: dfm.sheetThicknessMm,
        holeCount: dfm.holeCount,
        bendCount: dfm.bendCount,
        coating: bomBrief.coating ?? null,
      }),
      machines: rankMachines(mhrRaw, family, orgLocation, RetrievalService.TOP_N_MACHINES),
      labour: rankLabour(lsrRaw, orgLocation, RetrievalService.TOP_N_LABOUR),
      processes: rankedProcesses,
      calculators: rankCalculators(calculatorsRaw, family, RetrievalService.TOP_N_CALCULATORS),
      tooling: rankTooling(toolingRaw, family, RetrievalService.TOP_N_TOOLING),
    };

    this.logger.log(
      `Retrieved candidates for ${bomItemId}: ` +
      `rm=${candidates.rawMaterials.length}, ` +
      `mc=${candidates.machines.length}, ` +
      `lb=${candidates.labour.length}, ` +
      `op=${candidates.processes.length}, ` +
      `cl=${candidates.calculators.length}`,
    );

    return { brief, candidates };
  }

  // ── Per-kind queries ──────────────────────────────────────────────────────

  private async queryRawMaterials(client: any, userId: string, family: string) {
    const { data, error } = await client
      .from('raw_materials')
      .select('id, material_group, material, material_grade, density_kg_m3, cost, currency, location, user_id, material_form, material_family')
      .or(`material_group.ilike.%ferrous%,material_group.ilike.%non-ferrous%,material_group.ilike.%plastic%,material_group.ilike.%rubber%`)
      .limit(120);

    if (error) {
      this.logger.warn(`raw_materials query failed: ${error.message}`);
      return [];
    }

    // Convert each row's cost to INR using the budget rate for its declared currency.
    // The ranker reads `cost` and maps it to `unitCostInrPerKg` — so we overwrite
    // `cost` with the INR-converted value here, keeping the original in `cost_original`.
    return (data ?? []).map((row: any) => ({
      ...row,
      cost_original: row.cost,
      cost_original_currency: row.currency ?? 'INR',
      cost: this.fx.convertToInr(Number(row.cost ?? 0), row.currency ?? 'INR'),
    }));
  }

  private async queryMhr(client: any, userId: string) {
    const { data, error } = await client
      .from('mhr_records')
      .select('id, machine_name, machine_description, commodity_code, total_machine_hour_rate, currency_code, location, process_family')
      .not('total_machine_hour_rate', 'is', null)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) {
      this.logger.warn(`mhr_records query failed: ${error.message}`);
      return [];
    }

    // Convert to INR using the row's declared currency (defaults to INR for existing rows).
    // Today all rows are INR → passthrough. Future: Germany EUR, China CNY will convert correctly.
    return (data ?? []).map((row: any) => ({
      ...row,
      rate_inr: this.fx.convertToInr(Number(row.total_machine_hour_rate ?? 0), row.currency_code ?? 'INR'),
    }));
  }

  private async queryLsr(client: any, userId: string) {
    const { data, error } = await client
      .from('lsr_records')
      .select('id, labour_type, labour_code, lhr, currency_code, location')
      .not('lhr', 'is', null)
      .order('lhr', { ascending: true })
      .limit(40);
    if (error) {
      this.logger.warn(`lsr_records query failed: ${error.message}`);
      return [];
    }

    // Convert to INR using the row's declared currency (defaults to INR for existing rows).
    return (data ?? []).map((row: any) => ({
      ...row,
      lhr_inr: this.fx.convertToInr(Number(row.lhr ?? 0), row.currency_code ?? 'INR'),
    }));
  }

  private async queryProcesses(client: any, userId: string, family: string) {
    // Query process_calculator_mappings — the user's configured hierarchy
    // (group → route → operation). These are the only valid process choices
    // in the cost dialog, so the AI must select from here exclusively.
    const { data, error } = await client
      .from('process_calculator_mappings')
      .select('id, process_group, process_route, operation, calculator_id')
      .eq('is_active', true)
      .limit(200);
    if (error) {
      this.logger.warn(`process_calculator_mappings query failed: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async queryTooling(client: any, userId: string) {
    // Prefer template records (no bom_item_id) first, then fall back to all active records.
    const cols = 'id, tooling_type, description, specifications, unit_cost, quantity, amortization_parts, usage_percentage, total_cost, is_custom, supplier, is_active, user_id';
    const { data: templates } = await client
      .from('tooling_cost_records')
      .select(cols)
      .eq('user_id', userId)
      .is('bom_item_id', null)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(80);

    if (templates && templates.length >= 4) return templates;

    // Fallback: any active records for this user (de-duplication happens in ranker)
    const { data: all } = await client
      .from('tooling_cost_records')
      .select(cols)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(80);

    return all ?? [];
  }

  private async queryCalculators(client: any, userId: string) {
    const selectExpr = `
      id, name, calc_category, description, user_id, is_global,
      fields:calculator_fields(field_name, data_source, source_field, default_value),
      formulas:calculator_formulas(formula_name, formula_expression, execution_order, is_primary_result)
    `;
    // Return user-owned calculators + global/shared calculators in one query.
    const { data, error } = await client
      .from('calculators')
      .select(selectExpr)
      .or(`user_id.eq.${userId},is_global.eq.true`)
      .limit(40);
    if (error || !data || data.length === 0) {
      const { data: fallback } = await client
        .from('calculators')
        .select(selectExpr)
        .limit(40);
      return fallback ?? [];
    }
    return data;
  }

  // ── Process reference table enrichment ───────────────────────────────────

  private async enrichProcessReferenceTables(client: any, processes: any[]): Promise<void> {
    if (processes.length === 0) return;
    const processIds = processes.map((p) => p.dbId);

    const { data: tables, error } = await client
      .from('process_reference_tables')
      .select('id, process_id, table_name, column_definitions')
      .in('process_id', processIds);

    if (error || !tables || tables.length === 0) return;

    const tableIds = tables.map((t: any) => t.id);
    const { data: allRows } = await client
      .from('process_table_rows')
      .select('table_id, row_data')
      .in('table_id', tableIds)
      .order('row_order', { ascending: true });

    const rowsByTable = new Map<string, any[]>();
    for (const row of (allRows ?? [])) {
      if (!rowsByTable.has(row.table_id)) rowsByTable.set(row.table_id, []);
      rowsByTable.get(row.table_id)!.push(row.row_data);
    }

    const tablesByProcess = new Map<string, any[]>();
    for (const tbl of tables) {
      if (!tablesByProcess.has(tbl.process_id)) tablesByProcess.set(tbl.process_id, []);
      tablesByProcess.get(tbl.process_id)!.push({
        tableName: tbl.table_name,
        columnDefinitions: tbl.column_definitions ?? [],
        rows: rowsByTable.get(tbl.id) ?? [],
      });
    }

    for (const proc of processes) {
      proc.referenceTables = tablesByProcess.get(proc.dbId) ?? [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private extractDfm(bomRow: any): BriefDfm {
    const ga = bomRow.geometry_analysis ?? {};
    const da = bomRow.dfm_analysis ?? {};

    const fromCadEngine = !!(ga && Object.keys(ga).length > 0);
    const bbox = ga?.bounding_box ?? {};

    const lengthMm = numberOr(bbox.length ?? bbox.x, numberOr(bomRow.max_length ?? bomRow.length, 0));
    const widthMm  = numberOr(bbox.width  ?? bbox.y, numberOr(bomRow.max_width  ?? bomRow.width,  0));
    const heightMm = numberOr(bbox.height ?? bbox.z, numberOr(bomRow.max_height ?? bomRow.height, 0));

    const rawVolume = numberOr(ga.estimated_volume_mm3 ?? ga.volume_mm3, 0);
    const bboxVol   = lengthMm * widthMm * heightMm;

    // Sanity check: CAD engines occasionally emit near-zero artifact volumes (<1% of bounding box).
    // When detected, estimate from bounding box geometry instead.
    let volumeMm3: number;
    if (rawVolume > 0 && bboxVol > 0 && rawVolume < bboxVol * 0.01) {
      // Heuristic: if two shortest dims are within 20% of each other → cylindrical part
      const dims = [lengthMm, widthMm, heightMm].sort((a, b) => a - b);
      if (dims[1] / Math.max(dims[0], 1) < 1.2) {
        const avgDiam = (dims[0] + dims[1]) / 2;
        volumeMm3 = (Math.PI / 4) * avgDiam * avgDiam * dims[2];
      } else {
        volumeMm3 = bboxVol * 0.5; // box-like part, ~50% fill
      }
      this.logger.warn(
        `[extractDfm] Volume artifact: ${rawVolume.toFixed(1)}mm³ < 1% of bbox ${bboxVol.toFixed(0)}mm³ → estimated ${volumeMm3.toFixed(0)}mm³`,
      );
    } else if (rawVolume > 0) {
      volumeMm3 = rawVolume;
    } else if (bboxVol > 0) {
      // No 3D scan — apply a conservative fill factor rather than using full bounding box.
      // 0.45 is appropriate for milled parts with slots/pockets/holes; turned parts would be
      // closer to 0.65 but we don't know family here, so err on the side of under-estimation.
      volumeMm3 = bboxVol * 0.45;
      this.logger.log(
        `[extractDfm] No CAD volume — estimated from bbox ${bboxVol.toFixed(0)}mm³ × 0.45 fill factor = ${volumeMm3.toFixed(0)}mm³`,
      );
    } else {
      volumeMm3 = 0;
    }

    const mi = ga?.manufacturing_features?.manufacturing_intelligence?.features ?? {};

    return {
      volumeMm3,
      surfaceAreaMm2: numberOr(ga.surface_area_mm2 ?? ga.surface_area_estimation, 0),
      boundingBox: { lengthMm, widthMm, heightMm },
      holeCount: numberOr(da?.holes?.count ?? ga?.feature_detection?.holes_detected, 0),
      pocketCount: numberOr(da?.pockets?.count, 0),
      thinWallCount: (da?.thin_walls ?? 0) > 0 || ga?.feature_detection?.thin_walls ? 1 : 0,
      undercutCount: numberOr(da?.undercuts?.count, 0),
      fromCadEngine,
      bendCount:        numberOr(mi.bend_count, 0),
      slotCount:        numberOr(mi.slot_count, 0),
      cutLengthMm:      numberOr(mi.cut_length_mm, 0),
      sheetThicknessMm: numberOr(mi.sheet_thickness_mm, 0),
    };
  }

  private normaliseItemType(raw: unknown): 'assembly' | 'sub_assembly' | 'child_part' {
    const s = String(raw ?? '').toLowerCase();
    if (s.includes('assembly') && !s.includes('sub')) return 'assembly';
    if (s.includes('sub')) return 'sub_assembly';
    return 'child_part';
  }

  private async resolveOrgLocation(client: any, userId: string, bomRow: any): Promise<string> {
    // Try organizations table first (the workspace table introduced in 125)
    try {
      const { data } = await client
        .from('organizations')
        .select('country, city')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      if (data?.country) {
        return data.city ? `${data.country}-${data.city}` : data.country;
      }
    } catch (_) { /* ignore — table may not exist or column may differ */ }

    // Fall back to project location if available
    if (bomRow.project_location) return String(bomRow.project_location);
    return 'India-Bangalore';
  }
}

function numberOr(v: unknown, fallback: number): number;
function numberOr(v: unknown, fallback: null): number | null;
function numberOr(v: unknown, fallback: number | null): number | null {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Returns approximate material density in kg/m³ based on a free-text material hint.
 * Used to convert DFM volume → estimated unit weight when BOM weight is missing or incorrect.
 */
function estimateDensityKgPerM3(materialHint: string | null): number {
  const h = (materialHint ?? '').toLowerCase();
  // Specific alloys FIRST — most specific patterns before broad ones to prevent mis-matches
  // (e.g. "Aluminium Bronze" must not match the "alumin" rule → would give wrong density)
  if (/alumin[iu]+m?.?bronze|al.?bronze|aluminum.?bronze|albc/i.test(h)) return 8200; // Cu-Al alloy
  if (/phosphor.?bronze|phos.?bronze|tin.?bronze/.test(h)) return 8800;
  if (/leaded.?bronze|gunmetal/.test(h)) return 8700;
  if (/brass|cu.?zn/.test(h)) return 8500;
  if (/copper|cu\s*\d/.test(h)) return 8900;
  if (/titan|ti-6|ti6al/i.test(h)) return 4500;
  if (/stainless|ss\s*3|ss\s*4|316|304|17-4|inconel|hastelloy/i.test(h)) return 7900;
  if (/cast.?iron|grey.?iron|sg.?iron|ductile.?iron/i.test(h)) return 7200;
  if (/nylon|peek|abs|pom|pp\b|pe\b|ptfe|plastic|polymer/i.test(h)) return 1200;
  if (/rubber|elastomer/i.test(h)) return 1500;
  // Pure aluminium alloys — only after all copper/bronze variants are excluded above
  if (/alumin|al\s*6|al\s*7|7050|7075|6061|6082|2024|5083|5052/i.test(h)) return 2700;
  return 7850; // default: mild/alloy steel (EN8, EN24, EN36, H13, P20, ...)
}
