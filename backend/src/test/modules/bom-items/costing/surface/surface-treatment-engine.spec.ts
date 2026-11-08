/**
 * Surface treatment, run against the REAL reference files in
 * memory/SurfaceTreatment/ (the files migrations 819/820 stage), parsed at
 * test time. No rate, time or table row is typed into this spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { maxPartsInBox, partsPerLoad, type SecondaryMachine, type SecondaryPartFacts, type SecondaryReference } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';
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
    mhrUsd: Number(r['Direct Overhead Rate (USD / hr)'] ?? r['Direct Overhead Rate (USD/hr)']) + Number(r['Indirect Overhead Rate (USD / hr)'] ?? r['Indirect Overhead Rate (USD/hr)']),
    lhrUsd: Number(r['Labor Rate (USD / hr)'] ?? r['Labor Rate (USD/hr)']),
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

  it('anodize without a type on the drawing assumes Type II and says so (provisional)', () => {
    const r = byProcess().get('Anodize')!;
    expect(r.status).toBe('costed');
    expect(r.provisional).toBe(true);
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
    // The fastest of several batches: a busy machine (200 suites in parallel) slows some batches, never the best one.
    const perPart = Array.from({ length: 5 }, () => {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) computeSurfaceTreatments({ ...block, materialCutCode: 15.11, isMachined: false, surfaceCallout: 'Type II' }, reference, pool);
      return (performance.now() - t0) / 20;
    });
    expect(Math.min(...perPart)).toBeLessThan(process.platform === 'win32' ? 50 : 20); // ms per part
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

  it('marks modeled exactly the processes the engine costs (821, then 898, 979, 980, 982 and 983 on top)', () => {
    const later = ['898_surface_treatment_batch_load_processes.sql', '979_surface_treatment_provisional_processes.sql', '980_surface_treatment_powder_coating.sql', '982_surface_treatment_mask_and_screen.sql', '983_surface_treatment_mask_spray.sql'].flatMap((f) => {
      const text = fs.readFileSync(path.resolve(__dirname, '../../../../../../migrations/' + f), 'utf-8');
      const block = text.slice(text.indexOf('WITH ref'), text.indexOf('UPDATE process_taxonomy'));
      return [...block.matchAll(/\(\$str\$([^$]+)\$str\$, \$str\$([^$]+)\$str\$, (true|false)\)/g)].map((m) => [m[1], m[3] === 'true'] as [string, boolean]);
    });
    const now898 = new Map(later);
    const modeled = rows.map((r) => ({ ...r, modeled: now898.get(r.process) ?? r.modeled }));
    expect(new Set(modeled.filter((r) => r.modeled).map((r) => r.process))).toEqual(SURFACE_MODELED_PROCESSES);
  });
});

// The six provisional models (migration 979): machines and variables from memory/, one rule or published figure each.
// Every expected number is worked by hand from those rows and the figure in provisional-reference.ts.
describe('provisional surface models', () => {
  const provPool: SecondaryMachine[] = [
    ...machines('oven_cure_machines.csv', 'Oven Cure', [null, null, null]),
    ...machines('conveyor_oven_cure_machines.csv', 'Conveyor Oven Cure', [null, null, null]),
    ...machines('black_oxide_machines.csv', 'Black Oxide', [null, null, null]),
    ...machines('vibratory_finishing_machines.csv', 'Vibratory Finishing', [null, null, null]),
    ...machines('shot_blast_machines.csv', 'Shot Blast', [null, null, null]),
    ...machines('degrease_machines.csv', 'Degrease', [null, null, null]),
    ...machines('powder_coat_cart_machines.csv', 'Powder Coat Cart', [null, null, null]),
    ...machines('conveyor_powder_coating_machines.csv', 'Conveyor Powder Coating', [null, null, null]),
    ...machines('screen_printing_machines.csv', 'Screen Printing', [null, null, null]),
    ...machines('mask_bench_machine.csv', 'Mask-Bench', [null, null, null]),
    ...machines('mask_spray_machines.csv', 'Mask-Spray', [null, null, null]),
    ...machines('anodizing_machines.csv', 'Anodize', ['Loadbar Window Length (mm)', 'Loadbar Window Width (mm)', 'Loadbar Window Height (mm)']),
  ];
  const block: SecondaryPartFacts = { bboxMm: { length: 200, width: 100, height: 50 }, surfaceAreaMm2: 60000, weightKg: 1, wallThicknessMm: 5, materialCutCode: null, materialTypeName: null, features: [], batchSize: 100 };
  const run = (process: string, part = block) => computeSurfaceTreatments(part, reference, provPool).find((r) => r.process === process)!;
  const step = (r: ReturnType<typeof run>, label: string) => r.trace.find((t) => t.label === label)!;

  it('every line is flagged provisional and its warning names the figure and its published range', () => {
    for (const p of ['Oven Cure', 'Conveyor Oven Cure', 'Black Oxide', 'Vibratory Finishing', 'Shot Blast', 'Degrease', 'Powder Coat Cart', 'Conveyor Powder Coating']) {
      const r = run(p);
      expect(r.status).toBe('costed');
      expect(r.provisional).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/Provisional/);
      expect([p, r.costPerPartUsd]).toEqual([p, expect.any(Number)]); expect(r.costPerPartUsd).toBeGreaterThan(0);
    }
    // the reason (the tooltip of the option) says the price is an estimate, and names the figure
    expect(run('Oven Cure').reason).toMatch(/^Provisional estimate, not reference data: Provisional: the cure dwell/);
    expect(run('Shot Blast').reason).toMatch(/allowances are not applied/);
    expect(run('Oven Cure').warnings.join(' ')).toMatch(/published range 10-45 min/);
    expect(run('Black Oxide').warnings.join(' ')).toMatch(/published range 5-60 min/);
  });

  it('a reference-defined process (Zinc Plating) is never flagged provisional', () => {
    const zinc = computeSurfaceTreatments(block, reference, pool).find((r) => r.process === 'Zinc Plating')!;
    expect(zinc.provisional).toBeUndefined();
    expect(zinc.reason).not.toMatch(/Provisional/);
  });

  it('oven cure: parts per load from the oven and the powder-coat spacing factor, one dwell per load', () => {
    const r = run('Oven Cure');
    // part 200x100x50 + 50 % on each size = 300x150x75 in the oven's own box
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    expect(step(r, 'Parts per oven load').value).toBe(maxPartsInBox([300, 150, 75], [m.specs.oven_length_mm, m.specs.oven_width_mm, m.specs.oven_height_mm].map(Number).sort((a, b) => b - a) as [number, number, number]));
    expect(step(r, 'Oven loads').value).toBe(1);
    expect(step(r, 'Cure dwell per load').value).toBe(15);
    // 1 load x 15 min over 100 parts = 9 s a part before the reference cycle adjustment, efficiency and yield
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(r.cycleTimeSec! * r.machine!.goodPartYield * eff / adj).toBeCloseTo(9, 1);
  });

  it('conveyor oven cure: the part must spend the dwell in the oven, so speed = oven length / dwell and pitch / speed is the cycle', () => {
    const r = run('Conveyor Oven Cure');
    const len = Number(provPool.find((m) => m.name === r.machine!.name)!.specs.oven_length_mm);
    const speed = len / (15 * 60);
    expect(step(r, 'Line speed').value).toBeCloseTo(speed, 2);
    const pitch = 200 + Math.min(v('conveyorMaxPartSpacing'), Math.max(v('conveyorMinPartSpacing'), 200 * v('conveyorPartSpacingFactor')));
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(r.cycleTimeSec! * r.machine!.goodPartYield * eff / adj).toBeCloseTo(pitch / speed, 1);
  });

  it('black oxide: stage times from memory/ plus the provisional immersion, transfers of every stage, per bath load', () => {
    const r = run('Black Oxide');
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    const stages = v('defaultNumberOfBlackOxideStages');
    const loadSec = v('defaultBlackOxidePartCleanTime') + v('defaultPreBlackOxideRinse') + 15 * 60 + v('defaultPostBlackOxideRinseTime') + v('defaultBlackOxideSupplementaryFinishTime') + Number(m.specs.transfer_time_s) * stages;
    const n = Number(step(r, 'Parts per bath load').value);
    expect(n).toBeGreaterThan(1);
    const loads = Math.ceil(100 / n);
    expect(step(r, 'Bath loads').value).toBe(loads);
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(r.cycleTimeSec! * r.machine!.goodPartYield * eff / adj).toBeCloseTo((loads * loadSec) / 100, 1);
    expect(r.warnings.join(' ')).toMatch(/steel/);
  });

  it('black oxide: a part over the bath weight limit takes fewer per load, never more than the bath holds', () => {
    const light = Number(step(run('Black Oxide'), 'Parts per bath load').value);
    const heavy = Number(step(run('Black Oxide', { ...block, weightKg: 100 }), 'Parts per bath load').value);
    expect(heavy).toBeLessThan(light);
    expect(heavy).toBeLessThanOrEqual(5);   // 500 kg limit / 100 kg
  });

  it('vibratory finishing: container volume x fill over the part and its media (ratio), the part taken as its bounding box', () => {
    const r = run('Vibratory Finishing');
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    const expected = Math.min(
      Math.floor((Number(m.specs.container_volume_mm3) * v('vibratoryFinishingContainerFillPercent') / 100) / (200 * 100 * 50 * (1 + v('defaultVibratoryFinishingMediaRatio')))),
      Math.floor(Number(m.specs.weight_limit_kg) / 1),
    );
    expect(step(r, 'Parts per container load').value).toBe(expected);
    expect(r.warnings.join(' ')).toMatch(/bounding box/);
  });

  it('shot blast: the machine\'s cycle per hanger load, parts per load by hangers, chamber and weight; allowances are disclosed as not applied', () => {
    const r = run('Shot Blast');
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    expect(step(r, 'Parts per hanger load').value).toBe(Number(m.specs.number_hanger_positions));
    expect(step(r, 'Blast cycle').value).toBe(Number(m.specs.blast_cycle_time_s));
    expect(r.warnings.join(' ')).toMatch(/allowances are not applied/);
    // 100 kg parts against a 2000 kg capacity: 20 would fit, the hangers (2) still govern
    expect(step(run('Shot Blast', { ...block, weightKg: 1500 }), 'Parts per hanger load').value).toBe(1);
  });

  it('degrease: conveyor pitch over the washer\'s speed limit; a part wider than the window is a gap, not a price', () => {
    const r = run('Degrease');
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    expect(step(r, 'Line speed').value).toBe(Number(m.specs.conveyor_speed_limit_mm_per_s));
    const wide = run('Degrease', { ...block, bboxMm: { length: 700, width: 700, height: 50 } });
    // 700 x 700 is wider than most washer windows but one on file takes it (it is priced, on that washer); a part no window takes is a gap
    const none = run('Degrease', { ...block, bboxMm: { length: 700, width: 1500, height: 1500 } });
    expect(none.status).toBe('gap');
    expect(none.costPerPartUsd).toBeNull();
    expect(wide.status).toBe('costed');
  });

  it('powder spray: grams = area x thickness x specific gravity / transfer efficiency, time = grams / gun flow; the cart adds load and unload by weight', () => {
    const area = 60000 / 1e6 * v('defaultFractionOfSurfaceAreaPowderCoated');
    const grams = (area * 75 * 1.5) / v('powderCoatSprayEfficiency');
    for (const p of ['Powder Coat Cart', 'Conveyor Powder Coating']) {
      const r = run(p);
      expect(step(r, 'Powder sprayed').value).toBeCloseTo(grams, 1);
      expect(step(r, 'Film thickness').value).toBe(75);
      expect(r.warnings.join(' ')).toMatch(/published range 50-100 µm/);
    }
    const sprayS = (grams / v('defaultPowderCoatingTopCoatFlowRate')) * 60;
    const handling = parseCsv('lookup/powderCoatHandling.csv').map((x) => ({ kg: Number(x['Weight (kg)']), t: Number(x['Load Time (s)']) + Number(x['Unload Time (s)']) })).sort((a, b) => a.kg - b.kg).find((x) => 1 <= x.kg)!.t;
    const cart = run('Powder Coat Cart');
    expect(step(cart, 'Load and unload').value).toBe(handling);
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(cart.cycleTimeSec! * cart.machine!.goodPartYield * eff / adj).toBeCloseTo(sprayS + handling, 1);
    const conv = run('Conveyor Powder Coating');
    expect(conv.cycleTimeSec! * conv.machine!.goodPartYield * eff / adj).toBeCloseTo(sprayS, 1);
  });

  it('missing data stays a named gap: no batch size, no part size', () => {
    for (const p of ['Oven Cure', 'Black Oxide', 'Vibratory Finishing', 'Shot Blast']) {
      expect(run(p, { ...block, batchSize: null }).status).toBe('gap');
      expect(run(p, { ...block, bboxMm: null }).status).toBe('gap');
    }
  });
});

describe('provisional surface models without a machine to price on', () => {
  it('an empty pool is a gap that says no machine has a complete rate (not that the part does not fit); black oxide rows have a blank labor rate in memory/', () => {
    const block2: SecondaryPartFacts = { bboxMm: { length: 100, width: 50, height: 20 }, surfaceAreaMm2: 9000, weightKg: 0.1, wallThicknessMm: 2, materialCutCode: null, materialTypeName: null, features: [], batchSize: 100 };
    for (const r of computeSurfaceTreatments(block2, reference, []).filter((x) => ['Oven Cure', 'Conveyor Oven Cure', 'Black Oxide', 'Vibratory Finishing', 'Shot Blast', 'Degrease', 'Powder Coat Cart', 'Conveyor Powder Coating'].includes(x.process))) {
      expect(r.status).toBe('gap');
      expect(r.reason).toMatch(/complete rate is on file/);
    }
    expect(parseCsv('Machine/black_oxide_machines.csv').every((m) => m['Labor Rate (USD / hr)'] === '' && m['Wage Grade Name'] === '')).toBe(true);
  });
});

describe('provisional rules for what the drawing does not state', () => {
  const part: SecondaryPartFacts = { bboxMm: { length: 200, width: 100, height: 50 }, surfaceAreaMm2: 60000, weightKg: 1, wallThicknessMm: 5, materialCutCode: null, materialTypeName: null, features: [], batchSize: 100 };
  const provPool: SecondaryMachine[] = [
    ...machines('screen_printing_machines.csv', 'Screen Printing', [null, null, null]),
    ...machines('mask_bench_machine.csv', 'Mask-Bench', [null, null, null]),
    ...machines('mask_spray_machines.csv', 'Mask-Spray', [null, null, null]),
    ...machines('anodizing_machines.csv', 'Anodize', ['Loadbar Window Length (mm)', 'Loadbar Window Width (mm)', 'Loadbar Window Height (mm)']),
  ];
  const run = (process: string, p = part) => computeSurfaceTreatments(p, reference, provPool).find((r) => r.process === process)!;

  it('anodize with no type on the drawing assumes Type II, flagged provisional; a stated type is reference-priced', () => {
    const a = run('Anodize');
    expect(a.status).toBe('costed');
    expect(a.provisional).toBe(true);
    expect(a.trace.find((t) => t.label === 'Anodizing type')?.value).toBe('Type II');
    expect(a.warnings.join(' ')).toMatch(/names no anodizing type/);
    const stated = run('Anodize', { ...part, surfaceCallout: 'Anodize Type III' });
    expect(stated.provisional).toBeUndefined();
    expect(stated.trace.find((t) => t.label === 'Anodizing type')?.value).toBe('Type III');
  });

  it('screen printing: largest face x application cost x size multiplier x color factor, the printed region assumed and said so', () => {
    const r = run('Screen Printing');
    const m = provPool.find((x) => x.name === 'Manual Screen Printing' || x.name === r.machine!.name)!;
    const perM2 = Number(m.specs.application_cost_usd_per_m2);
    const mult = parseCsv('lookup/screenPrintSizeMult.csv').map((x) => ({ l: Number(x['Length (mm)']), w: Number(x['Width (mm)']), m: Number(x['Multiplier']) })).find((x) => 200 <= x.l && 100 <= x.w)!.m;
    expect(r.status).toBe('costed');
    expect(r.provisional).toBe(true);
    expect(r.costPerPartUsd).toBeCloseTo((0.2 * 0.1) * perM2 * mult * (1 + v('screenPrintColorMultiplier') * (v('defaultNumScreenPrintColors') - 1)), 3);
    expect(r.warnings.join(' ')).toMatch(/largest face is assumed/);
  });

  it('mask bench: one plug per detected hole at the bench plug time; no hole is not applicable, not a blank', () => {
    const holes = { id: 'h1', feature_type: 'simple_hole', occurrences: [{}, {}, {}] };
    const r = run('Mask-Bench', { ...part, features: [holes] });
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    expect(r.status).toBe('costed');
    expect(r.provisional).toBe(true);
    expect(r.trace.find((t) => t.label === 'Holes to plug')?.value).toBe(3);
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(r.cycleTimeSec! * r.machine!.goodPartYield * eff / adj).toBeCloseTo(3 * Number(m.specs.mask_plug_time_s), 1);
    expect(run('Mask-Bench').status).toBe('not_applicable');
  });

  it('mask spray: bore area of the CAD-counted holes x maskant layers / spray rate, programming once per batch; no hole is not applicable', () => {
    const withHoles: SecondaryPartFacts = { ...part, wallThicknessMm: 2, holeDiametersMm: [4, 6] };
    const r = run('Mask-Spray', withHoles);
    const m = provPool.find((x) => x.name === r.machine!.name)!;
    const area = Math.PI * 4 * 2 + Math.PI * 6 * 2;
    expect(r.status).toBe('costed');
    expect(r.provisional).toBe(true);
    expect(r.trace.find((t) => t.label === 'Masked area')?.value).toBeCloseTo(area, 0);
    const adj = Number(reference.variables.get('cycleTimeAdjustmentFactor') ?? 1);
    const eff = Number(reference.variables.get('defaultMachineEfficiency') ?? 1);
    expect(r.cycleTimeSec! * r.machine!.goodPartYield * eff / adj).toBeCloseTo((area * v('defaultNumMaskantLayers')) / Number(m.specs.spray_rate_mm2_per_s), 2);
    expect(r.setupMin).toBeCloseTo(r.machine!.setupHr * 60 + Number(m.specs.programming_time_hr) * 60, 1);
    expect(run('Mask-Spray').status).toBe('not_applicable');
  });

  it('Black Oxide has a wage grade in memory/ and every other machine of that grade carries one labor rate (migration 981 gives it)', () => {
    const grades = new Map(parseCsv('surface_treatment_wage_grades.csv').map((x) => [x['Process Name']!, x['Wage Grade Name']!]));
    expect(grades.get('Black Oxide')).toBe('2 - Metal');
    expect(parseCsv('Machine/black_oxide_machines.csv').every((x) => x['Labor Rate (USD / hr)'] === '')).toBe(true);
    const rates = new Set<string>();
    for (const [proc, grade] of grades) {
      if (grade !== '2 - Metal' || proc === 'Black Oxide') continue;
      const file = fs.readdirSync(path.join(ROOT, 'Machine')).find((f) => f.startsWith(proc.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^(.*)$/, '$1')));
      if (!file) continue;
      for (const row of parseCsv(`Machine/${file}`)) rates.add(row['Labor Rate (USD / hr)'] ?? row['Labor Rate (USD/hr)'] ?? '');
    }
    expect([...rates]).toEqual(['29.95']);
    expect(fs.readFileSync(path.resolve(__dirname, '../../../../../../migrations/981_black_oxide_wage_grade_labor_rate.sql'), 'utf-8')).toMatch(/HAVING count\(DISTINCT usd_labor_rate_per_hr\) = 1/);
  });
});
