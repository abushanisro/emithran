// Multi-Spindle Machining test data, read from memory/ as the database holds it:
// - the bar stock reference of memory/Multi-Spindle Maching (variables.csv, lookup/), staged as 2026-Multi-Spindle (migrations 786, 787);
// - the 15 Simultaneous Turning machines of memory/machining/machine/simultaneous_turning_usa.csv as HR Rates holds them (rates and
//   crew: migration 738; index times: 788; limits and slide layout: 1093);
// - the op-splitting rules of memory/machining/lookup (tblMultiSpindleOpSplitting and its thresholds, migration 785).
import { join } from 'path';

import { resolveSandReference, type SandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

import type { SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SplitRules } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const MEMORY = join(__dirname, '../../../../../../../memory');
const STOCK = join(MEMORY, 'Multi-Spindle Maching');
const MACHINING = join(MEMORY, 'machining');

/** The staged Multi-Spindle reference: every variable, and the two lookup tables as the bare arrays migration 787 staged. */
export function stockReferenceFromMemory(): SandReference {
  // Staged as text (machining_reference_data.value), whatever the CSV reader made of the cell.
  const variables = readCsv(join(STOCK, 'variables.csv')).rows.map((r) => ({
    key: String(r.variableName), value: r.stringValue == null ? null : String(r.stringValue), unit_type: r.unitTypeName ? String(r.unitTypeName) : null,
  }));
  const lookups = ['tblPreferredSizes', 'tblPartingRingWidth'].map((key) => ({ key, raw: readCsv(join(STOCK, 'lookup', `${key}.csv`)).rows }));
  return resolveSandReference({ variables, lookups });
}

const num = (v: string | undefined) => Number(String(v ?? '').trim());
const spindles = (v: string | undefined) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

/** The 15 multi-spindle machines, as HR Rates rows read through SandMachineService with the multi-spindle columns. */
export function multiSpindleMachinesFromMemory(): SandMachine[] {
  return readCsv(join(MACHINING, 'machine/simultaneous_turning_usa.csv')).rows.map((r) => {
    const name = String(r.name).trim();
    return {
      id: name, name, machineClass: 'simultaneous_turning',
      machineRatePerHr: num(r['accounting.direct_overhead_rate_usd_per_hr']) + num(r['accounting.indirect_overhead_rate_usd_per_hr']),
      rateSource: 'stored', assumedDefaults: [],
      labourRatePerHr: num(r['accounting.labor_rate_usd_per_hr']), operators: num(r['accounting.number_of_operators']),
      setupTimeHr: num(r['time.setup_time_hr']), preferred: false, powerKw: num(r['limits.spindle_power_kW']), location: 'USA',
      specs: {
        number_spindles: num(r['slide_configuration.number_spindles']),
        max_diameter_mm: num(r['limits.max_diameter_mm']), max_length_mm: num(r['limits.max_length_mm']),
        drum_index_time_s: num(r['time.drum_index_time_s']), transfer_time_s: num(r['time.transfer_time_s']),
        stock_feed_time_s: num(r['time.stock_feed_time_s']), speed_synchronization_time_s: num(r['time.speed_synchronization_time_s']),
        od_slide_spindles: spindles(r['slide_configuration.spindles_with_od_slide']),
        end_slide_spindles: spindles(r['slide_configuration.spindles_with_end_slide']),
        live_tooling_spindles: spindles(r['slide_configuration.spindles_with_live_tooling']),
        back_work_spindles: spindles(r['slide_configuration.back_work_spindles']),
        part_eject_time_s: num(r['time.part_eject_time_s']), tool_positioning_time_s: num(r['time.tool_positioning_time_s']),
      },
    };
  });
}

/** tblMultiSpindleOpSplitting with its thresholds, as MultiSpindleCostService reads them through MachiningLookupService. */
export function splitRulesFromMemory(): SplitRules {
  const thresholds = readCsv(join(MACHINING, 'lookup/tblMultiSpindleOpSplittingThresholds.csv')).rows;
  const splits = readCsv(join(MACHINING, 'lookup/tblMultiSpindleOpSplitting.csv')).rows;
  return (feature, operation, spindleCount) => {
    const t = thresholds.find((r) => r.Feature === feature && r.Operation === operation && String(r.EnableOperationSplitting).toLowerCase() === 'true');
    const s = splits.find((r) => r.Feature === feature && r.Operation === operation && num(r.MachineSpindles) === spindleCount);
    return t && s ? { passes: num(s.NumberOfOperations), threshold: num(t.Threshold) } : null;
  };
}
