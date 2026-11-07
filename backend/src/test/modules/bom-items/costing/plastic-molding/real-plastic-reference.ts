import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GPPS_REFERENCE_MATERIAL,
  PLASTIC_LOOKUP_KEYS,
  resolvePlasticReference,
  type PlasticReference,
  type PlasticReferenceRows,
} from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import type { MaterialClampProperties } from '../../../../../modules/bom-items/costing/plastic-molding/clamp-force';
import type { RealResinInputs } from '../../../../../modules/bom-items/costing/plastic-molding/process/cycle-time';

// The Plastic reference, resolved by the production resolver from the same
// memory/Plastic Modeling files migration 823 stages (not values typed here).
const DIR = join(__dirname, '../../../../../../../memory/plastic modeling');

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

/** The staged rows the plastic reference resolves from, read from memory/Plastic Modeling the way migration 823 stages them. */
export function realReferenceRows(): PlasticReferenceRows {
  const variables = read('variables/digital_factory_variables.csv').map((r) => ({ key: r['variableName']!, value: r['stringValue'] ?? null }));
  // Same file for each key that migration 823 stages under it (split tables in
  // lookup/ as X__records.csv, the settings export in process/).
  const fileOf = (k: string) => (k === 'digital_factory_settings_usa' ? `process/${k}.csv` : `lookup/${k}__records.csv`);
  const lookups = Object.fromEntries(PLASTIC_LOOKUP_KEYS.map((k) => [k, read(fileOf(k))]));
  const gps = read('materials_final.csv').find((r) => r['name'] === GPPS_REFERENCE_MATERIAL);
  const gppsMaterial = gps ? Object.fromEntries(Object.entries(gps).map(([k, v]) => [k, v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v])) : undefined;
  return { variables, lookups, ...(gppsMaterial ? { gppsMaterial } : {}) };
}

export function realPlasticReference(): PlasticReference {
  const { reference, missing } = resolvePlasticReference(realReferenceRows());
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

/** Every press in machine/injection_molding_machines.csv, as the selector's candidate pool carries it. */
export function allRealPresses(): Array<{
  name: string; maxTonnage: number; shotCapacityGrams: number; tieBarXMm: number; tieBarYMm: number;
  timing: { injectionRateMm3PerS: number | null; dryCycleTimeS: number | null }; mhrUsd: number; goodPartYield: number;
}> {
  return read('machine/injection_molding_machines.csv').map((row) => ({
    name: row['name']!,
    maxTonnage: Number(row['limits.clampingForceKn']) / 9.80665,
    shotCapacityGrams: Number(row['limits.shotSizeGppsG']),
    tieBarXMm: Number(row['limits.tieBarDistanceHorMm']),
    tieBarYMm: Number(row['limits.tieBarDistanceVertMm']),
    timing: {
      injectionRateMm3PerS: row['rates.injectionRateMm3PerS'] ? Number(row['rates.injectionRateMm3PerS']) : null,
      dryCycleTimeS: row['time.dryCycleTimeS'] ? Number(row['time.dryCycleTimeS']) : null,
    },
    mhrUsd: Number(row['accounting.directOverheadRateUsdPerHr']) + Number(row['accounting.indirectOverheadRateUsdPerHr']),
    goodPartYield: Number(row['yields.goodPartYield']),
  }));
}

/**
 * The operation catalog of each molding process as the reference states it (memory/Plastic Modeling/process/digital_factory_operations.csv): the compound strings
 * ("Compression Molding:As Molded//CurvedSurface") that migrations stage as process_taxonomy_operations, grouped by process.
 */
export function realOperationCatalog(): Record<string, string[]> {
  const rows = parseCsv(readFileSync(join(DIR, 'process', 'digital_factory_operations.csv'), 'utf8'));
  const byProcess: Record<string, string[]> = {};
  for (const r of rows) (byProcess[r.process!] ??= []).push(r.processName!);
  return byProcess;
}

/** The names of every material in materials_final.csv (the reference resin list). */
export function realMaterialNames(): string[] {
  return read('materials_final.csv').map((r) => r['name']!).filter((n) => n);
}

/** A reference material's thermoset cure time in minutes (cureTimeMin), or null when the grade has none (as raw_materials.cure_time_min carries it). */
export function realCureTimeMin(name: string): number | null {
  const row = read('materials_final.csv').find((r) => r['name'] === name);
  const v = row?.['processingParameters.cureTimeMin'];
  return v === undefined || v === '' ? null : Number(v);
}

/** The injectionTimeAdjustmentFactors rows (cavities per mold and gates per cavity brackets), in file order. */
export function realFillFactorRows(): Array<{ attribute: string; number: number; factor: number }> {
  return read('lookup/injectionTimeAdjustmentFactors__records.csv').map((r) => ({ attribute: r['attribute']!, number: Number(r['number']), factor: Number(r['adjustment_factor']) }));
}

/** The reaction injection machines of machine/reaction_injection_molding_machines.csv: the staged injection rate (mm3/s) and dry cycle (s) the RIM fill time and cycle read. */
export function realRimMachines(): Array<{ name: string; injectionRateMm3PerS: number; dryCycleTimeS: number }> {
  return read('machine/reaction_injection_molding_machines.csv').map((r) => ({
    name: r['name']!, injectionRateMm3PerS: Number(r['rates.injectionRateMm3PerS']), dryCycleTimeS: Number(r['time.dryCycleTimeS']),
  }));
}

