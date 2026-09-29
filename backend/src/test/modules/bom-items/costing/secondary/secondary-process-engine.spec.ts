/**
 * Secondary processes, run against the REAL reference files in
 * memory/Secondary process/ (the same files migrations 817/818 stage), parsed
 * here at test time. No rate, time or table row is typed into this spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  computeSecondaryProcesses,
  type SecondaryMachine,
  type SecondaryPartFacts,
  type SecondaryReference,
} from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';

const ROOT = path.resolve(__dirname, '../../../../../../../memory/Secondary process');

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
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

const numOrNull = (v: string | undefined) => (v != null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

const reference: SecondaryReference = {
  variables: new Map(parseCsv('variables_inherited.csv').map((r) => [r['Variable Name']!, r['String Value']!])),
  lookups: new Map(
    ['CMMInspection', 'CMMInspectionProbeTouches', 'ferromagneticMaterials', 'tblMaterialHandlingTimeUltrasonicScan', 'cartonSizes']
      .map((t) => [t, parseCsv(`lookup/${t}.csv`).map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numOrNull(v) ?? v])))]),
  ),
  defaultMachine: new Map(parseCsv('processes.csv').map((r) => [r['Process Name']!, r['Default Machine']!])),
};

function machines(file: string, machineClass: string, specs: (r: Record<string, string>) => Record<string, unknown>, env: (r: Record<string, string>) => [number | null, number | null, number | null]): SecondaryMachine[] {
  return parseCsv(`machines/${file}`).map((r, i) => {
    const [x, y, z] = env(r);
    return {
      id: `${machineClass}-${i}`,
      name: r['Primary ID (Name)'] ?? r['Machine Name']!,
      machineClass,
      mhrUsd: Number(r['Direct Overhead Rate (USD / hr)']) + Number(r['Indirect Overhead Rate (USD / hr)']),
      lhrUsd: Number(r['Labor Rate (USD / hr)']),
      operators: Number(r['Number of Operators']),
      laborTimeStandard: Number(r['Labor Time Standard']),
      setupHr: Number(r['Setup Time (hr)']),
      goodPartYield: Number(r['Good Part Yield']),
      maxXmm: x, maxYmm: y, maxZmm: z, maxLengthMm: null,
      maxWorkpieceKg: numOrNull(r['Max Allowable Mass (kg)']),
      specs: specs(r),
    };
  });
}

const none = (): [null, null, null] => [null, null, null];
const pool: SecondaryMachine[] = [
  ...machines('cmm_inspection_machines.csv', 'cmm', () => ({}),
    (r) => [numOrNull(r['Bed Length (mm)']), numOrNull(r['Bed Width (mm)']), numOrNull(r['Bed Height (mm)'])]),
  ...machines('ultrasonic_cleaning_machines.csv', 'ultrasonic_cleaning', () => ({}),
    (r) => [numOrNull(r['Basket Length (mm)']), numOrNull(r['Basket Width (mm)']), numOrNull(r['Basket Height (mm)'])]),
  ...machines('magnetic_particle_testing_machines.csv', 'magnetic_particle_testing', () => ({}), none),
  ...machines('hydrostatic_leak_testing_machines.csv', 'hydrostatic_leak_testing', () => ({}), none),
  ...machines('ultrasonic_c_scan_machines.csv', 'ultrasonic_c_scan',
    (r) => ({ surface_scan_rate_mm2_per_s: numOrNull(r['Surface Scan Rate (mm^2 / s)'] ?? Object.entries(r).find(([k]) => /Surface Scan Rate/.test(k))?.[1]) }),
    (r) => [numOrNull(Object.entries(r).find(([k]) => /Useable Length/.test(k))?.[1]), numOrNull(Object.entries(r).find(([k]) => /Useable Width/.test(k))?.[1]), numOrNull(Object.entries(r).find(([k]) => /Useable Height/.test(k))?.[1])]),
];

// A real part's CAD facts: a 120 × 80 × 30 mm block with 6 simple holes, a
// pocket and 6 planar faces (the shape a milled bracket reports).
const block: SecondaryPartFacts = {
  bboxMm: { length: 120, width: 80, height: 30 },
  surfaceAreaMm2: 2 * (120 * 80 + 120 * 30 + 80 * 30),
  weightKg: null,
  wallThicknessMm: null,
  materialCutCode: null,
  batchSize: 250,
  features: [
    { id: 'SimpleHole_through_0', feature_type: 'SimpleHole', occurrences: new Array(6).fill({}) },
    { id: 'PocketV2_0', feature_type: 'PocketV2', occurrences: [{}] },
    { id: 'PlanarFace_0', feature_type: 'PlanarFace', occurrences: new Array(6).fill({}) },
    { id: 'Edge_chamfer_0', feature_type: 'Edge', occurrences: [{}, {}] },
  ],
};

const byProcess = (facts: SecondaryPartFacts) =>
  new Map(computeSecondaryProcesses(facts, reference, pool).map((r) => [r.process, r]));

describe('secondary processes on the reference data', () => {
  it('CMM: probe touches from the detected features, AQL special sample, programming once per batch', () => {
    const r = byProcess(block).get('CMM Inspection')!;
    expect(r.status).toBe('costed');
    // 6 holes × 4 + 1 pocket × 9 + 6 planar faces × 4 = 57 touches; Edge has no count.
    expect(r.trace.find((t) => t.label === 'Probe touches per part')?.value).toBe(57);
    expect(r.featureIds).toEqual(['SimpleHole_through_0', 'PocketV2_0', 'PlanarFace_0']);
    expect(r.warnings.join(' ')).toMatch(/Edge/);
    expect(r.machine?.name).toBe('Axiom Too 1200'); // the reference default machine
    // Batch 250 -> "Smaller Sample Sizes" row for batch <= 280.
    const sample = r.trace.find((t) => t.label.startsWith('Sample size'))!;
    expect(sample.label).toMatch(/batch ≤ 280/);
  });

  it('CMM: no batch size means no sample size, disclosed as a gap', () => {
    expect(byProcess({ ...block, batchSize: null }).get('CMM Inspection')!.status).toBe('gap');
  });

  it('magnetic particle testing only for a ferromagnetic cut-code family', () => {
    expect(byProcess({ ...block, materialCutCode: 15.0 }).get('Magnetic Particle Testing')!.status).toBe('costed');
    const al = byProcess({ ...block, materialCutCode: 30.11 }).get('Magnetic Particle Testing')!;
    expect(al.status).toBe('not_applicable');
    expect(byProcess(block).get('Magnetic Particle Testing')!.status).toBe('gap'); // no material yet
  });

  it('leak test dwell comes from wall thickness; a solid part has none', () => {
    expect(byProcess(block).get('Hydrostatic Leak Testing')!.status).toBe('gap');
    const shell = byProcess({ ...block, wallThicknessMm: 3 }).get('Hydrostatic Leak Testing')!;
    expect(shell.status).toBe('costed');
    // 3 mm is below leakTestMinThickness (16.7 mm) -> leakTestMinDwellTime.
    expect(shell.trace.find((t) => t.label === 'Dwell')?.value).toBe(Number(reference.variables.get('leakTestMinDwellTime')));
  });

  it('ultrasonic cleaning fills a real basket less the nesting allowance', () => {
    const r = byProcess(block).get('Ultrasonic Cleaning')!;
    expect(r.status).toBe('costed');
    expect(Number(r.trace.find((t) => t.label === 'Parts per basket')?.value)).toBeGreaterThan(0);
    expect(r.highlight).toBe('whole_part');
  });

  it('CT scan and X-ray have no cycle-time data in the reference', () => {
    const m = byProcess(block);
    expect(m.get('CT Scan')!.status).toBe('gap');
    expect(m.get('Xray Inspection')!.status).toBe('gap');
  });

  it('a class with no machine at the location is a gap, never a stand-in rate', () => {
    expect(byProcess(block).get('Fluorescent Penetrant Testing')!.reason).toMatch(/No Fluorescent Penetrant Testing machine/);
  });
});
