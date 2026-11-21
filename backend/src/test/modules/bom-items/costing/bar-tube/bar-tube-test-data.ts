// The real memory/Bar and tube fab data as the staged rows, HR Rates machines and materials the engine reads, for the bar and tube tests.
// Nothing is copied into a test: everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { STOCK_PRICE_FORM, barTubeClass, type BarTubeMaterial } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-route';
import { cutCodeFamilyOf } from '../../../../../modules/bom-items/costing/shared/core/cut-code';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Bar and tube fab');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const stagedVariables = rows('bar_and_tube_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = readdirSync(join(DIR, 'lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`lookup/${f}`) } }));
export const realBarTubeReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
function machineOf(row: Record<string, any>, machineClass: string, i: number): SandMachine {
  const overhead = Number(row['direct_overhead_rate_usd_per_hr']) + Number(row['indirect_overhead_rate_usd_per_hr']);
  const specs = Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k)).map(([k, v]) => [k, v === 'true' || v === 'TRUE' ? true : v === 'false' || v === 'FALSE' ? false : v]));
  return sandMachineFromRow({
    id: `${machineClass}-${i}`, machine_name: row['name'], machine_class: machineClass, location: 'USA',
    mhr_usd_per_hour: Number.isFinite(overhead) ? overhead : null,
    usd_labor_rate_per_hr: row['labor_rate_usd_per_hr'], operators: row['number_of_operators'] ?? null, setup_time_hr: row['setup_time_hr'],
    machine_power_kw: row['machine_power_kw'], specs,
  }, () => ({ ratePerHr: 0, assumedDefaults: [] }));
}
/** Each process's machines (memory Machines/machines_<process>.csv; Punching's file is machines_bar_punching.csv), by HR Rates class. */
export function allBarTubeMachines(): Record<string, SandMachine[]> {
  const out: Record<string, SandMachine[]> = {};
  for (const f of readdirSync(join(DIR, 'Machines')).filter((x) => x.endsWith('.csv'))) {
    const process = f.replace(/^machines_/, '').replace(/\.csv$/, '').replace(/^bar_punching$/, 'punching');
    const cls = barTubeClass(process);
    out[cls] = rows(`Machines/${f}`).map((r, i) => machineOf(Object.fromEntries(Object.entries(r).map(([h, v]) => [specKey(String(h).replace(/^﻿/, '')), v])), cls, i));
  }
  return out;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const STOCK_PRICE_COLUMN: Readonly<Record<string, string>> = {
  round_tube: 'Round Tube Unit Cost (USD / kg)', square_tube: 'Square Tube Unit Cost (USD / kg)', rectangular_tube: 'Rectangular Tube Unit Cost (USD / kg)',
  round_bar: 'Round Bar Unit Cost (USD / kg)', square_bar: 'Square Bar Unit Cost (USD / kg)', rectangular_bar: 'Rectangular Bar Unit Cost (USD / kg)',
  hex_bar: 'Hex Bar Unit Cost (USD / kg)', angle_bar: 'Angle Bar Unit Cost (USD / kg)', channel_bar: 'Channel Bar Unit Cost (USD / kg)',
  i_beam: 'I-Beam Unit Cost (USD / kg)', t_beam: 'T-Beam Unit Cost (USD / kg)', plate: 'Sheet Unit Cost (USD / kg)',
};
/**
 * A material of memory/Bar and tube fab/Raw material/materials.csv as the cost service reads it (raw_materials and, from migrations 1090 and
 * 1092, its strengths, exit speed and specific heat), with the price of `stockForm` (USA). `costPerKgUsd` is the alloy's own price (cost_usa,
 * which the file does not hold: the test names it).
 */
export function barTubeMaterial(name: string, stockForm: string, costPerKgUsd: number | null = null): BarTubeMaterial {
  const r = rows('Raw material/materials.csv').find((m) => m['Name'] === name);
  if (!r) throw new Error(`no bar and tube material ${name}`);
  const ref = realBarTubeReference();
  const families = new Set([...ref.table('saw_cut_rate'), ...ref.table('process_cut_rate')].map((x) => String(x['Material Cut Code Family'])));
  const cutCode = Number(r['Cut Code']);
  const column = STOCK_PRICE_COLUMN[STOCK_PRICE_FORM[stockForm] ?? ''];
  const price = column && r[column] != null && r[column] !== '' ? Number(r[column]) : null;
  return {
    id: `raw-materials:${name}`, name, cutCode, cutCodeFamily: cutCodeFamilyOf(families, cutCode),
    materialType: String(r['Material Type'] ?? ''), densityKgM3: Number(r['Density (kg / m^3)']),
    utsMpa: num(r['Ultimate Tensile Strength (MPa)']), yieldMpa: num(r['Tensile Yield Strength (MPa)']), costPerKgUsd,
    specificHeatJKgK: num(r['Specific Heat RT (J / kg * K)']), exitSpeedMaxMmS: num(r['Maximum Extrusion Exit Speed (mm / s)']),
    stockPricePerKgUsd: price, stockPriceSource: price != null ? `materials.csv ${column}` : null,
  };
}
