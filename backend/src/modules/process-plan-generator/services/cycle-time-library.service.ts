import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  LASER_SPEED_MM_PER_MIN,
  LASER_PIERCE_SEC,
  PRESS_BRAKE_SEC_PER_BEND,
} from '../../bom-items/costing/default-rates';

/**
 * Loads process cycle-time parameters from `process_cycle_time_library` once on
 * startup and serves look-ups to the DeterministicPlannerService.
 *
 * Every method falls back to the constants in default-rates.ts when the DB row is
 * absent so the planner stays functional even when the table is empty or the DB is
 * unreachable. This keeps the fallback behaviour explicit and auditable.
 *
 * Unit contracts (important — don't break these):
 *   getLaserSpeed()      → mm/min   (DB stores mm/min, default-rates.ts also mm/min)
 *   getLaserPierceSec()  → seconds  (DB does not store this; always from default-rates)
 *   getBrakeSecPerBend() → seconds per bend
 *   getCncMrr()          → mm³/min  (DB stores cm³/min → ×1000 on load)
 */
@Injectable()
export class CycleTimeLibraryService implements OnModuleInit {
  private readonly logger = new Logger(CycleTimeLibraryService.name);

  // laser: materialTag → sorted [(thicknessMm, speedMmPerMin)]
  private laserSpeeds = new Map<string, Array<[number, number]>>();
  // brake: sorted [(thicknessMm, secPerBend)]
  private brakeTimes: Array<[number, number]> = [];
  // mrr: 'mill:aluminum', 'turn:carbon_steel', etc. → mm³/min
  private mrrValues = new Map<string, number>();

  private loaded = false;

  constructor(private readonly supabase: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.load();
    } catch (e: any) {
      this.logger.warn(
        `CycleTimeLibraryService initial load failed — deterministic planner will use ` +
        `default-rates.ts constants: ${e.message}`,
      );
    }
  }

  private async load(): Promise<void> {
    // RLS on process_cycle_time_library is FOR SELECT USING (true) — safe with admin client.
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('process_cycle_time_library')
      .select(
        'process_group, process_name, driver_label, driver_parameter, driver_value, ' +
        'cycle_time_base, cycle_time_unit',
      )
      .in('process_group', ['Sheet Metal', 'Machining', 'Plastic'])
      .limit(300);

    if (error) throw new Error(error.message);

    let laserRows = 0, brakeRows = 0, mrrRows = 0;
    for (const raw of data ?? []) {
      // Supabase JS client returns loosely-typed rows; cast to any for property access.
      const row = raw as any;
      const base = parseFloat(row.cycle_time_base);
      if (!Number.isFinite(base) || base <= 0) continue;

      switch (row.process_name as string) {
        case 'Laser Cutting':
          if (row.driver_parameter === 'sheet_thickness_mm' && row.driver_value != null) {
            const thick = parseFloat(row.driver_value);
            const tag = this.laserMatTag(row.driver_label as string);
            if (!this.laserSpeeds.has(tag)) this.laserSpeeds.set(tag, []);
            this.laserSpeeds.get(tag)!.push([thick, base]);
            laserRows++;
          }
          break;

        case 'Sheet Metal Bending':
          if (row.driver_parameter === 'bending_operation') {
            // Thickness is embedded in driver_label: 'MS 2.0mm single bend'
            const m = (row.driver_label as string).match(/(\d+\.?\d*)\s*mm/);
            if (m) {
              this.brakeTimes.push([parseFloat(m[1]), base]);
              brakeRows++;
            }
          }
          break;

        case 'CNC Milling':
        case 'CNC Turning': {
          if ((row.driver_parameter as string) === 'material_operation' &&
              (row.cycle_time_unit as string) === 'cm3/min' &&
              /rough/i.test(row.driver_label as string)) {
            // DB value is cm³/min; planner works in mm³/min
            const mm3PerMin = base * 1000;
            const op = (row.process_name as string) === 'CNC Milling' ? 'mill' : 'turn';
            const mat = this.cncMatTag(row.driver_label as string);
            if (mat) {
              const key = `${op}:${mat}`;
              // Keep the highest rough MRR we find (different label variations)
              const existing = this.mrrValues.get(key) ?? 0;
              if (mm3PerMin > existing) {
                this.mrrValues.set(key, mm3PerMin);
                mrrRows++;
              }
            }
          }
          break;
        }
      }
    }

    // Sort all threshold tables ascending so lookupByThreshold works correctly.
    for (const entries of this.laserSpeeds.values()) {
      entries.sort((a, b) => a[0] - b[0]);
    }
    this.brakeTimes.sort((a, b) => a[0] - b[0]);

    this.loaded = true;
    this.logger.log(
      `CycleTimeLibrary loaded: ${laserRows} laser + ${brakeRows} brake + ${mrrRows} MRR rows from DB`,
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Cutting speed in mm/min for a given material family and sheet thickness.
   * Falls back to `default-rates.ts` LASER_SPEED_MM_PER_MIN (mild-steel baseline)
   * multiplied by the material speed factor when DB has no matching row.
   */
  getLaserSpeed(materialFamily: string | null | undefined, thicknessMm: number): number {
    if (this.loaded) {
      const tag = this.toLaserTag(materialFamily);
      const entries = this.laserSpeeds.get(tag);
      if (entries?.length) {
        const hit = lookupByThreshold(entries, thicknessMm);
        if (hit != null) return hit;
      }
      // Try carbon_steel fallback if requested material had no data
      if (tag !== 'carbon_steel') {
        const csEntries = this.laserSpeeds.get('carbon_steel');
        if (csEntries?.length) {
          const hit = lookupByThreshold(csEntries, thicknessMm);
          if (hit != null) {
            // Apply material speed ratio from default-rates.ts
            const factor = speedFactor(tag);
            return Math.round(hit * factor);
          }
        }
      }
    }
    // Final fallback: default-rates.ts constants
    const defaultSpeed = lookupByThreshold(
      Object.entries(LASER_SPEED_MM_PER_MIN).map(([k, v]) => [Number(k), v] as [number, number]),
      thicknessMm,
    ) ?? 3000;
    return defaultSpeed;
  }

  /**
   * Pierce time in seconds for a given sheet thickness.
   * The DB does not store per-pierce times, so this always reads from default-rates.ts.
   */
  getLaserPierceSec(thicknessMm: number): number {
    return lookupByThreshold(
      Object.entries(LASER_PIERCE_SEC).map(([k, v]) => [Number(k), v] as [number, number]),
      thicknessMm,
    ) ?? 0.5;
  }

  /**
   * Press brake cycle time in seconds per bend for a given sheet thickness.
   * Falls back to `default-rates.ts` PRESS_BRAKE_SEC_PER_BEND.
   */
  getBrakeSecPerBend(thicknessMm: number): number {
    if (this.loaded && this.brakeTimes.length) {
      const hit = lookupByThreshold(this.brakeTimes, thicknessMm);
      if (hit != null) return hit;
    }
    // Fallback: default-rates.ts
    return lookupByThreshold(
      Object.entries(PRESS_BRAKE_SEC_PER_BEND).map(([k, v]) => [Number(k), v] as [number, number]),
      thicknessMm,
    ) ?? 15;
  }

  /**
   * Material removal rate in mm³/min for CNC milling or turning.
   * Returns null when neither DB nor default-rates can resolve the combination —
   * caller should then skip physics and let the resolver use its geometry heuristic.
   */
  getCncMrr(operation: 'mill' | 'turn', materialFamily: string | null | undefined): number | null {
    if (this.loaded) {
      const mat = this.toCncTag(materialFamily);
      const hit = this.mrrValues.get(`${operation}:${mat}`);
      if (hit) return hit;
      // Fall back to carbon_steel if specific material absent
      const cs = this.mrrValues.get(`${operation}:carbon_steel`);
      if (cs) return cs;
    }
    // Fallback: hardcoded baseline (same as planner was using before)
    const defaults: Record<string, Record<string, number>> = {
      mill: { aluminum: 50_000, stainless: 5_000, carbon_steel: 12_000, unknown: 8_000 },
      turn: { aluminum: 70_000, stainless: 7_000, carbon_steel: 18_000, unknown: 12_000 },
    };
    const mat = this.toCncTag(materialFamily);
    return defaults[operation]?.[mat] ?? defaults[operation]?.['unknown'] ?? null;
  }

  // ── Internal tag helpers ──────────────────────────────────────────────────

  /** Maps BOM materialHint driver_label to a laser material tag. */
  private laserMatTag(label: string): 'carbon_steel' | 'stainless' | 'aluminum' {
    const l = label.toLowerCase();
    if (l.startsWith('ss') || l.includes('stainless')) return 'stainless';
    if (l.startsWith('al') || l.includes('alumin')) return 'aluminum';
    return 'carbon_steel';
  }

  /** Maps DB driver_label to a CNC material tag. */
  private cncMatTag(label: string): string | null {
    const l = label.toLowerCase();
    if (/alumin|^al\b/.test(l)) return 'aluminum';
    if (/stainless|ss304|ss316/.test(l)) return 'stainless';
    if (/4140|alloy steel/.test(l)) return 'alloy_steel';
    if (/titan/.test(l)) return 'titanium';
    if (/inconel|superalloy|waspaloy|hastelloy/.test(l)) return 'superalloy';
    if (/mild|ms\b|carbon|s235|en1a/.test(l)) return 'carbon_steel';
    return null;
  }

  /** Maps a BriefBomItem.materialFamily to a laser DB tag. */
  private toLaserTag(family: string | null | undefined): 'carbon_steel' | 'stainless' | 'aluminum' {
    if (!family) return 'carbon_steel';
    if (family.includes('aluminum')) return 'aluminum';
    if (family.includes('stainless')) return 'stainless';
    return 'carbon_steel';
  }

  /** Maps a BriefBomItem.materialFamily to a CNC DB tag. */
  private toCncTag(family: string | null | undefined): string {
    if (!family) return 'unknown';
    if (family.includes('aluminum')) return 'aluminum';
    if (family.includes('stainless')) return 'stainless';
    if (family.includes('alloy_steel') || family.includes('ferrous_alloy')) return 'alloy_steel';
    if (family.includes('titanium')) return 'titanium';
    if (family.includes('ferrous')) return 'carbon_steel';
    return 'unknown';
  }
}

// Mild-steel speed factors for aluminium / stainless when DB only has MS data.
function speedFactor(laserTag: string): number {
  switch (laserTag) {
    case 'stainless': return 0.75;
    case 'aluminum':  return 0.90;
    default:          return 1.0;
  }
}

/** Returns the table value at the largest key ≤ value. */
function lookupByThreshold(table: Array<[number, number]>, value: number): number | undefined {
  let result: number | undefined;
  for (const [k, v] of table) {
    if (value >= k) result = v;
    else break;
  }
  return result;
}
