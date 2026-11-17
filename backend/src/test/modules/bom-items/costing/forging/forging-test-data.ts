// The real memory/Forging data as the staged rows and HR Rates machines the engine reads, for the forging tests. Never a copy of reference
// values in a test: everything is read from the folder, and the two published tables from the migration that stages them.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SandMaterial } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { FORGING_CLASS } from '../../../../../modules/bom-items/costing/forging/forging-reference';
import { specKey } from '../casting/sand-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
export const FORGING_DIR = join(__dirname, '../../../../../../../memory/Forging');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(FORGING_DIR, rel)).rows;

/** The tables migration 1050 stages (flash mass per parting length, equipment speed), read from the migration itself. */
const PUBLISHED = [...readFileSync(join(__dirname, '../../../../../../migrations/1050_forging_published_tables.sql'), 'utf8')
  .matchAll(/'lookup_table', 'USA', '2026-Forging', '(\w+)', '\d+',\s*'[^']*',\s*'(\{[\s\S]*?\})'::jsonb/g)].map((m) => ({ key: m[1]!, raw: JSON.parse(m[2]!) as { rows: Array<Record<string, any>> } }));

const stagedVariables = rows('forging_variables.csv').map((r) => ({
  key: String(r['Variable Name']),
  value: r['String Value'] == null ? null : String(r['String Value']), // staged as text
  unit_type: r['Unit Type Name'] || null,
}));
/** The Lookup/ files as staged (a file saved twice, "name (1).csv", is staged once). */
const lookupFiles = readdirSync(join(FORGING_DIR, 'Lookup')).filter((f) => f.endsWith('.csv') && !/\(\d+\)\.csv$/.test(f));
const stagedLookups = [...lookupFiles.map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } })), ...PUBLISHED];

export const realForgingReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });
export const forgingPublishedTables = PUBLISHED;
export const forgingLookupHeaders = (): Map<string, string[]> => new Map<string, string[]>([
  ...lookupFiles.map((f) => [f.replace(/\.csv$/, ''), readCsv(join(FORGING_DIR, 'Lookup', f)).columns as string[]] as [string, string[]]),
  ...PUBLISHED.map((t) => [t.key, Object.keys(t.raw.rows[0]!)] as [string, string[]]),
]);

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);

/** The machines of one Machine/ CSV as the engine reads them from HR Rates: the stored machine hour rate is direct + indirect overhead. */
function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machine/${file}`).map((r, i) => {
    // "Load+Unload Time (s)" is seeded as load_plus_unload_time_s (migration 824).
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(h.replace(/\+/g, ' plus ')), v]));
    const specs = Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k)));
    return sandMachineFromRow({
      id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
      mhr_usd_per_hour: Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']),
      usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'], setup_time_hr: row['setup_time_hr'],
      machine_power_kw: row['machine_power_kw'], specs,
    }, () => null);
  });
}

const FILES: Record<string, string> = {
  [FORGING_CLASS.bandSaw]: 'forging_machines_bandSaw.csv', [FORGING_CLASS.induction]: 'forging_machines_conveyorInductionHeat.csv',
  [FORGING_CLASS.furnace]: 'forging_machines_ovenFurnace.csv', [FORGING_CLASS.press]: 'forging_machines_press.csv',
  [FORGING_CLASS.mechanicalPress]: 'forging_machines_mechanicalPress.csv', [FORGING_CLASS.hammer]: 'forging_machines_hammer.csv',
  [FORGING_CLASS.trim]: 'forging_machines_trim.csv',
};

/** Every machine class of the route with its machines from the real Machine/ CSVs. */
export const allForgingMachines = (): Record<string, SandMachine[]> =>
  Object.fromEntries(Object.entries(FILES).map(([machineClass, file]) => [machineClass, machines(file, machineClass)]));

/** An alloy of forging_materials.csv with the columns the calculators read (raw_materials columns and raw_material_properties keys). */
export function forgingMaterial(name: string): SandMaterial {
  const r = rows('forging_materials.csv').find((m) => m['Name'] === name)!;
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']),
    columns: {
      density_kg_m3: n('Density (kg / m^3)'), cost_usa: n('Round Bar Unit Cost (USD / kg)'), price_usd_per_kg: n('Round Bar Unit Cost (USD / kg)'),
      cut_code: n('Cut Code'), scrap_cost_percent: n('Scrap Cost Percent (%)'), shear_strength: n('Shear Strength (MPa)'),
      forging_temperature: n('Forging Temperature (C)'), specific_heat_capacity: n('Specific Heat Capacity (J / kg * K)'),
      strength_coefficient: n('Strength Coefficient (MPa)'), strain_rate_sensitivity: n('Strain Rate Sensitivity'),
    },
  };
}
