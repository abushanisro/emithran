import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../../common/supabase/supabase.service";
import type { IsoGroup } from "../interfaces/operation-calculator.interface";

export interface MaterialGroupRecord {
  isoGroup: IsoGroup;
  kc1_1_n_mm2: number | null;
  mcExponent: number | null;
  materialFamily: string | null;
}

// Fallback table for when the DB lookup misses (covers common aliases that might
// not be in DB yet without failing the whole pipeline).
const ISO_FALLBACKS: Record<string, IsoGroup> = {
  "mild steel": "P",
  "ms": "P",
  "carbon steel": "P",
  "stainless steel": "M",
  "ss": "M",
  "cast iron": "K",
  "grey cast iron": "K",
  "aluminum": "N",
  "aluminium": "N",
  "al": "N",
  "brass": "N",
  "copper": "N",
  "titanium": "S",
  "ti-6al-4v": "S",
  "inconel": "S",
  "nickel": "S",
  "tool steel": "H",
  "hardened steel": "H",
  "pp": "N",
  "abs": "N",
  "pa66": "N",
  "plastic": "N",
};

interface MaterialGroupRow {
  material_grade: string;
  iso_group: string;
  kc1_1_n_mm2: number | null;
  mc_exponent: number | null;
  material_family: string | null;
  aliases: string[] | null;
}

@Injectable()
export class MaterialGroupResolver {
  private readonly logger = new Logger(MaterialGroupResolver.name);

  constructor(private readonly supabase: SupabaseService) {}

  async resolve(materialGrade: string): Promise<MaterialGroupRecord> {
    const db = this.supabase.getClient();
    const grade = materialGrade.trim();

    // 1. Exact match on primary material_grade (case-insensitive)
    const { data: exact } = await db
      .from("machining_material_groups")
      .select("iso_group, kc1_1_n_mm2, mc_exponent, material_family")
      .ilike("material_grade", grade)
      .limit(1)
      .maybeSingle();

    if (exact) {
      return this.map(exact);
    }

    // 2. Alias match — the aliases column is TEXT[], use @> containment
    const { data: alias } = await db
      .from("machining_material_groups")
      .select("iso_group, kc1_1_n_mm2, mc_exponent, material_family")
      .contains("aliases", [grade])
      .limit(1)
      .maybeSingle();

    if (alias) {
      return this.map(alias);
    }

    // 3. Partial match — catches spacing variants like 'IS 2062' vs 'IS2062'
    const normalized = grade.replace(/\s+/g, "").toLowerCase();
    const { data: rows } = await db
      .from("machining_material_groups")
      .select("material_grade, iso_group, kc1_1_n_mm2, mc_exponent, material_family, aliases");

    if (rows) {
      for (const row of rows as MaterialGroupRow[]) {
        const rowNorm = row.material_grade.replace(/\s+/g, "").toLowerCase();
        if (rowNorm === normalized || rowNorm.includes(normalized) || normalized.includes(rowNorm)) {
          return this.map(row);
        }
        for (const a of row.aliases ?? []) {
          if (a.replace(/\s+/g, "").toLowerCase() === normalized) return this.map(row);
        }
      }
    }

    // 4. Hardcoded fallback — prevents pipeline failure for unknown grades
    const lower = grade.toLowerCase();
    for (const [key, isoGroup] of Object.entries(ISO_FALLBACKS)) {
      if (lower.includes(key)) {
        this.logger.warn(`[material-group] No DB record for "${grade}" — using fallback ISO group ${isoGroup}`);
        return { isoGroup, kc1_1_n_mm2: null, mcExponent: null, materialFamily: null };
      }
    }

    // Default to P (carbon steel) to keep the pipeline running
    this.logger.warn(`[material-group] Unknown material "${grade}" — defaulting to ISO P (carbon steel)`);
    return { isoGroup: "P", kc1_1_n_mm2: 1350, mcExponent: 0.21, materialFamily: "carbon_steel" };
  }

  private map(row: { iso_group: unknown; kc1_1_n_mm2: unknown; mc_exponent: unknown; material_family: unknown }): MaterialGroupRecord {
    return {
      isoGroup: row.iso_group as IsoGroup,
      kc1_1_n_mm2: row.kc1_1_n_mm2 as number | null,
      mcExponent: row.mc_exponent as number | null,
      materialFamily: row.material_family as string | null,
    };
  }
}
