// The real memory/Sand casting data as the staged rows migration 853 stores (text values, lookup rows), for the sand tests. Never a copy of
// reference values in a test: everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
export const SAND_DIR = join(__dirname, '../../../../../../../memory/Sand casting');
export const sandRows = (rel: string): Array<Record<string, any>> => readCsv(join(SAND_DIR, rel)).rows;

export const stagedVariables = sandRows('sand_casting_variables.csv').map((r) => ({
  key: String(r['Variable Name']),
  value: r['String Value'] == null ? null : String(r['String Value']), // staged as text: machining_reference_data.value is TEXT
  unit_type: r['Unit Type Name'] || null,
}));
export const lookupFiles = readdirSync(join(SAND_DIR, 'Lookup')).filter((f) => f.endsWith('.csv'));
export const stagedLookups = lookupFiles.map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: sandRows(`Lookup/${f}`) } }));

export const realSandReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });
/** The sand raw materials (Raw Material/raw_materials.csv), as rows keyed by the CSV headers. */
export const sandMaterials = () => sandRows('Raw Material/raw_materials.csv');

// ── machines and materials as migrations 851 / 852 store them ────────────────────────────────────────────────────────────────────────
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { SandMaterial } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';

/** A CSV header as the key migration 851 gives a machine spec: "Flask Length (mm)" -> flask_length_mm, "Furnace Capacity (m^3)" -> furnace_capacity_m3. */
export const specKey = (header: string): string =>
  header.replace(/^﻿/, '').toLowerCase().replace(/\^/g, '').replace(/\(([^)]*)\)/g, ' $1 ').replace(/\//g, ' per ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);

/**
 * The machines of one Machine/ CSV as SandMachines. The stored machine hour rate is direct + indirect overhead where the file has them
 * (how this test stands in for the seeded column); a file without them (the furnaces) has none, and `engineRate` prices those.
 */
export function sandMachines(file: string, machineClass: string, engineRate: (row: Record<string, any>) => { ratePerHr: number; assumedDefaults: string[] } | null = () => null): SandMachine[] {
  return sandRows(`Machine/${file}`).map((r, i) => {
    const row: Record<string, any> = Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(h), v]));
    const direct = Number(row['direct_overhead_rate_usd_per_hr']);
    const indirect = Number(row['indirect_overhead_rate_usd_per_hr']);
    const specs = Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k)));
    return sandMachineFromRow({
      id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass,
      mhr_usd_per_hour: Number.isFinite(direct) && Number.isFinite(indirect) ? direct + indirect : null,
      usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'], setup_time_hr: row['setup_time_hr'],
      machine_power_kw: row['machine_power_kw'], specs,
    }, engineRate);
  });
}

/** A sand material of Raw Material/raw_materials.csv with the columns the calculators read, by their raw_materials column names. */
export function sandMaterial(name: string): SandMaterial {
  const r = sandMaterials().find((m) => m['Name'] === name)!;
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    name, materialType: String(r['Material Type']),
    columns: {
      density_kg_m3: n('Density (kg / m^3)'), heat_of_fusion_j_kg: n('Heat of Fusion (J / kg)'), specific_heat_rt_j_kg_k: n('Specific Heat RT (J / kg * K)'),
      specific_heat_solidus_j_kg_k: n('Specific Heat at Solidus Temperature (J / kg * K)'), injection_temp_c: n('Injection Temp (C)'),
      liquidus_temp_c: n('Liquidus Temp (C)'), cut_code: n('Cut Code'), cost_usa: n('Unit Cost (USD / kg)'),
    },
  };
}

/** Every sand machine class of the route with its machines from the real Machine/ CSVs (furnaces priced by a stand-in for the HR Rates engine). */
export const allSandMachines = (): Record<string, SandMachine[]> => {
  const files: Record<string, string> = {
    sand_casting_horizontal_automatic: 'machines_horizontal_automatic.csv', sand_casting_vertical_automatic: 'machines_vertical_automatic.csv',
    sand_casting_manual_std_moldmaking: 'machines_manual_std_moldmaking.csv', sand_casting_manual_floor_moldmaking: 'machines_manual_floor_moldmaking.csv',
    sand_casting_manual_pit_moldmaking: 'machines_manual_pit_moldmaking.csv', sand_casting_melting: 'machines_melting.csv', sand_casting_pour: 'machines_pour.csv',
    sand_casting_cooling: 'machines_cooling.csv', sand_casting_shakeout: 'machines_shakeout.csv', sand_casting_degating: 'machines_degating.csv',
    sand_casting_cleaning: 'machines_cleaning.csv', sand_casting_finishing: 'machines_finishing.csv', sand_casting_visual_inspection: 'machines_visual_inspection.csv',
    sand_casting_hot_box: 'machines_hot_box.csv', sand_casting_co2_coremaking: 'machines_co2_coremaking.csv', sand_casting_no_bake: 'machines_no_bake_coremaking.csv',
    sand_casting_oil_core: 'machines_oil_core.csv', sand_casting_shell: 'machines_shell_coremaking.csv',
  };
  return Object.fromEntries(Object.entries(files).map(([cls, file]) => [cls, sandMachines(file, cls, () => ({ ratePerHr: 12.5, assumedDefaults: ['payback_period_years'] }))]));
};

/**
 * The plant's hot box settings the tests use: core box 245 C (literature 230-260 C), a binder that cures at 150 C and 3 mm of core cured before it is
 * stripped. Illustrative values for tests only: no dataset holds them, and the application assumes none (they are set in the Cost Guide).
 */
export const HOT_BOX: { coreboxTempC: number; cureTempC: number; curedDepthMm: number } = { coreboxTempC: 245, cureTempC: 150, curedDepthMm: 3 };
