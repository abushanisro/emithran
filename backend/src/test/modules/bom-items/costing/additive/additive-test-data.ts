// The real memory/Additive Manufacturing data as the staged rows, HR Rates machines and materials the engine reads, for the additive tests.
// Nothing is copied into a test: everything is read from the folder (migration 1072's material table and 1070's cleaning machine included).
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { ADDITIVE_CLASS } from '../../../../../modules/bom-items/costing/additive/additive-domain';
import type { AdditiveMaterial } from '../../../../../modules/bom-items/costing/additive/additive-route';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Additive Manufacturing');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const materials = rows('Raw materials.csv');
const stagedVariables = rows('variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = [
  ...readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } })),
  // Migration 1072: each material's build process and powder properties, keyed by grade.
  { key: 'additive_tblMaterialBuild', raw: { rows: materials.map((r) => ({
    'Material Name': r['Name'], Grade: r['Source Name'], Process: r['Process'], 'Material Type': r['Material Type'],
    'Tapped Density (kg / m^3)': Number(r['Tapped Density (kg / m^3)']), 'Max Powder Cycles': Number(r['Max Powder Cycles']), 'Recycle Percentage': Number(r['Recycle Percentage']),
  })) } },
];
export const realAdditiveReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
export function machineOf(row: Record<string, any>, machineClass: string, i: number): SandMachine {
  const overhead = Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']);
  const specs = Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k)).map(([k, v]) => [k, v === 'true' || v === 'TRUE' ? true : v === 'false' || v === 'FALSE' ? false : v]));
  return sandMachineFromRow({
    id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
    mhr_usd_per_hour: Number.isFinite(overhead) ? overhead : null,
    usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'] ?? null, setup_time_hr: row['setup_time_hr'],
    machine_power_kw: row['machine_power_kw'], specs,
  }, () => ({ ratePerHr: 0, assumedDefaults: [] }));
}
function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machine/${file}`).map((r, i) => machineOf(Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^﻿/, '')), v])), machineClass, i));
}
export const allAdditiveMachines = (): Record<string, SandMachine[]> => ({
  [ADDITIVE_CLASS.metalSintering]: machines('machines_metal_sintering.csv', ADDITIVE_CLASS.metalSintering),
  [ADDITIVE_CLASS.laserSintering]: machines('machines_laser_sintering.csv', ADDITIVE_CLASS.laserSintering),
  [ADDITIVE_CLASS.printing]: machines('machines_printing.csv', ADDITIVE_CLASS.printing),
  [ADDITIVE_CLASS.resinCuring]: machines('machines_resin_curing.csv', ADDITIVE_CLASS.resinCuring),
  [ADDITIVE_CLASS.partCuring]: machines('machines_part_curing.csv', ADDITIVE_CLASS.partCuring),
  [ADDITIVE_CLASS.breakoff]: machines('machine_manual_breakoff_with_hand_tools.csv', ADDITIVE_CLASS.breakoff),
  [ADDITIVE_CLASS.powderLoading]: machines('machine_electric_trolley_loader_2m_lift_height.csv', ADDITIVE_CLASS.powderLoading),
  [ADDITIVE_CLASS.baseRemoval]: machines('machine_oscillating_power_tool_300w.csv', ADDITIVE_CLASS.baseRemoval),
  [ADDITIVE_CLASS.sieving]: machines('machine_vibratory_compact_sieve_500mm_diameter.csv', ADDITIVE_CLASS.sieving),
  // Migration 1070: Compressed Air Blasting at the Netherlands export's rates, with the export's cleaning rate.
  [ADDITIVE_CLASS.cleaning]: [machineOf({
    name: 'Compressed Air Blasting', labor_rate_usd_per_hr: 38.94, direct_overhead_rate_usd_per_hr: 1.3, indirect_overhead_rate_usd_per_hr: 14.13,
    number_of_operators: 1, setup_time_hr: 0, machine_power_kw: 0.1, metal_cleaning_rate: 0.03,
  }, ADDITIVE_CLASS.cleaning, 0)],
});

/** A material of memory/Additive Manufacturing/Raw materials.csv, as the cost service reads it (raw_materials and additive_tblMaterialBuild). */
export function additiveMaterial(name: string): AdditiveMaterial {
  const r = materials.find((m) => m['Name'] === name);
  if (!r) throw new Error(`no additive material ${name}`);
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, grade: String(r['Source Name']), materialType: String(r['Material Type']), process: String(r['Process']),
    densityKgM3: n('Density (kg / m^3)'), costPerKgUsd: n('Unit Cost (USD / kg)'),
    tappedDensityKgM3: n('Tapped Density (kg / m^3)') || null, maxPowderCycles: n('Max Powder Cycles'), recycleFraction: n('Recycle Percentage'),
  };
}
