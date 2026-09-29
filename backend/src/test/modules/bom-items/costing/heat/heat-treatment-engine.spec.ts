/**
 * Heat treatment on the REAL reference files in memory/Heat treatment (the
 * files migrations 823/826 stage), parsed at test time. No rate, time or table
 * row is typed into this spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  computeHeatTreatments, matchHeatTreatmentCallout, caseDepthFromCallout, HEAT_TREATMENT_SOURCE_VERSION,
  type HeatTreatmentFacts,
} from '../../../../../modules/bom-items/costing/heat/heat-treatment-engine';
import type { SecondaryMachine, SecondaryReference } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';
import { MEMORY_DOMAINS } from '../../../../../modules/processes/reference-domains';

const ROOT = path.resolve(__dirname, '../../../../../../../memory/Heat treatment');

function parseCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const val = (v: string | undefined): unknown => (v == null || v.trim() === '' ? null : v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v);
// Same key rule as scripts/lib/memory-machine-seed.js (specKey).
const specKey = (col: string) => col
  .replace(/\(([^)]*)\)/g, (_, u: string) => ' ' + u.replace(/\^2/g, '2').replace(/\^3/g, '3').replace(/\s*\/\s*/g, ' per ').replace(/%/g, 'pct').replace(/µ/g, 'u'))
  .replace(/\+/g, ' plus ')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const classOf = (p: string) => 'heat_treat_' + p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const reference: SecondaryReference = {
  variables: new Map(parseCsv('heat_treatment_variables.csv').map((r) => [r['Variable Name']!, r['String Value']!])),
  lookups: new Map(fs.readdirSync(path.join(ROOT, 'Lookup')).map((f) => [f.replace(/\.csv$/, ''),
    parseCsv(`Lookup/${f}`).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, val(v)])))])),
  defaultMachine: new Map(parseCsv('processes.csv').map((r) => [r['Process Name']!, r['Default Machine']!])),
};
const machines: SecondaryMachine[] = fs.readdirSync(path.join(ROOT, 'Machine')).flatMap((f) => parseCsv(`Machine/${f}`).map((r, i) => ({
  id: `${f}-${i}`,
  name: r['Name'] || r['Machine Name']!,
  machineClass: classOf(r['Process Name']!),
  mhrUsd: Number(r['Direct Overhead Rate (USD / hr)']) + Number(r['Indirect Overhead Rate (USD / hr)']),
  lhrUsd: Number(r['Labor Rate (USD / hr)']),
  operators: Number(r['Number of Operators']),
  laborTimeStandard: Number(r['Labor Time Standard']),
  setupHr: Number(r['Setup Time (hr)']),
  goodPartYield: Number(r['Good Part Yield']),
  maxXmm: val(r['Internal Length (mm)'] ?? r['Hot Zone Length (mm)']) as number | null,
  maxYmm: val(r['Internal Width (mm)'] ?? r['Hot Zone Diameter (mm)']) as number | null,
  maxZmm: val(r['Internal Height (mm)'] ?? r['Hot Zone Diameter (mm)']) as number | null,
  maxLengthMm: null, maxWorkpieceKg: null,
  specs: Object.fromEntries(Object.entries(r).map(([k, v]) => [specKey(k), val(v)])),
})));

const steelPart: HeatTreatmentFacts = {
  bboxMm: { length: 120, width: 60, height: 20 }, surfaceAreaMm2: 21_000, weightKg: 1.13, wallThicknessMm: null,
  materialCutCode: 1.1, materialTypeName: 'Steel', features: [], batchSize: 100, caseDepthMm: 0.7, volumeMm3: 144_000,
};
const run = (p: HeatTreatmentFacts) => new Map(computeHeatTreatments(p, reference, machines).map((r) => [r.process, r]));

describe('heat treatment on the reference data', () => {
  it('manifest version is the engine version', () => {
    expect(MEMORY_DOMAINS.find((d) => d.key === 'heat_treatment')?.sourceVersion).toBe(HEAT_TREATMENT_SOURCE_VERSION);
  });

  it('carburize: carburizable cut code, case-depth multiplier, priced by weight plus handling', () => {
    const r = run(steelPart).get('Carburize')!;
    expect(r.status).toBe('costed');
    expect(r.trace.find((t) => t.label === 'Case depth multiplier')?.value).toBe(1.25); // 0.7 mm <= 0.79 mm row
    expect(r.materialUsdPerPart).toBeGreaterThan(0);
  });

  it('carburize is not applicable to a cut code the reference does not list', () => {
    expect(run({ ...steelPart, materialCutCode: 30.11 }).get('Carburize')!.status).toBe('not_applicable');
  });

  it('carburize without a stated case depth is a gap, not a default depth', () => {
    expect(run({ ...steelPart, caseDepthMm: null }).get('Carburize')!.status).toBe('gap');
  });

  it('straightening uses the small-part rate for a part under smallPartsWeightLimit', () => {
    const r = run(steelPart).get('Straighten')!;
    expect(r.trace[0]!.label).toMatch(/small/);
  });

  it('HIP cycle from the material hold temperature and the reference averages', () => {
    const r = run(steelPart).get('Hot Isostatic Pressing')!;
    expect(r.status).toBe('costed');
    expect(r.trace.find((t) => t.label === 'Hold temperature')?.value).toBe(1163);
  });

  it('processes with no reference machine are disclosed gaps', () => {
    for (const p of ['Induction Harden', 'Stress Relief']) expect(run(steelPart).get(p)!.status).toBe('gap');
  });

  it('reads the process and case depth from a drawing callout', () => {
    expect(matchHeatTreatmentCallout('Carburize and harden, case depth 0.8 mm')).toBe('Carburize');
    expect(matchHeatTreatmentCallout('Vacuum air harden with high temper')).toBe('Vacuum Air Harden with High Temper');
    expect(caseDepthFromCallout('Carburize, case depth 0.8 mm')).toBe(0.8);
    expect(caseDepthFromCallout('Stress relieve')).toBeNull();
  });
});
