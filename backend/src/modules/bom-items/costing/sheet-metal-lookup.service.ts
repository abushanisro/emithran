import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

// ── Fallback constants used ONLY when DB rows are absent ──────────────────────
// These mirror the old hardcoded tables and serve as last-resort safety net.
const FALLBACK_LASER_SPEED: Record<number, number> = {
  1:4200, 2:2800, 3:1800, 4:1400, 5:1100, 6:900, 8:630, 10:450, 12:360, 16:250,
};
const FALLBACK_PIERCE_MIN: Record<number, number> = {
  1:0.013, 2:0.025, 3:0.033, 4:0.050, 5:0.067, 6:0.083, 8:0.117, 10:0.150,
};
const FALLBACK_STROKE_EFF = 0.75;
const FALLBACK_HANDLING_MIN = 0.5;
const FALLBACK_PRESS_SETUP_MIN = 30;
const FALLBACK_BRAKE_SETUP_MIN = 10;
const FALLBACK_STROKE_SEC = 15;
const FALLBACK_SAMPLING_RATE = 0.08;

// ── Normalise material names to match the seeded sm_lookup_laser_cut values ───
export function normaliseLaserMaterial(grade: string | null | undefined): string {
  const g = (grade ?? '').toUpperCase();
  if (/ALUMIN|AL\s*\d{4}|AA\s*\d{4}|6061|6063|5052|5754|7075|2024/.test(g)) return 'Aluminium';
  if (/STAINLESS|SS\s*3\d{2}|SS\s*4\d{2}|AISI\s*3\d{2}|17-4|SS304|SS316/.test(g)) return 'Stainless Steel';
  if (/BRASS|CUZ|CW/.test(g)) return 'Brass';
  // Default: CRCA, IS2062, mild, HR, DC01, E250, MS → Carbon Steel
  return 'Carbon Steel';
}

function nearestKey(value: number, keys: number[]): number {
  if (!keys.length) return value;
  return keys.reduce((best, k) => Math.abs(k - value) < Math.abs(best - value) ? k : best, keys[0]);
}

// ── Public interfaces ──────────────────────────────────────────────────────────

export interface LaserCutParams {
  cuttingSpeedMPerMin: number;
  pierceTimeMin: number;
  kerfMm: number;
  dataFound: boolean;
}

@Injectable()
export class SheetMetalLookupService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Table 5: Laser cutting params ─────────────────────────────────────────
  async getLaserParams(
    grade: string | null | undefined,
    thicknessMm: number,
    powerW: number,
  ): Promise<LaserCutParams> {
    const material = normaliseLaserMaterial(grade);
    const db = this.supabase.getAdminClient();

    // First: try exact thickness + nearest available power for this material
    const { data, error } = await db
      .from('sm_lookup_laser_cut')
      .select('cutting_speed_m_per_min, pierce_time_min, kerf_mm, laser_power_w, thickness_mm')
      .eq('material', material)
      .not('cutting_speed_m_per_min', 'is', null)
      .order('thickness_mm', { ascending: true });

    if (error || !data?.length) {
      return this.laserFallback(thicknessMm, powerW);
    }

    // Find nearest thickness available for this material
    const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))].sort((a, b) => a - b);
    const nearestThick = nearestKey(thicknessMm, thicknesses);
    const rowsAtThick = data.filter((r) => Number(r.thickness_mm) === nearestThick);

    if (!rowsAtThick.length) return this.laserFallback(thicknessMm, powerW);

    // Among rows at that thickness, pick nearest power that has non-null speed
    const powers = rowsAtThick.map((r) => Number(r.laser_power_w));
    const nearestPwr = nearestKey(powerW, powers);
    const row = rowsAtThick.find((r) => Number(r.laser_power_w) === nearestPwr);

    if (!row || row.cutting_speed_m_per_min == null) {
      return this.laserFallback(thicknessMm, powerW);
    }

    const pierceTimeMin = row.pierce_time_min != null ? Number(row.pierce_time_min) : null;
    const kerfMm = row.kerf_mm != null ? Number(row.kerf_mm) : null;
    // If any expected column is null, treat the row as incomplete — dataFound:false
    // ensures the caller emits a warning rather than silently using fallback values.
    if (pierceTimeMin == null || kerfMm == null) {
      return this.laserFallback(thicknessMm, powerW);
    }
    return {
      cuttingSpeedMPerMin: Number(row.cutting_speed_m_per_min),
      pierceTimeMin,
      kerfMm,
      dataFound: true,
    };
  }

  private laserFallback(thicknessMm: number, _powerW: number): LaserCutParams {
    const keys = Object.keys(FALLBACK_LASER_SPEED).map(Number).sort((a, b) => a - b);
    const k = nearestKey(thicknessMm, keys);
    return {
      cuttingSpeedMPerMin: (FALLBACK_LASER_SPEED[k] ?? 3000) / 1000, // convert mm→m
      pierceTimeMin: FALLBACK_PIERCE_MIN[k] ?? 0.025,
      kerfMm: 0.8,
      dataFound: false,
    };
  }

  // ── Table 1: Stroke rate efficiency ────────────────────────────────────────
  async getStrokeEfficiency(
    tonnage: number,
    complexity: 'simple' | 'inter' | 'complex',
  ): Promise<number> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_stroke_rate')
      .select('tonnage, eff_simple, eff_inter, eff_complex')
      .order('tonnage', { ascending: true });

    if (!data?.length) return FALLBACK_STROKE_EFF;

    const rows = data.map((r) => ({
      tonnage: Number(r.tonnage),
      eff_simple: Number(r.eff_simple),
      eff_inter: Number(r.eff_inter),
      eff_complex: Number(r.eff_complex),
    }));
    const nearest = rows.reduce(
      (best, r) => Math.abs(r.tonnage - tonnage) < Math.abs(best.tonnage - tonnage) ? r : best,
      rows[0],
    );

    if (complexity === 'simple') return nearest.eff_simple;
    if (complexity === 'complex') return nearest.eff_complex;
    return nearest.eff_inter;
  }

  // ── Table 2: Handling time (min) for given weight kg ───────────────────────
  async getHandlingTime(weightKg: number): Promise<number> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_handling_time')
      .select('weight_max_kg, handling_min')
      .gte('weight_max_kg', weightKg)
      .order('weight_max_kg', { ascending: true })
      .limit(1);

    if (!data?.length) {
      // Weight exceeds table max — use the last row
      const { data: last } = await db
        .from('sm_lookup_handling_time')
        .select('handling_min')
        .order('weight_max_kg', { ascending: false })
        .limit(1);
      return last?.[0] ? Number(last[0].handling_min) : FALLBACK_HANDLING_MIN;
    }
    return Number(data[0].handling_min);
  }

  // ── Table 3A/B: Tool setup time (min) ─────────────────────────────────────
  // type='press' → keyValue = tonnage; type='brake' → keyValue = tool length mm
  async getToolSetupTime(type: 'press' | 'brake', keyValue: number): Promise<number> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_tool_setup')
      .select('key_value, loading_time_min')
      .eq('setup_type', type)
      .order('key_value', { ascending: true });

    if (!data?.length) {
      return type === 'press' ? FALLBACK_PRESS_SETUP_MIN : FALLBACK_BRAKE_SETUP_MIN;
    }

    const rows = data.map((r) => ({ kv: Number(r.key_value), t: Number(r.loading_time_min) }));
    const best = rows.reduce(
      (b, r) => Math.abs(r.kv - keyValue) < Math.abs(b.kv - keyValue) ? r : b,
      rows[0],
    );
    return best.t;
  }

  // ── Table 4: Manual stroke time (sec) ─────────────────────────────────────
  async getManualStrokeTime(
    thicknessMm: number,
    tonnage: number,
    complexity: 'simple' | 'complex',
  ): Promise<number> {
    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_manual_stroke')
      .select('thickness_mm, tonnage, complexity, stroke_time_sec')
      .eq('complexity', complexity)
      .order('thickness_mm', { ascending: true });

    if (!data?.length) return FALLBACK_STROKE_SEC;

    // Find nearest thickness
    const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))].sort((a, b) => a - b);
    const nearestThick = nearestKey(thicknessMm, thicknesses);

    const atThick = data.filter((r) => Number(r.thickness_mm) === nearestThick);
    if (!atThick.length) return FALLBACK_STROKE_SEC;

    // Find nearest tonnage at that thickness
    const tons = atThick.map((r) => Number(r.tonnage));
    const nearestTon = nearestKey(tonnage, tons);
    const row = atThick.find((r) => Number(r.tonnage) === nearestTon);
    return row ? Number(row.stroke_time_sec) : FALLBACK_STROKE_SEC;
  }

  // ── Table 6: Sampling rate (fraction) for given lot size ──────────────────
  // Returns sample_qty_l2 / lotSize as a fraction.
  async getSamplingRate(lotSize: number): Promise<number> {
    if (lotSize <= 0) return FALLBACK_SAMPLING_RATE;

    const db = this.supabase.getAdminClient();
    const { data } = await db
      .from('sm_lookup_sampling_plan')
      .select('batch_size_from, batch_size_to, sample_qty_l2')
      .lte('batch_size_from', lotSize)
      .gte('batch_size_to', lotSize)
      .limit(1);

    if (!data?.length || data[0].sample_qty_l2 == null) return FALLBACK_SAMPLING_RATE;
    return Math.min(1, Number(data[0].sample_qty_l2) / lotSize);
  }
}
