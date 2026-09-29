import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GPPS_REFERENCE_MATERIAL,
  PLASTIC_LOOKUP_KEYS,
  resolvePlasticReference,
  type PlasticReference,
} from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import type { MaterialClampProperties } from '../../../../../modules/bom-items/costing/plastic-molding/clamp-force';
import type { RealResinInputs } from '../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';

// The Plastic reference, resolved by the production resolver from the same
// memory/Plastic Modeling files migration 823 stages (not values typed here).
const DIR = join(__dirname, '../../../../../../../memory/Plastic Modeling');

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const read = (rel: string) => parseCsv(readFileSync(join(DIR, rel), 'utf-8').replace(/^\uFEFF/, ''));

export function realPlasticReference(): PlasticReference {
  const variables = read('variables/digital_factory_variables.csv').map((r) => ({ key: r['variableName']!, value: r['stringValue'] ?? null }));
  // Same file for each key that migration 823 stages under it (split tables in
  // lookup/ as X__records.csv, the settings export in process/).
  const fileOf = (k: string) => (k === 'digital_factory_settings_usa' ? `process/${k}.csv` : `lookup/${k}__records.csv`);
  const lookups = Object.fromEntries(PLASTIC_LOOKUP_KEYS.map((k) => [k, read(fileOf(k))]));
  const gps = read('materials_final.csv').find((r) => r['name'] === GPPS_REFERENCE_MATERIAL);
  const gppsMaterial = gps ? Object.fromEntries(Object.entries(gps).map(([k, v]) => [k, v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v])) : undefined;
  const { reference, missing } = resolvePlasticReference({ variables, lookups, gppsMaterial });
  if (!reference) throw new Error(`Plastic reference missing: ${missing.join('; ')}`);
  return reference;
}

/** A reference material's clamp properties, from materials_final.csv (what
 *  migration 831 writes onto its raw_materials row). */
export function realMaterialClamp(name: string): MaterialClampProperties {
  const row = read('materials_final.csv').find((r) => r['name'] === name);
  if (!row) throw new Error(`no reference material ${name}`);
  return {
    injectionPressureMaxMpa: Number(row['processingParameters.injectionPressureMaxMPa']),
    flowLengthRatio: Number(row['processingParameters.flowLengthRatio']),
    referenceMaterial: name,
  };
}

/** A real press from machine/injection_molding_machines.csv, as mhr_records and
 *  its reference record carry it: tonnage = clampingForceKn / 9.80665 (migration
 *  633), shot capacity in GPPS grams, and its timing (migration 648). */
export function realPress(name: string): {
  maxTonnage: number; shotCapacityGrams: number; timing: { injectionRateMm3PerS: number | null; dryCycleTimeS: number | null };
  /** Machine hour rate (USD/h): direct + indirect overhead, as the HR Rates row carries it. */
  mhrUsd: number;
  /** yields.goodPartYield (good_part_yield). */
  goodPartYield: number;
} {
  const row = read('machine/injection_molding_machines.csv').find((r) => r['name'] === name);
  if (!row) throw new Error(`no press ${name}`);
  const n = (v: string | undefined) => (v == null || v === '' ? null : Number(v));
  return {
    maxTonnage: Number(row['limits.clampingForceKn']) / 9.80665,
    shotCapacityGrams: Number(row['limits.shotSizeGppsG']),
    timing: { injectionRateMm3PerS: n(row['rates.injectionRateMm3PerS']), dryCycleTimeS: n(row['time.dryCycleTimeS']) },
    mhrUsd: Number(row['accounting.directOverheadRateUsdPerHr']) + Number(row['accounting.indirectOverheadRateUsdPerHr']),
    goodPartYield: Number(row['yields.goodPartYield']),
  };
}

/** A reference material's thermal inputs, as migration 831 / raw_materials carry them. */
export function realResinInputs(name: string): RealResinInputs {
  const row = read('materials_final.csv').find((r) => r['name'] === name);
  if (!row) throw new Error(`no reference material ${name}`);
  const n = (k: string) => (row[k] === '' || row[k] == null ? null : Number(row[k]));
  return {
    meltingTempC: n('thermalProperties.meltingTempC'),
    moldTempC: n('thermalProperties.moldTempC'),
    ejectionTempC: n('thermalProperties.ejectDeflectionTempC'),
    specificHeatMeltJgC: n('physicalProperties.specificHeatOfMeltJgC'),
    thermalConductivityMeltWMK: n('physicalProperties.thermalConductivityOfMeltWattsMC'),
    densityOfMeltKgM3: n('physicalProperties.densityOfMeltKgM3'),
  };
}
