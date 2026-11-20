// A bar, tube or profile part's routes, priced on the staged memory/Bar and tube fab data (2026-BarTube) and the bar and tube calculators
// (migration 1091). Pure.
//
// The part is measured by cad-engine bar_tube/feature_extractor.py: its stock form and section, the centreline's developed length, the bends,
// the holes, complex holes and cutouts through the wall, each end's cut (square, angled, notch, slot) and the end forms (flare, flange,
// expansion, reduction, flattening). Two routes are compared and the cheaper is quoted (user decision 2026-11-19):
//   Saw + punch   the stock cut to length on a saw (the saws saw_routing_evaluation allows for the stock form) or a shear, the openings
//                 punched, the notched and slotted ends on their own machines
//   Tube laser    the cut, the openings and the end profiles in one setup on a tube laser (feed and pierce: process_cut_rate)
// End forms are formed on their own machines on either route. Each step on the cheapest capable machine of the location.
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

export const BAR_TUBE_ROUTES = [
  { key: 'saw', label: 'Saw and punch' },
  { key: 'laser', label: 'Tube laser' },
] as const;
export type BarTubeRouteKey = (typeof BAR_TUBE_ROUTES)[number]['key'];

/** The stock forms bought as a length of stock, and their material_stock_prices form. */
export const STOCK_PRICE_FORM: Readonly<Record<string, string>> = {
  ROUND_TUBE: 'round_tube', SQUARE_TUBE: 'square_tube', RECTANGULAR_TUBE: 'rectangular_tube', ROUND_BAR: 'round_bar', SQUARE_BAR: 'square_bar',
  RECTANGULAR_BAR: 'rectangular_bar', HEX_BAR: 'hex_bar', ANGLE_BAR: 'angle_bar', CHANNEL_BAR: 'channel_bar', I_BEAM: 'i_beam', T_BEAM: 't_beam',
};
const TUBES = new Set(['ROUND_TUBE', 'SQUARE_TUBE', 'RECTANGULAR_TUBE']);
const ROUND = new Set(['ROUND_TUBE', 'ROUND_BAR']);

const CALC = (name: string) => `Bar and Tube - ${name}`;
export const BAR_TUBE_CALC = {
  stock: CALC('Stock per part'), saw: CALC('Saw cut'), shear: CALC('Shear'), tubeLaser: CALC('Tube laser'), punching: CALC('Punching'), endForming: CALC('End forming'),
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
export interface BarTubeBend { clrMm: number; angleDeg: number }
export interface BarTubeHole { featureType: string; diameterMm: number; stationMm: number | null }
export interface BarTubeOpening { perimeterMm: number; stationMm: number | null }
export interface BarTubeEnd { end: 'start' | 'end'; variant: string; cutAngleDeg: number | null; cutPerimeterMm: number | null }

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
}

/** A bar and tube material: its cut code (saw and laser rates), density and the price of its stock form at the location. */
export interface BarTubeMaterial {
  id: string;
  name: string;
  /** The Material Cut Code Family the cut-rate lookups list for it ("1", "30"); null when they list none. */
  cutCodeFamily: string | null;
  cutCode: number | null;
  densityKgM3: number | null;
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

export interface BarTubeRoute {
  key: BarTubeRouteKey;
  label: string;
  lines: ProcessLineCost[];
  /** The stock bought per part: its mass (the part's share of a stock length) and the part's own mass. */
  material: { costUsd: number | null; massKg: number; partKg: number; partsPerStock: number | null; run: ReferenceCalcRun | null; missing: string | null };
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

/** The machine processes the part's routes may run, by class (the service loads exactly these). */
export const BAR_TUBE_ROUTE_CLASSES: readonly string[] = [
  ...SAWS, 'Shear', 'Punching', 'Tube Laser', ...Object.values(FORM_PROCESS), ...Object.values(END_CUT_PROCESS),
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
  const materialValues: Readonly<Record<string, { value: number | null; label: string }>> = {
    density_kg_m3: { value: material.densityKgM3, label: 'density (kg/m³)' },
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
  const timed = (calculator: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups: Record<string, CalcSeed | undefined> = {}): StepOutcome => {
    const r = run(calculator, m, engine, lookups);
    return 'run' in r ? { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: 0, notes: [] } : fail(...r.reasons);
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

  // ── Steps both routes share: the end forms ────────────────────────────────────────────────────────────────────────────────────────
  const formSteps = (): CostedStep[] => {
    const byProcess = new Map<string, number>();
    for (const f of forms) byProcess.set(FORM_PROCESS[f.variant]!, (byProcess.get(FORM_PROCESS[f.variant]!) ?? 0) + 1);
    return [...byProcess].map(([process, ends]) => step(process, (m) => {
      const fit = fitsStock(m);
      if (fit) return fail(fit);
      return timed(BAR_TUBE_CALC.endForming, m, { ends: seed(ends, `${ends} end(s) ${process.toLowerCase()} (the cad-engine's end forms)`) });
    }, ['The stock fits its diameter range']));
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
    const t = sec.wallMm ?? Math.min(sec.widthMm, sec.heightMm);
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
    if (thick != null && t > thick + 1e-6) return fail(`shears up to ${thick} mm thick, the section is ${r2(t)} mm`);
    return timed(BAR_TUBE_CALC.shear, m, {});
  }, ['A square cut', 'Its capacity for the stock form holds the section']);

  /** Punching: every opening one hit; the holes within the machine's diameter and the wall within its thickness. */
  const punchStep = (): CostedStep => step('Punching', (m) => {
    const fit = fitsStock(m);
    if (fit) return fail(fit);
    const t = sec.wallMm ?? Math.min(sec.widthMm, sec.heightMm);
    const maxT = machineValue(m, 'max_stock_thickness_mm');
    if (maxT != null && t > maxT + 1e-6) return fail(`punches up to ${maxT} mm thick, the wall is ${r2(t)} mm`);
    const maxHole = machineValue(m, 'max_hole_diameter_mm');
    const big = roundHoles.find((h) => maxHole != null && h.diameterMm > maxHole + 1e-6);
    if (big) return fail(`punches holes up to ${maxHole} mm, one is ${r2(big.diameterMm)} mm`);
    const ratio = machineValue(m, 'min_hole_dia_to_thickness_ratio');
    const small = roundHoles.find((h) => ratio != null && h.diameterMm < ratio * t - 1e-6);
    if (small) return fail(`a punched hole is at least ${ratio} x the wall (${r2(ratio! * t)} mm), one is ${r2(small.diameterMm)} mm`);
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
  const laserRates = ref.table('process_cut_rate').filter((r) => r['Machine Type'] === 'Tube Laser');
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
    if (!material.cutCodeFamily) return fail(`process_cut_rate lists no cut-code family for ${material.name}`);
    const t = sec.wallMm ?? Math.min(sec.widthMm, sec.heightMm);
    const watts = machineValue(m, 'power_watts');
    const rows = laserRates.filter((r) => String(r['Material Cut Code Family']) === material.cutCodeFamily && (watts == null || Number(r['Power (Watts)']) === watts))
      .sort((a, b) => Number(a['Thickness (mm)']) - Number(b['Thickness (mm)']));
    if (rows.length === 0) {
      const families = [...new Set(laserRates.map((r) => String(r['Material Cut Code Family'])))].join(', ');
      return fail(`process_cut_rate has no Tube Laser feed for cut-code family ${material.cutCodeFamily}${watts != null ? ` at ${watts} W` : ''} (it lists famil${families.includes(',') ? 'ies' : 'y'} ${families})`);
    }
    const row = rows.find((r) => Number(r['Thickness (mm)']) >= t - 1e-6);
    if (!row) return fail(`process_cut_rate's Tube Laser feeds stop at ${rows[rows.length - 1]!['Thickness (mm)']} mm, the wall is ${r2(t)} mm`);
    const id = ['Material Cut Code Family', 'Machine Type', 'Power (Watts)', 'Thickness (mm)'];
    return timed(BAR_TUBE_CALC.tubeLaser, m, {
      large_cut_mm: seed(r2(largeCut), 'end cuts (half of each end, a cut parts two lengths), notches, slots, complex holes and cutouts (mm)'),
      small_cut_mm: seed(r2(smallCut), `${roundHoles.length} round hole(s), π × diameter each (mm)`),
      pierces: seed(pierces, 'one per contour'),
      parts_per_stock: seed(partsPerStock, `${partsPerStock} parts per stock length (Bar and Tube - Stock per part)`),
    }, {
      'process_cut_rate.Feed Rate Large Features (mm / min)': lookupSeed('process_cut_rate', row, 'Feed Rate Large Features (mm / min)', id),
      'process_cut_rate.Feed Rate Small Features (mm / min)': lookupSeed('process_cut_rate', row, 'Feed Rate Small Features (mm / min)', id),
      'process_cut_rate.Pierce Time (s)': lookupSeed('process_cut_rate', row, 'Pierce Time (s)', id),
    });
  }, ['The stock fits its diameter and length', 'process_cut_rate has a feed for the material at the wall thickness and its power']);

  // ── What neither route makes yet: bends (bending is costed with the bending methods) ─────────────────────────────────────────────────
  const notYet = (process: string, reason: string): ProcessLineCost => ({
    process, processGroup: BAR_TUBE_PROCESS_GROUP, processRoute: process, operation: process,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: barTubeClass(process), machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process, machineClass: barTubeClass(process), reason },
  });
  const pending: ProcessLineCost[] = [];
  if (part.bends.length) pending.push(notYet('Bending', `${part.bends.length} bend(s): the bending methods (rotary draw, compression, roll, bend brake) are not costed yet`));
  for (const v of unknownForms) pending.push(notYet('End Forming', `an end form the reference has no process for (${v})`));

  const cheapest = (steps: CostedStep[]): CostedStep => {
    const costed = steps.filter((s) => !isGap(s.line)).sort((a, b) => a.line.totalCost - b.line.totalCost);
    return costed[0] ?? steps[0]!;
  };

  const routes: BarTubeRoute[] = [];
  const gaps: BarTubeRouteGap[] = [];
  const partKg = (part.developedLengthMm * sec.areaMm2 * material.densityKgM3) / 1e9;
  const finish = (key: BarTubeRouteKey, steps: CostedStep[], stock: { run: ReferenceCalcRun | null; reasons: string[] }, extra: string[] = []) => {
    const lines = [...steps.map((s) => (s.line.process === 'Tube Laser' || SAWS.includes(s.line.process as Saw) || s.line.process === 'Shear' ? { ...s.line, formsPartFeatures: true } : s.line)), ...pending];
    const priceMissing = material.stockPricePerKgUsd == null ? `no ${STOCK_PRICE_FORM[part.stockForm] ?? part.stockForm} price for ${material.name} (material_stock_prices)` : null;
    const materialMissing = stock.reasons[0] ?? priceMissing;
    const materialCost = stock.run && !priceMissing ? stock.run.value! : null;
    const complete = !lines.some(isGap) && materialCost != null;
    routes.push({
      key, label: BAR_TUBE_ROUTES.find((r) => r.key === key)!.label, lines,
      material: {
        costUsd: materialCost, massKg: r3(stock.run?.outputs['Mass per Part'] ?? partKg), partKg: r3(partKg),
        partsPerStock: stock.run?.outputs['Parts per Stock'] ?? null, run: stock.run, missing: materialMissing,
      },
      totalUsd: complete ? r2(materialCost! + lines.reduce((s, l) => s + l.totalCost, 0)) : null,
      complete,
      warnings: [...steps.flatMap((s) => s.warnings), ...extra, ...(materialMissing ? [`The stock is not costed: ${materialMissing}.`] : [])],
    });
  };

  // Saw and punch.
  const cutters = [...allowedSaws.map(sawStep), shearStep()];
  const cut = cheapest(cutters);
  const sawKerf = SAWS.includes(cut.line.process as Saw) ? num(SAW_KERF[cut.line.process as Saw]) ?? 0 : 0;
  const sawStock = stockFor(sawKerf, SAWS.includes(cut.line.process as Saw) ? `${SAW_KERF[cut.line.process as Saw]}: the ${cut.line.process.toLowerCase()}'s kerf (mm)` : 'a shear leaves no kerf');
  const sawSteps = [cut, ...(openings > 0 ? [punchStep()] : []), ...endCutSteps(), ...formSteps()];
  finish('saw', sawSteps, sawStock, allowedSaws.length === 0 ? [`saw_routing_evaluation allows no saw for ${part.stockForm}: only a shear can cut it.`] : []);

  // Tube laser: tubes and profiles; a solid bar is sawn.
  if (part.stockForm.endsWith('_BAR') && !['ANGLE_BAR', 'CHANNEL_BAR'].includes(part.stockForm)) {
    gaps.push({ key: 'laser', label: 'Tube laser', reason: `a tube laser cuts tubes and open profiles, not ${part.stockForm.toLowerCase().replace(/_/g, ' ')}` });
  } else {
    const laserStock = stockFor(0, 'a laser leaves no kerf to speak of');
    const perStock = laserStock.run?.outputs['Parts per Stock'] ?? 1;
    finish('laser', [laserStep(perStock), ...formSteps()], laserStock);
  }
  return { routes, gaps, missing: [] };
}

/** The route to quote: the one set in the Cost Guide when it is a route for the part, else the cheapest complete one; and a note saying which and why. */
export function chooseBarTubeRoute(routes: readonly BarTubeRoute[], gaps: readonly BarTubeRouteGap[], chosen: BarTubeRouteKey | null): { route: BarTubeRoute | null; note: string | null } {
  if (routes.length === 0) return { route: null, note: null };
  const money = (n: number) => `${n.toFixed(2)} USD`;
  const said = (r: BarTubeRoute) => (r.complete ? `${r.label} ${money(r.totalUsd!)}` : `${r.label} incomplete (${[...r.lines.filter(isGap).map((l) => l.process), ...(r.material.missing ? ['stock'] : [])].join(', ')})`);
  const others = (pick: BarTubeRoute) => [...routes.filter((r) => r !== pick).map(said), ...gaps.map((g) => `${g.label} not a route for this part (${g.reason})`)].join('; ');
  const user = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (user) return { route: user, note: `Bar and tube: ${user.label} is set in the Cost Guide. ${others(user)}.` };
  const complete = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!);
  const gapsOf = (r: BarTubeRoute) => r.lines.filter(isGap).length + (r.material.missing ? 1 : 0);
  const pick = complete[0] ?? [...routes].sort((a, b) => gapsOf(a) - gapsOf(b))[0]!;
  const why = complete[0] ? 'the cheapest complete route (stock and process per part)' : 'no route is complete: the one with the fewest gaps';
  const own = pick.complete ? ` (${money(pick.totalUsd!)} per part)` : '';
  return { route: pick, note: `Bar and tube: ${pick.label} is quoted${own}, ${why}.${others(pick) ? ` ${others(pick)}.` : ''}` };
}
