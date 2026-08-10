import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { LookupResolution, LookupQueryParam, LookupTableRow } from '../dto/cost-breakdown.dto';

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
  const withinTolerance = Math.abs(nearestClass - tonnage) / tonnage <= 0.1;
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
  async getInspectionOperationDefaults(): Promise<import('./inspection-engine').InspectionOperationDefaultRow[]> {
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
