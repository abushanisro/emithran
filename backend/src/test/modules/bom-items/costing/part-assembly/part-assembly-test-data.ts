// The real memory/Part Assembly data as the staged rows and HR Rates machines the engine reads, for the Part Assembly tests. Nothing is copied
// into a test: the lookups and variables are read from the folder, the machines from its machine files with the specs and crew migration 1098
// writes (read from the migration itself).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

/** A cell as the migration generators' readCsv gives it: a number, a boolean or text, null when empty (undefined: no such column). */
export type CsvCell = string | number | boolean | null | undefined;
interface Csv { columns: string[]; rows: Record<string, CsvCell>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const DIR = join(__dirname, '../../../../../../../memory/Part Assembly');
const MIGRATION_1098 = join(__dirname, '../../../../../../migrations/1098_part_assembly_machines.sql');
const text = (v: CsvCell): string | null => (v == null || v === '' ? null : String(v));

const stagedVariables = readCsv(join(DIR, 'variables_welding_group.csv')).rows
  .map((r) => ({ key: String(r['Variable Name']), value: text(r['String Value']), unit_type: text(r['Unit Type Name']) }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv'))
  .map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: readCsv(join(DIR, 'Lookup', f)).rows } }));
/** `value`, or a test failure naming what was missing. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing: ${what}`);
  return value;
}

export const realPartAssemblyReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

/** Migration 1098's spec and crew rows, by class and name. */
const written = new Map<string, { specs: Record<string, unknown>; operators: number | null }>(
  [...readFileSync(MIGRATION_1098, 'utf8').matchAll(/^ {2}\(\$str\$([^$]+)\$str\$, \$str\$([^$]+)\$str\$, \$jsonb\$(\{.*?\})\$jsonb\$::jsonb, (NULL|[\d.]+)::numeric\)/gm)]
    .map((m) => [`${m[1]}|${m[2]}`, { specs: JSON.parse(m[3]) as Record<string, unknown>, operators: m[4] === 'NULL' ? null : Number(m[4]) }]),
);

function machine(machineClass: string, i: number, row: { name: string; labour: number; direct: number; indirect: number; operators: number; setupHr: number; specs: Record<string, unknown> }): SandMachine {
  const w = written.get(`${machineClass}|${row.name}`);
  return sandMachineFromRow({
    id: `${machineClass}-${i}`, machine_name: row.name, machine_class: machineClass, location: 'USA',
    mhr_usd_per_hour: row.direct + row.indirect, usd_labor_rate_per_hr: row.labour, operators: w?.operators ?? row.operators, setup_time_hr: row.setupHr,
    machine_power_kw: null, specs: { ...row.specs, ...(w?.specs ?? {}) },
  }, () => ({ ratePerHr: 0, assumedDefaults: [] }));
}

/** The machines of a snake_case memory machine file (the welders, wire brushing). */
function snake(file: string, machineClass: string): SandMachine[] {
  return readCsv(join(DIR, 'Machine', file)).rows.map((r, i) => machine(machineClass, i, {
    name: String(r.name), labour: Number(r.labor_rate_usd_hr), direct: Number(r.direct_overhead_rate_usd_hr), indirect: Number(r.indirect_overhead_rate_usd_hr),
    operators: Number(r.number_of_operators), setupHr: Number(r.setup_time_hr), specs: {},
  }));
}
/** The one machine of a default grinding or bevel cutting file (headers with units). */
function titled(file: string, machineClass: string): SandMachine[] {
  const r = readCsv(join(DIR, 'Machine', file)).rows[0];
  const speed = r['Grinding Speed (mm / s)'];
  return [machine(machineClass, 0, {
    name: String(r.Name), labour: Number(r['Labor Rate (USD / hr)']), direct: Number(r['Direct Overhead Rate (USD / hr)']), indirect: Number(r['Indirect Overhead Rate (USD / hr)']),
    operators: Number(r['Number of Operators']), setupHr: Number(r['Setup Time (hr)']), specs: typeof speed === 'number' ? { grinding_speed_mm_per_s: speed } : {},
  })];
}
/** The laser seam welder (a parameter,value file): its power and load and unload times, as migration 864 wrote them. */
function laser(): SandMachine[] {
  const p = Object.fromEntries(readCsv(join(DIR, 'Machine/laser_seam_weld_machine.csv')).rows.map((r) => [String(r.parameter), Number(r.value)]));
  return [machine('laser_seam_welding', 0, {
    name: 'Default', labour: p['Labor Rate'], direct: p['Direct Overhead Rate'], indirect: p['Indirect Overhead Rate'], operators: p['Number of Operators'], setupHr: p['Setup Time'],
    specs: { power_w: p.Power, load_time_s: p['Load Time'], unload_time_s: p['Unload Time'] },
  })];
}

export const allPartAssemblyMachines = (): Record<string, SandMachine[]> => ({
  part_assembly_manual_mig_welding: snake('manual_mig_weld_machines.csv', 'part_assembly_manual_mig_welding'),
  part_assembly_robotic_mig_welding: snake('robotic_mig_weld_machines.csv', 'part_assembly_robotic_mig_welding'),
  part_assembly_manual_spot_welding: snake('manual_spot_weld_machines.csv', 'part_assembly_manual_spot_welding'),
  part_assembly_robotic_spot_welding: snake('robotic_spot_weld_machines.csv', 'part_assembly_robotic_spot_welding'),
  laser_seam_welding: laser(),
  bevel_cutting: titled('machine_default_bevel_cutting.csv', 'bevel_cutting'),
  grinding: titled('machine_default_grinding.csv', 'grinding'),
  finish_grinding: titled('machine_default_finish_grinding.csv', 'finish_grinding'),
  wire_brushing: snake('wire_brushing_machine.csv', 'wire_brushing'),
});
