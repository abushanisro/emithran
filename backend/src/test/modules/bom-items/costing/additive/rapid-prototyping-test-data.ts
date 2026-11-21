// The real memory/Rapid prototyping data as the staged rows, HR Rates machines and materials the engine reads, for the Rapid Prototyping
// tests. Everything is read from the folder; the machines' specs are renamed as migration 1103 renames them in the database.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import type { SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { RAPID_PROTOTYPING_CLASS } from '../../../../../modules/bom-items/costing/additive/additive-domain';
import type { AdditiveMaterial } from '../../../../../modules/bom-items/costing/additive/additive-route';
import { machineOf } from './additive-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv, specKey } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const DIR = join(__dirname, '../../../../../../../memory/Rapid prototyping');
const rows = (rel: string): Array<Record<string, any>> => readCsv(join(DIR, rel)).rows;

const stagedVariables = rows('rapid_prototyping_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] == null ? null : String(r['String Value']), unit_type: r['Unit Type Name'] || null }));
const stagedLookups = readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rows(`Lookup/${f}`) } }));
export const realRapidPrototypingReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });

// Migration 1103: the specs under the additive engine's keys, and each laser's cost per hour.
const RENAME: Record<string, Record<string, string>> = {
  [RAPID_PROTOTYPING_CLASS.printing]: { layer_speed: 'layer_speed_m_per_s', layer_thickness: 'layer_thickness_mm', scanning_speed: 'scanning_width_mm' },
  [RAPID_PROTOTYPING_CLASS.resinCuring]: { scanning_speed: 'scanning_speed_mm_per_s', wiper_speed: 'wiper_speed_mm_per_s' },
};
const laserRates = (file: string) => Object.fromEntries(rows(`Lookup/${file}`).map((r) => [r['Machine'], Number(r['Laser Cost Per Hour (USD / hr)'])]));
const LASER: Record<string, Record<string, number>> = {
  [RAPID_PROTOTYPING_CLASS.laserSintering]: laserRates('laser_cost_per_hour.csv'),
  [RAPID_PROTOTYPING_CLASS.resinCuring]: laserRates('laser_replacement.csv'),
};

function machines(file: string, machineClass: string): SandMachine[] {
  return rows(`Machines/${file}`).map((r, i) => {
    const row: Record<string, any> = {};
    for (const [h, v] of Object.entries(r)) {
      const key = specKey(String(h).replace(/^﻿/, ''));
      row[RENAME[machineClass]?.[key] ?? key] = v;
    }
    const laser = LASER[machineClass]?.[String(row['name'])];
    if (laser) row['laser_cost_per_hour_usd_per_hr'] = laser;
    return machineOf(row, machineClass, i);
  });
}

export const allRapidPrototypingMachines = (): Record<string, SandMachine[]> => ({
  [RAPID_PROTOTYPING_CLASS.laserSintering]: machines('machines_laser_sintering.csv', RAPID_PROTOTYPING_CLASS.laserSintering),
  [RAPID_PROTOTYPING_CLASS.printing]: machines('machines_printing.csv', RAPID_PROTOTYPING_CLASS.printing),
  [RAPID_PROTOTYPING_CLASS.resinCuring]: machines('machines_resin_curing.csv', RAPID_PROTOTYPING_CLASS.resinCuring),
  [RAPID_PROTOTYPING_CLASS.partCuring]: machines('machines_part_curing.csv', RAPID_PROTOTYPING_CLASS.partCuring),
  // memory/Rapid prototyping/Machines/machine_default_cleaning.csv (Field, Value).
  [RAPID_PROTOTYPING_CLASS.cleaning]: [machineOf({
    name: 'Default Cleaning', labor_rate_usd_per_hr: 30.49, direct_overhead_rate_usd_per_hr: 0.15, indirect_overhead_rate_usd_per_hr: 14.48,
    number_of_operators: 1, setup_time_hr: 0, machine_power_kw: 1,
  }, RAPID_PROTOTYPING_CLASS.cleaning, 0)],
});

/** A material of memory/Rapid prototyping/Raw Materials, as the cost service reads it (raw_materials and its process property). */
export function rapidPrototypingMaterial(name: string): AdditiveMaterial {
  const r = rows('Raw Materials/raw_materials.csv').find((m) => m['Name'] === name);
  if (!r) throw new Error(`no Rapid Prototyping material ${name}`);
  const n = (h: string) => (r[h] == null || r[h] === '' ? null : Number(r[h]));
  return {
    id: `raw-materials:${name}`, name, grade: String(r['Source Name']), materialType: String(r['Material Type Name']), process: String(r['Process']),
    densityKgM3: n('Density (kg / m^3)'), costPerKgUsd: n('Cost Per KG (USD / kg)'), tappedDensityKgM3: null, maxPowderCycles: null, recycleFraction: null,
  };
}
