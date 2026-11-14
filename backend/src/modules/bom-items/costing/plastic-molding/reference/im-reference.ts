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
