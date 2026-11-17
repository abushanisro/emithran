// The real memory/Forging data as the staged rows and HR Rates machines the engine reads, for the forging tests. Never a copy of reference
// values in a test: everything is read from the folder, and the baseline variables from the migration that stages them.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SandMaterial } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { FORGING_CLASS } from '../../../../../modules/bom-items/costing/forging/forging-route';

// eslint-disable-next-line @typescript-eslint/no-var-requires
// The seed's own key rule (Load+Unload Time (s) -> load_plus_unload_time_s), the one migrations 824 and 1049 stored the machines with.
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Forging');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

/** The variables migration 1052 stages (strain rate, pressure-multiplying factors), read from the migration itself. */
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const stagedBy = (file: string) => [...readFileSync(join(MIGRATIONS, file), 'utf8').matchAll(/\('variable', 'USA', '2026-Forging', '(\w+)', '([\d.]+)'/g)]
  .map((m) => ({ key: m[1]!, value: m[2]!, unit_type: null }));
/** The variables migrations 1052 and 1055 stage (strain rates, pressure-multiplying factors), read from the migrations themselves. */
export const forgingBaselineVariables = [...stagedBy('1052_forging_press_force_variables.sql'), ...stagedBy('1055_forging_hammer_and_open_die_data.sql')];

/** The open die presses' rated force migrations 1055 and 1056 set, by machine name. */
const openDieForce = new Map(['1055_forging_hammer_and_open_die_data.sql', '1056_forging_open_die_press_ratings.sql']
  .flatMap((f) => [...readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/\(\$str\$(.+?)\$str\$, ([\d.]+)\)/g)].map((m) => [m[1]!, Number(m[2])] as const)));

const stagedVariables = [
  ...rows('forging_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null })),
  ...forgingBaselineVariables,
];
// Staged under their file names (forging_bandSawCutting, ...), as migration 823 keys them.
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv') && !f.includes('(')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } }));
export const realForgingReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machine/${file}`).map((r, i) => {
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^\uFEFF/, '')), v]));
    return sandMachineFromRow({
      id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
      mhr_usd_per_hour: Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']),
      usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'], setup_time_hr: row['setup_time_hr'],
      machine_power_kw: row['machine_power_kw'],
      specs: { ...Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k))), ...(openDieForce.has(row['name']) ? { press_force_kn: openDieForce.get(row['name']) } : {}) },
    }, () => null);
  });
}
export const allForgingMachines = (): Record<string, SandMachine[]> => ({
  [FORGING_CLASS.bandSaw]: machines('forging_machines_bandSaw.csv', FORGING_CLASS.bandSaw),
  [FORGING_CLASS.induction]: machines('forging_machines_conveyorInductionHeat.csv', FORGING_CLASS.induction),
  [FORGING_CLASS.press]: machines('forging_machines_press.csv', FORGING_CLASS.press),
  [FORGING_CLASS.trim]: machines('forging_machines_trim.csv', FORGING_CLASS.trim),
  [FORGING_CLASS.furnace]: machines('forging_machines_ovenFurnace.csv', FORGING_CLASS.furnace),
  [FORGING_CLASS.hammer]: machines('forging_machines_hammer.csv', FORGING_CLASS.hammer),
  [FORGING_CLASS.mechanicalPress]: machines('forging_machines_mechanicalPress.csv', FORGING_CLASS.mechanicalPress),
  [FORGING_CLASS.openDie]: machines('forging_machines_openDiePress.csv', FORGING_CLASS.openDie),
  [FORGING_CLASS.ringRolling]: machines('forging_machines_ringRolling.csv', FORGING_CLASS.ringRolling),
});

/** A forging material of forging_materials.csv with the columns and properties the calculators read. */
export function forgingMaterial(name: string): SandMaterial {
  const r = rows('forging_materials.csv').find((m) => m['Name'] === name)!;
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']),
    columns: {
      density_kg_m3: n('Density (kg / m^3)'), cut_code: n('Cut Code'), round_bar_unit_cost: n('Round Bar Unit Cost (USD / kg)'),
      shear_strength: n('Shear Strength (MPa)'), strength_coefficient: n('Strength Coefficient (MPa)'), strain_rate_sensitivity: n('Strain Rate Sensitivity'),
      specific_heat_capacity: n('Specific Heat Capacity (J / kg * K)'), forging_temperature: n('Forging Temperature (C)'),
    },
  };
}
