import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../common/supabase/supabase.service';
import { readAllRows, type RowPage } from '../../../../common/supabase/read-all-rows';
import { cachedRead } from '../shared/core/request-cache';
import type { BlankPress, HydroformPress, HydroformingReference, StepTable } from './hydroforming-engine';

/** memory/Sheetmetal Hydroforming, as staged by migration 823. */
const SOURCE_VERSION = '2026-Hydroform';

const VARIABLES = [
  'fluidCellFormingRatioThreshold', 'cycleTimeAdjustmentFactor', 'defaultInspectionTime', 'minimumToolCleanTime',
  'throwPadApplicationRate', 'throwPadRemovalRate', 'requiredThrowPadDefault',
  'highStrengthMatlThreshold', 'highStrengthMatlDeratePercent',
] as const;

/** Source numbers may carry thousands separators ("999,999,999.00"); booleans read 1/0. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'true') return 1;
  if (t === 'false') return 0;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The hydroforming reference data and presses the engine needs, read from the
 * database only. A missing table or variable is simply absent: the engine
 * reports what it could not resolve.
 */
@Injectable()
export class HydroformingReferenceService {
  constructor(private readonly supabaseService: SupabaseService) {}

  getReference(accessToken: string): Promise<{ reference: HydroformingReference; missing: string[] }> {
    return cachedRead('hydroforming-reference', async () => {
      const client = this.supabaseService.getClient(accessToken);
      const [vars, tables] = await Promise.all([
        client.from('machining_reference_data').select('key, value')
          .eq('source_version', SOURCE_VERSION).eq('category', 'variable').in('key', [...VARIABLES]),
        client.from('machining_reference_data').select('key, raw')
          .eq('source_version', SOURCE_VERSION).eq('category', 'lookup_table')
          .in('key', ['tblMaterialHandling', 'tblCleanRate', 'pressMaterialAdvanceRate', 'drawReductionPercentage']),
      ]);
      const variables = new Map<string, number>();
      for (const r of (vars.data ?? []) as Array<{ key: string; value: string }>) {
        const n = num(r.value);
        if (n != null) variables.set(r.key, n);
      }
      const rowsOf = (key: string): Array<Record<string, unknown>> =>
        ((tables.data ?? []) as Array<{ key: string; raw: { rows?: Array<Record<string, unknown>> } }>)
          .find((t) => t.key === key)?.raw?.rows ?? [];
      const step = (key: string, keyCol: string, valueCol: string): StepTable =>
        rowsOf(key).map((r) => ({ key: num(r[keyCol]), value: num(r[valueCol]) }))
          .filter((r): r is { key: number; value: number } => r.key != null && r.value != null);

      const reference: HydroformingReference = {
        variables,
        materialHandling: step('tblMaterialHandling', 'Weight (kg)', 'Load Time (s)'),
        cleanRate: step('tblCleanRate', 'Component Area (mm^2)', 'Manual Clean Rate (mm^2 / s)'),
        pressAdvance: step('pressMaterialAdvanceRate', 'Part Length (mm)', 'Strokes Per Minute'),
        drawReduction: rowsOf('drawReductionPercentage').map((r) => ({
          thicknessMm: num(r['Material Thickness (mm)']) ?? NaN,
          ratiosPct: Object.keys(r).filter((k) => k.startsWith('Draw Punch Ratio')).sort()
            .map((k) => num(r[k])).filter((n): n is number => n != null),
        })).filter((r) => Number.isFinite(r.thicknessMm)),
      };
      const missing = [
        ...VARIABLES.filter((k) => !variables.has(k)),
        ...(['materialHandling', 'cleanRate', 'pressAdvance', 'drawReduction'] as const)
          .filter((k) => reference[k].length === 0),
      ];
      return { reference, missing };
    });
  }

  /** The Hydroform and Offline Blank presses at a location, from HR Rates. */
  async getPresses(accessToken: string, location: string): Promise<{ hydroform: HydroformPress[]; blank: BlankPress[] }> {
    const client = this.supabaseService.getClient(accessToken);
    type Row = {
      id: string; machine_name: string; machine_class: string; operators: number | null; setup_time_hr: number | null;
      total_machine_hour_rate: number | null; usd_labor_rate_per_hr: number | null; specs: Record<string, unknown> | null;
    };
    const { data } = await readAllRows<Row>((from, to) =>
      client.from('mhr_records')
        .select('id, machine_name, machine_class, operators, setup_time_hr, total_machine_hour_rate, usd_labor_rate_per_hr, specs')
        .in('machine_class', ['hydroform', 'hydroform_offline_blank'])
        .eq('location', location)
        .order('id')
        .range(from, to) as unknown as PromiseLike<RowPage<Row>>);
    const spec = (r: Row, k: string) => num(r.specs?.[k]);
    return {
      hydroform: data.filter((r) => r.machine_class === 'hydroform').map((r) => ({
        id: r.id,
        name: r.machine_name,
        formingType: String(r.specs?.machine_forming_type ?? '').toLowerCase(),
        maxDrawDepthMm: spec(r, 'max_draw_depth_mm'),
        formingAreaDiaMm: spec(r, 'forming_area_dia_mm'),
        formingAreaLengthMm: spec(r, 'forming_area_length_mm'),
        formingAreaWidthMm: spec(r, 'forming_area_width_mm'),
        maxToolDiaMm: spec(r, 'max_tool_dia_mm'),
        isPreferred: r.specs?.is_preferred === true,
      })),
      blank: data.filter((r) => r.machine_class === 'hydroform_offline_blank').map((r) => ({
        id: r.id,
        name: r.machine_name,
        pressForceKn: spec(r, 'press_force_kn'),
        machineRatePerHr: num(r.total_machine_hour_rate),
        labourRatePerHr: num(r.usd_labor_rate_per_hr),
        operators: num(r.operators),
        setupTimeHr: num(r.setup_time_hr),
      })),
    };
  }
}
