import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { InspectionRuleRow } from '../../bom-items/costing/gdt-severity';
import type { InspectionStagePolicy } from '../../bom-items/costing/default-rates';

/**
 * Inspection knowledge — DB-backed rules and quality plans (Layer-1 data layer).
 *
 *   inspection_rules  — GD&T symbol + tolerance band → method/severity/time
 *                       (migration 334; code matrix in gdt-severity.ts is the fallback)
 *   quality_plans     — named sampling policies: FAI / in-process / final stages
 *                       (migration 335; INSPECTION_SAMPLING_DEFAULT is the fallback)
 *
 * Reads are cached in-process for 5 minutes. Only is_system rows are cached
 * globally — if per-org rules are added later, the cache key must include the
 * caller's org, not just the table name.
 *
 * Failure policy: every read degrades to [] / null and lets the caller fall
 * back to the code defaults. A KB outage must never fail a costing request.
 */
@Injectable()
export class InspectionKnowledgeService {
  private readonly logger = new Logger(InspectionKnowledgeService.name);
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private static readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly supabase: SupabaseService) {}

  private cached<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < InspectionKnowledgeService.TTL_MS) return hit.data as T;
    return undefined;
  }

  private store(key: string, data: unknown): void {
    this.cache.set(key, { at: Date.now(), data });
  }

  async getInspectionRules(token: string): Promise<InspectionRuleRow[]> {
    const hit = this.cached<InspectionRuleRow[]>('inspection_rules');
    if (hit) return hit;
    try {
      const { data, error } = await this.supabase
        .getClient(token)
        .from('inspection_rules')
        .select(
          'gdt_symbol, tol_max_mm, severity, inspection_method, inspection_time_min, ' +
          'cost_impact_percent, cost_impact_range, reason_codes, manufacturing_actions',
        )
        .eq('is_system', true);
      if (error) {
        this.logger.warn(`inspection_rules read failed — using code fallback: ${error.message}`);
        return [];
      }
      // Supabase's typed client can't infer the row shape from a joined select string
      const rows = (data ?? []) as unknown as InspectionRuleRow[];
      this.store('inspection_rules', rows);
      return rows;
    } catch (e) {
      this.logger.warn(`inspection_rules read threw — using code fallback: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  async getQualityPlan(token: string, planKey: string): Promise<InspectionStagePolicy | null> {
    const key = `quality_plan:${planKey}`;
    const hit = this.cached<InspectionStagePolicy | null>(key);
    if (hit !== undefined) return hit;
    try {
      const { data, error } = await this.supabase
        .getClient(token)
        .from('quality_plans')
        .select('fai, in_process_per_n, final_per_n, final_check_min')
        .eq('plan_key', planKey)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        if (error) this.logger.warn(`quality_plans read failed for "${planKey}": ${error.message}`);
        else this.logger.warn(`quality plan "${planKey}" not found — using default sampling policy`);
        this.store(key, null);
        return null;
      }
      const policy: InspectionStagePolicy = {
        fai: Boolean(data.fai),
        inProcessPerN: Math.max(Number(data.in_process_per_n) || 1, 1),
        finalPerN: Math.max(Number(data.final_per_n) || 1, 1),
        finalCheckMin: Math.max(Number(data.final_check_min) || 0, 0),
      };
      this.store(key, policy);
      return policy;
    } catch (e) {
      this.logger.warn(`quality_plans read threw for "${planKey}": ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
