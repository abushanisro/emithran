import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { rankMaterials } from '../../process-plan-generator/ranking/material-ranker';
import type { GeometrySignals } from '../../process-plan-generator/ranking/material-ranker';

export interface MaterialCandidate {
  material: string;
  materialGrade: string | null;
  confidence: number;
  densityKgM3: number | null;
  costPerKg: number | null;
  reasons: string[];
  scoreFactors: string[];
  processCompatibility: Array<{ process: string; suitability: string }>;
}

@Injectable()
export class MaterialIntelligenceService {
  private readonly logger = new Logger(MaterialIntelligenceService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getCandidates(
    accessToken: string,
    family: string,
    sheetThicknessMm: number,
    holeCount: number,
    bendCount: number,
    coating: string | null,
    materialHint: string | null,
  ): Promise<MaterialCandidate[]> {
    const client = this.supabaseService.getClient(accessToken);
    const safeFamily = ['sheet_metal', 'cnc_turned', 'cnc_milled'].includes(family)
      ? (family as 'sheet_metal' | 'cnc_turned' | 'cnc_milled')
      : 'sheet_metal';

    // Use the same query pattern as retrieval.service.ts which is known to work:
    // no material_family in OR (avoids column-not-found errors on older DBs),
    // no is_global filter (RLS returns what the user can see), rankMaterials handles scoring.
    const { data: rows, error } = await client
      .from('raw_materials')
      .select(
        'id, material_group, material, material_grade, density_kg_m3, density, cost, location, material_form, material_family',
      )
      .or(
        `material_group.ilike.%ferrous%,material_group.ilike.%non-ferrous%,material_group.ilike.%aluminium%,material_group.ilike.%aluminum%,material_form.ilike.%sheet%,material_form.ilike.%plate%,material_form.ilike.%coil%,material_form.ilike.%bar%,material_form.ilike.%rod%`,
      )
      .limit(120);

    if (error) {
      this.logger.error('raw_materials query failed', {
        message: error.message,
        code: (error as any).code,
        safeFamily,
      });
      return [];
    }

    if (!rows?.length) return [];

    const signals: GeometrySignals = {
      sheetThicknessMm,
      holeCount,
      bendCount,
      coating,
    };
    const ranked = rankMaterials(rows as any[], safeFamily, materialHint, 'India', 5, signals);

    const result: MaterialCandidate[] = [];
    for (const cand of ranked) {
      const firstWord = cand.material.split(' ')[0];
      const { data: compat } = await client
        .from('material_process_compatibility')
        .select('process_name, suitability')
        .ilike('material_name', `%${firstWord}%`)
        .in('suitability', ['Ideal', 'Good'])
        .limit(4);

      result.push({
        material: cand.material,
        materialGrade: cand.grade,
        confidence: Math.round(cand.score * 100),
        densityKgM3: cand.densityKgPerM3,
        costPerKg: cand.unitCostInrPerKg || null,
        reasons: buildReasons(cand.material, safeFamily, sheetThicknessMm, holeCount, materialHint),
        scoreFactors: buildScoreFactors(cand.material, sheetThicknessMm, materialHint),
        processCompatibility: (compat ?? []).map((c: any) => ({
          process: c.process_name as string,
          suitability: c.suitability as string,
        })),
      });
    }
    return result;
  }
}

function buildReasons(
  material: string,
  family: string,
  thickness: number,
  holeCount: number,
  hint: string | null,
): string[] {
  const reasons: string[] = [];
  const matL = material.toLowerCase();

  if (hint) {
    const firstHintToken = hint.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (firstHintToken.length > 2 && matL.includes(firstHintToken)) {
      reasons.push(`Matches material hint "${hint}" from drawing or BOM`);
    }
  }
  if (family === 'sheet_metal') {
    reasons.push('Sheet metal family detected — prefers sheet/coil/strip forms');
  }
  if (thickness > 0 && thickness <= 3 && (matL.includes('crca') || matL.includes('cold rolled'))) {
    reasons.push(`Thickness ${thickness}mm matches cold-rolled sheet range (0.6–3.0mm)`);
  }
  if (thickness > 3 && thickness <= 8 && (matL.includes('is2062') || matL.includes('mild steel'))) {
    reasons.push(`Thickness ${thickness}mm suits structural mild steel (IS2062)`);
  }
  if (holeCount > 50) {
    reasons.push(`${holeCount} holes — typical for laser-cut sheet metal blanks`);
  }
  if (matL.includes('galvanized') || matL.includes('secc') || matL.includes(' gi ') || matL.includes('gi sheet')) {
    reasons.push('Pre-galvanised — eliminates separate surface treatment step');
  }
  if (['stainless', 'ss304', 'ss316'].some((k) => matL.includes(k))) {
    reasons.push('Austenitic stainless — corrosion-resistant, no surface treatment required');
  }
  return reasons;
}

function buildScoreFactors(
  material: string,
  thickness: number,
  hint: string | null,
): string[] {
  const factors: string[] = [];
  const matL = material.toLowerCase();

  if (hint) factors.push(`Material hint "${hint}" boosts hint-fit score`);
  if (thickness > 0 && thickness <= 3) {
    factors.push(`Thin gauge (${thickness}mm) favours cold-rolled sheet grades`);
  }
  if (thickness > 6) {
    factors.push(`Thick section (${thickness}mm) shifts preference toward structural grades`);
  }
  if (['stainless', 'ss304', 'ss316'].some((k) => matL.includes(k))) {
    factors.push('Stainless grade — heat-sensitive flag; laser quality score reduced by 4 pts');
  }
  return factors;
}
