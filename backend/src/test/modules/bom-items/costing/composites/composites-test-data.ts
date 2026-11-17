// The real memory/Composites data as the staged rows, HR Rates machines and materials the engine reads, for the composites tests. Nothing is
// copied into a test: everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { COMPOSITES_CLASS, type CompositeMaterial } from '../../../../../modules/bom-items/costing/composites/composites-route';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Composites');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const stagedVariables = rows('composite_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } }));
export const realCompositesReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

/**
 * The hourly rate the HR Rates engine gives a machine with no overhead rates in its file (the hand layup clean rooms): in the app it prices
 * them from their price and footprint (MHRService.engineHourRate); here a fixed figure stands in, so a test reads times and structure, not it.
 */
export const ENGINE_RATE_USD_PER_HR = 100;
const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machine/${file}`).map((r, i) => {
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^﻿/, '')), v]));
    const overhead = Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']);
    const specs = Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k)).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : v]));
    return sandMachineFromRow({
      id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
      mhr_usd_per_hour: Number.isFinite(overhead) ? overhead : null,
      usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'] ?? null, setup_time_hr: row['setup_time_hr'],
      machine_power_kw: row['machine_power_kw'], specs,
    }, () => ({ ratePerHr: ENGINE_RATE_USD_PER_HR, assumedDefaults: [] }));
  });
}
export const allCompositesMachines = (): Record<string, SandMachine[]> => ({
  [COMPOSITES_CLASS.toolClean]: machines('machines_tool_clean.csv', COMPOSITES_CLASS.toolClean),
  [COMPOSITES_CLASS.moldPrep]: machines('machines_mold_preparation.csv', COMPOSITES_CLASS.moldPrep),
  [COMPOSITES_CLASS.cut]: machines('machines_ultrasonic_cut.csv', COMPOSITES_CLASS.cut),
  [COMPOSITES_CLASS.handLayup]: machines('machines_hand_layup.csv', COMPOSITES_CLASS.handLayup),
  [COMPOSITES_CLASS.tapeLayup]: machines('machines_automated_tape_layup.csv', COMPOSITES_CLASS.tapeLayup),
  [COMPOSITES_CLASS.fiberPlacement]: machines('machines_automated_fiber_placement.csv', COMPOSITES_CLASS.fiberPlacement),
  [COMPOSITES_CLASS.autoclave]: machines('machines_autoclave_cure.csv', COMPOSITES_CLASS.autoclave),
  [COMPOSITES_CLASS.bench]: machines('machines_bench_operation.csv', COMPOSITES_CLASS.bench),
});

/** A material of memory/Composites/materials.csv with the price and properties the calculators read (migration 855's property keys). */
export function compositeMaterial(name: string): CompositeMaterial {
  const r = rows('materials.csv').find((m) => m['Name'] === name);
  if (!r) throw new Error(`no composites material ${name}`);
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  const form = String(r['Material Form']);
  const yes = (v: unknown) => String(v).trim().toLowerCase() === 'true';
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']),
    form: form === 'Ply' || form === 'Core' ? form : null,
    can: { hlu: yes(r['Can HLU']), atl: yes(r['Can ATL']), afp: yes(r['Can AFP']) },
    columns: {
      // "Unit Cost (USD / kg)" holds the price per square metre: the Cost Units of every composites material is "Cost per Sq Meter".
      cost_per_m2: n('Unit Cost (USD / kg)'), cured_thickness: n('Cured Thickness (mm)'), areal_weight: n('Areal Weight (g / m^2)'),
      material_utilization: n('Material Utilization (%)'), material_width: n('Material Width (mm)'),
      cure_hold_temperature: n('Cure Hold Temperature (°C)'), cure_dwell_time: n('Cure Dwell Time (min)'),
      cure_temperature_ramp_up_rate: n('Cure Temperature Ramp Up Rate (°C / min)'), cure_temperature_ramp_down_rate: n('Cure Temperature Ramp Down Rate (°C / min)'),
      deformation_average_angle: n('Deformation Average Angle (deg)'), deformation_warning_angle: n('Deformation Warning Angle (deg)'), deformation_limit_angle: n('Deformation Limit Angle (deg)'),
    },
  };
}
