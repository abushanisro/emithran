// The real memory/Powder metal data as the staged rows and HR Rates machines the engine reads, for the powder metal tests. Never a copy of
// reference values in a test: everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SandMaterial } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { POWDER_METAL_CLASS } from '../../../../../modules/bom-items/costing/powder-metal/powder-metal-route';

// The seed's own key rule, the one the machines were stored with.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Powder metal');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const stagedVariables = rows('powder_metal_variables.csv')
  .map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } }));
export const realPowderMetalReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machines/${file}`).map((r, i) => {
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^﻿/, '')), v]));
    return sandMachineFromRow({
      id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
      mhr_usd_per_hour: Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']),
      usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'], setup_time_hr: row['setup_time_hr'],
      machine_power_kw: row['machine_power_kw'],
      specs: Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k))),
    }, () => null);
  });
}
export const allPowderMetalMachines = (): Record<string, SandMachine[]> => ({
  [POWDER_METAL_CLASS.press]: machines('machines_compaction_pressing.csv', POWDER_METAL_CLASS.press),
  [POWDER_METAL_CLASS.furnace]: machines('machines_furnace_sintering.csv', POWDER_METAL_CLASS.furnace),
});

/** A powder of raw_materials.csv with the price and the properties the calculators read (as raw_material_properties stores them). */
export function powderMetalMaterial(name: string): SandMaterial {
  const r = rows('Raw material/raw_materials.csv').find((m) => m['Name'] === name)!;
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']),
    columns: {
      unit_cost_usd_per_kg: n('Unit Cost (USD / kg)'), cut_code: n('Cut Code'),
      green_density: n('Green Density (kg / m^3)'), apparent_density: n('Apparent Density (kg / m^3)'),
      min_green_density: n('Min Green Density (kg / m^3)'), max_green_density: n('Max Green Density (kg / m^3)'),
      compaction_curve_coef_a: n('Compaction Curve Coef A'), compaction_curve_coef_b: n('Compaction Curve Coef B'), compaction_curve_coef_c: n('Compaction Curve Coef C'),
    },
  };
}
