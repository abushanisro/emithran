import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

const MIN_SAMPLES = 5;       // minimum matched pairs before calibrating a cell
const RIDGE_ALPHA = 1.0;     // L2 regularisation strength (pulls multiplier toward 1.0)
const MAX_MULTIPLIER = 2.0;  // hard cap — never more than double a rate in one pass
const MIN_MULTIPLIER = 0.5;  // hard floor — never halve a rate in one pass

interface CalibrationCell {
  process_family: string;
  location: string;
  logRatios: number[];
}

export interface CalibrationResult {
  process_family: string;
  location: string;
  sample_count: number;
  correction_multiplier: number;
  mape_before: number;
  mape_after: number;
  bias_before: number;
  bias_after: number;
  pct_within_10pct_before: number;
  pct_within_10pct_after: number;
  mhr_rows_updated: number;
  skipped_reason?: string;
}

@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  // Admin client — bypasses RLS for rate updates
  private get admin() {
    return this.supabaseService.getClient();
  }

  /**
   * Run one calibration pass over all (process_family, location) cells that
   * have ≥ MIN_SAMPLES matched prediction/actual pairs.
   *
   * Ridge regression with a single intercept parameter:
   *   β = Σ ln(actual/predicted) / (n + α)
   *   correction_multiplier = exp(β)
   *
   * A multiplier > 1 means predictions were systematically under-costing
   * (rates are raised). A multiplier < 1 means over-costing (rates lowered).
   * The result is clamped to [MIN_MULTIPLIER, MAX_MULTIPLIER] to prevent
   * runaway calibration on small or noisy sample sets.
   */
  async runCalibration(): Promise<CalibrationResult[]> {
    // 1. Fetch all matched prediction / actual pairs
    const { data: pairs, error: pairsErr } = await this.admin
      .from('should_cost_actuals')
      .select(`
        id,
        actual_total_cost_usd,
        prediction_id,
        should_cost_predictions (
          id,
          process_family,
          location,
          predicted_total_cost_usd
        )
      `)
      .not('prediction_id', 'is', null)
      .not('actual_total_cost_usd', 'is', null);

    if (pairsErr) {
      this.logger.error(`Failed to fetch calibration pairs: ${pairsErr.message}`);
      throw new Error(`Calibration data fetch failed: ${pairsErr.message}`);
    }

    // 2. Group into cells by (process_family, location)
    const cells = new Map<string, CalibrationCell>();

    for (const row of pairs ?? []) {
      const pred = (row as any).should_cost_predictions;
      if (!pred?.process_family || !pred?.location) continue;
      if (!pred.predicted_total_cost_usd || pred.predicted_total_cost_usd <= 0) continue;
      if (!row.actual_total_cost_usd || row.actual_total_cost_usd <= 0) continue;

      const key = `${pred.process_family}::${pred.location}`;
      if (!cells.has(key)) {
        cells.set(key, { process_family: pred.process_family, location: pred.location, logRatios: [] });
      }
      cells.get(key)!.logRatios.push(
        Math.log(Number(row.actual_total_cost_usd) / Number(pred.predicted_total_cost_usd)),
      );
    }

    // 3. Calibrate each cell
    const results: CalibrationResult[] = [];

    for (const cell of cells.values()) {
      const n = cell.logRatios.length;

      if (n < MIN_SAMPLES) {
        results.push({
          ...zeroMetrics(cell),
          skipped_reason: `only ${n} samples (need ${MIN_SAMPLES})`,
        });
        continue;
      }

      // Ridge regression: closed-form for intercept-only model
      const sumLog = cell.logRatios.reduce((s, r) => s + r, 0);
      const beta = sumLog / (n + RIDGE_ALPHA);
      const rawMultiplier = Math.exp(beta);
      const multiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, rawMultiplier));

      // Accuracy metrics before calibration
      const ratiosBefore = cell.logRatios.map(Math.exp);        // actual/predicted ratios
      const mapeBefore = mape(ratiosBefore);
      const biasBefore = meanBias(ratiosBefore);
      const pct10Before = pctWithin10(ratiosBefore);

      // Accuracy metrics after (simulate applying multiplier)
      const ratiosAfter = ratiosBefore.map((r) => r / multiplier);
      const mapeAfter = mape(ratiosAfter);
      const biasAfter = meanBias(ratiosAfter);
      const pct10After = pctWithin10(ratiosAfter);

      // 4. Apply multiplier to matching BENCHMARK MHR rows
      const mhrRowsUpdated = await this.applyMultiplierToMhr(
        cell.process_family,
        cell.location,
        multiplier,
      );

      // 5. Log to rate_calibration_history
      await this.admin.from('rate_calibration_history').insert({
        process_family: cell.process_family,
        location: cell.location,
        correction_multiplier: multiplier,
        sample_count: n,
        mape_before: Number(mapeBefore.toFixed(2)),
        mape_after: Number(mapeAfter.toFixed(2)),
        bias_before: Number(biasBefore.toFixed(2)),
        bias_after: Number(biasAfter.toFixed(2)),
        pct_within_10pct_before: Number(pct10Before.toFixed(2)),
        pct_within_10pct_after: Number(pct10After.toFixed(2)),
        method: 'ridge_regression',
        notes: rawMultiplier !== multiplier
          ? `raw multiplier ${rawMultiplier.toFixed(4)} clamped to ${multiplier.toFixed(4)}`
          : null,
      });

      results.push({
        process_family: cell.process_family,
        location: cell.location,
        sample_count: n,
        correction_multiplier: multiplier,
        mape_before: Number(mapeBefore.toFixed(2)),
        mape_after: Number(mapeAfter.toFixed(2)),
        bias_before: Number(biasBefore.toFixed(2)),
        bias_after: Number(biasAfter.toFixed(2)),
        pct_within_10pct_before: Number(pct10Before.toFixed(2)),
        pct_within_10pct_after: Number(pct10After.toFixed(2)),
        mhr_rows_updated: mhrRowsUpdated,
      });

      this.logger.log(
        `Calibrated ${cell.process_family}/${cell.location}: ` +
        `×${multiplier.toFixed(3)}, ${n} samples, ` +
        `MAPE ${mapeBefore.toFixed(1)}% → ${mapeAfter.toFixed(1)}%, ` +
        `${mhrRowsUpdated} MHR rows updated`,
      );
    }

    return results;
  }

  /** Apply a rate multiplier to all BENCHMARK MHR rows for a cell. */
  private async applyMultiplierToMhr(
    processFamily: string,
    location: string,
    multiplier: number,
  ): Promise<number> {
    // Fetch matching rows first (Supabase JS client can't do UPDATE ... SET x = x * n directly)
    const { data: rows, error: fetchErr } = await this.admin
      .from('mhr_records')
      .select('id, total_machine_hour_rate, mhr_usd_per_hour')
      .eq('process_family', processFamily)
      .eq('source_type', 'BENCHMARK')
      .ilike('location', location)
      .not('total_machine_hour_rate', 'is', null);

    if (fetchErr || !rows?.length) return 0;

    const updates = rows.map((r: any) => ({
      id: r.id,
      total_machine_hour_rate: Number((Number(r.total_machine_hour_rate) * multiplier).toFixed(2)),
      mhr_usd_per_hour: r.mhr_usd_per_hour != null
        ? Number((Number(r.mhr_usd_per_hour) * multiplier).toFixed(2))
        : null,
    }));

    const { error: upsertErr } = await this.admin
      .from('mhr_records')
      .upsert(updates, { onConflict: 'id' });

    if (upsertErr) {
      this.logger.error(`MHR rate update failed: ${upsertErr.message}`);
      return 0;
    }

    return rows.length;
  }

  /** Return the last N calibration runs, most recent first. */
  async getHistory(limit = 50): Promise<any[]> {
    const { data, error } = await this.admin
      .from('rate_calibration_history')
      .select('*')
      .order('calibrated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`History fetch failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * Record a supplier actual against a prediction so future calibration runs
   * can use it. Wraps the should_cost_actuals insert.
   */
  async recordActual(dto: {
    predictionId?: string;
    bomItemId?: string;
    projectId?: string;
    actualType: 'rfq_response' | 'po_invoice' | 'emuski_shopfloor' | 'internal_quote';
    actualTotalCostUsd: number;
    actualMaterialCostUsd?: number;
    actualProcessCostUsd?: number;
    actualCycleTimeMin?: number;
    supplierName?: string;
    supplierLocation?: string;
    rfqDate?: string;
    enteredByUserId?: string;
    notes?: string;
  }): Promise<any> {
    const { data, error } = await this.admin
      .from('should_cost_actuals')
      .insert({
        prediction_id:          dto.predictionId ?? null,
        bom_item_id:            dto.bomItemId ?? null,
        project_id:             dto.projectId ?? null,
        actual_type:            dto.actualType,
        actual_total_cost_usd:  dto.actualTotalCostUsd,
        actual_material_cost_usd: dto.actualMaterialCostUsd ?? null,
        actual_process_cost_usd:  dto.actualProcessCostUsd ?? null,
        actual_cycle_time_min:    dto.actualCycleTimeMin ?? null,
        supplier_name:          dto.supplierName ?? null,
        supplier_location:      dto.supplierLocation ?? null,
        rfq_date:               dto.rfqDate ?? null,
        entered_by_user_id:     dto.enteredByUserId ?? null,
        notes:                  dto.notes ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Record actual failed: ${error.message}`);
    return data;
  }
}

// ── Pure maths helpers ────────────────────────────────────────────────────────

/** Mean Absolute Percentage Error — ratios are actual/predicted. */
function mape(ratios: number[]): number {
  if (!ratios.length) return 0;
  return (ratios.reduce((s, r) => s + Math.abs(r - 1) * 100, 0) / ratios.length);
}

/** Signed mean bias — positive = engine systematically under-predicts. */
function meanBias(ratios: number[]): number {
  if (!ratios.length) return 0;
  return (ratios.reduce((s, r) => s + (r - 1) * 100, 0) / ratios.length);
}

/** % of predictions within ±10% of actual. */
function pctWithin10(ratios: number[]): number {
  if (!ratios.length) return 0;
  const within = ratios.filter((r) => Math.abs(r - 1) <= 0.1).length;
  return (within / ratios.length) * 100;
}

function zeroMetrics(cell: CalibrationCell): CalibrationResult {
  return {
    process_family: cell.process_family,
    location: cell.location,
    sample_count: cell.logRatios.length,
    correction_multiplier: 1,
    mape_before: 0,
    mape_after: 0,
    bias_before: 0,
    bias_after: 0,
    pct_within_10pct_before: 0,
    pct_within_10pct_after: 0,
    mhr_rows_updated: 0,
  };
}
