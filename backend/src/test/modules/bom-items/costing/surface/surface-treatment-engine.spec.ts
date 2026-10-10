/**
 * Surface treatment, run against the REAL reference files in
 * memory/SurfaceTreatment/ (the files migrations 819/820 stage), parsed at
 * test time. No rate, time or table row is typed into this spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { partsPerLoad, type SecondaryMachine, type SecondaryPartFacts, type SecondaryReference } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';
import { computeSurfaceTreatments, anodizeTypeFromCallout, SURFACE_MODELED_PROCESSES, SURFACE_PROCESSES } from '../../../../../modules/bom-items/costing/surface/surface-treatment-engine';

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
  ...machines('passivation_machines.csv', 'Passivation', [null, null, null]),
  ...machines('wet_coat_line_machines.csv', 'Wet Coat Line', [null, null, null]),
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

  it('anodize without a type on the drawing is a gap naming the missing type', () => {
    const r = byProcess().get('Anodize')!;
    expect(r.status).toBe('gap');
    expect(r.reason).toMatch(/anodizing type/);
  });

  it('laser engraving needs the material type before it can check compatibility', () => {
    expect(byProcess().get('Laser Engraving')!.status).toBe('gap');
  });
});

// Phase 9: the batch-load processes, on the real memory/ machine rows.
// Expected values are worked by hand from those rows, not from the engine.
const one = (part: SecondaryPartFacts, process: string) => {
  const r = computeSurfaceTreatments(part, reference, pool).find((x) => x.process === process);
  if (!r) throw new Error(`${process} is not a surface process`);
  return r;
};
const step = (r: ReturnType<typeof one>, label: string) => r.trace.find((t) => t.label === label)?.value;
const block: SecondaryPartFacts = { ...plate, bboxMm: { length: 100, width: 50, height: 20 }, surfaceAreaMm2: 2 * (100 * 50 + 100 * 20 + 50 * 20) };

describe('partsPerLoad', () => {
  it('spaces each part by factor x its size and packs the best orientation', () => {
    // 100x50x20 at factor 0.5 -> 150x75x30 in 457.2 x 304.8 x 254: 3 x 4 x 8 = 96
    expect(partsPerLoad({ partMm: [100, 50, 20], windowMm: [457.2, 304.8, 254], spacingFactor: 0.5 })).toEqual({ count: 96, governedBy: 'window' });
  });
  it('the weight limit and the surface-area limit cap the count, and say so', () => {
    expect(partsPerLoad({ partMm: [100, 50, 20], windowMm: [457.2, 304.8, 254], spacingFactor: 0.5, partKg: 20, weightLimitKg: 1000 }))
      .toEqual({ count: 50, governedBy: 'weight' });
    expect(partsPerLoad({ partMm: [200, 100, 2], windowMm: [1219, 1219, 914], spacingFactor: 0.5, partAreaM2: 0.04, areaLimitM2: 28 }))
      .toEqual({ count: 700, governedBy: 'surface area' });
  });
  it('a loadbar with no depth hangs one layer; a part bigger than the window fits 0', () => {
    expect(partsPerLoad({ partMm: [200, 100, 2], windowMm: [7620, 3505.2, null], spacingFactor: 0.5 }).count).toBe(25 * 23);
    expect(partsPerLoad({ partMm: [600, 50, 20], windowMm: [457.2, 304.8, 254], spacingFactor: 0.5 }).count).toBe(0);
  });
});

describe('passivation (passivationTreatments + tank window)', () => {
  const stainless: SecondaryPartFacts = { ...block, materialCutCode: 15.11, isMachined: false };
  it('uses the shortest listed treatment and loads the default tank', () => {
    const r = one(stainless, 'Passivation');
    expect(r.status).toBe('costed');
    expect(r.machine?.name).toBe('Best Technology 188P'); // surface_treatment_processes.csv default
    expect(step(r, 'Immersion time')).toBe(25);           // hot bath; the 60 min cold bath is shown
    expect(step(r, 'Parts per tank load')).toBe(96);
    expect(step(r, 'Tank loads')).toBe(2);                 // ceil(100 / 96)
    expect(r.warnings.join(' ')).toMatch(/60 min/);
  });
  it('a machined part takes the machined treatment', () => {
    expect(step(one({ ...stainless, isMachined: true }, 'Passivation'), 'Immersion time')).toBe(23);
  });
  it('a material with no passivation treatment is not applicable, a missing cut code is a gap', () => {
    expect(one({ ...stainless, materialCutCode: 1.1 }, 'Passivation').status).toBe('not_applicable');
    expect(one({ ...stainless, materialCutCode: null }, 'Passivation').status).toBe('gap');
  });
});

describe('anodize (one loadbar per Load Window Time)', () => {
  const typeII: SecondaryPartFacts = { ...plate, surfaceCallout: 'Anodize per MIL-A-8625 Type II, Class 2' };
  it('runs on a line of the drawing type; a big loadbar is capped by its surface area', () => {
    const r = one(typeII, 'Anodize');
    expect(r.status).toBe('costed');
    expect(r.machine?.name).toMatch(/^Type II Line/);
    const line = parseCsv('Machine/anodizing_machines.csv').find((m) => m.Name === r.machine?.name);
    const cap = Number(line?.['Loadbar Max Load Surface Area (m^2)']);
    expect(step(r, 'Parts per loadbar')).toBe(Math.floor(cap / 0.04)); // 200x100 plate, both faces = 0.04 m²
  });
  it('a small batch is charged the line minimum batch cost', () => {
    const r = one({ ...typeII, batchSize: 1 }, 'Anodize');
    expect(r.costPerPartUsd).toBe(250); // Min Batch Cost (USD) on every line
  });
  it('reads every reference type name from a callout', () => {
    expect(['type I', 'TYPE IB', 'Type IC', 'type 2', 'Type III'].map(anodizeTypeFromCallout))
      .toEqual(['Type I', 'Type IB', 'Type IC', 'Type II', 'Type III']);
    expect(anodizeTypeFromCallout('Anodize clear')).toBeNull();
  });
});

describe('wet coat line (one loadbar per Load Window Time + paint)', () => {
  it('times the part on the default line and prices the paint from coverage', () => {
    const r = one(plate, 'Wet Coat Line');
    expect(r.status).toBe('costed');
    expect(r.machine?.name).toBe('WetCoatLine01');
    expect(step(r, 'Parts per loadbar')).toBe(575);                   // 300x150 spaced, one layer, in 7620 x 3505.2
    expect(r.cycleTimeSec).toBeCloseTo((0.25 * 3600) / 575, 3);       // 0.25 h window, yield 1
    expect(r.materialUsdPerPart).toBeCloseTo((0.04 / 7.36) * 10.04, 4); // area / coverage x USD per L
  });
});

describe('performance', () => {
  it('costs every surface process for a part well inside the request budget', () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) computeSurfaceTreatments({ ...block, materialCutCode: 15.11, isMachined: false, surfaceCallout: 'Type II' }, reference, pool);
    expect((performance.now() - t0) / 100).toBeLessThan(20); // ms per part
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

  it('marks modeled exactly the processes the engine costs (821, then 898 on top)', () => {
    const sql898 = fs.readFileSync(path.resolve(__dirname, '../../../../../../migrations/898_surface_treatment_batch_load_processes.sql'), 'utf-8');
    const block898 = sql898.slice(sql898.indexOf('WITH ref'), sql898.indexOf('UPDATE process_taxonomy'));
    const now898 = new Map([...block898.matchAll(/\(\$str\$([^$]+)\$str\$, \$str\$([^$]+)\$str\$, (true|false)\)/g)].map((m) => [m[1], m[3] === 'true']));
    const modeled = rows.map((r) => ({ ...r, modeled: now898.get(r.process) ?? r.modeled }));
    expect(new Set(modeled.filter((r) => r.modeled).map((r) => r.process))).toEqual(SURFACE_MODELED_PROCESSES);
  });
});
