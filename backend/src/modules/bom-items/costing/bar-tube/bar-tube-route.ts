// A bar, tube or profile part's routes, priced on the staged memory/Bar and tube fab data (2026-BarTube) and the bar and tube calculators
// (migration 1091). Pure.
//
// The part is measured by cad-engine bar_tube/feature_extractor.py: its stock form and section (or, cut from plate, its thickness, outline and
// blank), the centreline's developed length, the bends (CLR, angle, clock angle), the holes, complex holes and cutouts through the wall, each
// end's cut (square, angled, notch, slot) and the end forms (flare, flange, expansion, reduction, flattening). The routes, compared and the
// cheapest complete one quoted (user decisions 2026-11-19):
//   Saw + punch   the stock cut to length on a saw (the saws saw_routing_evaluation allows for the stock form) or a shear, the openings
//                 punched, the notched and slotted ends on their own machines
//   Tube laser    the cut, the openings and the end profiles in one setup on a tube laser (feed and pierce: process_cut_rate)
//   Extrusion     a generic profile: the billet preheated and extruded, cut off, its openings punched
//   Plate laser, plasma, oxyfuel   a flat part cut from plate
// End forms on their own machines on either stock route. Each bend on the cheapest method that can make it (rotary draw, compression, roll,
// bend brake; a profile's on the profile benders). Each step on the cheapest capable machine of the location.
import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import type { CostContext } from '../casting/casting-finishing';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import type { SandReference } from '../casting/sand/sand-reference';
import { seedsFor, type SeedProvider, type SeedProviders } from '../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type StepOutcome } from '../casting/sand/sand-steps';
import type { CadEvidenceKey } from '../shared/cad-evidence';

export const BAR_TUBE_DOMAIN = 'bar_tube';
export const BAR_TUBE_PROCESS_GROUP = 'Bar and Tube Fabrication';

/** The HR Rates machine class of each catalog process (migrations 862, 1089). */
export const barTubeClass = (process: string) => `bar_tube_fab_${process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

const SAWS = ['Band Saw', 'Circular Saw', 'Reciprocating Saw'] as const;
type Saw = (typeof SAWS)[number];
const SAW_KERF: Record<Saw, string> = { 'Band Saw': 'bandSawKerf', 'Circular Saw': 'circSawKerf', 'Reciprocating Saw': 'recipSawKerf' };
const SAW_BUNDLE: Record<Saw, string> = { 'Band Saw': 'maxPartsPerBundleBandSaw', 'Circular Saw': 'maxPartsPerBundleCircSaw', 'Reciprocating Saw': 'maxPartsPerBundleRecipSaw' };
/** The end forms the cad-engine names (Form variants) and the end cuts that are their own operation (End variants), and their processes. */
const FORM_PROCESS: Readonly<Record<string, string>> = {
  flare: 'Flaring', flange: 'Flanging', expansion: 'Expansion', reduction: 'Reduction', flattening: 'Flattening', knurl: 'Knurling',
};
const END_CUT_PROCESS: Readonly<Record<string, string>> = { notch: 'Notching', slot: 'Slotting' };
const STOCK_BENDING = ['Rotary Draw Bending', 'Compression Bending', '2 Roll Bending', '3 Roll Bending', '4 Roll Bending', 'Bar Bend Brake'] as const;
const PROFILE_BENDING = ['Profile CNC Bend', 'Profile 3 Roll Bend'] as const;
const PLATE_CUTTING = [
  { key: 'plate_laser', process: 'Sheet Laser Cut', machineType: 'Laser Cut' },
  { key: 'plate_plasma', process: 'Sheet Plasma Cut', machineType: 'Plasma Cut' },
  { key: 'plate_oxyfuel', process: 'Sheet OxyFuel Cut', machineType: 'OxyFuel Cut' },
] as const;
/** The temperature a billet is extruded at (the Billet preheat calculator's billet_temp_c, 480 °C: aluminium extrusion). */
const BILLET_TEMP_C = 480;

export const BAR_TUBE_ROUTES = [
  { key: 'saw', label: 'Saw and punch' },
  { key: 'laser', label: 'Tube laser' },
  { key: 'extrusion', label: 'Extrusion' },
  { key: 'plate_laser', label: 'Plate laser' },
  { key: 'plate_plasma', label: 'Plate plasma' },
  { key: 'plate_oxyfuel', label: 'Plate oxyfuel' },
] as const;
export type BarTubeRouteKey = (typeof BAR_TUBE_ROUTES)[number]['key'];

/** The stock forms bought as a length of stock, and their material_stock_prices form. */
export const STOCK_PRICE_FORM: Readonly<Record<string, string>> = {
  ROUND_TUBE: 'round_tube', SQUARE_TUBE: 'square_tube', RECTANGULAR_TUBE: 'rectangular_tube', ROUND_BAR: 'round_bar', SQUARE_BAR: 'square_bar',
  RECTANGULAR_BAR: 'rectangular_bar', HEX_BAR: 'hex_bar', ANGLE_BAR: 'angle_bar', CHANNEL_BAR: 'channel_bar', I_BEAM: 'i_beam', T_BEAM: 't_beam',
  PLATE: 'plate',
};
const TUBES = new Set(['ROUND_TUBE', 'SQUARE_TUBE', 'RECTANGULAR_TUBE']);
const ROUND = new Set(['ROUND_TUBE', 'ROUND_BAR']);
const FLAT_BARS = new Set(['RECTANGULAR_BAR', 'ANGLE_BAR']);

const CALC = (name: string) => `Bar and Tube - ${name}`;
export const BAR_TUBE_CALC = {
  stock: CALC('Stock per part'), plate: CALC('Plate per part'), billet: CALC('Extrusion billet'),
  saw: CALC('Saw cut'), shear: CALC('Shear'), tubeLaser: CALC('Tube laser'), punching: CALC('Punching'), endForming: CALC('End forming'),
  rotaryDraw: CALC('Rotary draw bending'), compression: CALC('Compression bending'), brake: CALC('Bar bend brake'), roll: CALC('Roll bending'),
  profileRoll: CALC('Profile 3 roll bend'), profileCnc: CALC('Profile CNC bend'), plateCut: CALC('Plate cutting'),
  extrusion: CALC('Extrusion'), billetPreheat: CALC('Billet preheat'), diePreheat: CALC('Die preheat'),
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });
const isGap = (l: ProcessLineCost) => l.physicsGap != null;
type Row = Readonly<Record<string, unknown>>;

export interface BarTubeSection {
  areaMm2: number;
  widthMm: number;
  heightMm: number;
  outerPerimeterMm: number;
  odMm: number | null;
  /** A tube's wall, or a profile's thickness; null for a solid bar. */
  wallMm: number | null;
  circumscribingDiameterMm: number | null;
}
export interface BarTubeBend { clrMm: number; angleDeg: number; clockAngleDeg?: number | null; arcLengthMm?: number | null }
export interface BarTubeHole { featureType: string; diameterMm: number; stationMm: number | null }
export interface BarTubeOpening { perimeterMm: number; stationMm: number | null }
export interface BarTubeEnd { end: 'start' | 'end'; variant: string; cutAngleDeg: number | null; cutPerimeterMm: number | null }
/** A flat part cut from plate (cad-engine plate_measurements). */
export interface BarTubePlate { thicknessMm: number; cutLengthMm: number; pierces: number; blankLengthMm: number; blankWidthMm: number; faceAreaMm2: number }

/** The part as the routes take it (cad-engine bar_tube/feature_extractor.py, via auto-fill's barTubeGeometry). */
export interface BarTubePart {
  stockForm: string;
  section: BarTubeSection;
  developedLengthMm: number;
  bends: readonly BarTubeBend[];
  holes: readonly BarTubeHole[];
  complexHoles: readonly BarTubeOpening[];
  cutouts: readonly BarTubeOpening[];
  ends: readonly BarTubeEnd[];
  forms: ReadonlyArray<{ end: 'start' | 'end'; variant: string }>;
  /** Set for a part cut from plate (stock form PLATE). */
  plate?: BarTubePlate | null;
}

/** A bar and tube material: its cut code (saw and laser rates), properties and the price of its stock form at the location. */
export interface BarTubeMaterial {
  id: string;
  name: string;
  /** The Material Cut Code Family the cut-rate lookups list for it ("1", "30"); null when they list none. */
  cutCodeFamily: string | null;
  cutCode: number | null;
  materialType?: string | null;
  densityKgM3: number | null;
  utsMpa?: number | null;
  yieldMpa?: number | null;
  /** The material's own price (cost_usa): an extrusion's billet is bought as the alloy, not as a stock form. */
  costPerKgUsd?: number | null;
  specificHeatJKgK?: number | null;
  /** The fastest exit speed the alloy is extruded at (migration 1090); null for an alloy that is not extruded. */
  exitSpeedMaxMmS?: number | null;
  /** USD/kg of the part's stock form at the location (material_stock_prices); null when none is on file. */
  stockPricePerKgUsd: number | null;
  stockPriceSource: string | null;
}

export interface BarTubeScenario { batchSize: number; route: BarTubeRouteKey | null }

export interface BarTubeRouteInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  material: BarTubeMaterial;
  part: BarTubePart;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  scenario: BarTubeScenario;
  costContext: CostContext;
}

/** How a bend is made: its method, its tool key (rotary draw: bending_difficulty_factor) and whether it needs a mandrel. */
export interface BarTubeBendPlan { index: number; clrMm: number; angleDeg: number; method: string | null; toolKey: string | null; mandrel: boolean; reason: string | null }

export interface BarTubeRoute {
  key: BarTubeRouteKey;
  label: string;
  lines: ProcessLineCost[];
  /** The stock bought per part: its mass (the part's share of a stock length, a sheet or a billet) and the part's own mass. */
  material: { costUsd: number | null; massKg: number; partKg: number; partsPerStock: number | null; run: ReferenceCalcRun | null; missing: string | null };
  bendPlan: BarTubeBendPlan[];
  totalUsd: number | null;
  complete: boolean;
  warnings: string[];
}
export interface BarTubeRouteGap { key: BarTubeRouteKey; label: string; reason: string }

/** The cut-code family the rate lookups list for a material's cut code ("33.30": "333" when listed, else "33"); null when neither is. */
export function cutCodeFamilyOf(families: ReadonlySet<string>, cutCode: number | null): string | null {
  if (cutCode == null) return null;
  const [whole, decimals = ''] = String(cutCode).split('.');
  return [`${whole}${decimals.slice(0, 1)}`, whole!].find((f) => families.has(f)) ?? null;
}

/**
 * A rotary draw bender's largest tube, from its name (the machine files carry no diameter column): "Rotary Draw Bender - 150mm Max Tube
 * Diameter", "Silfax SE 32" (32 mm), "Pines Model 1 1/4" (a Pines model number is its largest tube OD in inches). Null when the name says none.
 */
export function rotaryDrawCapacityMm(name: string): number | null {
  const mm = /(\d+(?:\.\d+)?)\s*mm\s*Max Tube Diameter/i.exec(name);
  if (mm) return Number(mm[1]);
  const silfax = /Silfax SE\s*(\d+)/i.exec(name);
  if (silfax) return Number(silfax[1]);
  const pines = /Pines Model\s+(\d+)(?:\s+(\d+)\/(\d+))?$|Pines Model\s+(\d+)\/(\d+)$/i.exec(name.trim());
  if (pines) {
    const inches = pines[4] ? Number(pines[4]) / Number(pines[5]) : Number(pines[1]) + (pines[2] ? Number(pines[2]) / Number(pines[3]) : 0);
    return r2(inches * 25.4);
  }
  return null;
}

/** The machine processes the part's routes may run, by class (the service loads exactly these). */
export const BAR_TUBE_ROUTE_CLASSES: readonly string[] = [
  ...SAWS, 'Shear', 'Punching', 'Tube Laser', ...Object.values(FORM_PROCESS), ...Object.values(END_CUT_PROCESS),
  ...STOCK_BENDING, ...PROFILE_BENDING, ...PLATE_CUTTING.map((p) => p.process), 'Extrusion', 'Billet Preheat', 'Die Preheat',
].map(barTubeClass);

/** Every route of the part (each complete or with its gaps), the routes it cannot take and why, and what keeps any route from being built. */
export function buildBarTubeRoutes(input: BarTubeRouteInput): { routes: BarTubeRoute[]; gaps: BarTubeRouteGap[]; missing: string[] } {
  const { ref, part, scenario, material } = input;
  const none = (...missing: string[]) => ({ routes: [], gaps: [], missing });
  const num = (name: string) => ref.number(name);
  if (material.densityKgM3 == null || !(material.densityKgM3 > 0)) return none(`${material.name}: its density`);
  const sec = part.section;
  const tube = TUBES.has(part.stockForm);
  const outsideSize = Math.max(sec.widthMm, sec.heightMm);
  const diagonal = sec.circumscribingDiameterMm ?? (ROUND.has(part.stockForm) ? outsideSize : Math.hypot(sec.widthMm, sec.heightMm));
  const thickness = sec.wallMm ?? Math.min(sec.widthMm, sec.heightMm);

  // ── Seeding: every input from its declared source; the key before a " (" note is the value's name ──────────────────────────────────
  const cadSeed = (value: number, source: string, evidence: CadEvidenceKey): CalcSeed => ({ value, source, ref: { kind: 'cad', evidence } });
  const cad: Record<string, CalcSeed | undefined> = {
    developed_length: cadSeed(part.developedLengthMm, 'the centreline: straights and bend arcs, end to end (mm)', 'developed_length'),
    section_area: cadSeed(sec.areaMm2, 'the cross-section cut normal to the centreline (mm²)', 'section_area'),
  };
  const named = (values: Readonly<Record<string, CalcSeed | undefined>>): SeedProvider => (key) => values[key.split(' (')[0]!.trim()] ?? values[key] ?? null;
  const variable: SeedProvider = (name) => {
    const value = num(name);
    return value == null ? null : { value, source: `Bar and tube variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}`, ref: { kind: 'variable', domain: BAR_TUBE_DOMAIN, name } };
  };
  const materialValues: Readonly<Record<string, { value: number | null | undefined; label: string }>> = {
    density_kg_m3: { value: material.densityKgM3, label: 'density (kg/m³)' },
    cost: { value: material.costPerKgUsd, label: 'price (USD/kg)' },
    specific_heat_rt_j_kg_k: { value: material.specificHeatJKgK, label: 'specific heat (J/kg·K)' },
    extrusion_exit_speed_max_mm_s: { value: material.exitSpeedMaxMmS, label: 'fastest extrusion exit speed (mm/s)' },
  };
  const materialProvider: SeedProvider = (column) => {
    const v = materialValues[column];
    return v?.value == null ? null : { value: v.value, source: `${material.name}: ${v.label}`, ref: { kind: 'material', materialId: material.id, materialName: material.name, column } };
  };
  type Run = { run: ReferenceCalcRun } | { reasons: string[] };
  const run = (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): Run => {
    const calc = input.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, cad: named(cad), engine: named(engine), lookup: named(lookups), scenario: named({ batch_size: { value: scenario.batchSize, source: 'batch size' } }),
      material: materialProvider,
      machine: (key) => {
        const value = machine ? machineValue(machine, key) : null;
        return value == null || !machine ? null : {
          value, source: `machine ${machine.name}: ${key}`,
          ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, machineClass: machine.machineClass, location: machine.location, column: key },
        };
      },
    };
    const { seeds, missing } = seedsFor(calc, providers);
    if (missing.length) return { reasons: missing.map((m) => `${calculator}: ${m}`) };
    const result = runReferenceCalculator(input.calculators, calculator, seeds, calc.output ?? 'Cycle Time');
    return result.value == null ? { reasons: result.missing } : { run: result };
  };
  const seed = (value: number, source: string): CalcSeed => ({ value, source });
  const lookupSeed = (table: string, row: Row | undefined, column: string, identity: readonly string[]): CalcSeed | undefined => {
    if (!row || row[column] == null || !Number.isFinite(Number(row[column]))) return undefined;
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    return {
      value: Number(row[column]), source: `${table} (${identity.map((c) => `${c} ${row[c]}`).join(', ')}): ${column}`, lookup: true, match: { table, row: id },
      ref: { kind: 'lookup', domain: BAR_TUBE_DOMAIN, table, column, row: id },
    };
  };
  const step = (process: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[]): CostedStep =>
    selectAndCost({
      process, machineClass: barTubeClass(process), machines: input.machinesByClass[barTubeClass(process)] ?? [], evaluate, criteria,
      batchSize: scenario.batchSize, costContext: input.costContext, ref, partName: 'part', processGroup: BAR_TUBE_PROCESS_GROUP,
    });
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}, extra: Record<string, unknown> = {}): StepOutcome => {
    const r = run(calculator, m, engine, lookups);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [], ...extra } as StepOutcome : fail(...r.reasons);
  };
  /** The stock fits the machine: its outside size within the machine's max stock diameter (and width and height when it lists them). */
  const fitsStock = (m: SandMachine): string | null => {
    const maxD = machineValue(m, 'max_stock_diameter_mm');
    if (maxD != null && diagonal > maxD + 1e-6) return `takes stock up to ${maxD} mm across, the section is ${r2(diagonal)} mm`;
    const maxH = machineValue(m, 'max_stock_height_mm');
    const maxW = machineValue(m, 'max_stock_width_mm');
    if (maxH != null && Math.min(sec.widthMm, sec.heightMm) > maxH + 1e-6) return `takes stock up to ${maxH} mm high, the section is ${r2(Math.min(sec.widthMm, sec.heightMm))} mm`;
    if (maxW != null && outsideSize > maxW + 1e-6) return `takes stock up to ${maxW} mm wide, the section is ${r2(outsideSize)} mm`;
    const minD = machineValue(m, 'min_stock_dia_mm');
    if (minD != null && outsideSize < minD - 1e-6) return `takes stock from ${minD} mm across, the section is ${r2(outsideSize)} mm`;
    return null;
  };
  const partKg = part.plate
    ? (part.plate.faceAreaMm2 * part.plate.thicknessMm * material.densityKgM3) / 1e9
    : (part.developedLengthMm * sec.areaMm2 * material.densityKgM3) / 1e9;
  /** The material_handling row of a process for the part's weight: the first band at or above it. */
  const handling = (process: string): Record<string, CalcSeed | undefined> => {
    const row = ref.table('material_handling').filter((r) => r['Process Name'] === process)
      .sort((a, b) => Number(a['Weight (kg)']) - Number(b['Weight (kg)'])).find((r) => Number(r['Weight (kg)']) >= partKg - 1e-9);
    const id = ['Process Name', 'Weight (kg)'];
    return {
      'material_handling.Load Time (s)': lookupSeed('material_handling', row, 'Load Time (s)', id),
      'material_handling.Manipulation Time (s)': lookupSeed('material_handling', row, 'Manipulation Time (s)', id),
      'material_handling.Unload Time (s)': lookupSeed('material_handling', row, 'Unload Time (s)', id),
    };
  };

  // ── The part's openings and ends ───────────────────────────────────────────────────────────────────────────────────────────────────
  const roundHoles = part.holes;
  const openings = roundHoles.length + part.complexHoles.length + part.cutouts.length;
  const stations = [...roundHoles, ...part.complexHoles, ...part.cutouts].map((o) => o.stationMm).filter((s): s is number => s != null);
  const indexMm = stations.length > 1 ? Math.max(...stations) - Math.min(...stations) : 0;
  const angled = part.ends.filter((e) => (e.cutAngleDeg ?? 0) > 0.5);
  const maxCutAngle = Math.max(0, ...angled.map((e) => e.cutAngleDeg ?? 0));
  const endCuts = part.ends.filter((e) => END_CUT_PROCESS[e.variant]);
  const forms = part.forms.filter((f) => FORM_PROCESS[f.variant]);
  const unknownForms = part.forms.filter((f) => !FORM_PROCESS[f.variant]).map((f) => f.variant);

  /** The stock per part for a cut of `kerfMm` (Bar and Tube - Stock per part); the material cost needs the stock form's price. */
  const stockFor = (kerfMm: number, kerfSource: string): { run: ReferenceCalcRun | null; reasons: string[] } => {
    const price = material.stockPricePerKgUsd;
    const r = run(BAR_TUBE_CALC.stock, null, {
      price_per_kg: seed(price ?? 0, price != null ? `${material.stockPriceSource ?? 'material_stock_prices'} (USD/kg)` : 'no stock price on file'),
      kerf_mm: seed(kerfMm, kerfSource),
    });
    return 'run' in r ? { run: r.run, reasons: [] } : { run: null, reasons: r.reasons };
  };

  // ── Steps the stock routes share: the end forms ───────────────────────────────────────────────────────────────────────────────────
  const formSteps = (): CostedStep[] => {
    const byProcess = new Map<string, number>();
    for (const f of forms) byProcess.set(FORM_PROCESS[f.variant]!, (byProcess.get(FORM_PROCESS[f.variant]!) ?? 0) + 1);
    return [...byProcess].map(([process, ends]) => step(process, (m) => {
      const fit = fitsStock(m);
      if (fit) return fail(fit);
      return timed(BAR_TUBE_CALC.endForming, m, { ends: seed(ends, `${ends} end(s) ${process.toLowerCase()} (the cad-engine's end forms)`) });
    }, ['The stock fits its diameter range']));
  };

  // ── Bending: each bend on the cheapest method that can make it ─────────────────────────────────────────────────────────────────────
  const difficulty = ref.table('bending_difficulty_factor');
  /** A tube bend's tool key: the bending_difficulty_factor row at the wall factor (OD / wall, rounded up) and D of bend (CLR / OD, rounded down). */
  const toolKeyOf = (b: BarTubeBend): { key: string | null; reason: string | null } => {
    if (!tube || sec.wallMm == null) return { key: null, reason: null };
    const wf = outsideSize / sec.wallMm;
    const dob = b.clrMm / outsideSize;
    const wfs = [...new Set(difficulty.map((r) => Number(r['Wall Factor'])))].sort((a, c) => a - c);
    const wfRow = wfs.find((w) => w >= wf - 1e-9);
    if (wfRow == null) return { key: null, reason: `a wall factor of ${r2(wf)} (OD / wall) is beyond bending_difficulty_factor (up to ${wfs[wfs.length - 1]})` };
    const rows = difficulty.filter((r) => Number(r['Wall Factor']) === wfRow).sort((a, c) => Number(a['D Of Bend']) - Number(c['D Of Bend']));
    const row = [...rows].reverse().find((r) => Number(r['D Of Bend']) <= dob + 1e-9);
    if (!row) return { key: null, reason: `a ${r2(dob)} D bend (CLR / OD) is tighter than bending_difficulty_factor lists at wall factor ${wfRow} (from ${rows[0]?.['D Of Bend']} D)` };
    return { key: String(row['Tool Key']), reason: null };
  };
  const needsMandrel = (key: string | null) => key != null && key.slice(1) !== '0';
  // Draw bending (rotary draw, compression) covers the bends bending_difficulty_factor lists, 0.75 to 12 D (CLR / outside size); a larger
  // radius is rolled. The reference's own range divides the methods: a roll bender has no small-radius limit on file, a draw bender no large.
  const tableD = difficulty.map((r) => Number(r['D Of Bend'])).filter((d) => d > 0);
  const maxDrawD = tableD.length ? Math.max(...tableD) : null;
  const dOf = (b: BarTubeBend) => b.clrMm / outsideSize;
  const drawRange = (bends: readonly BarTubeBend[]): string | null => {
    const big = bends.find((b) => maxDrawD != null && dOf(b) > maxDrawD + 1e-9);
    return big ? `a ${r2(dOf(big))} D bend (CLR / outside size) is beyond draw bending (bending_difficulty_factor lists up to ${maxDrawD} D): it is rolled` : null;
  };
  const rollRange = (bends: readonly BarTubeBend[]): string | null => {
    const tight = bends.find((b) => maxDrawD != null && dOf(b) <= maxDrawD + 1e-9);
    return tight ? `a ${r2(dOf(tight))} D bend is within draw bending (up to ${maxDrawD} D, bending_difficulty_factor): a roll bender makes larger radii` : null;
  };
  const strengthPasses = (() => {
    const refUts = num('referenceTensileStrength');
    return material.utsMpa != null && refUts != null && material.utsMpa > refUts ? Math.ceil(material.utsMpa / refUts) : 1;
  })();
  const speedFactor = material.utsMpa != null && material.yieldMpa != null && material.yieldMpa >= 0.9 * material.utsMpa ? num('rollingSpeedAdjustmentFactor') ?? 1 : 1;
  const arcOf = (b: BarTubeBend) => b.arcLengthMm ?? (b.clrMm * b.angleDeg * Math.PI) / 180;
  const rotationsOf = (bends: readonly BarTubeBend[]) => bends.filter((b, i) => i > 0 && Math.abs(b.clockAngleDeg ?? 0) > 0.5).length;
  const aluminium = /alumin/i.test(material.materialType ?? material.name);

  /** One bending method's step for a set of bends (each feasible on the machine or the machine is not capable). */
  const bendStep = (process: string, bends: readonly BarTubeBend[]): CostedStep => {
    const n = bends.length;
    const keys = bends.map(toolKeyOf);
    const maxAngle = Math.max(...bends.map((b) => b.angleDeg));
    const arc = bends.reduce((s, b) => s + arcOf(b), 0);
    const bendsSeed = seed(n, `${n} bend(s)`);
    const rotations = seed(rotationsOf(bends), 'bends after a plane rotation (clock angle not 0)');
    const angleOk = (m: SandMachine) => {
      const a = machineValue(m, 'max_bend_angle_deg');
      return a != null && maxAngle > a + 1e-6 ? `bends up to ${a} degrees, a bend is ${r2(maxAngle)}` : null;
    };
    switch (process) {
      case 'Rotary Draw Bending': return step(process, (m) => {
        // Tube and round, square or hex bar; a flat or angle bar is bent in a bend brake (or rolled).
        if (!(tube || ['ROUND_BAR', 'SQUARE_BAR', 'HEX_BAR'].includes(part.stockForm))) return fail(`a rotary draw bender bends tube and round, square or hex bar, not ${part.stockForm.toLowerCase().replace(/_/g, ' ')}`);
        const range = drawRange(bends);
        if (range) return fail(range);
        const cap = rotaryDrawCapacityMm(m.name);
        if (cap == null) return fail('no tube capacity on file (the machine name gives none)');
        if (diagonal > cap + 1e-6) return fail(`bends tube up to ${cap} mm (its name), the section is ${r2(diagonal)} mm`);
        const why = angleOk(m) ?? keys.find((k) => k.reason)?.reason;
        if (why) return fail(why);
        const mandrels = keys.filter((k) => needsMandrel(k.key)).length;
        return timed(BAR_TUBE_CALC.rotaryDraw, m, {
          bends: bendsSeed, rotations,
          mandrel_bends: seed(mandrels, mandrels ? `bends whose tool key (bending_difficulty_factor: ${[...new Set(keys.map((k) => k.key))].join(', ')}) needs a mandrel` : 'no bend needs a mandrel'),
        });
      }, ['Its tube capacity (machine name) takes the section', 'Its max bend angle', 'bending_difficulty_factor lists the wall factor and D of bend']);
      case 'Compression Bending': return step(process, (m) => {
        if (!tube || !ROUND.has(part.stockForm)) return fail('compression bending is for round tube');
        const range = drawRange(bends);
        if (range) return fail(range);
        const lim = (k: string) => machineValue(m, k);
        if (lim('max_tube_diameter_mm') != null && outsideSize > lim('max_tube_diameter_mm')! + 1e-6) return fail(`bends tube up to ${lim('max_tube_diameter_mm')} mm, the tube is ${r2(outsideSize)} mm`);
        if (lim('min_tube_diameter_mm') != null && outsideSize < lim('min_tube_diameter_mm')! - 1e-6) return fail(`bends tube from ${lim('min_tube_diameter_mm')} mm, the tube is ${r2(outsideSize)} mm`);
        const clrs = bends.map((b) => b.clrMm);
        if (lim('max_center_line_radius_mm') != null && Math.max(...clrs) > lim('max_center_line_radius_mm')! + 1e-6) return fail(`bends to a ${lim('max_center_line_radius_mm')} mm CLR at most, a bend is ${r2(Math.max(...clrs))} mm`);
        if (lim('min_center_line_radius_mm') != null && Math.min(...clrs) < lim('min_center_line_radius_mm')! - 1e-6) return fail(`bends to a ${lim('min_center_line_radius_mm')} mm CLR at least, a bend is ${r2(Math.min(...clrs))} mm`);
        const why = angleOk(m) ?? keys.find((k) => k.reason)?.reason ?? (keys.some((k) => needsMandrel(k.key)) ? 'a bend needs a mandrel (bending_difficulty_factor): a compression bender has none' : null);
        if (why) return fail(why);
        return timed(BAR_TUBE_CALC.compression, m, { bends: bendsSeed, rotations });
      }, ['Its tube diameter and CLR range', 'Its max bend angle', 'No bend needs a mandrel']);
      case '2 Roll Bending': case '3 Roll Bending': case '4 Roll Bending': return step(process, (m) => {
        const range = rollRange(bends);
        if (range) return fail(range);
        const d = 2 * Math.min(...bends.map((b) => b.clrMm));
        const rollLen = machineValue(m, 'roll_working_length_mm');
        if (rollLen != null && outsideSize > rollLen + 1e-6) return fail(`rolls up to ${rollLen} mm wide, the section is ${r2(outsideSize)} mm`);
        let passes = strengthPasses;
        if (process === '2 Roll Bending') {
          const top = machineValue(m, 'top_roll_diameter_mm');
          const ratio = num('min2RollBendingDiameterRatio');
          if (top != null && ratio != null && d < ratio * top - 1e-6) return fail(`rolls to a ${r2(ratio * top)} mm diameter at least (min2RollBendingDiameterRatio ${ratio} x its ${top} mm top roll), a bend is ${r2(d)} mm`);
          const t = machineValue(m, 'steel_thickness_mm');
          if (t != null && thickness > t + 1e-6) return fail(`rolls up to ${t} mm thick, the section is ${r2(thickness)} mm`);
        } else if (process === '3 Roll Bending') {
          const v = (k: string) => machineValue(m, k);
          const single = (v('min_single_pass_diameter_mm') == null || d >= v('min_single_pass_diameter_mm')! - 1e-6) && (v('max_single_pass_thickness_mm') == null || thickness <= v('max_single_pass_thickness_mm')! + 1e-6);
          const multi = (v('min_multi_pass_diameter_mm') == null || d >= v('min_multi_pass_diameter_mm')! - 1e-6) && (v('max_multi_pass_thickness_mm') == null || thickness <= v('max_multi_pass_thickness_mm')! + 1e-6);
          if (!single && !multi) return fail(`rolls ${v('max_multi_pass_thickness_mm')} mm thick to ${v('min_multi_pass_diameter_mm')} mm at most and least, the bend is ${r2(d)} mm across, ${r2(thickness)} mm thick`);
          if (!single) passes = Math.max(2, passes);
        }
        return timed(BAR_TUBE_CALC.roll, m, {
          arc_mm: seed(r2(arc), 'the bends rolled, along the centreline (mm)'),
          passes: seed(passes, passes > 1 ? `${passes} passes (a multi-pass bend, or a UTS above referenceTensileStrength)` : 'one pass'),
          speed_factor: seed(speedFactor, speedFactor !== 1 ? 'rollingSpeedAdjustmentFactor: the yield is within 10 % of the UTS' : 'full speed'),
        }, handling(process));
      }, ['Its rolls take the section width and thickness', 'The bend diameter within its single- or multi-pass range']);
      case 'Bar Bend Brake': return step(process, (m) => {
        if (!FLAT_BARS.has(part.stockForm)) return fail(`a bend brake bends flat and angle bar, not ${part.stockForm.toLowerCase().replace(/_/g, ' ')}`);
        const t = Math.min(sec.widthMm, sec.heightMm);
        const maxR = num('maxBendBrakeRadius');
        const clr = Math.max(...bends.map((b) => b.clrMm));
        if (maxR != null && clr > maxR + 1e-6) return fail(`bends to ${maxR} mm at most (maxBendBrakeRadius), a bend is ${r2(clr)} mm`);
        const ratioMin = machineValue(m, 'min_radius_to_thickness_ratio_mm');
        const ratioMax = machineValue(m, 'max_radius_to_thickness_ratio_mm');
        const ratio = Math.min(...bends.map((b) => b.clrMm)) / t;
        if (ratioMin != null && ratio < ratioMin - 1e-6) return fail(`bends to ${ratioMin} x thickness at least, a bend is ${r2(ratio)} x`);
        if (ratioMax != null && clr / t > ratioMax + 1e-6) return fail(`bends to ${ratioMax} x thickness at most, a bend is ${r2(clr / t)} x`);
        const maxT = machineValue(m, aluminium ? 'max_thickness_aluminum_mm' : 'max_thickness_steel_mm');
        if (maxT != null && t > maxT + 1e-6) return fail(`bends ${aluminium ? 'aluminium' : 'steel'} up to ${maxT} mm thick, the bar is ${r2(t)} mm`);
        const w = machineValue(m, 'max_stock_width_mm');
        if (w != null && outsideSize > w + 1e-6) return fail(`bends bar up to ${w} mm wide, the bar is ${r2(outsideSize)} mm`);
        return timed(BAR_TUBE_CALC.brake, m, { bends: bendsSeed }, handling(process));
      }, ['Flat or angle bar', 'The bend within maxBendBrakeRadius and its radius-to-thickness range', 'Its thickness and width for the material']);
      case 'Profile CNC Bend': return step(process, (m) => {
        const cap = machineValue(m, 'max_part_diameter_mm');
        if (cap != null && diagonal > cap + 1e-6) return fail(`bends profiles up to ${cap} mm across, the section is ${r2(diagonal)} mm`);
        return timed(BAR_TUBE_CALC.profileCnc, m, {}, handling(process));
      }, ['Its part diameter takes the section']);
      default: return step(process, (m) => {
        const h = machineValue(m, 'roller_max_height_separation_mm');
        if (h != null && Math.min(sec.widthMm, sec.heightMm) > h + 1e-6) return fail(`its rollers open to ${h} mm, the section is ${r2(Math.min(sec.widthMm, sec.heightMm))} mm`);
        return timed(BAR_TUBE_CALC.profileRoll, m, {
          arc_mm: seed(r2(arc), 'the bends rolled (mm)'), passes: seed(strengthPasses, strengthPasses > 1 ? `${strengthPasses} passes: the UTS is above referenceTensileStrength` : 'one pass'),
        }, handling(process));
      }, ['Its rollers open to the section']);
    }
  };
  /**
   * Each bend's method: the cheapest one that can make it alone (its line's cost for that bend); then the bends of each method on one line.
   * A profile is bent on the profile benders only (profileBendExtrusionsOnlyRoutingPreference).
   */
  const bendingSteps = (methods: readonly string[]): { steps: CostedStep[]; plan: BarTubeBendPlan[] } => {
    const plan: BarTubeBendPlan[] = part.bends.map((b, index) => {
      const tk = toolKeyOf(b);
      const trials = methods.map((method) => ({ method, s: bendStep(method, [b]) }));
      const best = trials.filter((t) => !isGap(t.s.line)).sort((a, c) => a.s.line.totalCost - c.s.line.totalCost)[0];
      const why = trials.map((t) => `${t.method}: ${(t.s.line.physicsGap as { reason?: string } | undefined)?.reason ?? 'not costed'}`).join('; ');
      return { index, clrMm: b.clrMm, angleDeg: b.angleDeg, method: best?.method ?? null, toolKey: tk.key, mandrel: needsMandrel(tk.key), reason: best ? null : why };
    });
    const steps: CostedStep[] = [];
    for (const method of methods) {
      const mine = plan.filter((p) => p.method === method).map((p) => part.bends[p.index]!);
      if (mine.length) steps.push(bendStep(method, mine));
    }
    return { steps, plan };
  };

  // ── The saw route's cut-off: the saws the reference allows for the stock form, or a shear ────────────────────────────────────────────
  const sawRouting = ref.table('saw_routing_evaluation').find((r) => r['Stock Form'] === part.stockForm);
  const allowedSaws = SAWS.filter((s) => String(sawRouting?.[s] ?? '').toLowerCase() === 'true');
  const sawRates = ref.table('saw_cut_rate');
  const cutArea = sec.areaMm2 / Math.cos((maxCutAngle * Math.PI) / 180);
  const cutsPerPart = part.ends.length >= 2 && part.ends.every((e) => (e.cutAngleDeg ?? 0) > 0.5) ? 2 : 1;
  const sawStep = (saw: Saw): CostedStep => step(saw, (m) => {
    const fit = fitsStock(m);
    if (fit) return fail(fit);
    const sawable = num('maxSawableCutoutAngle');
    if (sawable != null && maxCutAngle > sawable + 1e-6) return fail(`an end is cut at ${r2(maxCutAngle)} degrees, beyond the reference's maxSawableCutoutAngle of ${sawable}`);
    const maxAngle = machineValue(m, 'max_cut_angle_deg');
    if (maxCutAngle > 0.5 && maxAngle != null && maxCutAngle > maxAngle + 1e-6) return fail(`cuts up to ${maxAngle} degrees, an end is cut at ${r2(maxCutAngle)}`);
    if (!material.cutCodeFamily) return fail(`saw_cut_rate lists no cut-code family for ${material.name} (cut code ${material.cutCode ?? 'none'})`);
    const rows = sawRates.filter((r) => r['Process Name'] === saw && String(r['Material Cut Code Family']) === material.cutCodeFamily)
      .sort((a, b) => Number(a['Material Width (mm)']) - Number(b['Material Width (mm)']));
    const row = rows.find((r) => Number(r['Material Width (mm)']) >= outsideSize - 1e-6);
    if (!row) return fail(`saw_cut_rate has no ${saw} rate for cut-code family ${material.cutCodeFamily} at ${r2(outsideSize)} mm wide`);
    // Parts in a bundle: as many sections as the saw's stock height and width hold, within the reference's limit for the saw.
    const maxH = machineValue(m, 'max_stock_height_mm') ?? outsideSize;
    const maxW = machineValue(m, 'max_stock_width_mm') ?? outsideSize;
    const fit2 = Math.max(1, Math.floor(maxH / Math.max(1e-6, Math.min(sec.widthMm, sec.heightMm))) * Math.floor(maxW / Math.max(1e-6, outsideSize)));
    const bundle = Math.max(1, Math.min(fit2, num(SAW_BUNDLE[saw]) ?? 1));
    return timed(BAR_TUBE_CALC.saw, m, {
      cut_area_mm2: seed(r2(cutArea), maxCutAngle > 0.5 ? `the section's metal area over cos ${r2(maxCutAngle)} degrees (mm²)` : "the section's metal area (mm²)"),
      parts_per_bundle: seed(bundle, `${bundle} per bundle: the saw's stock height and width hold ${fit2}, ${SAW_BUNDLE[saw]} ${num(SAW_BUNDLE[saw]) ?? 'unset'}`),
      cuts_per_part: seed(cutsPerPart, cutsPerPart === 2 ? 'both ends cut at an angle' : 'one cut per part'),
    }, {
      'saw_cut_rate.Cutting Rate (mm^2 / min)': lookupSeed('saw_cut_rate', row, 'Cutting Rate (mm^2 / min)', ['Process Name', 'Material Cut Code Family', 'Material Width (mm)']),
    });
  }, ['The stock fits its height, width and diameter', 'Its max cut angle takes the end cuts', 'saw_cut_rate lists the material at the section width']);
  /** A shear cuts a bar or profile its capacity for the stock form holds (memory machines_shear capacity columns); never a round tube or bar. */
  const shearStep = (): CostedStep => step('Shear', (m) => {
    if (maxCutAngle > 0.5) return fail('a shear cuts square: an end is cut at an angle');
    const cap = (key: string) => machineValue(m, key);
    const limit: Record<string, [number | null, number, string]> = {
      ANGLE_BAR: [cap('angle_bar_max_leg_mm'), outsideSize, 'leg'], CHANNEL_BAR: [cap('channel_bar_max_width_mm'), outsideSize, 'width'],
      RECTANGULAR_BAR: [cap('rec_bar_max_height_mm'), Math.min(sec.widthMm, sec.heightMm), 'height'], SQUARE_BAR: [cap('square_bar_max_height_mm'), outsideSize, 'height'],
      SQUARE_TUBE: [cap('square_tube_max_height_mm'), outsideSize, 'height'],
    };
    const l = limit[part.stockForm];
    if (!l) return fail(`a shear does not cut ${part.stockForm.toLowerCase().replace(/_/g, ' ')}`);
    if (l[0] == null || l[1] > l[0] + 1e-6) return fail(`shears ${part.stockForm.toLowerCase().replace(/_/g, ' ')} up to ${l[0] ?? 0} mm ${l[2]}, the section is ${r2(l[1])} mm`);
    const thick = part.stockForm === 'ANGLE_BAR' ? cap('angle_bar_max_thickness_mm') : part.stockForm === 'CHANNEL_BAR' ? cap('channel_bar_max_thickness_mm') : null;
    if (thick != null && thickness > thick + 1e-6) return fail(`shears up to ${thick} mm thick, the section is ${r2(thickness)} mm`);
    return timed(BAR_TUBE_CALC.shear, m, {});
  }, ['A square cut', 'Its capacity for the stock form holds the section']);

  /** Punching: every opening one hit; the holes within the machine's diameter and the wall within its thickness. */
  const punchStep = (): CostedStep => step('Punching', (m) => {
    const fit = fitsStock(m);
    if (fit) return fail(fit);
    const maxT = machineValue(m, 'max_stock_thickness_mm');
    if (maxT != null && thickness > maxT + 1e-6) return fail(`punches up to ${maxT} mm thick, the wall is ${r2(thickness)} mm`);
    const maxHole = machineValue(m, 'max_hole_diameter_mm');
    const big = roundHoles.find((h) => maxHole != null && h.diameterMm > maxHole + 1e-6);
    if (big) return fail(`punches holes up to ${maxHole} mm, one is ${r2(big.diameterMm)} mm`);
    const ratio = machineValue(m, 'min_hole_dia_to_thickness_ratio');
    const small = roundHoles.find((h) => ratio != null && h.diameterMm < ratio * thickness - 1e-6);
    if (small) return fail(`a punched hole is at least ${ratio} x the wall (${r2(ratio! * thickness)} mm), one is ${r2(small.diameterMm)} mm`);
    const punchKey = tube ? 'mandrel_punch_time_s' : 'non_mandrel_punch_time_s';
    const punch = machineValue(m, punchKey);
    if (punch == null) return fail(`machine ${m.name}: ${punchKey}`);
    return timed(BAR_TUBE_CALC.punching, m, {
      hits: seed(openings, `${roundHoles.length} hole(s), ${part.complexHoles.length} complex hole(s), ${part.cutouts.length} cutout(s): one hit each`),
      punch_time_s: seed(punch, `machine ${m.name}: ${punchKey}${tube ? ' (a tube is punched over a mandrel)' : ''}`),
      index_mm: seed(r2(indexMm), 'from the first opening to the last along the length (mm)'),
    });
  }, ['The stock fits it', 'The wall within its thickness', 'The holes within its diameter and dia-to-thickness ratio']);
  const endCutSteps = (): CostedStep[] => {
    const byProcess = new Map<string, number>();
    for (const e of endCuts) byProcess.set(END_CUT_PROCESS[e.variant]!, (byProcess.get(END_CUT_PROCESS[e.variant]!) ?? 0) + 1);
    return [...byProcess].map(([process, ends]) => step(process, (m) => {
      const fit = fitsStock(m);
      if (fit) return fail(fit);
      return timed(BAR_TUBE_CALC.endForming, m, { ends: seed(ends, `${ends} end(s) ${process === 'Notching' ? 'notched' : 'slotted'}`) });
    }, ['The stock fits its diameter range']));
  };

  // ── The tube laser: the cut-off, the openings and the end profiles in one setup ─────────────────────────────────────────────────────
  const cutRates = ref.table('process_cut_rate');
  /** The process_cut_rate row of a machine type for the material at `t` mm on a machine of `watts` (the first thickness at or above `t`). */
  const cutRate = (machineType: string, t: number, watts: number | null): { row: Row } | { reason: string } => {
    const all = cutRates.filter((r) => r['Machine Type'] === machineType);
    if (!material.cutCodeFamily) return { reason: `process_cut_rate lists no cut-code family for ${material.name}` };
    const rows = all.filter((r) => String(r['Material Cut Code Family']) === material.cutCodeFamily && (watts == null || Number(r['Power (Watts)']) === watts))
      .sort((a, b) => Number(a['Thickness (mm)']) - Number(b['Thickness (mm)']));
    if (rows.length === 0) {
      const families = [...new Set(all.map((r) => String(r['Material Cut Code Family'])))].join(', ');
      return { reason: `process_cut_rate has no ${machineType} feed for cut-code family ${material.cutCodeFamily}${watts != null ? ` at ${watts} W` : ''} (it lists famil${families.includes(',') ? 'ies' : 'y'} ${families})` };
    }
    const row = rows.find((r) => Number(r['Thickness (mm)']) >= t - 1e-6);
    return row ? { row } : { reason: `process_cut_rate's ${machineType} feeds stop at ${rows[rows.length - 1]!['Thickness (mm)']} mm, the material is ${r2(t)} mm` };
  };
  const cutId = ['Material Cut Code Family', 'Machine Type', 'Power (Watts)', 'Thickness (mm)'];
  const endPerimeters = part.ends.map((e) => e.cutPerimeterMm ?? sec.outerPerimeterMm);
  // One cut parts two lengths: each part pays for half of its two ends' cuts; a notched or slotted end's profile is cut in full.
  const largeCut = (endPerimeters.reduce((s, p) => s + p, 0) / 2)
    + endCuts.length * sec.outerPerimeterMm + part.complexHoles.reduce((s, o) => s + o.perimeterMm, 0) + part.cutouts.reduce((s, o) => s + o.perimeterMm, 0);
  const smallCut = roundHoles.reduce((s, h) => s + Math.PI * h.diameterMm, 0);
  const pierces = openings + 1 + endCuts.length;
  const laserStep = (partsPerStock: number): CostedStep => step('Tube Laser', (m) => {
    const fit = fitsStock(m);
    if (fit) return fail(fit);
    const maxLen = machineValue(m, 'max_stock_length_mm');
    if (maxLen != null && part.developedLengthMm > maxLen + 1e-6) return fail(`takes stock up to ${maxLen} mm long, the part is ${r2(part.developedLengthMm)} mm`);
    const rate = cutRate('Tube Laser', thickness, machineValue(m, 'power_watts'));
    if ('reason' in rate) return fail(rate.reason);
    return timed(BAR_TUBE_CALC.tubeLaser, m, {
      large_cut_mm: seed(r2(largeCut), 'end cuts (half of each end, a cut parts two lengths), notches, slots, complex holes and cutouts (mm)'),
      small_cut_mm: seed(r2(smallCut), `${roundHoles.length} round hole(s), π × diameter each (mm)`),
      pierces: seed(pierces, 'one per contour'),
      parts_per_stock: seed(partsPerStock, `${partsPerStock} parts per stock length (Bar and Tube - Stock per part)`),
    }, {
      'process_cut_rate.Feed Rate Large Features (mm / min)': lookupSeed('process_cut_rate', rate.row, 'Feed Rate Large Features (mm / min)', cutId),
      'process_cut_rate.Feed Rate Small Features (mm / min)': lookupSeed('process_cut_rate', rate.row, 'Feed Rate Small Features (mm / min)', cutId),
      'process_cut_rate.Pierce Time (s)': lookupSeed('process_cut_rate', rate.row, 'Pierce Time (s)', cutId),
    });
  }, ['The stock fits its diameter and length', 'process_cut_rate has a feed for the material at the wall thickness and its power']);

  const notYet = (process: string, reason: string): ProcessLineCost => ({
    process, processGroup: BAR_TUBE_PROCESS_GROUP, processRoute: process, operation: process,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: barTubeClass(process), machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process, machineClass: barTubeClass(process), reason },
  });
  const cheapest = (steps: CostedStep[]): CostedStep => {
    const costed = steps.filter((s) => !isGap(s.line)).sort((a, b) => a.line.totalCost - b.line.totalCost);
    return costed[0] ?? steps[0]!;
  };
  /** The bend lines of a route, and a gap for each bend no method can make. */
  const bendLines = (methods: readonly string[]): { steps: CostedStep[]; plan: BarTubeBendPlan[]; gaps: ProcessLineCost[] } => {
    if (!part.bends.length) return { steps: [], plan: [], gaps: [] };
    const { steps, plan } = bendingSteps(methods);
    const gaps = plan.filter((p) => !p.method).map((p) => notYet('Bending', `bend ${p.index + 1} (${r2(p.clrMm)} mm CLR, ${r2(p.angleDeg)} degrees): no method can make it (${p.reason})`));
    return { steps, plan, gaps };
  };
  const formLines = unknownForms.map((v) => notYet('End Forming', `an end form the reference has no process for (${v})`));
  /** Elongation of the outer fibre of a bend (OD / 2 CLR) against the material's allowable % (elongation_limits by cut code): a warning, not a gap. */
  const elongationWarnings = (() => {
    const lim = ref.table('elongation_limits').find((r) => material.cutCode != null && Number(r['Material Cut Code Name']) === material.cutCode);
    const allowable = lim ? Number(lim['Allowable Percent Elongation']) : null;
    return part.bends.flatMap((b, i) => {
      const e = (outsideSize / (2 * b.clrMm)) * 100;
      return allowable != null && e > allowable + 1e-6 ? [`Bend ${i + 1}: its outer fibre stretches ${r2(e)} % (OD / 2 CLR), beyond the ${allowable} % ${material.name} allows (elongation_limits): it may crack.`] : [];
    });
  })();

  const routes: BarTubeRoute[] = [];
  const gaps: BarTubeRouteGap[] = [];
  const finish = (key: BarTubeRouteKey, steps: CostedStep[], stock: { run: ReferenceCalcRun | null; reasons: string[] }, extra: { lines?: ProcessLineCost[]; plan?: BarTubeBendPlan[]; warnings?: string[]; priceMissing?: string | null } = {}) => {
    const lines = [
      ...steps.map((s, i) => (i === 0 ? { ...s.line, formsPartFeatures: true } : s.line)),
      ...(extra.lines ?? []), ...formLines,
    ];
    const priceMissing = extra.priceMissing !== undefined ? extra.priceMissing
      : material.stockPricePerKgUsd == null ? `no ${STOCK_PRICE_FORM[part.stockForm] ?? part.stockForm} price for ${material.name} (material_stock_prices)` : null;
    const materialMissing = stock.reasons[0] ?? priceMissing;
    const materialCost = stock.run && !priceMissing ? stock.run.value! : null;
    const complete = !lines.some(isGap) && materialCost != null;
    const partsKey = stock.run?.outputs['Parts per Stock'] ?? stock.run?.outputs['Parts per Sheet'] ?? stock.run?.outputs['Parts per Billet'] ?? null;
    routes.push({
      key, label: BAR_TUBE_ROUTES.find((r) => r.key === key)!.label, lines,
      material: { costUsd: materialCost, massKg: r3(stock.run?.outputs['Mass per Part'] ?? partKg), partKg: r3(partKg), partsPerStock: partsKey, run: stock.run, missing: materialMissing },
      bendPlan: extra.plan ?? [],
      totalUsd: complete ? r2(materialCost! + lines.reduce((s, l) => s + l.totalCost, 0)) : null,
      complete,
      warnings: [...steps.flatMap((s) => s.warnings), ...(extra.warnings ?? []), ...elongationWarnings, ...(materialMissing ? [`The stock is not costed: ${materialMissing}.`] : [])],
    });
  };

  // ── A part cut from plate: laser, plasma and oxyfuel ─────────────────────────────────────────────────────────────────────────────────
  if (part.stockForm === 'PLATE') {
    const p = part.plate;
    if (!p) return none('the plate measurements: press Refresh analysis');
    const plateRun = run(BAR_TUBE_CALC.plate, null, {
      blank_length_mm: seed(p.blankLengthMm, "the flat part's smallest rectangle, long side (mm)"), blank_width_mm: seed(p.blankWidthMm, "the flat part's smallest rectangle, short side (mm)"),
      thickness_mm: seed(p.thicknessMm, 'the plate (mm)'), face_area_mm2: seed(p.faceAreaMm2, "the flat part's face (mm²)"),
      price_per_kg: seed(material.stockPricePerKgUsd ?? 0, material.stockPricePerKgUsd != null ? `${material.stockPriceSource ?? 'material_stock_prices'} (USD/kg)` : 'no plate price on file'),
    });
    const plateStock = 'run' in plateRun ? { run: plateRun.run, reasons: [] } : { run: null, reasons: plateRun.reasons };
    const perSheet = plateStock.run?.outputs['Parts per Sheet'] ?? 1;
    for (const c of PLATE_CUTTING) {
      const s = step(c.process, (m) => {
        const bedL = machineValue(m, 'bed_length_mm');
        const bedW = machineValue(m, 'bed_width_mm');
        if (bedL != null && bedW != null && (Math.max(p.blankLengthMm, p.blankWidthMm) > Math.max(bedL, bedW) + 1e-6 || Math.min(p.blankLengthMm, p.blankWidthMm) > Math.min(bedL, bedW) + 1e-6)) {
          return fail(`its ${bedL} x ${bedW} mm bed is smaller than the ${r2(p.blankLengthMm)} x ${r2(p.blankWidthMm)} mm blank`);
        }
        const rate = cutRate(c.machineType, p.thicknessMm, machineValue(m, 'power_watts'));
        if ('reason' in rate) return fail(rate.reason);
        return timed(BAR_TUBE_CALC.plateCut, m, {
          cut_mm: seed(p.cutLengthMm, "the flat part's outline and openings (mm)"), pierces: seed(p.pierces, 'one per contour'),
          parts_per_sheet: seed(perSheet, `${perSheet} parts per ${num('standardSheetLength')} x ${num('standardSheetWidth')} mm sheet (Bar and Tube - Plate per part)`),
        }, {
          'process_cut_rate.Feed Rate Large Features (mm / min)': lookupSeed('process_cut_rate', rate.row, 'Feed Rate Large Features (mm / min)', cutId),
          'process_cut_rate.Pierce Time (s)': lookupSeed('process_cut_rate', rate.row, 'Pierce Time (s)', cutId),
        });
      }, ['Its bed takes the blank', 'process_cut_rate has a feed for the material at the plate thickness and its power']);
      finish(c.key, [s], plateStock);
    }
    for (const r of BAR_TUBE_ROUTES.filter((x) => !PLATE_CUTTING.some((c) => c.key === x.key))) gaps.push({ key: r.key, label: r.label, reason: 'a part cut from plate is not a length of stock' });
    return { routes, gaps, missing: [] };
  }
  for (const c of PLATE_CUTTING) gaps.push({ key: c.key, label: BAR_TUBE_ROUTES.find((r) => r.key === c.key)!.label, reason: 'a length of bar, tube or profile is not cut from plate' });

  // ── An extruded profile: billet preheat, extrusion, cut-off; its bends on the profile benders ──────────────────────────────────────
  if (part.stockForm === 'GENERIC_EXTRUSION') {
    for (const r of ['saw', 'laser'] as const) gaps.push({ key: r, label: BAR_TUBE_ROUTES.find((x) => x.key === r)!.label, reason: 'a generic profile is extruded, not bought as stock' });
    if (material.exitSpeedMaxMmS == null) {
      gaps.push({ key: 'extrusion', label: 'Extrusion', reason: `${material.name} has no extrusion exit speed (memory materials.csv lists one for the extrusion alloys)` });
      return { routes, gaps, missing: [] };
    }
    let billet: ReferenceCalcRun | null = null;
    let press: SandMachine | null = null;
    const extrude = step('Extrusion', (m) => {
      const bd = machineValue(m, 'billet_diameter_mm');
      if (bd != null && diagonal > bd + 1e-6) return fail(`its ${bd} mm billet is smaller than the ${r2(diagonal)} mm profile`);
      const b = run(BAR_TUBE_CALC.billet, m, {});
      if ('reasons' in b) return fail(...b.reasons);
      return timed(BAR_TUBE_CALC.extrusion, m, {
        extruded_mm: seed(r2(b.run.outputs['Extruded Length']!), 'the length one billet extrudes (Bar and Tube - Extrusion billet, mm)'),
        parts_per_billet: seed(b.run.outputs['Parts per Billet']!, 'parts per billet (Bar and Tube - Extrusion billet)'),
        extrusion_ratio: seed(r2(b.run.outputs['Extrusion Ratio']!), 'billet area over section area (Bar and Tube - Extrusion billet)'),
      }, {}, { billet: b.run });
    }, ['Its billet takes the profile', 'The alloy extrudes (an exit speed)']);
    const out = extrude.outcome as (Extract<StepOutcome, { ok: true }> & { billet?: ReferenceCalcRun }) | null;
    billet = out?.billet ?? null;
    press = extrude.machine;
    const billetKg = billet?.outputs['Billet Mass'] ?? null;
    const perBillet = billet?.outputs['Parts per Billet'] ?? 1;
    const preheat = step('Billet Preheat', (m) => {
      if (billetKg == null) return fail('no billet: the extrusion press has no machine');
      const d = machineValue(m, 'diameter_mm');
      const bd = press ? machineValue(press, 'billet_diameter_mm') : null;
      if (d != null && bd != null && bd > d + 1e-6) return fail(`heats billets up to ${d} mm, the press takes ${bd} mm`);
      return timed(BAR_TUBE_CALC.billetPreheat, m, {
        billet_kg: seed(r3(billetKg), `the billet (Bar and Tube - Extrusion billet on ${press?.name ?? 'the press'}, kg)`),
        billet_temp_c: seed(BILLET_TEMP_C, 'aluminium is extruded at 480 °C'), parts_per_billet: seed(perBillet, 'parts per billet'),
      });
    }, ['It heats the press\'s billet diameter']);
    const die = step('Die Preheat', (m) => timed(BAR_TUBE_CALC.diePreheat, m, {}), ['Any die oven: heated before the run, charged as its setup']);
    const cut = cheapest(allowedSaws.map(sawStep));
    const bends = bendLines([...PROFILE_BENDING]);
    const steps = [extrude, preheat, die, ...(allowedSaws.length ? [cut] : []), ...(openings > 0 ? [punchStep()] : []), ...bends.steps];
    const billetStock = billet ? { run: billet, reasons: [] } : { run: null, reasons: ['no billet: the extrusion press has no machine'] };
    finish('extrusion', steps, billetStock, {
      lines: bends.gaps, plan: bends.plan,
      priceMissing: material.costPerKgUsd == null ? `${material.name}: its price per kg (cost_usa)` : null,
      warnings: ['The extrusion die is a tooling investment and is not in this quote: no die cost is on file.'],
    });
    return { routes, gaps, missing: [] };
  }
  gaps.push({ key: 'extrusion', label: 'Extrusion', reason: `a ${part.stockForm.toLowerCase().replace(/_/g, ' ')} is bought as stock, not extruded` });

  // ── Saw and punch ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const bends = bendLines([...STOCK_BENDING]);
  const cut = cheapest([...allowedSaws.map(sawStep), shearStep()]);
  const sawKerf = SAWS.includes(cut.line.process as Saw) ? num(SAW_KERF[cut.line.process as Saw]) ?? 0 : 0;
  const sawStock = stockFor(sawKerf, SAWS.includes(cut.line.process as Saw) ? `${SAW_KERF[cut.line.process as Saw]}: the ${cut.line.process.toLowerCase()}'s kerf (mm)` : 'a shear leaves no kerf');
  finish('saw', [cut, ...(openings > 0 ? [punchStep()] : []), ...endCutSteps(), ...formSteps(), ...bends.steps], sawStock, {
    lines: bends.gaps, plan: bends.plan,
    warnings: allowedSaws.length === 0 ? [`saw_routing_evaluation allows no saw for ${part.stockForm}: only a shear can cut it.`] : [],
  });

  // ── Tube laser: tubes and open profiles; a solid bar is sawn ─────────────────────────────────────────────────────────────────────────
  if (part.stockForm.endsWith('_BAR') && !['ANGLE_BAR', 'CHANNEL_BAR'].includes(part.stockForm)) {
    gaps.push({ key: 'laser', label: 'Tube laser', reason: `a tube laser cuts tubes and open profiles, not ${part.stockForm.toLowerCase().replace(/_/g, ' ')}` });
  } else {
    const laserStock = stockFor(0, 'a laser leaves no kerf to speak of');
    const perStock = laserStock.run?.outputs['Parts per Stock'] ?? 1;
    finish('laser', [laserStep(perStock), ...formSteps(), ...bends.steps], laserStock, { lines: bends.gaps, plan: bends.plan });
  }
  return { routes, gaps, missing: [] };
}

/** The gaps worth naming for the part: not the routes of another kind of part (a plate route for a tube, the extrusion for bought stock). */
export function relevantBarTubeGaps(gaps: readonly BarTubeRouteGap[]): BarTubeRouteGap[] {
  return gaps.filter((g) => !/not cut from plate|is bought as stock, not extruded|not a length of stock|is extruded, not bought/.test(g.reason));
}

/** The route to quote: the one set in the Cost Guide when it is a route for the part, else the cheapest complete one; and a note saying which and why. */
export function chooseBarTubeRoute(routes: readonly BarTubeRoute[], gaps: readonly BarTubeRouteGap[], chosen: BarTubeRouteKey | null): { route: BarTubeRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: BarTubeRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${[...r.lines.filter(isGap).map((l) => l.process), ...(r.material.missing ? ['stock'] : [])].join(', ')})`);
  const relevant = relevantBarTubeGaps(gaps);
  const others = (pick: BarTubeRoute) => [...routes.filter((r) => r !== pick).map(said), ...relevant.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Bar and tube: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const gapsOf = (r: BarTubeRoute) => r.lines.filter(isGap).length + (r.material.missing ? 1 : 0);
  const pick = complete[0] ?? [...routes].sort((a, b) => gapsOf(a) - gapsOf(b))[0]!;
  const why = complete[0] ? 'the cheapest complete route (stock and process per part)' : 'no route is complete: the one with the fewest gaps';
  const own = pick.complete ? ` (${money(pick.totalUsd!)} per part)` : '';
  return { route: pick, note: `Bar and tube: ${pick.label} is quoted${own}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
