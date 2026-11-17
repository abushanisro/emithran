// The real memory/Casting Investment data as the staged rows and HR Rates machines the engine reads, for the investment casting tests. Never a
// copy of reference values in a test: everything is read from the folder, and the two baseline variables from the migration that stages them.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SandMaterial } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { INVESTMENT_CLASS } from '../../../../../modules/bom-items/costing/casting/investment/investment-reference';
import { specKey } from './sand-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Casting Investment');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

/** The variables migration 1045 stages (the wax conductivity and die temperature), read from the migration itself. */
const BASELINE = [...readFileSync(join(__dirname, '../../../../../../migrations/1045_investment_wax_pattern_cooling_variables.sql'), 'utf8')
  .matchAll(/\('variable', 'USA', '2026-CastInvest', '(\w+)', '([\d.]+)', '([^']+)'/g)].map((m) => ({ key: m[1]!, value: m[2]!, unit_type: m[3]! }));

const stagedVariables = [
  ...rows('investment_casting_variables.csv').map((r) => ({
    key: String(r['Variable Name']),
    value: r['String Value'] == null ? null : String(r['String Value']), // staged as text
    unit_type: r['Unit Type Name'] || null,
  })),
  ...BASELINE,
];
const stagedLookups = [
  ...readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } })),
  // The India price list of the alloys, staged with the lookup tables (migration 874).
  { key: 'raw_material_cost_master', raw: { rows: rows('Indian data/raw_material_cost_master.csv') } },
];

export const realInvestmentReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });
export const investmentBaselineVariables = BASELINE;

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);

/** The machines of one Machine/ CSV: a table of machines, or one machine written as Field / Value pairs. */
function machines(file: string, machineClass: string): SandMachine[] {
  const read = readCsv(join(DIR, 'Machine', file)) as { columns: string[]; rows: Array<Record<string, any>> };
  const records = read.columns.join() === 'Field,Value' ? [Object.fromEntries(read.rows.map((r) => [r['Field'], r['Value']]))] : read.rows;
  return records.map((r, i) => {
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(h), v]));
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
  [INVESTMENT_CLASS.waxPattern]: 'wax_pattern_molding_machines.csv', [INVESTMENT_CLASS.bench]: 'bench_operation_machine.csv',
  [INVESTMENT_CLASS.primaryDip]: 'primary_slurry_dipping_machines.csv', [INVESTMENT_CLASS.primarySand]: 'primary_sand_coating_machine.csv',
  [INVESTMENT_CLASS.secondaryDip]: 'secondary_slurry_dipping_machines.csv', [INVESTMENT_CLASS.secondarySand]: 'secondary_sand_coating_machine.csv',
  [INVESTMENT_CLASS.robot]: 'robotic_assist_machines.csv',
  [INVESTMENT_CLASS.flashFire]: 'flash_fire_dewaxing_machines.csv', [INVESTMENT_CLASS.autoclave]: 'steam_autoclave_dewaxing_machines.csv',
  [INVESTMENT_CLASS.burnout]: 'mold_burnout_machines.csv', [INVESTMENT_CLASS.preheat]: 'mold_preheating_machines.csv',
  [INVESTMENT_CLASS.pouring]: 'metal_pouring_machines.csv', [INVESTMENT_CLASS.cooling]: 'cooling_machine.csv',
  [INVESTMENT_CLASS.knockout]: 'knockout_machine.csv', [INVESTMENT_CLASS.bandSaw]: 'band_saw_machine.csv', [INVESTMENT_CLASS.beltSand]: 'belt_sand_machine.csv',
};

/** Every machine class of the route with its machines from the real Machine/ CSVs. */
export const allInvestmentMachines = (): Record<string, SandMachine[]> =>
  Object.fromEntries(Object.entries(FILES).map(([machineClass, file]) => [machineClass, machines(file, machineClass)]));

/** An alloy of Raw Material/raw_materials.csv with the columns the calculators read (raw_materials columns and raw_material_properties keys). */
export function investmentMaterial(name: string): SandMaterial {
  const r = rows('Raw Material/raw_materials.csv').find((m) => m['Name'] === name)!;
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, materialType: String(r['Material Type']),
    columns: {
      density_kg_m3: n('Density (kg / m^3)'), cost_usa: n('Unit Cost (USD / kg)'), price_usd_per_kg: n('Unit Cost (USD / kg)'), heat_of_fusion: n('Heat of Fusion (J / kg)'),
      specific_heat_rt: n('Specific Heat RT (J / kg * K)'), liquidus_temp: n('Liquidus Temp (°C)'), pour_temp: n('Pour Temp (°C)'),
    },
  };
}
