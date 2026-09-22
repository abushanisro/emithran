import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { resolveUtsMpa, isSheetFormableMaterial } from '../costing/shared/core/default-rates.constants';
import { isPlasticGrade } from '../costing/plastic-molding/process/process-tree';
import { shapeRankForFamily, isDiscouragedShapeForFamily } from '../../raw-materials/constants/material-shape-ranking';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import {
  rankMaterialMatches,
  pickUnambiguousBest,
  escapeLikePattern,
  type RankedMaterial,
} from '../../raw-materials/material-search-ranking';
import { expandSearchTermSpellingVariants } from '../../raw-materials/material-search-spelling';

interface MatchedMaterialRow {
  id: string;
  material: string | null; materialGrade: string | null; materialGroup: string | null;
  astmStandard: string | null; dinStandard: string | null; enStandard: string | null; jisStandard: string | null;
  hasCost: boolean;
  shape: string | null; locCost: number | null; indiaCost: number | null; densityKgM3: number | null;
  shearStrengthMpa: number | null; utsMpa: number | null;
  meltingTempC: number | null; moldTempC: number | null; ejectDeflectionTempC: number | null;
  specificHeatMeltJgC: number | null; thermalConductivityMeltWMK: number | null;
  cureTimeMinFromMaterial: number | null;
}

interface MaterialMatch {
  row: MatchedMaterialRow | undefined;
  /** Disclosure to surface as a costing warning (non-exact or duplicate-name match). */
  note: string | null;
  /** Set when the query was too under-specified to pick a grade; replaces the "not found" wording. */
  ambiguityNote: string | null;
}

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
  //      (e.g. machined-PEEK prototype pinned to milled).
  //   2. Thermoplastic grade → plastic_molded, whatever the shape classifier
  //      guessed (a PA66 cover and an aluminium cover are the same geometry).
  //   3. Non-sheet-formable alloy on a sheet-shaped part → milled (flat
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
        family: 'milled',
        familySource: 'material',
        warning:
          `${input.grade} is not sheet-formable (cast alloy) — geometry looks like flat sheet ` +
          'but the part is costed as a machined plate; verify the intended process',
      };
    }

    return { family: geoFamily, familySource: 'geometry', warning: null };
  }

  // Extracted from resolveMaterialForFamily (2026-09-19) so a caller that only
  // needs the real resolved density — not cost/UTS/thermal/cure-time — can
  // reuse the EXACT same alias/exact/ranked raw_materials match instead of
  // a second, independently-written lookup. See resolveDensityKgM3 below for
  // why this extraction exists: a part's weight must be computed from the
  // SAME material row every other property (cost, UTS, shear) already comes
  // from, never a second, differently-matched row.
  //
  // Resolution order: registered alias > exact name > RANKED designation match.
  // The last stage used to take whatever the DB happened to return first
  // (no ORDER BY, .limit(12)) -- so a loose "6061" could price on the 2700 or
  // the 2770 kg/m3 row depending on row order. It now ranks every candidate
  // with the shared, deterministic material-search ranker, discloses any
  // non-exact match, and REFUSES (returns no row) when the query cannot tell
  // materially different materials apart (a bare "ALUMINUM").
  private async matchBestRawMaterialRow(
    client: ReturnType<SupabaseService['getClient']>,
    grade: string,
    family: string,
    materialCol: string,
  ): Promise<MaterialMatch> {
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
    //
    // id/material/material_group/*_standard: identity columns the ranker
    // needs to score a candidate (materialCol above is only the COST column).
    const selectCols = `${materialCol}, id, material, material_group, astm_standard, din_standard, en_standard, jis_standard, cost_india, cost, density, density_kg_m3, shape, material_grade, shearing_strength, ultimate_tensile_strength, shear_strength_mpa, uts_mpa, melting_temp_c, mold_temp_c, specific_heat_melt, thermal_conductivity_melt, eject_deflection_temp_c` +
      (cureTimeColumnAvailable ? `, cure_time_min` : '');

    // Alias lookup first — e.g. "AL6101" has no substring in common with its
    // real row ("Generic Aluminum, ANSI 6101"), so none of the ilike attempts
    // below can ever match it. material_aliases (migration 382/383) exists
    // exactly for this and is already used by raw-materials.service.ts's own
    // search — this resolver just never queried it, so any alias-only grade
    // silently fell through to the mild-steel default further down.
    let data: unknown[] | null = null;
    let stage: 'alias' | 'exact' | 'ranked' = 'ranked';
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
        if (data?.length) stage = 'alias';
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
    // LIKE wildcards in the grade ("_", "%") are escaped so they match literally.
    const exactPattern = escapeLikePattern(g);
    if (!data?.length) {
      ({ data } = await client
        .from('raw_materials')
        .select(selectCols)
        .ilike('material', exactPattern)
        .limit(5));
      if (data?.length) stage = 'exact';
    }
    if (!data?.length) {
      ({ data } = await client
        .from('raw_materials')
        .select(selectCols)
        .ilike('material_grade', exactPattern)
        .limit(5));
      if (data?.length) stage = 'exact';
    }

    if (!data?.length) {
      // Broad, ORDERED candidate fetch -- the ranker below decides, not the DB.
      // Tokenize compound grade strings so partial-standard matches succeed.
      // "IS2062 E250 CRCA" splits to ["IS2062","E250","CRCA"]; the DB stores
      // "Mild Steel IS2062" and "CRCA Steel" as separate rows — neither matches
      // the full compound string, but each token matches at least one row.
      // Each token is searched in both real spellings (aluminium/aluminum) and
      // across the ASTM/DIN/EN/JIS standard columns, in quoted patterns so
      // commas/parentheses in a real name cannot corrupt PostgREST's or().
      // The old .limit(12) (arbitrary order) could drop the right row before
      // any ranking; the cap is now large enough to hold every plausible
      // candidate and the fetch is ordered so it is reproducible.
      const tokens = g
        .split(/[\s\-\/]+/)
        .map((t) => t.replace(/[(),]/g, ''))
        .filter((t) => t.length >= 3);
      const terms = tokens.length > 1 ? tokens : [g.replace(/[(),]/g, '')];
      const orClause = terms
        .flatMap((t) => expandSearchTermSpellingVariants(t))
        .flatMap((v) => {
          const safe = escapeLikePattern(v).replace(/"/g, '\\"');
          return ['material_grade', 'material', 'astm_standard', 'din_standard', 'en_standard', 'jis_standard']
            .map((col) => `${col}.ilike."%${safe}%"`);
        })
        .join(',');
      ({ data } = await client
        .from('raw_materials')
        .select(selectCols)
        .or(orClause)
        .order('material', { ascending: true })
        .limit(300));
    }

    // Cast via unknown: the select() column list is dynamic (location column),
    // which Supabase's literal-type parser cannot statically resolve.
    const rows: MatchedMaterialRow[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
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
        // ranker identity
        id: row.id as string,
        material: (row.material as string | null) ?? null,
        materialGrade: (row.material_grade as string | null) ?? null,
        materialGroup: (row.material_group as string | null) ?? null,
        astmStandard: (row.astm_standard as string | null) ?? null,
        dinStandard: (row.din_standard as string | null) ?? null,
        enStandard: (row.en_standard as string | null) ?? null,
        jisStandard: (row.jis_standard as string | null) ?? null,
        hasCost: (locCost != null && locCost > 0) || (indiaCost != null && indiaCost > 0),
        // resolved properties
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
    const withDensity = rows.filter((r) => r.densityKgM3 != null && r.densityKgM3 > 0);
    const ranked = rankMaterialMatches(g, withDensity, {
      family,
      aliasRowIds: stage === 'alias' ? new Set(withDensity.map((r) => r.id)) : undefined,
    });
    const pick = pickUnambiguousBest(ranked);
    const fmt = (r: RankedMaterial<MatchedMaterialRow>) =>
      `"${r.row.material ?? r.row.materialGrade}" (${Math.round(r.row.densityKgM3 as number)} kg/m³)`;

    // Only the fuzzy stage may refuse: an alias or exact-name hit is the user's
    // own explicit choice, so it is always honoured (a duplicate-name row with a
    // different density is disclosed below, never turned into a hard failure).
    if (!pick.best && stage === 'ranked' && pick.ambiguous.length > 1) {
      return {
        row: undefined,
        note: null,
        ambiguityNote:
          `Material "${g}" is ambiguous — it matches ${pick.ambiguous.length} equally specific grades with different densities ` +
          `(${pick.ambiguous.slice(0, 4).map(fmt).join(', ')}${pick.ambiguous.length > 4 ? ', …' : ''}). ` +
          `Select a specific grade; no weight or cost is assumed.`,
      };
    }
    const best = pick.best ?? ranked[0];
    if (!best) return { row: undefined, note: null, ambiguityNote: null };

    let note: string | null = null;
    if (stage === 'ranked') {
      note =
        `Material "${g}" is not an exact grade name — matched ${fmt(best)} by ${best.reason}.` +
        (pick.divergentAlternatives.length > 0
          ? ` Other candidates differ: ${pick.divergentAlternatives.map(fmt).join(', ')}. Enter the full grade name to choose explicitly.`
          : '');
    } else if (pick.divergentAlternatives.length > 0) {
      note =
        `Material "${g}" matches more than one raw_materials row with different densities — using ${fmt(best)}; ` +
        `others: ${pick.divergentAlternatives.map(fmt).join(', ')}.`;
    }
    return { row: best.row, note, ambiguityNote: null };
  }

  // Real, single density lookup for a grade — used wherever a caller needs
  // ONLY the resolved density (e.g. persisting a part's real net weight,
  // volumeMm3 * densityKgM3 / 1e9, once a material grade is committed) without
  // pulling in cost/UTS/thermal/cure-time context. Reuses the exact same
  // alias/exact/tokenized raw_materials match resolveMaterialForFamily uses —
  // never a second, independently-matched row, so a part's persisted weight
  // and its live-costed materialDensityKgM3 can never diverge onto two
  // different raw_materials rows for the same grade. materialCol defaults to
  // the always-selected 'cost' column since locCost/indiaCost are irrelevant
  // to density and this call has no location context to derive a real one.
  // Returns null (never a fabricated density) when the grade has no real
  // raw_materials match — callers must treat null as "cannot compute weight
  // yet", never substitute an assumed material's density.
  async resolveDensityKgM3(accessToken: string, grade: string, family: string = 'unknown'): Promise<number | null> {
    const g = grade?.trim();
    if (!g) return null;
    try {
      const client = this.supabaseService.getClient(accessToken);
      const { row } = await this.matchBestRawMaterialRow(client, g, family, 'cost');
      return row?.densityKgM3 ?? null;
    } catch {
      return null;
    }
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

    let ambiguityNote: string | null = null;
    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const match = await this.matchBestRawMaterialRow(client, grade, family, materialCol);
        const best = match.row;
        ambiguityNote = match.ambiguityNote;
        // A non-exact / duplicate-name match is disclosed, never silent.
        if (best && match.note) warnings.push(match.note);
        // Memoized (checkMaterialCureTimeColumnAvailable caches per-process) —
        // this is not a second query, just the same already-fetched flag
        // matchBestRawMaterialRow used internally to build its select list.
        const cureTimeColumnAvailable = await this.checkMaterialCureTimeColumnAvailable(client);

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
      (ambiguityNote ? `${ambiguityNote} Material cost and weight are $0/0kg. ` : `Material "${grade ?? 'unknown'}" not found in raw_materials database — material cost and weight are $0/0kg. `) +
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
