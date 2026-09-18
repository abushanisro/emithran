import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { resolveUtsMpa, isSheetFormableMaterial } from '../costing/shared/core/default-rates.constants';
import { isPlasticGrade } from '../costing/plastic-molding/process/process-tree';
import { shapeRankForFamily, isDiscouragedShapeForFamily } from '../../raw-materials/constants/material-shape-ranking';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';

@Injectable()
export class MaterialResolutionService {
  // Cached per-process, not per-request: migration 619 adds raw_materials.
  // cure_time_min, but this code must keep working correctly (not crash,
  // not silently misreport "material not found") against a database that
  // hasn't had that migration applied yet. Probed once and cached, mirroring
  // selector.ts's fetchMachinePool's own "retry without the new columns on
  // a schema-cache error" resilience for the exact same reason (see that
  // file's own comment). Real per-grade thermal columns (melting_temp_c
  // etc.) are NOT probed here — they've been live in raw_materials since
  // before this session, unlike cure_time_min.
  private materialCureTimeColumnAvailable: boolean | null = null;

  constructor(private readonly supabaseService: SupabaseService) {}

  private async checkMaterialCureTimeColumnAvailable(client: ReturnType<SupabaseService['getClient']>): Promise<boolean> {
    if (this.materialCureTimeColumnAvailable != null) return this.materialCureTimeColumnAvailable;
    const { error } = await client.from('raw_materials').select('cure_time_min').limit(1);
    this.materialCureTimeColumnAvailable = !(error && /column|schema cache/i.test(error.message));
    return this.materialCureTimeColumnAvailable;
  }

  // Family-aware material resolution — shared by cost summary and route
  // comparison so both price the SAME raw-material row. Candidate rows are
  // ranked by product form for the part family (a machined billet part must
  // never price on a "Sheet" row while a plate/bar row exists — that was the
  // "T6 - Sheet on a machined boom clamp" defect). All INR fallbacks convert
  // to the location currency; a raw INR number in a EUR/USD costing is a
  // silent ~80-90× error.
  // ── Family resolution ───────────────────────────────────────────────────────
  // Single precedence chain used by BOTH costing endpoints (summary ≡ route
  // invariant): user override > material physics > geometry classifier.
  //
  // Geometry alone cannot distinguish a machined plate from a molded cover of
  // the identical shape — the material can. This is the eMithran routing model:
  // geometry proposes, material routes, user override is final.
  //   1. manufacturing_family_override — explicit user intent, always wins
  //      (e.g. machined-PEEK prototype pinned to cnc_milled).
  //   2. Thermoplastic grade → plastic_molded, whatever the shape classifier
  //      guessed (a PA66 cover and an aluminium cover are the same geometry).
  //   3. Non-sheet-formable alloy on a sheet-shaped part → cnc_milled (flat
  //      bronze casting can never run a laser + press-brake route).
  //   4. Geometry classifier result.
  resolveEffectiveFamily(input: {
    item: BOMItemResponseDto;
    fg: any;
    grade: string | null;
    sheetThicknessMm: number;
  }): { family: string; familySource: 'override' | 'material' | 'geometry'; warning: string | null } {
    const override = (input.item.manufacturingFamilyOverride ?? '').trim();
    if (override) return { family: override, familySource: 'override', warning: null };

    const geoFamily: string =
      input.fg?.classification?.family ??
      input.item.familyClassification ??
      (input.sheetThicknessMm > 0 ? 'sheet_metal' : 'unknown');

    if (isPlasticGrade(input.grade) && geoFamily !== 'plastic_molded') {
      return {
        family: 'plastic_molded',
        familySource: 'material',
        warning:
          `Material "${input.grade}" is a thermoplastic — routed to injection molding ` +
          `(geometry classifier suggested ${geoFamily.replace(/_/g, ' ')}). ` +
          'Set a manufacturing-family override on the item to force a machining route instead.',
      };
    }

    if (geoFamily === 'sheet_metal' && !isSheetFormableMaterial(input.grade)) {
      return {
        family: 'cnc_milled',
        familySource: 'material',
        warning:
          `${input.grade} is not sheet-formable (cast alloy) — geometry looks like flat sheet ` +
          'but the part is costed as a machined plate; verify the intended process',
      };
    }

    return { family: geoFamily, familySource: 'geometry', warning: null };
  }

  async resolveMaterialForFamily(input: {
    accessToken: string;
    grade: string | null;
    family: string;
    materialCol: string;
    rates: RateSnapshot;
    locCurrencyCode: string;
    warnings: string[];
  }): Promise<{
    materialCostPerKg: number; materialDensityKgM3: number; materialSource: 'db' | 'default';
    // UTS/shear strength — resolved from the SAME raw_materials row density/cost
    // came from (same exact-then-tokenized match), so machine selection (press-
    // brake tonnage) and $ costing can never diverge onto two different material
    // rows or two different property sources. Three-tier hierarchy, no invented
    // catch-all: verified per-part DB value ('db') -> approved material-family
    // value from MATERIAL_UTS_MPA ('family_default') -> null ('unavailable') when
    // the grade matches neither. Callers must treat null as "skip the UTS-
    // dependent check" (never substitute a guessed number), and utsSource lets
    // them warn appropriately.
    utsMpa: number | null; shearStrengthMpa: number | null; utsSource: 'db' | 'family_default' | 'unavailable';
    // Real per-grade Injection Molding thermal/process properties (Phase 1
    // materials-data foundation, 2026-09-02) — resolved from the SAME
    // raw_materials row every other field on this return came from (same
    // exact-then-tokenized match), never a second, independently-resolved
    // material. null (never a fabricated default) when this specific grade
    // has no real value on file — see thermalSource/cureTimeSource for why.
    meltingTempC: number | null; moldTempC: number | null; ejectionTempC: number | null;
    specificHeatMeltJgC: number | null; thermalConductivityMeltWMK: number | null;
    thermalSource: 'db' | 'unavailable';
    cureTimeMinFromMaterial: number | null;
    cureTimeSource: 'db' | 'unavailable' | 'column_not_migrated';
  }> {
    const { accessToken, grade, family, materialCol, rates, locCurrencyCode, warnings } = input;

    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const cureTimeColumnAvailable = await this.checkMaterialCureTimeColumnAvailable(client);
        const g = grade.trim();
        // melting_temp_c/mold_temp_c/specific_heat_melt/thermal_conductivity_melt:
        // real, per-grade Injection Molding thermal properties, already
        // populated for 511/574 raw_materials rows (imported at some earlier
        // point from the same licensed reference-data source as
        // memory/Injection/materials_final.json). Selected unconditionally
        // (not gated by family) since they're NULL-safe for every non-plastic
        // material and this is the SAME single material-resolution call
        // every family already shares — a second, family-gated query would
        // be a second source of truth.
        //
        // cure_time_min: migration 619's new column (compression-molding-
        // relevant thermoset grades only, see
        // gen_619_seed_material_cure_time.js) — only requested when
        // checkMaterialCureTimeColumnAvailable() has confirmed it exists, so
        // this resolver keeps working correctly against a database that
        // hasn't had migration 619 applied yet (never a crash, never a
        // false "material not found").
        const selectCols = `${materialCol}, cost_india, cost, density, density_kg_m3, shape, material_grade, shearing_strength, ultimate_tensile_strength, shear_strength_mpa, uts_mpa, melting_temp_c, mold_temp_c, specific_heat_melt, thermal_conductivity_melt, eject_deflection_temp_c` +
          (cureTimeColumnAvailable ? `, cure_time_min` : '');

        // Alias lookup first — e.g. "AL6101" has no substring in common with its
        // real row ("Generic Aluminum, ANSI 6101"), so none of the ilike attempts
        // below can ever match it. material_aliases (migration 382/383) exists
        // exactly for this and is already used by raw-materials.service.ts's own
        // search — this resolver just never queried it, so any alias-only grade
        // silently fell through to the mild-steel default further down.
        let data: unknown[] | null = null;
        const aliasNormalized = g.toUpperCase().replace(/[\s-]/g, '');
        if (aliasNormalized) {
          const { data: aliasRow } = await client
            .from('material_aliases')
            .select('raw_material_id')
            .eq('alias_normalized', aliasNormalized)
            .maybeSingle();
          if (aliasRow?.raw_material_id) {
            ({ data } = await client
              .from('raw_materials')
              .select(selectCols)
              .eq('id', aliasRow.raw_material_id)
              .limit(1));
          }
        }

        // Try an exact (case-insensitive) match on the full grade string first — e.g.
        // "Generic Aluminum - Honeycomb (Expanded 1)" should hit that literal row, not
        // whatever else happens to contain "Aluminum". Without this, the tokenized
        // fuzzy fallback below could silently substitute a completely different
        // material's density/cost (confirmed live against this DB: this exact grade has
        // real density 50 kg/m³, but the fuzzy path was landing on unrelated
        // ~450-2700 kg/m³ rows — an 8-50x error in computed part weight with no warning).
        // Uses two separate .ilike() calls, not .or('material.ilike.X,...') — PostgREST's
        // or() filter treats "," and "(" "/" ")" in the embedded value as its own
        // grouping syntax, so a grade string containing them (confirmed: "(Expanded 1)")
        // silently corrupts the filter and the query returns nothing.
        if (!data?.length) {
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .ilike('material', g)
            .limit(5));
        }
        if (!data?.length) {
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .ilike('material_grade', g)
            .limit(5));
        }

        if (!data?.length) {
          // Tokenize compound grade strings so partial-standard matches succeed.
          // "IS2062 E250 CRCA" splits to ["IS2062","E250","CRCA"]; the DB stores
          // "Mild Steel IS2062" and "CRCA Steel" as separate rows — neither matches
          // the full compound string, but each token matches at least one row. Only
          // reached when no exact match exists — this is a lower-confidence fallback,
          // not an equal alternative to the exact match above. Strip PostgREST's
          // or()-filter-special characters (same corruption risk as above — a token
          // like "(Expanded" would otherwise break the whole clause) rather than
          // silently dropping the token or the whole match attempt.
          const tokens = g
            .split(/[\s\-\/]+/)
            .map((t) => t.replace(/[(),]/g, ''))
            .filter((t) => t.length >= 3);
          const orClause = (tokens.length > 1 ? tokens : [g.replace(/[(),]/g, '')])
            .flatMap((t) => [`material_grade.ilike.%${t}%`, `material.ilike.%${t}%`])
            .join(',');
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .or(orClause)
            .limit(12));
        }

        // Cast via unknown: the select() column list is dynamic (location column),
        // which Supabase's literal-type parser cannot statically resolve.
        const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
          const locCost = row[materialCol] as number | null;
          const indiaCost = (row.cost_india ?? row.cost) as number | null;
          const densityGCm3 = row.density as number | null;
          const densityKgM3 =
            (row.density_kg_m3 as number | null) ?? (densityGCm3 != null ? densityGCm3 * 1000 : null);
          // Prefer the newer, calculator-facing columns (uts_mpa/shear_strength_mpa,
          // migration 360) over their legacy source columns — migration 395's own
          // comment already documents this as the intended single source of truth
          // ("the calculator system reads uts_mpa specifically, not the legacy
          // column"), but this resolver kept reading the legacy columns directly,
          // so a row whose uts_mpa was deliberately set to a different, more
          // current value than its legacy ultimate_tensile_strength (~25 rows
          // predating migration 395's backfill) was silently ignored. Falling back
          // to the legacy column keeps every already-synced row (511/511 after
          // migration 395) numerically identical to today's behavior.
          const shearStrengthMpa = (row.shear_strength_mpa as number | null) ?? (row.shearing_strength as number | null);
          const utsMpa = (row.uts_mpa as number | null) ?? (row.ultimate_tensile_strength as number | null);
          const meltingTempC = (row.melting_temp_c as number | null) ?? null;
          const moldTempC = (row.mold_temp_c as number | null) ?? null;
          const ejectDeflectionTempC = (row.eject_deflection_temp_c as number | null) ?? null;
          const specificHeatMeltJgC = (row.specific_heat_melt as number | null) ?? null;
          const thermalConductivityMeltWMK = (row.thermal_conductivity_melt as number | null) ?? null;
          const cureTimeMinFromMaterial = (row.cure_time_min as number | null) ?? null;
          return {
            shape: (row.shape as string | null) ?? null, locCost, indiaCost, densityKgM3, shearStrengthMpa, utsMpa,
            meltingTempC, moldTempC, ejectDeflectionTempC, specificHeatMeltJgC, thermalConductivityMeltWMK, cureTimeMinFromMaterial,
          };
        });

        // Density and cost are independent facts about a material row — a
        // PENDING_REVIEW row (real, verified density; cost intentionally left
        // NULL because no verified quote exists) must still power weight/
        // tonnage calculations from its real density. Requiring cost>0 here
        // discarded the whole row, silently zeroing density too and reporting
        // "material not found" for a material that DOES exist in the DB.
        const withDensity = rows
          .filter((r) => r.densityKgM3 != null && r.densityKgM3 > 0)
          .sort((a, b) => shapeRankForFamily(a.shape, family) - shapeRankForFamily(b.shape, family));
        const withCost = withDensity.filter(
          (r) => (r.locCost != null && r.locCost > 0) || (r.indiaCost != null && r.indiaCost > 0),
        );
        const best = withCost[0] ?? withDensity[0];

        if (best) {
          if (isDiscouragedShapeForFamily(best.shape, family)) {
            warnings.push(
              `Material priced from "${best.shape}" stock — no ${family.replace(/_/g, ' ')}-appropriate product form found for "${grade}" in raw materials. Verify the cost/kg before quoting.`,
            );
          }
          const hasCost = (best.locCost != null && best.locCost > 0) || (best.indiaCost != null && best.indiaCost > 0);
          if (!hasCost) {
            warnings.push(
              `Material "${grade}" found in raw_materials with verified density, but no verified cost ` +
              `(pending review) — weight/tonnage use its real density; material cost shows as $0 until a cost is added.`,
            );
          }
          const hasUts = best.utsMpa != null && best.utsMpa > 0 && best.shearStrengthMpa != null && best.shearStrengthMpa > 0;
          const familyUts = hasUts ? null : resolveUtsMpa(grade);
          if (!hasUts) {
            warnings.push(
              familyUts != null
                ? `Material "${grade}" found in raw_materials, but no verified UTS/shear strength — using the approved ${grade} family UTS (${familyUts} MPa) for press-brake tonnage. Shear strength has no approved-family table, so it is unavailable and turret-punch tonnage checks are skipped until verified values are added.`
                : `Material "${grade}" found in raw_materials, but no verified UTS/shear strength, and the grade matches no approved material family either — press-brake tonnage, turret-punch tonnage, and UTS-dependent DFM checks are skipped until verified values are added.`,
            );
          }
          const hasThermal = best.meltingTempC != null && best.moldTempC != null;
          return {
            materialCostPerKg: hasCost
              ? (best.locCost != null && best.locCost > 0 ? best.locCost : (best.indiaCost as number) * rates.convertStrict('INR', locCurrencyCode))
              : 0,
            materialDensityKgM3: best.densityKgM3 as number,
            materialSource: 'db',
            utsMpa: hasUts ? (best.utsMpa as number) : familyUts,
            shearStrengthMpa: hasUts ? (best.shearStrengthMpa as number) : null,
            utsSource: hasUts ? 'db' : (familyUts != null ? 'family_default' : 'unavailable'),
            meltingTempC: best.meltingTempC, moldTempC: best.moldTempC, ejectionTempC: best.ejectDeflectionTempC,
            specificHeatMeltJgC: best.specificHeatMeltJgC, thermalConductivityMeltWMK: best.thermalConductivityMeltWMK,
            thermalSource: hasThermal ? 'db' : 'unavailable',
            cureTimeMinFromMaterial: best.cureTimeMinFromMaterial,
            cureTimeSource: best.cureTimeMinFromMaterial != null
              ? 'db'
              : (cureTimeColumnAvailable ? 'unavailable' : 'column_not_migrated'),
          };
        }
      } catch {
        // fall through to named defaults below
      }
    }

    // No DB match — warn and return zero for both cost and density. A "mild steel"
    // density default here would silently fabricate a weight for a material that
    // was never actually looked up (e.g. this exact bug: a honeycomb material with
    // real density 50 kg/m³ falling through to a 7850 kg/m³ steel assumption — a
    // ~150x error with no indication anything was wrong). materialDensityKgM3 = 0
    // correctly gates hasValidDimensions downstream to false, so weight/nesting
    // are skipped entirely rather than computed from an invented number.
    const notFoundFamilyUts = resolveUtsMpa(grade);
    warnings.push(
      `Material "${grade ?? 'unknown'}" not found in raw_materials database — material cost and weight are $0/0kg. ` +
      (notFoundFamilyUts != null
        ? `Press-brake tonnage uses the approved ${grade} family UTS (${notFoundFamilyUts} MPa); shear strength has no approved-family table, so it is unavailable and turret-punch tonnage checks are skipped. `
        : `The grade also matches no approved material family, so press-brake tonnage, turret-punch tonnage, and UTS-dependent DFM checks are all skipped. `) +
      `Add the material to the raw materials table to quote accurately.`,
    );
    return {
      materialCostPerKg: 0,
      materialDensityKgM3: 0,
      materialSource: 'default',
      utsMpa: notFoundFamilyUts,
      shearStrengthMpa: null,
      utsSource: notFoundFamilyUts != null ? 'family_default' : 'unavailable',
      meltingTempC: null, moldTempC: null, ejectionTempC: null, specificHeatMeltJgC: null, thermalConductivityMeltWMK: null,
      thermalSource: 'unavailable',
      cureTimeMinFromMaterial: null,
      cureTimeSource: 'unavailable',
    };
  }
}
