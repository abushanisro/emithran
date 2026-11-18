// The real memory/Assembly data as the staged rows and HR Rates machines the engine reads, for the assembly tests. Nothing is copied into a
// test: everything is read from the folder, plus what migrations 1075 (laser welding, adhesive bonding) and 1077 (the DFA baseline) add.
import { readdirSync } from 'fs';
import { join } from 'path';

import { sandMachineFromRow, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

interface Csv { columns: string[]; rows: Record<string, string | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv; specKey: (header: string) => string };

const DIR = join(__dirname, '../../../../../../../memory/Assembly');
const clean = (h: string) => h.replace(/^﻿/, '');
const cleanRow = (r: Record<string, string | undefined>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [clean(k), v]));
const numeric = (v: string | undefined): unknown => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v === 'true' || v === 'TRUE' ? true : v === 'false' || v === 'FALSE' ? false : v);

const stagedVariables = readCsv(join(DIR, 'digital_factory_variables.csv')).rows.map(cleanRow)
  .map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] ? String(r['Unit Type Name']) : null }));
const stagedLookups = [
  ...readdirSync(join(DIR, 'lookup')).filter((f) => f.endsWith('.csv'))
    .map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: readCsv(join(DIR, 'lookup', f)).rows.map((r) => Object.fromEntries(Object.entries(cleanRow(r)).map(([k, v]) => [k, numeric(v)]))) } })),
  // Migration 1077: the Boothroyd-Dewhurst baseline (controller assembly worksheet).
  { key: 'assembly_tblDfaOperationTimes', raw: { rows: [
    { Operation: 'Screw Tighten - Manual', 'Handling Code': '11', 'Handling Time (s)': 1.8, 'Insertion Code': '39', 'Insertion Time (s)': 8, 'Total Time (s)': 9.8 },
    { Operation: 'Nut Insert', 'Handling Code': '00', 'Handling Time (s)': 1.13, 'Insertion Code': '39', 'Insertion Time (s)': 8, 'Total Time (s)': 9.13 },
    { Operation: 'Snap Fit', 'Handling Code': '30', 'Handling Time (s)': 1.95, 'Insertion Code': '31', 'Insertion Time (s)': 5, 'Total Time (s)': 6.95 },
  ] } },
];
export const realAssemblyReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

const TOP_LEVEL = new Set(['name', 'labor_rate_usd_per_hr', 'direct_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_per_hr', 'number_of_operators', 'setup_time_hr', 'machine_power_kw']);
function machineOf(row: Record<string, unknown>, machineClass: string, i: number): SandMachine {
  const overhead = Number(row.direct_overhead_rate_usd_per_hr) + Number(row.indirect_overhead_rate_usd_per_hr);
  return sandMachineFromRow({
    id: `${machineClass}-${i}`, machine_name: row.name, machine_class: machineClass, location: 'USA',
    mhr_usd_per_hour: Number.isFinite(overhead) ? overhead : null,
    usd_labor_rate_per_hr: row.labor_rate_usd_per_hr, operators: row.number_of_operators ?? null, setup_time_hr: row.setup_time_hr,
    machine_power_kw: row.machine_power_kw, specs: Object.fromEntries(Object.entries(row).filter(([k]) => !TOP_LEVEL.has(k))),
  }, () => ({ ratePerHr: 0, assumedDefaults: [] }));
}
/** The machines of a memory/Assembly machine file: one per row, or the one machine of a Field,Value file. */
function machines(file: string, machineClass: string): SandMachine[] {
  const t = readCsv(join(DIR, 'Machines', file));
  const keyed = (pairs: [string, string | undefined][]) => Object.fromEntries(pairs.map(([h, v]) => [specKey(clean(h)), numeric(v)]));
  if (clean(t.columns[0]) === 'Field') return [machineOf(keyed(t.rows.map((r) => [cleanRow(r).Field ?? '', cleanRow(r).Value])), machineClass, 0)];
  return t.rows.map((r, i) => machineOf(keyed(Object.entries(r)), machineClass, i));
}

export const allAssemblyMachines = (): Record<string, SandMachine[]> => ({
  pick_and_place: machines('machine_pick_and_place.csv', 'pick_and_place'),
  mechanical_assembly: machines('machine_mechanical_assembly.csv', 'mechanical_assembly'),
  threaded_insert: machines('machine_threaded_insert.csv', 'threaded_insert'),
  lock_bolt: machines('machines_lock_bolt.csv', 'lock_bolt'),
  rivet: machines('machine_rivet.csv', 'rivet'),
  manual_mig_welding: machines('machines_manual_mig_welding.csv', 'manual_mig_welding'),
  robotic_mig_welding: machines('machines_robotic_mig_welding.csv', 'robotic_mig_welding'),
  manual_tig_welding: machines('machines_manual_tig_welding.csv', 'manual_tig_welding'),
  robotic_tig_welding: machines('machines_robotic_tig_welding.csv', 'robotic_tig_welding'),
  manual_spot_welding: machines('machines_manual_spot_welding (1).csv', 'manual_spot_welding'),
  robotic_spot_welding: machines('machines_robotic_spot_welding.csv', 'robotic_spot_welding'),
  electron_beam_welding: machines('machines_electron_beam_welding.csv', 'electron_beam_welding'),
  assembly_ultrasonic_welding: machines('machines_ultrasonic_welding.csv', 'assembly_ultrasonic_welding'),
  fay_sealing: machines('machine_fay_sealing.csv', 'fay_sealing'),
  fillet_sealing: machines('machine_fillet_sealing.csv', 'fillet_sealing'),
  cap_sealing: machines('machine_manual_cap_sealing.csv', 'cap_sealing'),
  weld_prep: machines('machine_weld_prep.csv', 'weld_prep'),
  weld_clean_up: machines('machine_weld_clean_up.csv', 'weld_clean_up'),
  // Migration 1075: the Netherlands export's laser welder and manual adhesive bonding, at its rates.
  laser_welding: [machineOf({
    name: 'Laser Welder - 1000 Watts - 0.5m x 0.3m', labor_rate_usd_per_hr: 47.36, direct_overhead_rate_usd_per_hr: 5, indirect_overhead_rate_usd_per_hr: 20,
    number_of_operators: 1, setup_time_hr: 1, beam_output_power_kw: 1, max_speed_mm_per_s: 100, part_placement_time_s: 5, programming_time_per_weld_s: 1800,
  }, 'laser_welding', 0)],
  adhesive_bonding: [machineOf({
    name: 'Manual Adhesive Bonding', labor_rate_usd_per_hr: 29.95, direct_overhead_rate_usd_per_hr: 0.02, indirect_overhead_rate_usd_per_hr: 13.85,
    number_of_operators: 1, setup_time_hr: 0.5, application_rate_m2_per_min: 0.02,
  }, 'adhesive_bonding', 0)],
});
