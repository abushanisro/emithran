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

import { ScopeClassifierService } from './scope-classifier.service';
import { DrawingExtractorService } from './drawing-extractor.service';

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
  static readonly TOP_N_MACHINES = 6;
  static readonly TOP_N_LABOUR = 4;
  static readonly TOP_N_PROCESSES = 6;
  static readonly TOP_N_CALCULATORS = 4;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly scopeClassifier: ScopeClassifierService,
    private readonly drawingExtractor: DrawingExtractorService,
  ) {}

  async assemble(
    bomItemId: string,
    userId: string,
    accessToken: string | null,
  ): Promise<{ brief: EngineeringBrief; candidates: CandidateSet }> {
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
    };

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

    // ── Promote drawing fields into bomBrief where BOM was empty ──────────
    // The drawing is the authoritative source for tolerance / surface
    // finish / heat treat / hardness when present.
    if (drawing.available) {
      bomBrief.materialHint = bomBrief.materialHint ?? drawing.material;
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

    // ── Run scope classifier (now with drawing-promoted fields) ────────────
    const scope = this.scopeClassifier.classify(bomBrief, dfm);

    const brief: EngineeringBrief = {
      bomItem: bomBrief,
      dfm,
      drawing,
      context: { organizationLocation: orgLocation, currency: 'INR', language: 'en' },
      scope,
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
        },
      };
    }

    const family = scope.family as Exclude<typeof scope.family, 'out_of_scope'>;

    // ── Query masters in parallel ──────────────────────────────────────────
    const [materialsRaw, mhrRaw, lsrRaw, processesRaw, calculatorsRaw] = await Promise.all([
      this.queryRawMaterials(client, userId, family),
      this.queryMhr(client, userId),
      this.queryLsr(client, userId),
      this.queryProcesses(client, userId, family),
      this.queryCalculators(client, userId),
    ]);

    // ── Rank to top-N per kind ─────────────────────────────────────────────
    const candidates: CandidateSet = {
      rawMaterials: rankMaterials(materialsRaw, family, bomBrief.materialHint, orgLocation, RetrievalService.TOP_N_MATERIALS),
      machines: rankMachines(mhrRaw, family, orgLocation, RetrievalService.TOP_N_MACHINES),
      labour: rankLabour(lsrRaw, orgLocation, RetrievalService.TOP_N_LABOUR),
      processes: rankProcesses(processesRaw, family, dfm, RetrievalService.TOP_N_PROCESSES),
      calculators: rankCalculators(calculatorsRaw, family, RetrievalService.TOP_N_CALCULATORS),
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
    // Materials masters are typically shared — try with user_id first, then
    // fall back to global (user_id is null) rows if the user hasn't added any.
    const groupFilter = family === 'sheet_metal' ? ['Ferrous & Non-Ferrous'] : ['Ferrous & Non-Ferrous'];

    const { data, error } = await client
      .from('raw_materials')
      .select('id, material_group, material, material_grade, density_kg_m3, cost, location, user_id')
      .or(`material_group.ilike.%ferrous%,material_group.ilike.%non-ferrous%`)
      .limit(120);

    if (error) {
      this.logger.warn(`raw_materials query failed: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async queryMhr(client: any, userId: string) {
    const { data, error } = await client
      .from('mhr_records')
      .select('id, machine_name, machine_description, commodity_code, total_machine_hour_rate, location')
      .not('total_machine_hour_rate', 'is', null)
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) {
      this.logger.warn(`mhr_records query failed: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async queryLsr(client: any, userId: string) {
    const { data, error } = await client
      .from('lsr_records')
      .select('id, labour_type, labour_code, lhr, location')
      .not('lhr', 'is', null)
      .order('lhr', { ascending: true })
      .limit(40);
    if (error) {
      this.logger.warn(`lsr_records query failed: ${error.message}`);
      return [];
    }
    return data ?? [];
  }

  private async queryProcesses(client: any, userId: string, family: string) {
    const familyKeywords: Record<string, string[]> = {
      cnc_turned: ['turn', 'lathe', 'drill', 'tap', 'deburr', 'grind'],
      cnc_milled: ['mill', 'machin', 'drill', 'tap', 'deburr', 'grind'],
      sheet_metal: ['laser', 'punch', 'bend', 'form', 'shear', 'deburr'],
    };

    const keywords = familyKeywords[family] ?? ['mill'];
    const orFilter = keywords.map((k) => `process_name.ilike.%${k}%`).join(',');

    // We deliberately don't select machine_type — it's optional and some deployments
    // don't have that column. Ranker tolerates null machine_type.
    const { data, error } = await client
      .from('processes')
      .select('id, process_name, process_category, description, standard_time_minutes, setup_time_minutes, cycle_time_minutes, skill_level_required')
      .or(orFilter)
      .limit(80);
    if (error) {
      this.logger.warn(`processes query failed: ${error.message}`);
      const { data: anyRows } = await client.from('processes').select('id, process_name, process_category, description').limit(60);
      return anyRows ?? [];
    }
    return data ?? [];
  }

  private async queryCalculators(client: any, userId: string) {
    const { data, error } = await client
      .from('calculators')
      .select('id, name, calc_category, description, user_id')
      .eq('user_id', userId)
      .limit(40);
    if (error || !data || data.length === 0) {
      // Fallback: any calculators (e.g. shared/default ones)
      const { data: any } = await client
        .from('calculators')
        .select('id, name, calc_category, description')
        .limit(40);
      return any ?? [];
    }
    return data;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private extractDfm(bomRow: any): BriefDfm {
    const ga = bomRow.geometry_analysis ?? {};
    const da = bomRow.dfm_analysis ?? {};

    const fromCadEngine = !!(ga && Object.keys(ga).length > 0);
    const bbox = ga?.bounding_box ?? {};

    return {
      volumeMm3: numberOr(ga.estimated_volume_mm3 ?? ga.volume_mm3, numberOr(bomRow.weight, 0) * 1000),
      surfaceAreaMm2: numberOr(ga.surface_area_mm2 ?? ga.surface_area_estimation, 0),
      boundingBox: {
        lengthMm: numberOr(bbox.length ?? bbox.x, numberOr(bomRow.max_length ?? bomRow.length, 0)),
        widthMm: numberOr(bbox.width ?? bbox.y, numberOr(bomRow.max_width ?? bomRow.width, 0)),
        heightMm: numberOr(bbox.height ?? bbox.z, numberOr(bomRow.max_height ?? bomRow.height, 0)),
      },
      holeCount: numberOr(da?.holes?.count ?? ga?.feature_detection?.holes_detected, 0),
      pocketCount: numberOr(da?.pockets?.count, 0),
      thinWallCount: (da?.thin_walls ?? 0) > 0 || ga?.feature_detection?.thin_walls ? 1 : 0,
      undercutCount: numberOr(da?.undercuts?.count, 0),
      fromCadEngine,
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
