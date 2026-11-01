import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database/database.service";
import type { IsoGroup } from "../interfaces/operation-calculator.interface";

/**
 * Where the ISO group came from:
 *  - db_exact / db_alias / db_partial: a machining_material_groups row.
 *  - fallback_alias_table: no row; the grade name matched ISO_FALLBACKS below
 *    (group only, no kc1.1 / mc on file).
 *  - assumed_default: nothing matched; ISO P carbon steel was ASSUMED so the
 *    pipeline can still produce a time, and the result says so.
 */
export type MaterialGroupSource = "db_exact" | "db_alias" | "db_partial" | "fallback_alias_table" | "assumed_default";

export interface MaterialGroupRecord {
  isoGroup: IsoGroup;
  kc1_1_n_mm2: number | null;
  mcExponent: number | null;
  materialFamily: string | null;
  materialGroupSource: MaterialGroupSource;
  /** Set whenever the group did not come from a machining_material_groups row. */
  warning?: string;
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

// The assumption used when nothing matches (unchanged values, now disclosed):
// ISO P carbon steel, kc1.1 = 1350 N/mm², mc = 0.21.
const ASSUMED_DEFAULT = { isoGroup: "P" as IsoGroup, kc1_1_n_mm2: 1350, mcExponent: 0.21, materialFamily: "carbon_steel" };

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

  constructor(private readonly database: DatabaseService) {}

  async resolve(materialGrade: string): Promise<MaterialGroupRecord> {
    const db = this.database.getPrivilegedClient("reference-data: machining_material_groups");
    const grade = materialGrade.trim();
    // A failed query is an error, never a reason to assume carbon steel.
    const fail = (step: string, message: string): never => {
      throw new InternalServerErrorException(`machining_material_groups ${step} lookup failed for "${grade}": ${message}`);
    };

    // 1. Exact match on primary material_grade (case-insensitive)
    const { data: exact, error: exactErr } = await db
      .from("machining_material_groups")
      .select("iso_group, kc1_1_n_mm2, mc_exponent, material_family")
      .ilike("material_grade", grade)
      .limit(1)
      .maybeSingle();
    if (exactErr) fail("exact", exactErr.message);
    if (exact) return this.map(exact, "db_exact");

    // 2. Alias match — the aliases column is TEXT[], use @> containment
    const { data: alias, error: aliasErr } = await db
      .from("machining_material_groups")
      .select("iso_group, kc1_1_n_mm2, mc_exponent, material_family")
      .contains("aliases", [grade])
      .limit(1)
      .maybeSingle();
    if (aliasErr) fail("alias", aliasErr.message);
    if (alias) return this.map(alias, "db_alias");

    // 3. Partial match — catches spacing variants like 'IS 2062' vs 'IS2062'
    const normalized = grade.replace(/\s+/g, "").toLowerCase();
    const { data: rows, error: rowsErr } = await db
      .from("machining_material_groups")
      .select("material_grade, iso_group, kc1_1_n_mm2, mc_exponent, material_family, aliases");
    if (rowsErr) fail("partial", rowsErr.message);

    for (const row of (rows ?? []) as MaterialGroupRow[]) {
      const rowNorm = row.material_grade.replace(/\s+/g, "").toLowerCase();
      if (rowNorm === normalized || rowNorm.includes(normalized) || normalized.includes(rowNorm)) {
        return this.map(row, "db_partial");
      }
      for (const a of row.aliases ?? []) {
        if (a.replace(/\s+/g, "").toLowerCase() === normalized) return this.map(row, "db_partial");
      }
    }

    // 4. Name-keyword table — a group only, flagged
    const lower = grade.toLowerCase();
    for (const [key, isoGroup] of Object.entries(ISO_FALLBACKS)) {
      if (lower.includes(key)) {
        const warning = `Material "${grade}" is not in machining_material_groups; ISO group ${isoGroup} was inferred from the name ("${key}") with no kc1.1/mc on file — add the grade to price it from real data.`;
        this.logger.warn(`[material-group] ${warning}`);
        return { isoGroup, kc1_1_n_mm2: null, mcExponent: null, materialFamily: null, materialGroupSource: "fallback_alias_table", warning };
      }
    }

    // 5. Nothing matched — assume carbon steel, and say so on the result
    const warning = `Material "${grade}" is unknown (not in machining_material_groups and no name match); ISO P carbon steel (kc1.1 ${ASSUMED_DEFAULT.kc1_1_n_mm2} N/mm², mc ${ASSUMED_DEFAULT.mcExponent}) was ASSUMED — cutting data and times are not for this material.`;
    this.logger.warn(`[material-group] ${warning}`);
    return { ...ASSUMED_DEFAULT, materialGroupSource: "assumed_default", warning };
  }

  private map(
    row: { iso_group: unknown; kc1_1_n_mm2: unknown; mc_exponent: unknown; material_family: unknown },
    materialGroupSource: MaterialGroupSource,
  ): MaterialGroupRecord {
    return {
      isoGroup: row.iso_group as IsoGroup,
      kc1_1_n_mm2: row.kc1_1_n_mm2 as number | null,
      mcExponent: row.mc_exponent as number | null,
      materialFamily: row.material_family as string | null,
      materialGroupSource,
    };
  }
}
