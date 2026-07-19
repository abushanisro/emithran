import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../../common/supabase/supabase.service";
import type {
  IsoGroup,
  MachiningParams,
  QualityLevel,
  ToolMaterial,
} from "../interfaces/operation-calculator.interface";

export interface ParameterQuery {
  operation: string;
  isoGroup: IsoGroup;
  qualityLevel?: QualityLevel;
  toolMaterial?: ToolMaterial;
  diameterMm?: number;  // for drilling/tapping/reaming
}

// Hardcoded fallback params per ISO group so the pipeline never fails with
// unknown DB state. These are conservative (low Vc) to avoid overheating.
const FALLBACK_PARAMS: Record<IsoGroup, Omit<MachiningParams, "isoGroup" | "parameterSource">> = {
  P: { vcRecommended: 120, feedRecommended: 0.15, apMaxMm: 3.0, toolMaterial: "carbide", insertGradeIso: "P25", insertCoating: "PVD TiAlN", toolLifeMinutes: 15 },
  M: { vcRecommended: 80,  feedRecommended: 0.10, apMaxMm: 2.0, toolMaterial: "carbide", insertGradeIso: "M25", insertCoating: "PVD TiAlN", toolLifeMinutes: 15 },
  K: { vcRecommended: 200, feedRecommended: 0.20, apMaxMm: 3.0, toolMaterial: "carbide", insertGradeIso: "K25", insertCoating: "CVD Al2O3", toolLifeMinutes: 15 },
  N: { vcRecommended: 500, feedRecommended: 0.20, apMaxMm: 4.0, toolMaterial: "carbide", insertGradeIso: "K10", insertCoating: "Uncoated", toolLifeMinutes: 30 },
  S: { vcRecommended: 40,  feedRecommended: 0.08, apMaxMm: 1.0, toolMaterial: "carbide", insertGradeIso: "S15", insertCoating: "PVD TiAlN", toolLifeMinutes: 10 },
  H: { vcRecommended: 120, feedRecommended: 0.08, apMaxMm: 0.2, toolMaterial: "cbn",     insertGradeIso: "H10", insertCoating: "CBN", toolLifeMinutes: 15 },
};

@Injectable()
export class ParameterResolver {
  private readonly logger = new Logger(ParameterResolver.name);

  constructor(private readonly supabase: SupabaseService) {}

  async resolve(query: ParameterQuery): Promise<MachiningParams> {
    const db = this.supabase.getClient();
    const {
      operation,
      isoGroup,
      qualityLevel = "semi_finishing",
      toolMaterial = "carbide",
      diameterMm,
    } = query;

    // Normalize quality level (if drilling/tapping there's usually only 'finishing')
    const qLevel = this.normalizeQuality(operation, qualityLevel);

    let dbQuery = db
      .from("machining_parameters")
      .select("*")
      .eq("operation", operation)
      .eq("iso_material_group", isoGroup)
      .eq("quality_level", qLevel)
      .eq("tool_material", toolMaterial);

    // Diameter-range scoping for drilling/tapping/reaming
    if (diameterMm != null && ["drilling", "tapping", "reaming", "boring"].includes(operation)) {
      dbQuery = dbQuery
        .lte("drill_dia_min_mm", diameterMm)
        .gt("drill_dia_max_mm", diameterMm);
    }

    const { data, error } = await dbQuery.limit(1).maybeSingle();

    if (error) {
      this.logger.error(`[param-resolver] DB error for ${operation}/${isoGroup}/${qLevel}: ${error.message}`);
    }

    if (data) {
      return this.mapRow(data as Record<string, unknown>, isoGroup, toolMaterial);
    }

    // Fallback: try any tool_material for the same operation + group + quality
    const { data: fallbackData } = await db
      .from("machining_parameters")
      .select("*")
      .eq("operation", operation)
      .eq("iso_material_group", isoGroup)
      .eq("quality_level", qLevel)
      .limit(1)
      .maybeSingle();

    if (fallbackData) {
      this.logger.warn(`[param-resolver] No ${toolMaterial} record for ${operation}/${isoGroup} — using first available tool material`);
      const row = fallbackData as Record<string, unknown>;
      return this.mapRow(row, isoGroup, String(row.tool_material ?? toolMaterial));
    }

    // Last resort: hardcoded fallbacks — never breaks the pipeline
    this.logger.warn(`[param-resolver] No DB params for ${operation}/${isoGroup}/${qLevel} — using hardcoded fallbacks`);
    const fb = FALLBACK_PARAMS[isoGroup];
    return {
      isoGroup,
      ...fb,
      parameterSource: "fallback_hardcoded",
    };
  }

  private normalizeQuality(operation: string, quality: QualityLevel): QualityLevel {
    // Drilling/tapping tables only have 'finishing' rows
    if (["drilling", "tapping", "reaming"].includes(operation)) return "finishing";
    return quality;
  }

  private mapRow(
    row: Record<string, unknown>,
    isoGroup: IsoGroup,
    toolMaterial: string,
  ): MachiningParams {
    return {
      isoGroup,
      vcRecommended: Number(row.vc_recommended),
      feedRecommended: Number(row.feed_recommended),
      apMaxMm: Number(row.ap_max_mm ?? 2.0),
      aePctMax: row.ae_pct_max != null ? Number(row.ae_pct_max) : undefined,
      toolMaterial: toolMaterial as ToolMaterial,
      insertGradeIso: (row.insert_grade_iso as string) ?? "",
      insertCoating: (row.insert_coating as string) ?? "",
      toolLifeMinutes: row.tool_life_minutes != null ? Number(row.tool_life_minutes) : undefined,
      toolLifeHoles: row.tool_life_holes != null ? Number(row.tool_life_holes) : undefined,
      parameterSource: (row.source_reference as string) ?? "machining_parameters_db",
    };
  }
}
