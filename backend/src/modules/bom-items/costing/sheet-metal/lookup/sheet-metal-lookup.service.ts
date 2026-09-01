import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import type { LookupResolution, LookupQueryParam, LookupTableRow } from '../../../dto/cost-breakdown.dto';
import { classifyLaserMaterial } from '../../shared/capability/machine-selection/physics';

// No fallback constants in this file. Every lookup below returns
// `dataFound: false` (with a neutral 0/empty value that is never priced —
// see each caller's own `...(result.dataFound ? {...} : {})` gate) when its
// real DB table has no row for the request, instead of substituting a
// hardcoded number. A missing row is a real, reportable gap — "add this row
// to the table" — never a guess dressed up as a lookup result.

// ── Normalise material names to match the seeded sm_lookup_laser_cut values ───
export function normaliseLaserMaterial(grade: string | null | undefined): string {
  const g = (grade ?? '').toUpperCase();
  if (/ALUMIN|AL\s*\d{4}|AA\s*\d{4}|6061|6063|5052|5754|7075|2024/.test(g)) return 'Aluminium';
  if (/STAINLESS|SS\s*3\d{2}|SS\s*4\d{2}|AISI\s*3\d{2}|17-4|SS304|SS316/.test(g)) return 'Stainless Steel';
  if (/BRASS|CUZ|CW/.test(g)) return 'Brass';
  // Default: CRCA, IS2062, mild, HR, DC01, E250, MS → Carbon Steel
  return 'Carbon Steel';
}

// Real commercial press brakes are only ever sold in these rated tonnage
// classes (Baileigh 42T, Amada 40T, Trumpf 40T, ... — confirmed no real
// machine exists below ~30-40T). A machine's REAL capacity, once converted
// from a kN name via precise SI physics (kN / 9.80665 — see
// machine-selection/selector.ts's parseTonnageFromName), almost never lands
// on a round class ("800kN" -> 81.6t), even though "800kN" branded brakes
// are conventionally the SAME real machine size sm_lookup_manual_stroke
// calls "80T" (1500kN/2500kN -> 153t/255t confirms this is a unit-
// convention artifact, not evidence of a genuinely different/uncovered
// machine). Rounding to the nearest class, but ONLY within 10% relative
// difference (tight enough to never silently substitute a meaningfully
// different machine), lets a real, exact-matching row resolve instead of
// gapping purely on float noise from the kN conversion. Every caller of
// getManualStrokeTime shares this rounding rather than each reimplementing
// it — this table's own resolver is the single place that knows how its
// tonnage column is actually classed.
export const STANDARD_PRESS_BRAKE_TONNAGE_CLASSES = [
  10, 20, 30, 50, 80, 100, 150, 200, 250, 300, 350, 400, 500, 800, 1000, 1500, 2000,
];

export function resolveNearestStandardTonnageClass(tonnage: number): { tonnage: number; roundedFrom: number | null } {
  if (!Number.isFinite(tonnage) || tonnage <= 0) return { tonnage, roundedFrom: null };
  const nearestClass = STANDARD_PRESS_BRAKE_TONNAGE_CLASSES.reduce(
    (best, c) => Math.abs(c - tonnage) < Math.abs(best - tonnage) ? c : best,
    STANDARD_PRESS_BRAKE_TONNAGE_CLASSES[0],
  );
  // Root-caused live 2026-08-31: real USA "11010 (Heller-hydraulic)" bend
  // brake is 1096kN -> 111.76t (SI conversion, machine_library.json's own
  // press_force_kn), 10.52% from its clearly-intended 100T class — just over
  // the previous 10% cutoff, so it fell through to "no data" for every real
  // part instead of using the real 100T stroke-time curve. Checked the FULL
  // real Bend Press Brake category (16 machines) before widening: there is a
  // clean, evidenced gap between machines clearly meant to fit a class
  // (≤10.85% away — e.g. this Heller unit, and "HG-2204 (Amada)" at 1843.4kN
  // aka 224.34t/10.85% from 200T, same bug) and genuinely different-sized
  // real machines (13.15%+ away — e.g. "HG-1303 (Amada)"/"SPH-60C (Amada)")
  // that must NOT be force-matched to a distant class. 11% captures exactly
  // the first group, unchanged for everything else.
  const withinTolerance = Math.abs(nearestClass - tonnage) / tonnage <= 0.11;
  return withinTolerance && nearestClass !== tonnage
    ? { tonnage: nearestClass, roundedFrom: tonnage }
    : { tonnage, roundedFrom: null };
}

function nearestKey(value: number, keys: number[]): number {
  if (!keys.length) return value;
  return keys.reduce((best, k) => Math.abs(k - value) < Math.abs(best - value) ? k : best, keys[0]);
}

// A theoretical required-force estimate (no real machine selected) never
// lands on one of the standard classes above — a real shop always runs the
// job on the smallest REAL machine whose rated capacity meets or exceeds the
// requirement (never a smaller one), so round UP rather than to the nearest.
// Contrast resolveNearestStandardTonnageClass: that one corrects unit-naming
// noise for an ALREADY-KNOWN real machine's capacity (round to nearest,
// tightly bounded) — a fundamentally different situation from "no machine
// picked yet, what capacity would this actually need."
export function roundUpToStandardTonnageClass(requiredTonnage: number): number {
  if (!Number.isFinite(requiredTonnage) || requiredTonnage <= 0) return requiredTonnage;
  const adequate = STANDARD_PRESS_BRAKE_TONNAGE_CLASSES.find((c) => c >= requiredTonnage);
  return adequate ?? STANDARD_PRESS_BRAKE_TONNAGE_CLASSES[STANDARD_PRESS_BRAKE_TONNAGE_CLASSES.length - 1];
}

// ── Public interfaces ──────────────────────────────────────────────────────────

export interface LaserCutParams {
  cuttingSpeedMPerMin: number;
  pierceTimeMin: number;
  kerfMm: number;
  dataFound: boolean;
}

export interface WaterjetCutParams {
  cuttingSpeedMmPerMin: number;
  pierceTimeMin: number;
  kerfMm: number;
  dataFound: boolean;
}

export interface RouterCutParams {
  cuttingSpeedMmPerMin: number;
  dataFound: boolean;
}

export interface OxyfuelCutParams {
  feedRateLargeFeaturesMmPerMin: number;
  pierceTimeSec: number;
  dataFound: boolean;
}

export interface LaserPunchMachineParams {
  punchRateCyclesPerMin: number;
  nibbleMmPerMin: number;
  toolChangeSec: number;
  dataFound: boolean;
}

// Real material-family -> sm_lookup_router_cut key mapping. Deliberately NOT
// normaliseLaserMaterial() below (which speaks a different vocabulary:
// 'Aluminium'/'Stainless Steel'/'Brass'/'Carbon Steel', with no distinct
// Copper bucket) — the router table's real source, tblRouterUtilities.json,
// only ever has 'Aluminum'/'Copper' rows (American spelling, no Steel/
// Stainless data of any kind), so classifyLaserMaterial()'s AL/CU tokens map
// onto it directly and honestly. MS/SS/OTHER get no key at all — a genuine,
// disclosed gap in the source data, not a guess forced into a table that
// doesn't have it.
const ROUTER_FAMILY_KEY: Partial<Record<ReturnType<typeof classifyLaserMaterial>, string>> = {
  AL: 'Aluminum',
  CU: 'Copper',
};

// No fallback constants for waterjet: unlike laser (which had years of prior
// hardcoded defaults to migrate from), there is no pre-existing waterjet
// speed table anywhere in this codebase to fall back to. If
// sm_lookup_waterjet_cut (migration 398) has no row for a material/
// thickness, dataFound:false is returned with a null-safe zero rather than a
// fabricated number — the caller must surface that as a real gap.

@Injectable()
export class SheetMetalLookupService {
  constructor(private readonly supabase: SupabaseService) {}

  // lookup_table_policy (migration 427) was seeded but never actually read —
  // every call site below hardcoded 'EXACT_MATCH'/'INTERPOLATE' as a TS
  // literal, matching the DB row by convention only. This reads the real row
  // (cached in-process — these classifications don't change mid-request, and
  // rarely change at all) so the admin-declared policy genuinely governs the
  // label a caller sees, falling back to `fallback` (today's literal) only
  // when a table has no row yet — no behavior change for any already-
  // classified table. Deliberately NOT used to gate the thickness-
  // interpolation branch inside getManualStrokeTime below — that's a real,
  // always-on per-FIELD behavior (see its own doc comment), not the table-
  // level switch this column represents.
  private policyCache = new Map<string, 'EXACT_MATCH' | 'INTERPOLATE' | 'RANGE' | 'FORMULA'>();
  async resolveLookupPolicy(
    tableName: string,
    fallback: 'EXACT_MATCH' | 'INTERPOLATE' | 'RANGE' | 'FORMULA',
  ): Promise<'EXACT_MATCH' | 'INTERPOLATE' | 'RANGE' | 'FORMULA'> {
    if (this.policyCache.has(tableName)) return this.policyCache.get(tableName)!;
    try {
      const db = this.supabase.getAdminClient();
      const { data } = await db.from('lookup_table_policy').select('policy').eq('table_name', tableName).maybeSingle();
      const policy = (data?.policy as any) ?? fallback;
      this.policyCache.set(tableName, policy);
      return policy;
    } catch {
      return fallback;
    }
  }

  // ── Table 5: Laser cutting params ─────────────────────────────────────────
  // technology is required, not optional: fiber (~1.06um) and co2 (10.6um)
  // cutting speed/pierce time genuinely differ and must never cross-match —
  // see migration 457. Every row seeded so far is 'fiber'; a co2-classed
  // machine (e.g. AMADA Quattro) correctly gets dataFound:false until real
  // co2-specific data is sourced, regardless of what power it reports.
  async getLaserParams(
    grade: string | null | undefined,
    thicknessMm: number,
    powerW: number,
    technology: 'fiber' | 'co2',
  ): Promise<LaserCutParams> {
    const material = normaliseLaserMaterial(grade);
    const db = this.supabase.getAdminClient();

    // First: try exact thickness + nearest available power for this material
    const { data, error } = await db
      .from('sm_lookup_laser_cut')
      .select('cutting_speed_m_per_min, pierce_time_min, kerf_mm, laser_power_w, thickness_mm')
      .eq('material', material)
      .eq('laser_technology', technology)
      .not('cutting_speed_m_per_min', 'is', null)
      .order('thickness_mm', { ascending: true });

    const noData: LaserCutParams = { cuttingSpeedMPerMin: 0, pierceTimeMin: 0, kerfMm: 0, dataFound: false };

    if (error || !data?.length) {
      return noData;
    }

    // Find nearest thickness available for this material
    const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))].sort((a, b) => a - b);
    const nearestThick = nearestKey(thicknessMm, thicknesses);
    const rowsAtThick = data.filter((r) => Number(r.thickness_mm) === nearestThick);

    if (!rowsAtThick.length) return noData;

    // Among rows at that thickness, pick nearest power that has non-null speed
    const powers = rowsAtThick.map((r) => Number(r.laser_power_w));
    const nearestPwr = nearestKey(powerW, powers);
    const row = rowsAtThick.find((r) => Number(r.laser_power_w) === nearestPwr);

    if (!row || row.cutting_speed_m_per_min == null) {
      return noData;
    }

    const pierceTimeMin = row.pierce_time_min != null ? Number(row.pierce_time_min) : null;
    const kerfMm = row.kerf_mm != null ? Number(row.kerf_mm) : null;
    // If any expected column is null, treat the row as incomplete — dataFound:false
    // ensures the caller emits a warning rather than silently using fallback values.
    if (pierceTimeMin == null || kerfMm == null) {
      return noData;
    }
    return {
      cuttingSpeedMPerMin: Number(row.cutting_speed_m_per_min),
      pierceTimeMin,
      kerfMm,
      dataFound: true,
    };
  }

  // ── Waterjet cutting params (migration 398) ───────────────────────────────
  // No power/pressure axis — see migration 398 for why (this app's real
  // waterjet machine names don't carry a consistently parseable pump rating).
  async getWaterjetParams(
    grade: string | null | undefined,
    thicknessMm: number,
  ): Promise<WaterjetCutParams> {
    const material = normaliseLaserMaterial(grade);
    const db = this.supabase.getAdminClient();

    const { data, error } = await db
      .from('sm_lookup_waterjet_cut')
      .select('cutting_speed_mm_per_min, pierce_time_sec, kerf_mm, thickness_mm')
      .eq('material', material)
      .not('cutting_speed_mm_per_min', 'is', null)
      .order('thickness_mm', { ascending: true });

    if (error || !data?.length) {
      return { cuttingSpeedMmPerMin: 0, pierceTimeMin: 0, kerfMm: 0, dataFound: false };
    }

    const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))].sort((a, b) => a - b);
    const nearestThick = nearestKey(thicknessMm, thicknesses);
    const row = data.find((r) => Number(r.thickness_mm) === nearestThick);

    if (!row || row.cutting_speed_mm_per_min == null || row.pierce_time_sec == null || row.kerf_mm == null) {
      return { cuttingSpeedMmPerMin: 0, pierceTimeMin: 0, kerfMm: 0, dataFound: false };
    }
    return {
      cuttingSpeedMmPerMin: Number(row.cutting_speed_mm_per_min),
      pierceTimeMin: Number(row.pierce_time_sec) / 60,
      kerfMm: Number(row.kerf_mm),
      dataFound: true,
    };
  }

  // ── OxyFuel Cut params (2026-09-01, sm_reference_data 'nestingCutRate:*:
  // OxyFuelCut:*' rows — migration 492, real "USA reference export" data,
  // 278 rows covering Steel/Cast Iron/Stainless Steel, 3mm-305mm, all at
  // powerWatts=200 — every one of the 18 real Oxyfuel machines in
  // machine_library.json reports power_watts=200 too, so this single tier
  // covers all of them; a genuinely different tier would honestly gap via
  // the nearest-power fallback below, same as getLaserParams' nearest-
  // power logic). materialCutCodeFamily is dropped after filtering by
  // materialTypeName — same simplification getWaterjetParams/getLaserParams
  // already make (their tables don't carry that axis at all).
  async getOxyfuelParams(
    grade: string | null | undefined,
    thicknessMm: number,
  ): Promise<OxyfuelCutParams> {
    const noData: OxyfuelCutParams = { feedRateLargeFeaturesMmPerMin: 0, pierceTimeSec: 0, dataFound: false };
    const material = normaliseLaserMaterial(grade); // 'Aluminium'|'Stainless Steel'|'Brass'|'Carbon Steel' — see below for the OxyFuel-specific remap
    // The real OxyFuel dataset's material axis is 'Steel'/'Cast Iron'/
    // 'Stainless Steel' — a different vocabulary from normaliseLaserMaterial's
    // laser-specific set (which has no 'Cast Iron' at all, and calls plain
    // carbon steel 'Carbon Steel' not 'Steel'). Remapped here rather than
    // widening normaliseLaserMaterial itself, which every laser/waterjet
    // caller also depends on staying exactly as-is.
    const oxyfuelMaterial = material === 'Stainless Steel' ? 'Stainless Steel' : 'Steel';

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .like('key', 'nestingCutRate:%:OxyFuelCut:%');
    if (error || !data?.length) return noData;

    const rowsForMaterial = data.filter((r: any) => r.raw?.materialTypeName === oxyfuelMaterial);
    if (!rowsForMaterial.length) return noData;

    const thicknesses = [...new Set(rowsForMaterial.map((r: any) => Number(r.raw?.thicknessMm)))].sort((a, b) => a - b);
    const nearestThick = nearestKey(thicknessMm, thicknesses);
    const row = rowsForMaterial.find((r: any) => Number(r.raw?.thicknessMm) === nearestThick);
    const feedRate = row?.raw?.feedRateLargeFeaturesMmPerMin;
    const pierceTimeS = row?.raw?.pierceTimeS;
    if (typeof feedRate !== 'number' || !Number.isFinite(feedRate) || feedRate <= 0 || typeof pierceTimeS !== 'number') {
      return noData;
    }
    return { feedRateLargeFeaturesMmPerMin: feedRate, pierceTimeSec: pierceTimeS, dataFound: true };
  }

  // ── Laser Punch per-machine physics (2026-09-01, sm_reference_data
  // 'laserPunchMachine:<machine name>' rows staged from machine_library.json's
  // "Laser Punch / Punch Press" category, all 26 real machines). Unlike
  // getWaterjetParams/getOxyfuelParams/getRouterParams above (resolved ONCE
  // from material+thickness before machine selection), this is keyed by the
  // SPECIFIC machine name mhrRates.laserPunch resolved to — these combo
  // laser+punch machines report punch/nibble rate as a per-unit spec, not a
  // shared material/thickness table. nibbleMmPerMin is derived here from the
  // real nibble_rate_cycles_min × (nibble_tool_diameter_mm −
  // nibble_tool_overlap_mm) — the standard nibbling step-per-cycle geometry
  // (each cycle advances less than the full tool diameter so the cut edge
  // stays continuous), not a fabricated speed.
  async getLaserPunchMachineParams(machineName: string | null | undefined): Promise<LaserPunchMachineParams> {
    const noData: LaserPunchMachineParams = { punchRateCyclesPerMin: 0, nibbleMmPerMin: 0, toolChangeSec: 0, dataFound: false };
    if (!machineName) return noData;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'machine')
      .eq('key', `laserPunchMachine:${machineName}`)
      .maybeSingle();
    if (error || !data?.raw) return noData;

    const punchRate = data.raw.punch_rate_cycles_min;
    const nibbleRate = data.raw.nibble_rate_cycles_min;
    const nibbleDia = data.raw.nibble_tool_diameter_mm;
    const nibbleOverlap = data.raw.nibble_tool_overlap_mm;
    const toolChangeSec = data.raw.tool_change_time_s;
    if (
      typeof punchRate !== 'number' || punchRate <= 0 ||
      typeof nibbleRate !== 'number' || nibbleRate <= 0 ||
      typeof nibbleDia !== 'number' || typeof nibbleOverlap !== 'number' ||
      typeof toolChangeSec !== 'number'
    ) {
      return noData;
    }
    const nibbleStepMm = nibbleDia - nibbleOverlap;
    if (nibbleStepMm <= 0) return noData;

    return {
      punchRateCyclesPerMin: punchRate,
      nibbleMmPerMin: nibbleRate * nibbleStepMm,
      toolChangeSec,
      dataFound: true,
    };
  }

  // ── 2-Axis Router cutting params (Track B Phase 2, tblRouterUtilities.json) ──
  // Real data covers only Aluminum/Copper — see ROUTER_FAMILY_KEY's own
  // comment. Multiple tool_diameter_mm rows exist per material family, all
  // sharing the same real cutting_speed_m_per_min value in the source data;
  // ordering by tool_diameter_mm and taking the first is deterministic (never
  // an arbitrary/unordered pick) even though the diameter itself doesn't
  // currently change the result.
  async getRouterParams(grade: string | null | undefined): Promise<RouterCutParams> {
    const noData: RouterCutParams = { cuttingSpeedMmPerMin: 0, dataFound: false };
    const familyKey = ROUTER_FAMILY_KEY[classifyLaserMaterial(grade ?? null)];
    if (!familyKey) return noData;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_lookup_router_cut')
      .select('cutting_speed_m_per_min')
      .eq('material_family', familyKey)
      .order('tool_diameter_mm', { ascending: true })
      .limit(1);

    if (error || !data?.length || data[0].cutting_speed_m_per_min == null) {
      return noData;
    }
    return {
      cuttingSpeedMmPerMin: Number(data[0].cutting_speed_m_per_min) * 1000, // m/min -> mm/min
      dataFound: true,
    };
  }

  // ── Table 2: Handling time (min) for given weight kg ───────────────────────
  async getHandlingTime(weightKg: number): Promise<{ minutes: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_handling_time')
      .select('weight_max_kg, handling_min')
      .gte('weight_max_kg', weightKg)
      .order('weight_max_kg', { ascending: true })
      .limit(1);

    if (!data?.length) {
      // Weight exceeds table max — use the last (heaviest) row; this is real DB
      // data extrapolated at the boundary, not a fallback.
      const { data: last } = await db
        .from('sm_lookup_handling_time')
        .select('handling_min')
        .order('weight_max_kg', { ascending: false })
        .limit(1);
      return last?.[0]
        ? { minutes: Number(last[0].handling_min), dataFound: true }
        : { minutes: 0, dataFound: false };
    }
    return { minutes: Number(data[0].handling_min), dataFound: true };
  }

  // ── Table 3A/B: Tool setup time (min) ─────────────────────────────────────
  // type='press' → keyValue = tonnage; type='brake' → keyValue = tool length mm
  async getToolSetupTime(type: 'press' | 'brake', keyValue: number): Promise<{ minutes: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_tool_setup')
      .select('key_value, loading_time_min')
      .eq('setup_type', type)
      .order('key_value', { ascending: true });

    if (!data?.length) {
      return { minutes: 0, dataFound: false };
    }

    const rows = data.map((r) => ({ kv: Number(r.key_value), t: Number(r.loading_time_min) }));
    const best = rows.reduce(
      (b, r) => Math.abs(r.kv - keyValue) < Math.abs(b.kv - keyValue) ? r : b,
      rows[0],
    );
    return { minutes: best.t, dataFound: true };
  }

  // ── Table 4: Manual stroke time (sec) ─────────────────────────────────────
  // Mixed granularity, per real machine physics: TONNAGE and COMPLEXITY are
  // EXACT_MATCH (migration 427) — a real machine either IS this tonnage
  // class or it isn't; there's no "in-between" 45-ton press to interpolate
  // toward between a real 30T and 50T machine, and substituting one would be
  // exactly the "fabricated value dressed as a lookup" this architecture
  // exists to remove (confirmed live: the Press Brake calculator crashed
  // because a separate round-down-only query had no such safety net).
  // THICKNESS interpolates (real, disclosed INTERPOLATE policy, same
  // convention as sm_lookup_laser_cut's cutting-speed curve) once tonnage and
  // complexity are pinned to a real row — confirmed live: the source spec
  // this table was seeded from (memory/sheetmetal/Lookup_Table_4_Manual_
  // Stroke_Time.md) only has whole-mm thickness rows (1,2,3,4,5,6,8,10,12,
  // 14,16), yet stroke time visibly varies SMOOTHLY with thickness within a
  // fixed tonnage/complexity (e.g. tonnage=10,simple: 1mm→1.00s, 2mm→1.11s)
  // — a real physical dwell-time relationship for one real machine, not a
  // guess across different machines. A common real gauge like 1.5mm sheet
  // has no exact row at any tonnage, which is a genuine, disclosed
  // INTERPOLATE case, never presented as an exact hit. Extrapolating beyond
  // the seeded thickness range (below 1mm or above 16mm) for a given
  // tonnage/complexity is still a real gap, not interpolation — rule 4 of
  // this architecture's own policy definitions.
  async getManualStrokeTime(
    thicknessMm: number,
    tonnage: number,
    complexity: 'simple' | 'complex',
  ): Promise<{ secondsPerBend: number; dataFound: boolean; resolution: LookupResolution; roundedFromTonnage: number | null }> {
    const table = 'sm_lookup_manual_stroke';
    const exactPolicy = await this.resolveLookupPolicy(table, 'EXACT_MATCH');
    // Round the incoming (real, exact) tonnage to this table's own standard
    // classes before querying — see resolveNearestStandardTonnageClass's doc
    // comment. Every caller (backend cost engine, route comparison, the
    // standalone interactive calculator dialog) shares this single rounding
    // rule instead of each reimplementing it or gapping on float noise.
    const { tonnage: roundedTonnage, roundedFrom: roundedFromTonnage } = resolveNearestStandardTonnageClass(tonnage);
    tonnage = roundedTonnage;
    const queryParams: LookupQueryParam[] = [
      { column: 'thickness_mm', value: thicknessMm, unit: 'mm' },
      { column: 'tonnage', value: tonnage, unit: 'T' },
      { column: 'complexity', value: complexity },
    ];
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_manual_stroke')
      .select('thickness_mm, tonnage, complexity, stroke_time_sec')
      .eq('complexity', complexity);

    if (!data?.length) {
      return {
        secondsPerBend: 0,
        dataFound: false,
        resolution: { table, policy: exactPolicy, queryParams, matchedRow: null, nearestRows: [] },
        roundedFromTonnage,
      };
    }

    const rows = data.map((r) => ({
      thickness_mm: Number(r.thickness_mm),
      tonnage: Number(r.tonnage),
      complexity: String(r.complexity),
      stroke_time_sec: Number(r.stroke_time_sec),
    }));

    const toTableRow = (r: typeof rows[number], matchedDimensions: number): LookupTableRow => ({
      columns: { thickness_mm: r.thickness_mm, tonnage: r.tonnage, complexity: r.complexity, stroke_time_sec: r.stroke_time_sec },
      matchedDimensions,
      totalDimensions: 3,
    });

    // Small epsilon for float storage/rounding, not a nearest-DIFFERENT-
    // value search.
    const EPS = 0.01;

    // Exact hit on all three dimensions — the common, cheap case.
    const exactRow = rows.find((r) =>
      Math.abs(r.thickness_mm - thicknessMm) < EPS &&
      Math.abs(r.tonnage - tonnage) < EPS,
    );
    if (exactRow) {
      return {
        secondsPerBend: exactRow.stroke_time_sec,
        dataFound: true,
        resolution: { table, policy: exactPolicy, queryParams, matchedRow: toTableRow(exactRow, 3), nearestRows: [] },
        roundedFromTonnage,
      };
    }

    // Tonnage is EXACT_MATCH — no real row at this exact tonnage class means
    // a real gap regardless of thickness, disclosing the closest real
    // candidates across the whole table (unchanged from the original
    // EXACT_MATCH-only behavior).
    const tonnageRows = rows.filter((r) => Math.abs(r.tonnage - tonnage) < EPS);
    if (tonnageRows.length === 0) {
      const thicknesses = rows.map((r) => r.thickness_mm);
      const tonnages = rows.map((r) => r.tonnage);
      const thickSpan = Math.max(1e-6, Math.max(...thicknesses) - Math.min(...thicknesses));
      const tonSpan = Math.max(1e-6, Math.max(...tonnages) - Math.min(...tonnages));
      const nearestRows: LookupTableRow[] = [...rows]
        .sort((a, b) => {
          const da = ((a.thickness_mm - thicknessMm) / thickSpan) ** 2 + ((a.tonnage - tonnage) / tonSpan) ** 2;
          const db_ = ((b.thickness_mm - thicknessMm) / thickSpan) ** 2 + ((b.tonnage - tonnage) / tonSpan) ** 2;
          return da - db_;
        })
        .slice(0, 3)
        .map((r) => toTableRow(r, 1 + (Math.abs(r.thickness_mm - thicknessMm) < EPS ? 1 : 0)));
      return {
        secondsPerBend: 0,
        dataFound: false,
        resolution: { table, policy: exactPolicy, queryParams, matchedRow: null, nearestRows },
        roundedFromTonnage,
      };
    }

    // Tonnage (and complexity) are pinned to a real machine class — now
    // interpolate thickness between the two real bracketing rows for THAT
    // exact tonnage. Requesting a thickness outside the seeded range for
    // this tonnage is extrapolation, not interpolation — still a real gap.
    const sortedByThickness = [...tonnageRows].sort((a, b) => a.thickness_mm - b.thickness_mm);
    const lower = [...sortedByThickness].reverse().find((r) => r.thickness_mm <= thicknessMm);
    const upper = sortedByThickness.find((r) => r.thickness_mm >= thicknessMm);
    if (lower && upper && lower.thickness_mm !== upper.thickness_mm) {
      const fraction = (thicknessMm - lower.thickness_mm) / (upper.thickness_mm - lower.thickness_mm);
      const interpolatedSec = lower.stroke_time_sec + fraction * (upper.stroke_time_sec - lower.stroke_time_sec);
      const interpolatedRow: LookupTableRow = {
        columns: {
          thickness_mm: thicknessMm, tonnage, complexity,
          stroke_time_sec: Math.round(interpolatedSec * 100) / 100,
          interpolated_between_thickness_mm: `${lower.thickness_mm}-${upper.thickness_mm}`,
        },
        matchedDimensions: 3,
        totalDimensions: 3,
      };
      return {
        secondsPerBend: interpolatedSec,
        dataFound: true,
        resolution: {
          table, policy: 'INTERPOLATE', queryParams,
          matchedRow: interpolatedRow,
          nearestRows: [toTableRow(lower, 2), toTableRow(upper, 2)],
        },
        roundedFromTonnage,
      };
    }

    // Requested thickness falls outside this tonnage/complexity's real
    // seeded range — no bracketing pair, so the interpolation above can't
    // run. When at least two real rows exist on the near side, extend the
    // SAME linear relationship already trusted for interpolation one step
    // further (the local slope between the two nearest real rows), clearly
    // disclosed as extrapolated rather than an exact or bracketed-interpolated
    // hit — e.g. 0.5mm at a tonnage/complexity whose smallest real row is
    // 1mm. This is a deliberate, disclosed exception to "extrapolation is
    // always a gap" for exactly this situation, not a general reopening of
    // it — a genuine gap (fewer than 2 real rows on the near side, or a
    // negative extrapolated result) still falls through to the report below.
    const sortedForExtrapolation = sortedByThickness;
    if (sortedForExtrapolation.length >= 2) {
      const belowMin = thicknessMm < sortedForExtrapolation[0].thickness_mm;
      const aboveMax = thicknessMm > sortedForExtrapolation[sortedForExtrapolation.length - 1].thickness_mm;
      const anchor = belowMin
        ? [sortedForExtrapolation[0], sortedForExtrapolation[1]]
        : aboveMax
          ? [sortedForExtrapolation[sortedForExtrapolation.length - 2], sortedForExtrapolation[sortedForExtrapolation.length - 1]]
          : null;
      if (anchor) {
        const [a, b] = anchor;
        const slope = (b.stroke_time_sec - a.stroke_time_sec) / (b.thickness_mm - a.thickness_mm);
        const extrapolatedSec = a.stroke_time_sec + slope * (thicknessMm - a.thickness_mm);
        if (Number.isFinite(extrapolatedSec) && extrapolatedSec > 0) {
          const extrapolatedRow: LookupTableRow = {
            columns: {
              thickness_mm: thicknessMm, tonnage, complexity,
              stroke_time_sec: Math.round(extrapolatedSec * 100) / 100,
              extrapolated_from_thickness_mm: `${a.thickness_mm}-${b.thickness_mm}`,
            },
            matchedDimensions: 3,
            totalDimensions: 3,
          };
          return {
            secondsPerBend: extrapolatedSec,
            dataFound: true,
            resolution: {
              table, policy: 'INTERPOLATE', queryParams,
              matchedRow: extrapolatedRow,
              nearestRows: [toTableRow(a, 2), toTableRow(b, 2)],
            },
            roundedFromTonnage,
          };
        }
      }
    }

    // Fewer than two real rows on the near side (or a nonsensical negative
    // result) — a real gap, disclosing the closest real same-tonnage rows on
    // file.
    const nearestRows: LookupTableRow[] = [...tonnageRows]
      .sort((a, b) => Math.abs(a.thickness_mm - thicknessMm) - Math.abs(b.thickness_mm - thicknessMm))
      .slice(0, 3)
      .map((r) => toTableRow(r, 2));
    return {
      secondsPerBend: 0,
      dataFound: false,
      resolution: { table, policy: exactPolicy, queryParams, matchedRow: null, nearestRows },
      roundedFromTonnage,
    };
  }

  // ── Real per-machine bend cycle time, for the SPECIFIC selected press
  // brake ── machine_library.json carries a real bend_cycle_time_s for all
  // 16 named "Bend Press Brake" machines. Same exact-name, non-ambiguous
  // matching discipline as getWaterjetAbrasiveRateForMachine/
  // getTurretPunchParamsForMachine.
  async getBendCycleTimeForMachine(machineName: string | null | undefined): Promise<{ secondsPerBend: number | null; dataFound: boolean }> {
    const empty = { secondsPerBend: null, dataFound: false };
    if (!machineName?.trim()) return empty;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'machine');
    if (error || !data) return empty;

    const nameLower = machineName.trim().toLowerCase();
    const matches = data.filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
    if (matches.length !== 1) return empty;

    const val = matches[0].raw?.bend_cycle_time_s;
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return empty;
    return { secondsPerBend: val, dataFound: true };
  }

  // ── Bend stroke time, preferring the SPECIFIC selected press brake's own
  // real cycle time over the generic thickness/tonnage/complexity curve —
  // per explicit product decision (same "prefer it outright" rule applied to
  // Turret Punch's rate/tool-change time). A drop-in replacement for
  // getManualStrokeTime() at every one of its Bend Brake call sites — a
  // single composed method rather than each call site re-implementing the
  // same merge, so a future call site can't independently drift out of sync
  // (this codebase has been bitten by exactly that class of bug before, with
  // labour-rate resolution — see bom-items.service.ts's resolveLHRRates
  // comment). `resolution`/`roundedFromTonnage` are passed through from the
  // generic curve unchanged (still useful audit-trail context) even when the
  // real per-machine value wins on secondsPerBend/dataFound.
  async getManualStrokeTimeForPressBrake(
    thicknessMm: number,
    tonnage: number,
    complexity: 'simple' | 'complex',
    machineName: string | null | undefined,
  ): ReturnType<SheetMetalLookupService['getManualStrokeTime']> {
    const [generic, real] = await Promise.all([
      this.getManualStrokeTime(thicknessMm, tonnage, complexity),
      this.getBendCycleTimeForMachine(machineName),
    ]);
    if (!real.dataFound || real.secondsPerBend == null) return generic;
    return { ...generic, secondsPerBend: real.secondsPerBend, dataFound: true };
  }

  // ── Table 6: Sampling rate (fraction) for given lot size ──────────────────
  // Returns sample_qty_l2 / lotSize as a fraction.
  async getSamplingRate(lotSize: number): Promise<{ rate: number; dataFound: boolean }> {
    if (lotSize <= 0) return { rate: 0, dataFound: false };

    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_sampling_plan')
      .select('batch_size_from, batch_size_to, sample_qty_l2')
      .lte('batch_size_from', lotSize)
      .gte('batch_size_to', lotSize)
      .limit(1);

    if (!data?.length || data[0].sample_qty_l2 == null) {
      return { rate: 0, dataFound: false };
    }
    return { rate: Math.min(1, Number(data[0].sample_qty_l2) / lotSize), dataFound: true };
  }

  // ── Table 7: Per-piece inspection time (min) by complexity tier ───────────
  // Previously a flat 0.5min CostEngineInput default parameter that NO caller
  // ever overrode — silently baked into every sheet-metal process line's
  // inspection cost with zero DB backing (see migration <N>_sm_lookup_
  // inspection_time.sql). Mirrors getSamplingRate's structure exactly.
  async getInspectionTime(complexity: 'simple' | 'inter' | 'complex'): Promise<{ minutes: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_inspection_time')
      .select('inspection_min')
      .eq('complexity', complexity)
      .limit(1);

    if (!data?.length || data[0].inspection_min == null) {
      return { minutes: 0, dataFound: false };
    }
    return { minutes: Number(data[0].inspection_min), dataFound: true };
  }

  // ── Per-batch setup/changeover time (min) by operation ────────────────────
  // See migration 416 — replaces the 11 separate *_SETUP_MIN constants that
  // used to live directly in default-rates.ts with zero DB backing.
  // Bulk: one query for the whole (small, 11-row) table — callers typically
  // need several operations' setup times per request (e.g. getRouteComparison
  // needs laser/turret_punch/waterjet/press_brake; getCostSummary needs
  // tapping/counterbore/countersink/pem_insertion/burring/ream), so this
  // avoids N round trips the way getCounterboreCycleTimes already does for
  // its own bulk lookup.
  async getOpSetupTimes(): Promise<{ minutes: Map<string, number>; dataFound: Set<string> }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_op_setup_time')
      .select('operation, setup_min');

    const minutes = new Map<string, number>();
    const dataFound = new Set<string>();
    for (const r of data ?? []) {
      if (r.setup_min == null) continue;
      minutes.set(r.operation, Number(r.setup_min));
      dataFound.add(r.operation);
    }
    return { minutes, dataFound };
  }

  // Resolves one operation's setup time from an already-fetched getOpSetupTimes()
  // result. No fallback constant when the table has no row yet for this
  // operation — callers disclose the gap (dataFound:false) and must not price
  // a fabricated setup time; 0 here is a neutral placeholder, never charged.
  resolveOpSetupMin(resolved: { minutes: Map<string, number>; dataFound: Set<string> }, operation: string): { minutes: number; dataFound: boolean } {
    if (resolved.dataFound.has(operation)) return { minutes: resolved.minutes.get(operation)!, dataFound: true };
    return { minutes: 0, dataFound: false };
  }

  // ── Per-feature, per-method inspection cycle time (sec) ───────────────────
  // See migration 423 — feeds costing/inspection-engine.ts's general-purpose
  // Inspection process line. Bulk: one query for the whole (small, ~21-row)
  // table, same convention as getOpSetupTimes() above — the caller passes the
  // full array straight through to computeInspectionLine, which does its own
  // feature+method lookup and disclosed fallback.
  async getInspectionOperationDefaults(): Promise<import('../../shared/process/inspection-engine').InspectionOperationDefaultRow[]> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('inspection_operation_defaults')
      .select('feature, method, cycle_time_sec, sampling_default, equipment');
    return (data ?? []).map((r: any) => ({
      feature: r.feature,
      method: r.method,
      cycle_time_sec: Number(r.cycle_time_sec),
      sampling_default: r.sampling_default ?? null,
      equipment: r.equipment ?? null,
    }));
  }

  // ── Turret punch press cycle-time params by thickness ─────────────────────
  // See migration 414 — replaces TURRET_HITS_PER_MIN/TURRET_NIBBLE_MM_PER_MIN/
  // TURRET_TOOL_CHANGE_SEC, which used to live directly in default-rates.ts.
  async getTurretPunchParams(thicknessMm: number): Promise<{
    hitsPerMin: number; nibbleMmPerMin: number; toolChangeSec: number; dataFound: boolean;
  }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_turret_punch')
      .select('thickness_mm, hits_per_min, nibble_mm_per_min, tool_change_sec')
      .order('thickness_mm', { ascending: true });

    if (!data?.length) {
      return { hitsPerMin: 0, nibbleMmPerMin: 0, toolChangeSec: 0, dataFound: false };
    }
    const thicknesses = data.map((r) => Number(r.thickness_mm));
    const nearestThick = nearestKey(thicknessMm, thicknesses);
    const row = data.find((r) => Number(r.thickness_mm) === nearestThick)!;
    return {
      hitsPerMin: Number(row.hits_per_min),
      nibbleMmPerMin: Number(row.nibble_mm_per_min),
      toolChangeSec: Number(row.tool_change_sec),
      dataFound: true,
    };
  }

  // ── Turret Punch rate for the SPECIFIC selected machine, not the generic
  // thickness curve ── machine_library.json carries real per-machine
  // punch_rate_cycles_min/tool_change_time_s for every named turret/laser-
  // punch machine (47 total). Unlike getWaterjetAbrasiveRateForMachine, this
  // deliberately does NOT touch nibble speed — the real source has no
  // matching mm/min field (only nibble_rate_cycles_min, cycles/min, which
  // would need an inferred tool-diameter/overlap conversion formula, not a
  // direct substitution — left for a separate, reviewed follow-up).
  // Same exact-name, non-ambiguous matching discipline as
  // lookupMachineLibraryBenchmark()/getWaterjetAbrasiveRateForMachine —
  // never guesses. Per explicit product decision, the real machine's own
  // rate is preferred outright over the generic thickness-keyed curve
  // whenever the selected machine has real data — even though this specific
  // real value is not itself thickness-adjusted.
  async getTurretPunchParamsForMachine(machineName: string | null | undefined): Promise<{
    hitsPerMin: number | null; toolChangeSec: number | null; dataFound: boolean;
  }> {
    const empty = { hitsPerMin: null, toolChangeSec: null, dataFound: false };
    if (!machineName?.trim()) return empty;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'machine');
    if (error || !data) return empty;

    const nameLower = machineName.trim().toLowerCase();
    const matches = data.filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
    if (matches.length !== 1) return empty;

    const raw = matches[0].raw ?? {};
    const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
    const hitsPerMin = numOrNull(raw.punch_rate_cycles_min);
    const toolChangeSec = numOrNull(raw.tool_change_time_s);
    return { hitsPerMin, toolChangeSec, dataFound: hitsPerMin != null || toolChangeSec != null };
  }

  // ── Waterjet abrasive (garnet) consumption rate ────────────────────────────
  // See migration 415 — replaces WATERJET_ABRASIVE_KG_PER_MIN, which used to
  // live directly in default-rates.ts.
  async getWaterjetAbrasiveRate(pumpTier = '50hp_60kpsi'): Promise<{ kgPerMin: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_waterjet_abrasive_rate')
      .select('abrasive_kg_per_min')
      .eq('pump_tier', pumpTier)
      .limit(1);

    if (!data?.length || data[0].abrasive_kg_per_min == null) {
      return { kgPerMin: 0, dataFound: false };
    }
    return { kgPerMin: Number(data[0].abrasive_kg_per_min), dataFound: true };
  }

  // ── Waterjet abrasive rate for the SPECIFIC selected machine, not a generic
  // pump tier ── machine_library.json (staged into sm_reference_data,
  // category='machine') carries a real abrasive_flow_rate_kg_min for every
  // named waterjet machine — this shop's actual selected machine's own real
  // consumption rate, when it happens to be one of those 281 named units.
  // Same exact-name, non-ambiguous matching discipline as
  // mhr.service.ts's lookupMachineLibraryBenchmark() — never guesses, never
  // fuzzy-matches. Preferred by the caller over the generic pump-tier row
  // above when found (real machine data beats a generic class average);
  // falls back to that pump-tier lookup, and ultimately to
  // WATERJET_ABRASIVE_KG_PER_MIN, exactly as before this method existed —
  // this only ADDS a higher-priority real source, it doesn't remove the
  // existing fallback chain.
  async getWaterjetAbrasiveRateForMachine(machineName: string | null | undefined): Promise<{ kgPerMin: number; dataFound: boolean }> {
    const empty = { kgPerMin: 0, dataFound: false };
    if (!machineName?.trim()) return empty;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'machine');
    if (error || !data) return empty;

    const nameLower = machineName.trim().toLowerCase();
    const matches = data.filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
    if (matches.length !== 1) return empty;

    const rate = matches[0].raw?.abrasive_flow_rate_kg_min;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return empty;
    return { kgPerMin: rate, dataFound: true };
  }

  // ── Roll Bending (3/4-Roll) real per-machine cycle time ────────────────────
  // machine_library.json (staged into sm_reference_data, category='machine')
  // carries real per-machine roll-bending physics for every "3 Roll Bender"/
  // "4 Roll Bender" machine (migration 569 links these to process_route
  // 'Bending/Floating /Forming', machine_class 'roll_forming') — same
  // exact-name, non-ambiguous matching discipline as
  // getWaterjetAbrasiveRateForMachine above.
  //
  // Formula (single-pass only): the developed (flattened) length of the
  // rolled shell divided by the machine's real rolling_speed_mm_s, plus TWO
  // real prebend_time_s passes — one per sheet end. Pre-bending both leading
  // and trailing edges before rolling is standard 3/4-roll bending practice
  // (an un-prebent end stays flat since the roll arrangement can't curve
  // material right at the entry/exit nip); this dataset carries a real
  // prebend_time_s for both 3-roll AND 4-roll machines, so it's applied
  // uniformly rather than assumed 3-roll-only from bending theory.
  //
  // Multi-pass is a genuine, currently-unmodeled gap: the number of passes
  // needed depends on target curvature vs. roll diameter and springback,
  // which isn't derivable from any field this dataset carries. Rather than
  // guess a pass count, a part that only qualifies as multi-pass-capable
  // returns capable:true with secondsPerPart:null and an explicit
  // gapReason — an honest, reportable gap, not a fabricated number.
  async getRollBendingCycleTime(
    machineName: string | null | undefined,
    developedLengthMm: number,
    thicknessMm: number,
    targetDiameterMm: number,
  ): Promise<{
    secondsPerPart: number | null;
    passMode: 'single' | 'multi' | null;
    capable: boolean;
    dataFound: boolean;
    gapReason?: string;
  }> {
    const empty = { secondsPerPart: null, passMode: null, capable: false, dataFound: false };
    if (!machineName?.trim()) return empty;
    if (!(developedLengthMm > 0) || !(thicknessMm > 0) || !(targetDiameterMm > 0)) return empty;

    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('sm_reference_data')
      .select('raw')
      .eq('category', 'machine');
    if (error || !data) return empty;

    const nameLower = machineName.trim().toLowerCase();
    const matches = data.filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
    if (matches.length !== 1) return empty;

    const raw = matches[0].raw ?? {};
    const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
    const rollingSpeedMmS = numOrNull(raw.rolling_speed_mm_s);
    const prebendTimeS = numOrNull(raw.prebend_time_s) ?? 0;
    const maxSinglePassThicknessMm = numOrNull(raw.max_single_pass_thickness_mm);
    const minSinglePassDiameterMm = numOrNull(raw.min_single_pass_diameter_mm);
    const maxMultiPassThicknessMm = numOrNull(raw.max_multi_pass_thickness_mm);
    const minMultiPassDiameterMm = numOrNull(raw.min_multi_pass_diameter_mm);

    if (rollingSpeedMmS == null) return empty;

    const singlePassCapable =
      maxSinglePassThicknessMm != null && minSinglePassDiameterMm != null &&
      thicknessMm <= maxSinglePassThicknessMm && targetDiameterMm >= minSinglePassDiameterMm;
    const multiPassCapable =
      maxMultiPassThicknessMm != null && minMultiPassDiameterMm != null &&
      thicknessMm <= maxMultiPassThicknessMm && targetDiameterMm >= minMultiPassDiameterMm;

    if (singlePassCapable) {
      const rollingTimeS = developedLengthMm / rollingSpeedMmS;
      const secondsPerPart = rollingTimeS + prebendTimeS * 2;
      return { secondsPerPart, passMode: 'single', capable: true, dataFound: true };
    }
    if (multiPassCapable) {
      return {
        secondsPerPart: null,
        passMode: 'multi',
        capable: true,
        dataFound: true,
        gapReason: 'Part requires multiple rolling passes — real pass-count model not yet available (depends on target curvature vs. roll diameter and springback, not derivable from current data).',
      };
    }
    return {
      secondsPerPart: null,
      passMode: null,
      capable: false,
      dataFound: true,
      gapReason: `Exceeds this machine's real capability: thickness ${thicknessMm}mm / diameter ${targetDiameterMm}mm is outside both single-pass and multi-pass limits on file.`,
    };
  }

  // ── Material handling allowance by weight (Turret Press only today) ───────
  // See migration 530 (closeout Plan Phase 2a) -- real USD-by-weight-bracket
  // data, currently seeded for machine_class='turret_punch' only (the other
  // process-specific curves staged alongside it have no live consumer to
  // wire into). Nearest-upper-bound-bracket resolution, same semantics as
  // default-rates.ts's resolveBracket() -- kept here rather than importing
  // that helper since this one needs an async DB round trip first to build
  // the bracket array, unlike every other resolveBracket() caller which
  // works off a compile-time table.
  async getHandlingAllowanceUsd(machineClass: string, partWeightKg: number): Promise<{ allowanceUsd: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_handling_allowance_rates')
      .select('weight_kg_max, allowance_usd')
      .eq('machine_class', machineClass)
      .order('weight_kg_max', { ascending: true });

    if (!data?.length) {
      return { allowanceUsd: 0, dataFound: false };
    }
    const hit = data.find((r) => partWeightKg <= Number(r.weight_kg_max));
    const row = hit ?? data[data.length - 1]!;
    return { allowanceUsd: Number(row.allowance_usd), dataFound: true };
  }

  // ── Waterjet nozzle-wear cost per hour ─────────────────────────────────────
  // See migration 531 (closeout Plan Phase 2b). Defaults to the 'Mid-Life
  // Composite Carbide' grade — the middle of the 3 real seeded options —
  // until a per-shop nozzle-grade setting exists; disclosed via dataFound,
  // never silently substituted for a genuinely missing table.
  async getWaterjetNozzleCostPerHr(nozzleGrade = 'Mid-Life Composite Carbide'): Promise<{ costPerHr: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_waterjet_nozzle_rates')
      .select('cost_usd, life_hours')
      .eq('nozzle_grade', nozzleGrade)
      .limit(1)
      .maybeSingle();

    if (!data || data.life_hours == null || Number(data.life_hours) <= 0) {
      return { costPerHr: 0, dataFound: false };
    }
    return { costPerHr: Number(data.cost_usd) / Number(data.life_hours), dataFound: true };
  }

  // ── Manual deburring cycle-time rate ──────────────────────────────────────
  // See migration 413 — replaces DEBURR_SEC_PER_METRE/DEBURR_SEC_PER_PIERCE,
  // which used to live directly in default-rates.ts. Real per-material/
  // thickness data does not exist in the industry literature (researched —
  // see migration 413's comment), so this resolves a single honest default
  // row rather than a fabricated material-keyed curve.
  async getDeburrRate(materialFamily = '__default__'): Promise<{ secPerMetre: number; secPerPierce: number; dataFound: boolean }> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_deburr_rate')
      .select('sec_per_metre, sec_per_pierce')
      .eq('material_family', materialFamily)
      .limit(1);

    if (!data?.length) {
      return { secPerMetre: 0, secPerPierce: 0, dataFound: false };
    }
    return { secPerMetre: Number(data[0].sec_per_metre), secPerPierce: Number(data[0].sec_per_pierce), dataFound: true };
  }

  // ── Counterbore cycle time (sec/hit) by diameter ──────────────────────────
  // Bulk: one query for the whole (small) table, matched in memory per diameter —
  // a part can have dozens of distinct hole-diameter groups, and firing one query
  // per group here previously pushed cost-summary past the client request timeout.
  async getCounterboreCycleTimes(diametersMm: number[]): Promise<Map<number, { seconds: number; dataFound: boolean }>> {
    const result = new Map<number, { seconds: number; dataFound: boolean }>();
    if (diametersMm.length === 0) return result;

    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_counterbore')
      .select('diameter_mm, cycle_time_sec')
      .order('diameter_mm', { ascending: true });

    if (!data?.length) {
      for (const d of diametersMm) result.set(d, { seconds: 0, dataFound: false });
      return result;
    }
    const rows = data.map((r) => ({ d: Number(r.diameter_mm), sec: Number(r.cycle_time_sec) }));
    for (const d of diametersMm) {
      const best = rows.reduce((b, r) => Math.abs(r.d - d) < Math.abs(b.d - d) ? r : b, rows[0]);
      result.set(d, { seconds: best.sec, dataFound: true });
    }
    return result;
  }

  // ── Countersink cycle time (sec/hit) by entry diameter ────────────────────
  async getCountersinkCycleTimes(diametersMm: number[]): Promise<Map<number, { seconds: number; dataFound: boolean }>> {
    const result = new Map<number, { seconds: number; dataFound: boolean }>();
    if (diametersMm.length === 0) return result;

    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_countersink')
      .select('diameter_mm, cycle_time_sec')
      .order('diameter_mm', { ascending: true });

    if (!data?.length) {
      for (const d of diametersMm) result.set(d, { seconds: 0, dataFound: false });
      return result;
    }
    const rows = data.map((r) => ({ d: Number(r.diameter_mm), sec: Number(r.cycle_time_sec) }));
    for (const d of diametersMm) {
      const best = rows.reduce((b, r) => Math.abs(r.d - d) < Math.abs(b.d - d) ? r : b, rows[0]);
      result.set(d, { seconds: best.sec, dataFound: true });
    }
    return result;
  }

  // ── PEM hardware match: hole diameter + sheet thickness → part spec ──────
  // Recognition-only match (nearest within tolerance) — not a geometric detector.
  // Bulk: one query for the whole (small) table, matched in memory per hole group.
  // A hole diameter with no match is just a plain through-hole, not a false PEM guess.
  async getPemMatches(
    holeDiametersMm: number[],
    sheetThicknessMm: number,
  ): Promise<Map<number, { partSpec: string; insertionCycleSec: number } | null>> {
    const result = new Map<number, { partSpec: string; insertionCycleSec: number } | null>();
    if (holeDiametersMm.length === 0) return result;

    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_pem_hardware')
      .select('hole_diameter_mm, sheet_thickness_mm, pem_part_spec, insertion_cycle_sec');

    if (!data?.length) {
      for (const d of holeDiametersMm) result.set(d, null);
      return result;
    }
    const DIAM_TOL_MM = 0.3;
    const THICK_TOL_MM = 0.3;
    for (const d of holeDiametersMm) {
      const match = data.find((r) =>
        Math.abs(Number(r.hole_diameter_mm) - d) <= DIAM_TOL_MM &&
        Math.abs(Number(r.sheet_thickness_mm) - sheetThicknessMm) <= THICK_TOL_MM,
      );
      result.set(d, match
        ? { partSpec: match.pem_part_spec, insertionCycleSec: Number(match.insertion_cycle_sec) || 0 }
        : null);
    }
    return result;
  }
}
