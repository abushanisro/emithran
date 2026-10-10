// High pressure die casting die (tooling) cost, amortised over die life.
// Pure: the caller loads the staged rows (CastingReferenceService.getDieToolingReference)
// and the HPDC result; nothing here holds a reference value.
//
// Sources (user decisions 2026-10-04: H13 die steel; cavity machining table
// chosen from the part feature count):
//   memory/Die Casting variables
//     defaultMoldConstruction            Standard / Custom base design column
//     partingLineBaseDesignTime, partingLineDesignTimePerSlide   design hours
//     projAreaPerEjectorPin, ejectorPinsCost, ejPinsAssTimePerTool  ejector pins
//     densityH13, machinabilityMultiplierH13ToolSteel                die steel
//     percentTuning, percentSGandA, percentProfit                    on the die
//     defaultToolLife                    shots per die for a type tblToolLife lacks
//   memory/Die Casting lookups
//     tblEdgeMoldBorderX / Y             die border each side, by press force
//     tblCavityPlateDepthBorder / tblCorePlateDepthBorder  plate depth border (in), by press force
//     tblMoldBaseDesignTime              design hours by cavities and die width
//     tblHrsPerSqInchSimple / Average / Complex  cavity machining hours per in2 of part surface
//     tblToolLife                        shots per die by alloy material type
//   the Digital Factory USA "Default" tool shop (memory/Plastic Modeling/process,
//   named by memory/Die Casting/Processes/processDefaults.csv Default Tool Shop Name)
//     digital_factory_settings_usa       design / machining / assembly USD/hr
//     digital_factory_tool_materials_usa AISI H13 materialCostUsdPerKg
//
// The die:
//   borders       High Pressure Die Casting: by the selected machine clamping
//                 force (the die runs in it), tblEdgeMoldBorderX / Y and
//                 tblCavityPlateDepthBorder + tblCorePlateDepthBorder
//                 (pressDieBorders). Gravity Die Casting (a permanent mould, no
//                 clamp): edgeBorderPM each side and depthBorderPM below each
//                 half's cavity (permanentMoldBorders)
//   die X x Y     cavity layout footprint (longer side on X) + 2 x edge border X / Y
//   die depth     part extent along the pull axis + the two depth borders
//   steel         X x Y x depth x densityH13 x H13 price
//   design hr     tblMoldBaseDesignTime (first row with cavities >= n and width
//                 >= the die short side) base + per slide x slides,
//                 + partingLineBaseDesignTime + partingLineDesignTimePerSlide x slides
//   machining hr  tblHrsPerSqInch[complexity] (first row whose surface area bound
//                 is at or above the part area) x part area (in2) x n
//                 x machinabilityMultiplierH13ToolSteel
//   ejector pins  ceil(n x projected area (in2) / projAreaPerEjectorPin);
//                 cost x ejectorPinsCost, assembly x ejPinsAssTimePerTool
//   die cost      (steel + pins + hours x tool shop rates) x (1 + tuning + SG&A + profit)
//   dies          ceil(lifetime shots / shots per die); a replacement die is the
//                 die cost without its design hours (the design is reused)
//   per part      all dies / (annual volume x production life)
//
// Complexity (cavity machining table): the part feature count against the
// thresholds memory gives in the notes of lowComplexityFactor (< 1000 features),
// mediumComplexityFactor (1000-2000) and highComplexityFactor (> 2000); low ->
// Simple, medium -> Average, high -> Complex.
//
//   heat treat    die steel kg x stdHeatTreatCostPerMass x compHeatTreatCost (the
//                 calibration dial, read as a multiplier)
//   guide pins    numGuidePins x the smallest componentStandardCosts guidePinAssy
//                 (memory has no size rule; the smallest, as the progressive die
//                 does); assembly numGuidePins x guidePinsAssTimePerTool
//   coating       none: memory names a default tooling coating only for
//                 high-strength part materials (highStrengthMatlToolingCoatingType)
//   sprue         pressure die: one sprue bushing, one sprue spreader and
//                 locatingRings locating rings (memory gives their cost and
//                 assembly time per piece, no count: one each per die)
//   cooling       numRowsWaterChCavHoles + numRowsWaterChCoreHoles gun-drilled
//                 channels, each across the die length: drill gunDrillSetup +
//                 length / waterlineDrillSpeed, tap gunTapSetup + gunTapTime and
//                 counterbore cboreSetup + cboreTime per channel, design
//                 max(minWaterChannelDesignTime, channels x waterChannelDesignTime)
//   slides        per slide bundle, by its width against
//                 small/mediumSlideBundleWidthThreshold: small/medium/large
//                 SlideVolume of H13 (+ heat treat), its SlideDesignTime +
//                 slideCutterPathTimePerTool, CNC slideCNCMachRate x volume +
//                 slideSetup, pocket slidesCNCRate x volume + slidePocketSetup,
//                 assembly slideAssTimePerTool, spotting spotSlidesTimePerTool,
//                 inspection slideInspectTimePerTool (+ slideInspectSetup once)
//
// Not modelled, and said so: cooling baffles, hoses, manifolds, fittings and
// quick disconnects (die-casting memory gives each piece cost and assembly
// time but no count).
// The tool shop rates are USA only: anywhere else the hours are reported, not priced.


import type { CalculatorRunDto } from '../../dto/cost-breakdown.dto';
import { runReferenceCalculator, type CalcSeed, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { castingSeed, runView, SeedSet } from './casting-calculator-seeds';

const MM_PER_IN = 25.4;
const MM2_PER_IN2 = MM_PER_IN * MM_PER_IN;

/** Feature-count complexity thresholds, from the notes of the memory/Die Casting
 *  variables lowComplexityFactor ("less than 1000 features") and
 *  highComplexityFactor ("more than 2000 features"). */
export const COMPLEXITY_FEATURE_THRESHOLDS = { lowBelow: 1000, highAbove: 2000 } as const;

type DieComplexity = 'Simple' | 'Average' | 'Complex';

export const DIE_TOOLING_VARIABLE_KEYS = [
  'partingLineBaseDesignTime', 'partingLineDesignTimePerSlide', 'projAreaPerEjectorPin', 'ejectorPinsCost',
  'ejPinsAssTimePerTool', 'densityH13', 'machinabilityMultiplierH13ToolSteel', 'percentTuning', 'percentSGandA',
  'percentProfit', 'defaultToolLife', 'edgeBorderPM', 'depthBorderPM',
  'stdHeatTreatCostPerMass', 'compHeatTreatCost', 'numGuidePins', 'guidePinsAssTimePerTool',
  'sprueBushingCost', 'sprueSpreaderCost', 'sprBushSpreadAssTimePerTool', 'locatingRings', 'locatingRingsCost', 'locatRingsAssTimePerTool',
  'numRowsWaterChCavHoles', 'numRowsWaterChCoreHoles', 'gunDrillSetup', 'waterlineDrillSpeed', 'gunTapSetup', 'gunTapTime',
  'cboreSetup', 'cboreTime', 'waterChannelDesignTime', 'minWaterChannelDesignTime',
  'smallSlideBundleWidthThreshold', 'mediumSlideBundleWidthThreshold', 'smallSlideVolume', 'mediumSlideVolume', 'largeSlideVolume',
  'smallSlideDesignTime', 'mediumSlideDesignTime', 'largeSlideDesignTime', 'slideCutterPathTimePerTool',
  'slideCNCMachRate', 'slideSetup', 'slidesCNCRate', 'slidePocketSetup', 'slideAssTimePerTool', 'spotSlidesTimePerTool',
  'slideInspectSetup', 'slideInspectTimePerTool',
] as const;
/** String-valued variable: 'Standard Mold Base' or 'Custom Mold Base'. */
export const DIE_TOOLING_TEXT_VARIABLE_KEYS = ['defaultMoldConstruction'] as const;

export const DIE_TOOLING_LOOKUP_KEYS = [
  'tblEdgeMoldBorderX', 'tblEdgeMoldBorderY', 'tblCavityPlateDepthBorder', 'tblCorePlateDepthBorder',
  'tblMoldBaseDesignTime', 'tblHrsPerSqInchSimple', 'tblHrsPerSqInchAverage', 'tblHrsPerSqInchComplex', 'tblToolLife',
  'componentStandardCosts',
] as const;

/** The tool shop tables, staged with the Plastic Modeling domain (migration 823). */
export const TOOL_SHOP_LOOKUP_KEYS = ['digital_factory_settings_usa', 'digital_factory_tool_materials_usa'] as const;
const TOOL_SHOP_NAME = 'Default';
const DIE_STEEL = 'AISI H13';

export interface DieToolingReference {
  v: Record<(typeof DIE_TOOLING_VARIABLE_KEYS)[number], number>;
  customBase: boolean;
  borderX: Array<{ maxKn: number; mm: number | null }>;
  borderY: Array<{ maxKn: number; mm: number | null }>;
  cavityDepthBorder: Array<{ maxKn: number; in: number }>;
  coreDepthBorder: Array<{ maxKn: number; in: number }>;
  designTime: Array<{ cavities: number; widthMm: number; standardHr: number; customHr: number; perSlideHr: number }>;
  hrsPerSqIn: Record<DieComplexity, Array<{ maxAreaIn2: number; hrPerIn2: number }>>;
  toolLifeShotsByType: Map<string, number>;
  /** componentStandardCosts guidePinAssy, the smallest catalogued size. */
  guidePin: { model: string; sizeMm: number; costUsd: number };
  /** Default tool shop, USD. */
  toolShop: { designUsdPerHr: number; machiningUsdPerHr: number; assemblyUsdPerHr: number; h13UsdPerKg: number };
}

export interface DieToolingRows {
  variables: ReadonlyArray<{ key: string; value: string | number | null }>;
  lookups: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
  toolShop: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function resolveDieToolingReference(rows: DieToolingRows): { reference: DieToolingReference | null; missing: string[] } {
  const missing: string[] = [];
  const raw = new Map(rows.variables.map((x) => [x.key, x.value]));
  const v = {} as DieToolingReference['v'];
  for (const k of DIE_TOOLING_VARIABLE_KEYS) {
    const n = num(raw.get(k));
    if (n == null) missing.push(`variables: ${k}`);
    v[k] = n ?? NaN;
  }
  const construction = String(raw.get('defaultMoldConstruction') ?? '').trim();
  if (construction !== 'Standard Mold Base' && construction !== 'Custom Mold Base') {
    missing.push(`variables: defaultMoldConstruction (${construction || 'not staged'})`);
  }
  const table = (k: string, src = rows.lookups) => {
    const t = src[k];
    if (!t || t.length === 0) missing.push(`${k} (not staged)`);
    return t ?? [];
  };
  const byForce = (k: string, valueCol: string) => table(k).map((r) => ({
    maxKn: num(r['Max Press Force KN (kN)'] ?? r['Max Press Force (kN)']) ?? NaN,
    value: num(r[valueCol]),
  })).sort((a, b) => a.maxKn - b.maxKn);
  const borderX = byForce('tblEdgeMoldBorderX', 'Edge Mold Border X (mm)').map((r) => ({ maxKn: r.maxKn, mm: r.value }));
  const borderY = byForce('tblEdgeMoldBorderY', 'Edge Mold Border Y (mm)').map((r) => ({ maxKn: r.maxKn, mm: r.value }));
  const cavityDepthBorder = byForce('tblCavityPlateDepthBorder', 'Cavity Plate Depth Border (in)').map((r) => ({ maxKn: r.maxKn, in: r.value ?? NaN }));
  const coreDepthBorder = byForce('tblCorePlateDepthBorder', 'Core Plate Depth Border (in)').map((r) => ({ maxKn: r.maxKn, in: r.value ?? NaN }));
  const designTime = table('tblMoldBaseDesignTime').map((r) => ({
    cavities: num(r['Number of Cavities']) ?? NaN,
    widthMm: num(r['Mold Base Width (mm)']) ?? NaN,
    standardHr: num(r['Standard Base Design Time (hr)']) ?? NaN,
    customHr: num(r['Custom Base Design Time (hr)']) ?? NaN,
    perSlideHr: num(r['Per Slide Design Time (hr)']) ?? NaN,
  })).sort((a, b) => a.cavities - b.cavities || a.widthMm - b.widthMm);
  const hrs = (c: DieComplexity) => table(`tblHrsPerSqInch${c}`).map((r) => ({
    maxAreaIn2: num(r[`Surface Area ${c} (in^2)`]) ?? NaN,
    hrPerIn2: num(r[`Hrs Per Sq Inch ${c} (hr / in^2)`]) ?? NaN,
  })).sort((a, b) => a.maxAreaIn2 - b.maxAreaIn2);
  const hrsPerSqIn = { Simple: hrs('Simple'), Average: hrs('Average'), Complex: hrs('Complex') };
  const toolLifeShotsByType = new Map<string, number>();
  for (const r of table('tblToolLife')) {
    const n = num(r['Num Shots Per Tool']);
    if (n != null) toolLifeShotsByType.set(String(r['Material Type']), n);
  }

  const guidePin = table('componentStandardCosts')
    .filter((r) => r['Name'] === 'guidePinAssy')
    .map((r) => ({ model: String(r['Model'] ?? ''), sizeMm: num(r['Size (mm)']) ?? NaN, costUsd: num(r['Cost (USD)']) ?? NaN }))
    .filter((r) => Number.isFinite(r.sizeMm) && Number.isFinite(r.costUsd))
    .sort((a, b) => a.sizeMm - b.sizeMm)[0];
  if (!guidePin) missing.push('componentStandardCosts: guidePinAssy');

  const settings = table('digital_factory_settings_usa', rows.toolShop).find((r) => r['name'] === TOOL_SHOP_NAME);
  const steel = table('digital_factory_tool_materials_usa', rows.toolShop).find((r) => r['name'] === DIE_STEEL);
  const shopNum = (row: Record<string, unknown> | undefined, field: string, what: string) => {
    const n = num(row?.[field]);
    if (n == null || n <= 0) { missing.push(`${what}: ${field}`); return NaN; }
    return n;
  };
  const toolShop = {
    designUsdPerHr: shopNum(settings, 'designRateUsdPerHr', `tool shop ${TOOL_SHOP_NAME}`),
    machiningUsdPerHr: shopNum(settings, 'machiningRateUsdPerHr', `tool shop ${TOOL_SHOP_NAME}`),
    assemblyUsdPerHr: shopNum(settings, 'assemblyRateUsdPerHr', `tool shop ${TOOL_SHOP_NAME}`),
    h13UsdPerKg: shopNum(steel, 'materialCostUsdPerKg', DIE_STEEL),
  };

  const reference: DieToolingReference = {
    v, customBase: construction === 'Custom Mold Base',
    borderX, borderY, cavityDepthBorder, coreDepthBorder, designTime, hrsPerSqIn, toolLifeShotsByType, toolShop,
    guidePin: guidePin ?? { model: '', sizeMm: NaN, costUsd: NaN },
  };
  return { reference: missing.length ? null : reference, missing };
}

export function complexityOfFeatureCount(featureCount: number): DieComplexity {
  if (featureCount < COMPLEXITY_FEATURE_THRESHOLDS.lowBelow) return 'Simple';
  if (featureCount > COMPLEXITY_FEATURE_THRESHOLDS.highAbove) return 'Complex';
  return 'Average';
}

/** Die borders around the cavity layout (each an input of the Die Size calculator, with its source). */
export interface DieBorders { x: CalcSeed; y: CalcSeed; cavityDepth: CalcSeed; coreDepth: CalcSeed; source: string }

/** HPDC: borders by the press the die runs in (tblEdgeMoldBorderX/Y, tblCavity/CorePlateDepthBorder). */
export function pressDieBorders(ref: DieToolingReference, pressForceKn: number): { borders: DieBorders } | { reason: string } {
  const bx = firstAtOrAbove(ref.borderX, (r) => r.maxKn, pressForceKn);
  const by = firstAtOrAbove(ref.borderY, (r) => r.maxKn, pressForceKn);
  if (bx?.mm == null || by?.mm == null) return { reason: `tblEdgeMoldBorderX/Y has no border for a ${pressForceKn} kN press.` };
  const cav = firstAtOrAbove(ref.cavityDepthBorder, (r) => r.maxKn, pressForceKn);
  const core = firstAtOrAbove(ref.coreDepthBorder, (r) => r.maxKn, pressForceKn);
  if (!cav || !core) return { reason: `tblCavityPlateDepthBorder / tblCorePlateDepthBorder has no row for a ${pressForceKn} kN press.` };
  const inMm = (inches: number, table: string, row: Record<string, number>): CalcSeed => ({
    ...castingSeed.lookup(table, table === 'tblCavityPlateDepthBorder' ? 'Cavity Plate Depth Border (in)' : 'Core Plate Depth Border (in)', inches * MM_PER_IN, row),
    source: `${table} ${inches} in = ${r2(inches * MM_PER_IN)} mm (Max Press Force ${row['Max Press Force (kN)']} kN)`,
  });
  return {
    borders: {
      x: castingSeed.lookup('tblEdgeMoldBorderX', 'Edge Mold Border X (mm)', bx.mm, { 'Max Press Force KN (kN)': bx.maxKn }),
      y: castingSeed.lookup('tblEdgeMoldBorderY', 'Edge Mold Border Y (mm)', by.mm, { 'Max Press Force KN (kN)': by.maxKn }),
      cavityDepth: inMm(cav.in, 'tblCavityPlateDepthBorder', { 'Max Press Force (kN)': cav.maxKn }),
      coreDepth: inMm(core.in, 'tblCorePlateDepthBorder', { 'Max Press Force (kN)': core.maxKn }),
      source: `${pressForceKn} kN press: tblEdgeMoldBorderX ${bx.mm}, Y ${by.mm} mm; plate depth borders ${cav.in} + ${core.in} in`,
    },
  };
}

/** GDC: the permanent-mould borders (edgeBorderPM each side, depthBorderPM below each half). */
export function permanentMoldBorders(ref: DieToolingReference): { borders: DieBorders } {
  const e = ref.v.edgeBorderPM;
  const d = ref.v.depthBorderPM;
  return {
    borders: {
      x: castingSeed.variable('edgeBorderPM', e), y: castingSeed.variable('edgeBorderPM', e),
      cavityDepth: castingSeed.variable('depthBorderPM', d), coreDepth: castingSeed.variable('depthBorderPM', d),
      source: `permanent mould: edgeBorderPM ${e} mm each side, depthBorderPM ${d} mm per half`,
    },
  };
}

export interface DieToolingInput {
  reference: DieToolingReference;
  /** The die-casting calculators (database), keyed by calculator key. */
  calculators: ReferenceCalculators | null;
  borders: DieBorders;
  /** The die-casting machine clamping force (kN); null for a gravity machine. */
  pressForceKn: number | null;
  cavities: { count: number; lengthWise: number; widthWise: number };
  footprintMm: [number, number];
  pullExtentMm: number | null;
  projectedAreaMm2: number;
  surfaceAreaMm2: number | null;
  /** Part feature occurrences (feature_graph_v2 counts). */
  featureCount: number;
  slideCount: number;
  /** Width (mm) of each slide bundle, cad-engine SlideBundle extent; null when not measured. */
  slideWidthsMm: ReadonlyArray<number | null>;
  materialType: string | null;
  annualVolume: number | null;
  productionLifeYears: number | null;
  /** Tool shop rates exist for USA only. */
  location: string;
}

export interface DieToolingResult {
  ok: boolean;
  /** Why the die could not be costed (ok false). */
  reason: string | null;
  dieSizeMm: [number, number, number] | null;
  pressForceKn: number | null;
  complexity: DieComplexity;
  featureCount: number;
  steelKg: number | null;
  steelUsd: number | null;
  designHr: number | null;
  machiningHr: number | null;
  assemblyHr: number | null;
  ejectorPins: number | null;
  ejectorPinsUsd: number | null;
  /** Hours x tool shop rates; null outside USA. */
  labourUsd: number | null;
  markupPct: number;
  /** One die, all-in (null when part of it cannot be priced). */
  dieCostUsd: number | null;
  shotsPerDie: number | null;
  diesRequired: number | null;
  totalToolingUsd: number | null;
  perPartUsd: number | null;
  trace: Array<{ label: string; value: string }>;
  /** The calculators behind the die (Die Size, Slide n, Die Build, Die Cost, Die Life). */
  runs: Record<string, CalculatorRunDto>;
  warnings: string[];
}

const firstAtOrAbove = <T>(rows: readonly T[], bound: (r: T) => number, value: number): T | undefined =>
  rows.find((r) => value <= bound(r));

const COMPLEXITY_TABLE: Record<DieComplexity, string> = { Simple: 'tblHrsPerSqInchSimple', Average: 'tblHrsPerSqInchAverage', Complex: 'tblHrsPerSqInchComplex' };

export function computeDieTooling(input: DieToolingInput): DieToolingResult {
  const ref = input.reference;
  const v = ref.v;
  const calcs = input.calculators;
  const n = input.cavities.count;
  const complexity = complexityOfFeatureCount(input.featureCount);
  const trace: DieToolingResult['trace'] = [];
  const warnings: string[] = [];
  const runs: Record<string, CalculatorRunDto> = {};
  const base: DieToolingResult = {
    ok: false, reason: null, dieSizeMm: null, pressForceKn: input.pressForceKn, complexity, featureCount: input.featureCount,
    steelKg: null, steelUsd: null, designHr: null, machiningHr: null, assemblyHr: null, ejectorPins: null, ejectorPinsUsd: null,
    labourUsd: null, markupPct: v.percentTuning + v.percentSGandA + v.percentProfit,
    dieCostUsd: null, shotsPerDie: null, diesRequired: null, totalToolingUsd: null, perPartUsd: null, trace, runs, warnings,
  };
  const fail = (reason: string): DieToolingResult => ({ ...base, reason, warnings: [...warnings, `Die tooling not costed: ${reason}`] });
  const run = (key: string, name: string, output: string, seeds: Record<string, CalcSeed>, label = key) => {
    const r = runReferenceCalculator(calcs, key, seeds, output);
    runs[label] = runView(name, output, r);
    return r;
  };

  // ── Die Size ────────────────────────────────────────────────────────────
  if (!(input.pullExtentMm && input.pullExtentMm > 0)) return fail('part depth along the pull axis not measured (re-run analysis as a casting process).');
  const [fa, fb] = [...input.footprintMm].sort((a, b) => b - a) as [number, number];
  const layoutA = Math.max(input.cavities.lengthWise * fa, input.cavities.widthWise * fb);
  const layoutB = Math.min(input.cavities.lengthWise * fa, input.cavities.widthWise * fb);
  const layout = `${input.cavities.lengthWise} × ${input.cavities.widthWise} cavity layout of ${r2(fa)} × ${r2(fb)} mm parts`;
  const b = input.borders;
  const size = run('Die Size', 'Die Casting - Die Size', 'Die Steel Weight', {
    'Layout Length': castingSeed.engine(layoutA, `${layout} (longer side, mm)`),
    'Layout Width': castingSeed.engine(layoutB, `${layout} (shorter side, mm)`),
    'Edge Border X': b.x, 'Edge Border Y': b.y,
    'Cavity Half Depth Border': b.cavityDepth, 'Core Half Depth Border': b.coreDepth,
    'Pull Extent': castingSeed.cad(input.pullExtentMm, 'part depth along the pull axis (mm)'),
    'H13 Density': castingSeed.variable('densityH13', v.densityH13),
  });
  if (size.value == null) return fail(size.missing.join('; '));
  const dieX = size.outputs['Die Length']!;
  const dieY = size.outputs['Die Width']!;
  const dieZ = size.outputs['Die Depth']!;
  trace.push({ label: 'Die size', value: `${r2(dieX)} × ${r2(dieY)} × ${r2(dieZ)} mm, ${r2(size.value)} kg H13 (Die Size calculator; ${b.source})` });

  // ── Slides, one per slide bundle, sized by the bundle width ─────────────
  const slideTotals = { kg: 0, design: 0, machining: 0, assembly: 0 };
  const unsized: number[] = [];
  input.slideWidthsMm.forEach((w, i) => {
    if (w == null) { unsized.push(i + 1); return; }
    const sz = w <= v.smallSlideBundleWidthThreshold ? 'small' : w <= v.mediumSlideBundleWidthThreshold ? 'medium' : 'large';
    const volKey = `${sz}SlideVolume` as const;
    const designKey = `${sz}SlideDesignTime` as const;
    const r = run('Slide', 'Die Casting - Slide', 'Slide Steel Weight', {
      'Slide Volume': { ...castingSeed.variable(volKey, v[volKey]), source: `variables ${volKey} = ${v[volKey]} in³ (bundle ${r2(w)} mm wide: ${sz}, thresholds smallSlideBundleWidthThreshold ${v.smallSlideBundleWidthThreshold} / mediumSlideBundleWidthThreshold ${v.mediumSlideBundleWidthThreshold} mm)` },
      'Slide Design Time': castingSeed.variable(designKey, v[designKey]),
      'H13 Density': castingSeed.variable('densityH13', v.densityH13),
      'Cutter Path Time': castingSeed.variable('slideCutterPathTimePerTool', v.slideCutterPathTimePerTool),
      'Slide CNC Rate': castingSeed.variable('slideCNCMachRate', v.slideCNCMachRate),
      'Slide Setup': castingSeed.variable('slideSetup', v.slideSetup),
      'Pocket CNC Rate': castingSeed.variable('slidesCNCRate', v.slidesCNCRate),
      'Pocket Setup': castingSeed.variable('slidePocketSetup', v.slidePocketSetup),
      'Slide Assembly Time': castingSeed.variable('slideAssTimePerTool', v.slideAssTimePerTool),
      'Spotting Time': castingSeed.variable('spotSlidesTimePerTool', v.spotSlidesTimePerTool),
      'Slide Inspection Time': castingSeed.variable('slideInspectTimePerTool', v.slideInspectTimePerTool),
    }, `Slide ${i + 1}`);
    if (r.value == null) { unsized.push(i + 1); return; }
    slideTotals.kg += r.value;
    slideTotals.design += r.outputs['Slide Design Hours']!;
    slideTotals.machining += r.outputs['Slide Machining Hours']!;
    slideTotals.assembly += r.outputs['Slide Assembly Hours']!;
    trace.push({ label: `Slide ${i + 1}`, value: `${r2(w)} mm wide: ${sz}, ${r2(r.value)} kg H13 (Slide calculator)` });
  });
  if (unsized.length) warnings.push(`Die tooling: slide${unsized.length === 1 ? '' : 's'} ${unsized.join(', ')} not costed as steel: slide bundle width not measured (re-run analysis).`);
  const sized = input.slideWidthsMm.length - unsized.length;
  const slideSum = (value: number, what: string) => castingSeed.engine(value, sized ? `sum over the ${sized} sized slide${sized === 1 ? '' : 's'} (Slide calculator): ${what}` : 'no sized slides');

  // ── Die Build ───────────────────────────────────────────────────────────
  const width = Math.min(dieX, dieY);
  const design = ref.designTime.find((r) => r.cavities >= n && r.widthMm >= width);
  if (!design) return fail(`tblMoldBaseDesignTime has no row for ${n} cavities and a ${r2(width)} mm wide die.`);
  const designRow = { 'Number of Cavities': design.cavities, 'Mold Base Width (mm)': design.widthMm };
  if (!(input.surfaceAreaMm2 && input.surfaceAreaMm2 > 0)) return fail('part surface area not measured.');
  const areaIn2 = input.surfaceAreaMm2 / MM2_PER_IN2;
  const hrRow = firstAtOrAbove(ref.hrsPerSqIn[complexity], (r) => r.maxAreaIn2, areaIn2);
  if (!hrRow) return fail(`tblHrsPerSqInch${complexity} has no row for ${r2(areaIn2)} in².`);
  const gp = ref.guidePin;
  const pressure = input.pressForceKn != null;
  const vs = (k: keyof typeof v) => castingSeed.variable(k, v[k]);
  const build = run('Die Build', 'Die Casting - Die Build', 'Total Steel Weight', {
    'Die Length': castingSeed.calculator(dieX, 'Die Size'),
    'Die Steel Weight': castingSeed.calculator(size.value, 'Die Size'),
    'Base Design Time': castingSeed.lookup('tblMoldBaseDesignTime', ref.customBase ? 'Custom Base Design Time (hr)' : 'Standard Base Design Time (hr)',
      ref.customBase ? design.customHr : design.standardHr, designRow),
    'Per Slide Design Time': castingSeed.lookup('tblMoldBaseDesignTime', 'Per Slide Design Time (hr)', design.perSlideHr, designRow),
    'Slides': castingSeed.cad(input.slideCount, 'slide bundles'),
    'Parting Line Base Design Time': vs('partingLineBaseDesignTime'),
    'Parting Line Design Time per Slide': vs('partingLineDesignTimePerSlide'),
    'Hours per Square Inch': castingSeed.lookup(COMPLEXITY_TABLE[complexity], `Hrs Per Sq Inch ${complexity} (hr / in^2)`, hrRow.hrPerIn2,
      { [`Surface Area ${complexity} (in^2)`]: hrRow.maxAreaIn2 }),
    'Surface Area': castingSeed.cad(input.surfaceAreaMm2, 'part surface area (mm²)'),
    'Cavities': castingSeed.engine(n, `${n} cavit${n === 1 ? 'y' : 'ies'} per die`),
    'H13 Machinability': vs('machinabilityMultiplierH13ToolSteel'),
    'Projected Area': castingSeed.cad(input.projectedAreaMm2, 'projected area on the parting plane (mm²)'),
    'Projected Area per Ejector Pin': vs('projAreaPerEjectorPin'),
    'Ejector Pin Cost': vs('ejectorPinsCost'),
    'Ejector Pin Assembly Time': vs('ejPinsAssTimePerTool'),
    'Guide Pins': vs('numGuidePins'),
    'Guide Pin Cost': { ...castingSeed.lookup('componentStandardCosts', 'Cost (USD)', gp.costUsd, { Name: 'guidePinAssy', Model: gp.model }),
      source: `componentStandardCosts guidePinAssy ${gp.model} (${gp.sizeMm} mm, the smallest catalogued: memory has no size rule)` },
    'Guide Pin Assembly Time': vs('guidePinsAssTimePerTool'),
    'Pressure Die': castingSeed.engine(pressure ? 1 : 0, pressure ? 'pressure die: the shot enters through a sprue bushing and spreader' : 'gravity die: no sprue bushing or spreader'),
    'Sprue Bushing Cost': vs('sprueBushingCost'),
    'Sprue Spreader Cost': vs('sprueSpreaderCost'),
    'Sprue Assembly Time': vs('sprBushSpreadAssTimePerTool'),
    'Locating Rings': vs('locatingRings'),
    'Locating Ring Cost': vs('locatingRingsCost'),
    'Locating Ring Assembly Time': vs('locatRingsAssTimePerTool'),
    'Cavity Plate Water Rows': vs('numRowsWaterChCavHoles'),
    'Core Plate Water Rows': vs('numRowsWaterChCoreHoles'),
    'Gun Drill Setup': vs('gunDrillSetup'),
    'Waterline Drill Speed': vs('waterlineDrillSpeed'),
    'Gun Tap Setup': vs('gunTapSetup'),
    'Gun Tap Time': vs('gunTapTime'),
    'Counterbore Setup': vs('cboreSetup'),
    'Counterbore Time': vs('cboreTime'),
    'Water Channel Design Time': vs('waterChannelDesignTime'),
    'Min Water Channel Design Time': vs('minWaterChannelDesignTime'),
    'Slide Steel Weight': slideSum(slideTotals.kg, 'H13 weight'),
    'Slide Design Hours': slideSum(slideTotals.design, 'design hours'),
    'Slide Machining Hours': slideSum(slideTotals.machining, 'machining hours'),
    'Slide Assembly Hours': slideSum(slideTotals.assembly, 'assembly, spotting and inspection hours'),
    'Slide Inspection Setup': vs('slideInspectSetup'),
  });
  if (build.value == null) return fail(build.missing.join('; '));
  const o = build.outputs;
  const result: DieToolingResult = {
    ...base, ok: true, dieSizeMm: [r2(dieX), r2(dieY), r2(dieZ)],
    steelKg: build.value, designHr: o['Design Hours']!, machiningHr: o['Machining Hours']!, assemblyHr: o['Assembly Hours']!,
    ejectorPins: o['Ejector Pins']!, ejectorPinsUsd: o['Ejector Pins']! * v.ejectorPinsCost,
  };
  trace.push({ label: 'Die build', value: `design ${r2(o['Design Hours']!)} h, machining ${r2(o['Machining Hours']!)} h, assembly ${r2(o['Assembly Hours']!)} h, components $${r2(o['Component Cost']!)} (Die Build calculator)` });
  warnings.push('Die tooling excludes cooling baffles, hoses, manifolds and fittings (die-casting memory gives their piece cost and assembly time but no count).');
  if (input.location !== 'USA') {
    warnings.push(`Die tooling: ${r2(o['Design Hours']! + o['Machining Hours']! + o['Assembly Hours']!)} toolmaker hours are not priced: the tool shop rates in memory are USA only, none for ${input.location}.`);
    return result;
  }

  // ── Die Cost ────────────────────────────────────────────────────────────
  const shop = ref.toolShop;
  const shopRow = { name: TOOL_SHOP_NAME };
  const cost = run('Die Cost', 'Die Casting - Die Cost', 'Die Cost', {
    'Total Steel Weight': castingSeed.calculator(build.value, 'Die Build'),
    'Component Cost': castingSeed.calculator(o['Component Cost']!, 'Die Build'),
    'Design Hours': castingSeed.calculator(o['Design Hours']!, 'Die Build'),
    'Machining Hours': castingSeed.calculator(o['Machining Hours']!, 'Die Build'),
    'Assembly Hours': castingSeed.calculator(o['Assembly Hours']!, 'Die Build'),
    'H13 Price': castingSeed.lookup('digital_factory_tool_materials_usa', 'materialCostUsdPerKg', shop.h13UsdPerKg, { name: DIE_STEEL }),
    'Heat Treat Cost per kg': vs('stdHeatTreatCostPerMass'),
    'Heat Treat Calibration': { ...vs('compHeatTreatCost'), source: `variables compHeatTreatCost = ${v.compHeatTreatCost} (calibration dial, applied as a multiplier)` },
    'Design Rate': castingSeed.lookup('digital_factory_settings_usa', 'designRateUsdPerHr', shop.designUsdPerHr, shopRow),
    'Machining Rate': castingSeed.lookup('digital_factory_settings_usa', 'machiningRateUsdPerHr', shop.machiningUsdPerHr, shopRow),
    'Assembly Rate': castingSeed.lookup('digital_factory_settings_usa', 'assemblyRateUsdPerHr', shop.assemblyUsdPerHr, shopRow),
    'Tuning': vs('percentTuning'),
    'SG and A': vs('percentSGandA'),
    'Profit': vs('percentProfit'),
  });
  if (cost.value == null) return { ...result, warnings: [...warnings, `Die cost not priced: ${cost.missing.join('; ')}`] };
  result.steelUsd = cost.outputs['Steel Cost']!;
  result.labourUsd = cost.outputs['Labour Cost']!;
  result.dieCostUsd = cost.value;
  trace.push({ label: 'Die cost', value: `$${r2(cost.value)} (steel $${r2(cost.outputs['Steel Cost']!)} + heat treat $${r2(cost.outputs['Heat Treat Cost']!)} + components $${r2(o['Component Cost']!)} + tool shop $${r2(cost.outputs['Labour Cost']!)}) × ${cost.outputs['Markup']} (Die Cost calculator)` });
  trace.push({ label: 'Coating', value: 'none: memory names a default tooling coating only for high-strength part materials (highStrengthMatlToolingCoatingType)' });

  // ── Die Life ────────────────────────────────────────────────────────────
  const lifeRow = input.materialType ? ref.toolLifeShotsByType.get(input.materialType) : undefined;
  if (lifeRow == null) warnings.push(`No tblToolLife row for material type ${input.materialType ?? '(none)'}: die life is defaultToolLife (${v.defaultToolLife} shots).`);
  const shots = lifeRow != null
    ? castingSeed.lookup('tblToolLife', 'Num Shots Per Tool', lifeRow, { 'Material Type': input.materialType! })
    : vs('defaultToolLife');
  result.shotsPerDie = shots.value;
  const life = new SeedSet()
    .put('Annual Volume', input.annualVolume != null && input.annualVolume > 0 ? input.annualVolume : null, (x) => castingSeed.scenario(x, 'annual volume'), 'annual volume')
    .put('Production Life', input.productionLifeYears != null && input.productionLifeYears > 0 ? input.productionLifeYears : null, (x) => castingSeed.scenario(x, 'production life (yr)'), 'production life');
  if (life.missing.length) {
    warnings.push('Die tooling not amortised: annual volume or production life not set.');
    return result;
  }
  const amort = run('Die Life', 'Die Casting - Die Life', 'Tooling per Part', life.with({
    'Die Cost': castingSeed.calculator(cost.value, 'Die Cost'),
    'Replacement Die Cost': castingSeed.calculator(cost.outputs['Replacement Die Cost']!, 'Die Cost'),
    'Shots per Die': shots,
    'Cavities': castingSeed.engine(n, `${n} cavit${n === 1 ? 'y' : 'ies'} per die`),
  }));
  if (amort.value == null) return { ...result, warnings: [...warnings, `Die tooling not amortised: ${amort.missing.join('; ')}`] };
  result.diesRequired = amort.outputs['Dies Required']!;
  result.totalToolingUsd = amort.outputs['Total Tooling']!;
  result.perPartUsd = amort.value;
  trace.push({ label: 'Amortised', value: `${result.diesRequired} die${result.diesRequired === 1 ? '' : 's'}, $${r2(result.totalToolingUsd)} total, $${amort.value.toFixed(4)} per part (Die Life calculator)` });
  return result;
}
