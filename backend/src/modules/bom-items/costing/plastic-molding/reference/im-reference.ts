// The injection-molding reference package (this folder's *.csv, from the costing engineer's research): read by the cost model where a
// decision needs it. The CSVs are the one source; nest-cli.json ships them with the build. Each row keeps its confidence and source, so a
// cost that uses one says how far it can be trusted.
import { readFileSync } from 'fs';
import { join } from 'path';

/** RFC 4180: quoted fields, "" for a quote inside one. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function readReferenceCsv(file: string): Array<Record<string, string>> {
  const [header, ...body] = parseCsv(readFileSync(join(__dirname, file), 'utf8'));
  return body.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));
}

/** A value of the reference package with its unit, confidence and source, for a calculator input. */
export interface ReferenceValue { value: number; unit: string; confidence: string; source: string }

function referenceValue(rows: ReadonlyArray<Record<string, string>>, match: (r: Record<string, string>) => boolean, file: string): ReferenceValue | null {
  const r = rows.find(match);
  const value = r ? Number(r['value']) : NaN;
  if (!r || r['value'] === '' || !Number.isFinite(value)) return null;
  return { value, unit: r['unit'] ?? '', confidence: r['confidence'] ?? '', source: `reference/${file}: ${r['source_name']}` };
}

/** The weight check (quality-inspection-reference.csv) and the equipment economics its scale rate is derived with (equipment-economics-reference.csv). */
export function weightCheckReference(
  quality: ReadonlyArray<Record<string, string>> = readReferenceCsv('quality-inspection-reference.csv'),
  economics: ReadonlyArray<Record<string, string>> = readReferenceCsv('equipment-economics-reference.csv'),
) {
  const q = (p: string) => referenceValue(quality, (r) => r['operation'] === 'weight_check' && r['parameter'] === p, 'quality-inspection-reference.csv');
  const e = (p: string) => referenceValue(economics, (r) => r['parameter'] === p, 'equipment-economics-reference.csv');
  return {
    timePerCheckS: q('time_per_check'), samplingInterval: q('sampling_interval'), scalePriceUsd: q('scale_price'),
    lifeYr: e('life'), maintenancePct: e('annual_maintenance_factor'), installationPct: e('installation_factor'), salvagePct: e('salvage_factor'),
    uptimePct: e('uptime'), utilization: e('utilization'), scheduledHours: e('scheduled_hours'),
  };
}
export type WeightCheckReference = ReturnType<typeof weightCheckReference>;

export interface DryingCondition { material: string; grade: string; tempC: string; timeH: string; confidence: string; source: string }
export interface DryerModel { model: string; throughputKgH: number; ratedKw: number | null; priceUsd: number | null; priceBasis: string; confidence: string; source: string }

/**
 * The drying row of a resin grade (material-drying-reference.csv), matched on the polymer and the glass fill: "Nylon, Type 11 40% Glass" is PA11 GF.
 * A polymer with no row (PA66 has none: it does not inherit PA6) is null, never another resin's conditions.
 */
export function dryingConditionFor(grade: string | null, rows: ReadonlyArray<Record<string, string>> = readReferenceCsv('material-drying-reference.csv')): DryingCondition | null {
  const g = ` ${(grade ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ')} `;
  const glass = /\bglass\b|\bgf\b|\bgf\d+|\d+% glass/.test(g);
  const polymer = /\bpa ?11\b|\bnylon(?: type)? 11\b|\btype 11\b|\bpolyamide 11\b/.test(g) ? 'PA11'
    : /\bpa ?66\b|\bnylon(?: type)? 66\b|\btype 66\b|\bnylon 6 6\b/.test(g) ? 'PA66'
      : /\bpa ?6\b|\bnylon(?: type)? 6\b|\btype 6\b|\bpolyamide 6\b/.test(g) ? 'PA6'
        : /\bpolycarbonate\b|\bpc\b/.test(g) ? 'PC'
          : /\bpbt\b|\bpolybutylene terephthalate\b/.test(g) ? 'PBT'
            : /\bpet\b|\bpolyethylene terephthalate\b/.test(g) ? 'PET'
              : /\babs\b|\bacrylonitrile butadiene styrene\b/.test(g) ? 'ABS' : null;
  if (!polymer) return null;
  const key = glass && (polymer === 'PA6' || polymer === 'PA11') ? `${polymer} GF` : polymer;
  const r = rows.find((x) => x['material'] === key);
  if (!r) return null;
  const range = (lo: string, hi: string) => (lo === hi ? lo : `${lo}-${hi}`);
  return {
    material: key, grade: r['material_grade']!, tempC: range(r['drying_temp_c_min']!, r['drying_temp_c_max']!), timeH: range(r['drying_time_h_min']!, r['drying_time_h_max']!),
    confidence: r['confidence']!, source: `reference/material-drying-reference.csv: ${r['source_name']}`,
  };
}

/** The dryer models (dryer-models-reference.csv): throughput and rated power, and the one published price. */
export function dryerModels(rows: ReadonlyArray<Record<string, string>> = readReferenceCsv('dryer-models-reference.csv')): DryerModel[] {
  const n = (s: string | undefined) => (s == null || s === '' ? null : Number(s));
  return rows.map((r) => ({
    model: r['model']!, throughputKgH: Number(r['nylon_throughput_kg_h']), ratedKw: n(r['rated_kw']), priceUsd: n(r['price_usd']), priceBasis: r['price_basis'] ?? '',
    confidence: r['confidence']!, source: `reference/dryer-models-reference.csv: ${r['source_name']}`,
  }));
}

/** The equipment economics (equipment-economics-reference.csv) for a machine-hour rate by the migration 580 pattern. */
export function equipmentEconomics(rows: ReadonlyArray<Record<string, string>> = readReferenceCsv('equipment-economics-reference.csv')) {
  const e = (p: string) => referenceValue(rows, (r) => r['parameter'] === p, 'equipment-economics-reference.csv');
  return {
    lifeYr: e('life'), maintenancePct: e('annual_maintenance_factor'), installationPct: e('installation_factor'), salvagePct: e('salvage_factor'),
    uptimePct: e('uptime'), utilization: e('utilization'), scheduledHours: e('scheduled_hours'),
  };
}

export interface SteelTreatment {
  steelGrade: string;
  deliveryCondition: string;
  /** Charged by default: only a grade the reference says is always treated. "when_specified", a certificate or "not_default" is not a default charge. */
  hardening: boolean;
  stressRelief: boolean;
  confidence: string;
  reviewRequired: boolean;
  source: string;
}

/** The heat treatment a tool steel grade gets by default (mold-steel-treatment-reference.csv), or null when the grade has no row. */
export function steelTreatment(grade: string, rows: ReadonlyArray<Record<string, string>> = readReferenceCsv('mold-steel-treatment-reference.csv')): SteelTreatment | null {
  const r = rows.find((x) => x['steel_grade'] === grade);
  if (!r) return null;
  return {
    steelGrade: r['steel_grade']!,
    deliveryCondition: r['delivery_condition']!,
    hardening: r['heat_treatment_required'] === 'true',
    stressRelief: r['stress_relief_required'] === 'true',
    confidence: r['confidence']!,
    reviewRequired: r['review_required'] === 'true',
    source: r['source_name']!,
  };
}
