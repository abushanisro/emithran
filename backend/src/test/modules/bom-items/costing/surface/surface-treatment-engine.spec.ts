/**
 * Surface treatment, run against the REAL reference files in
 * memory/SurfaceTreatment/ (the files migrations 819/820 stage), parsed at
 * test time. No rate, time or table row is typed into this spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeSurfaceTreatments, SURFACE_MODELED_PROCESSES, SURFACE_PROCESSES } from '../../../../../modules/bom-items/costing/surface/surface-treatment-engine';
import type { SecondaryMachine, SecondaryPartFacts, SecondaryReference } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';

const ROOT = path.resolve(__dirname, '../../../../../../../memory/SurfaceTreatment');

function parseCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
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
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const val = (v: string | undefined): unknown => {
  if (v == null || v.trim() === '') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return Number.isFinite(Number(v)) ? Number(v) : v;
};
// Same key rule as gen_820 (specKey).
const specKey = (col: string) => col
  .replace(/\(([^)]*)\)/g, (_, u: string) => ' ' + u.replace(/\^2/g, '2').replace(/\^3/g, '3').replace(/\s*\/\s*/g, ' per ').replace(/%/g, 'pct').replace(/µ/g, 'u'))
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const reference: SecondaryReference = {
  variables: new Map(parseCsv('surface_treatment_variables.csv').map((r) => [r['Variable Name']!, r['String Value']!])),
  lookups: new Map(fs.readdirSync(path.join(ROOT, 'lookup')).filter((f) => f.endsWith('.csv'))
    .map((f) => [f.replace(/\.csv$/, ''), parseCsv(`lookup/${f}`).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, val(v)])))])),
  defaultMachine: new Map(parseCsv('surface_treatment_processes.csv').map((r) => [r['Process Name']!, r['Default Machine']!])),
};

function machines(file: string, process: string, env: [string | null, string | null, string | null]): SecondaryMachine[] {
  return parseCsv(`Machine/${file}`).map((r, i) => ({
    id: `${process}-${i}`,
    name: r['Name']!,
    machineClass: 'surface_' + process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    mhrUsd: Number(r['Direct Overhead Rate (USD / hr)']) + Number(r['Indirect Overhead Rate (USD / hr)']),
    lhrUsd: Number(r['Labor Rate (USD / hr)']),
    operators: Number(r['Number of Operators']),
    laborTimeStandard: Number(r['Labor Time Standard']),
    setupHr: Number(r['Setup Time (hr)']),
    goodPartYield: Number(r['Good Part Yield']),
    maxXmm: env[0] ? (val(r[env[0]]) as number) : null,
    maxYmm: env[1] ? (val(r[env[1]]) as number) : null,
    maxZmm: env[2] ? (val(r[env[2]]) as number) : null,
    maxLengthMm: null,
    maxWorkpieceKg: null,
    specs: Object.fromEntries(Object.entries(r).map(([k, v]) => [specKey(k), val(v)])),
  }));
}

const pool: SecondaryMachine[] = [
  ...machines('zinc_plating_machines.csv', 'Zinc Plating', [null, null, null]).filter((m) => m.name === 'Default Zinc Plating'),
  ...machines('dot_peen_machines.csv', 'Dot Peen', [null, null, null]),
  ...machines('conveyor_shot_blast_machines.csv', 'Conveyor Shot Blast', [null, 'Opening Width (mm)', 'Max Nesting Height (mm)']),
  ...machines('anodizing_machines.csv', 'Anodize', ['Loadbar Window Length (mm)', 'Loadbar Window Width (mm)', 'Loadbar Window Height (mm)']),
];

const plate: SecondaryPartFacts = {
  bboxMm: { length: 200, width: 100, height: 2 },
  surfaceAreaMm2: 2 * 200 * 100,
  weightKg: null,
  wallThicknessMm: 2,
  materialCutCode: null,
  materialTypeName: null,
  features: [],
  batchSize: 100,
};
const byProcess = () => new Map(computeSurfaceTreatments(plate, reference, pool).map((r) => [r.process, r]));
const v = (k: string) => Number(reference.variables.get(k));

describe('surface treatment on the reference data', () => {
  it('zinc plating is a per-area price from the plating line', () => {
    const r = byProcess().get('Zinc Plating')!;
    expect(r.status).toBe('costed');
    expect(r.cycleTimeSec).toBeNull();
    const perM2 = Number(parseCsv('Machine/zinc_plating_machines.csv').find((m) => m['Name'] === 'Default Zinc Plating')!['Application Cost Per Area (USD / m^2)']);
    const areaM2 = (plate.surfaceAreaMm2! / 1e6) * (v('defaultPercentageOfSurfaceAreaElectroplated') / 100);
    expect(r.costPerPartUsd).toBeCloseTo(areaM2 * perM2, 3);
  });

  it('dot peen time is characters x time per character', () => {
    const r = byProcess().get('Dot Peen')!;
    expect(r.status).toBe('costed');
    expect(r.trace.find((t) => t.label === 'Characters')?.value).toBe(v('dotPeenDefaultCharacters'));
  });

  it('conveyor shot blast uses the reference line speed and spacing rule', () => {
    const r = byProcess().get('Conveyor Shot Blast')!;
    expect(r.status).toBe('costed');
    const spacing = Math.min(v('conveyorMaxPartSpacing'), Math.max(v('conveyorMinPartSpacing'), 200 * v('conveyorPartSpacingFactor')));
    expect(r.trace.find((t) => t.label === 'Part spacing')?.value).toBe(spacing);
  });

  it('anodize is a disclosed gap: the anodizing duration has no reference rule', () => {
    const r = byProcess().get('Anodize')!;
    expect(r.status).toBe('gap');
    expect(r.reason).toMatch(/anodizing duration/);
  });

  it('laser engraving needs the material type before it can check compatibility', () => {
    expect(byProcess().get('Laser Engraving')!.status).toBe('gap');
  });
});

describe('migration 821 matches the engine', () => {
  // The catalog marks production exactly the processes the engine can cost.
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../../../../migrations/821_surface_treatment_catalog_on_reference_engine.sql'), 'utf-8');
  const block = sql.slice(sql.indexOf('WITH ref'), sql.indexOf('UPDATE process_taxonomy'));
  const rows = [...block.matchAll(/\(\$str\$([^$]+)\$str\$, \$str\$([^$]+)\$str\$, (true|false)\)/g)]
    .map((m) => ({ process: m[1]!, cls: m[2]!, modeled: m[3] === 'true' }));

  it('lists every reference process with its engine machine class', () => {
    expect(rows.map((r) => [r.process, r.cls]).sort()).toEqual(SURFACE_PROCESSES.map((p) => [p.process, p.machineClass]).sort());
  });

  it('marks modeled exactly the processes the engine costs', () => {
    expect(new Set(rows.filter((r) => r.modeled).map((r) => r.process))).toEqual(SURFACE_MODELED_PROCESSES);
  });
});
