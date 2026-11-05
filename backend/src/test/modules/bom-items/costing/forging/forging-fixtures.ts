// Real data only: memory/Forging, read with the CSV reader the machine seed
// (migration 824) uses. Reference rows are shaped as migration 823 stages them
// (Variable Name -> value, every lookup CSV as rows); materials as migration
// 855 promotes them (raw_materials columns + raw_material_properties keyed by
// the header, snake-cased, unit dropped); machines by 824's rule
// (MHR = Direct OH + Indirect OH, labour = Labor Rate).
import { join } from 'path';

import {
  FORGING_LOOKUP_KEYS,
  resolveForgingMaterial,
  resolveForgingReference,
  type ForgingMaterial,
  type ForgingReference,
  type ForgingReferenceRows,
} from '../../../../../modules/bom-items/costing/forging/forging-reference';

import type { ForgingMachine } from '../../../../../modules/bom-items/costing/forging/forging-line';

type Row = Record<string, unknown>;

// The memory CSV reader is untyped CommonJS (migrations/scripts/lib), loaded
// with require as in the casting specs; typed here by the shape it returns.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as {
  readCsv: (path: string) => { rows: Row[] };
};

const DIR = join(__dirname, '../../../../../../../memory/Forging');
export const csv = (rel: string): Row[] => readCsv(join(DIR, rel)).rows;

/** The value, or a named failure: a test helper in place of a non-null assertion. */
export function defined<T>(x: T | null | undefined, what = 'value'): T {
  if (x == null) throw new Error(`${what} is ${String(x)}`);
  return x;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const cell = (v: unknown): string | number | boolean | null =>
  (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null);

export const referenceRows = (): ForgingReferenceRows => ({
  variables: csv('forging_variables.csv').map((r) => ({ key: str(r['Variable Name']) ?? '', value: cell(r['String Value']) })),
  lookups: Object.fromEntries(FORGING_LOOKUP_KEYS.map((k) => [k, csv(`Lookup/${k}.csv`)])),
});

export function loadReference(): ForgingReference {
  const { reference, missing } = resolveForgingReference(referenceRows());
  if (!reference) throw new Error(`reference missing: ${missing.join(', ')}`);
  return reference;
}

export function material(name: string): ForgingMaterial {
  const r = csv('forging_materials.csv').find((m) => m.Name === name);
  if (!r) throw new Error(`${name} not in forging_materials.csv`);
  return resolveForgingMaterial({
    row: { name: r.Name, material_type: r['Material Type'], density_kg_m3: r['Density (kg / m^3)'], cost_usa: r['Round Bar Unit Cost (USD / kg)'], cut_code: r['Cut Code'] },
    properties: { forging_temperature: num(r['Forging Temperature (C)']) },
  });
}

export function machine(file: string, name: string, machineClass: string): ForgingMachine {
  const r = csv(`Machine/${file}`).find((m) => m.Name === name);
  if (!r) throw new Error(`${name} not in ${file}`);
  const direct = num(r['Direct Overhead Rate (USD / hr)']);
  const indirect = num(r['Indirect Overhead Rate (USD / hr)']);
  return {
    id: `${machineClass}:${name}`,
    name,
    machineClass,
    machineRatePerHr: direct != null && indirect != null ? direct + indirect : null,
    labourRatePerHr: num(r['Labor Rate (USD / hr)']),
    operators: num(r['Number of Operators']),
    setupTimeHr: num(r['Setup Time (hr)']),
    specs: { cycle_time_s: r['Cycle Time (s)'], press_force_kn: r['Press Force (kN)'] },
  };
}
