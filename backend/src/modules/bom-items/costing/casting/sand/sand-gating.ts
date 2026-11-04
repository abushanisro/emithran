// The gating system and risers of a sand casting, designed from the plant's gating ratio and the casting's metal by the calculators
// "Sand Casting - Risers" and "Sand Casting - Gating system" (formulas in the database, inputs seeded from each input's declared source).
// The choke area depends on the pouring time, which depends on the metal poured, gating included: the design is repeated until the
// gating weight settles. Ported from the retired petrus-demo prototype (its design records, D-numbers, are archived outside the repo) (D146), with the solidification shrinkage read from the data.
//
// Nothing is substituted: a selector that finds no row, or a missing input, returns what is missing and no design.
import type { ReferenceCalcRun, ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';
import type { SandGatingLayout } from '../../../dto/cost-breakdown.dto';
import { runReferenceCalculator } from '../../shared/calculators/reference-calculator';
import type { DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import { seedsFor, valuesProvider, variableProvider } from './sand-seeds';
import type { SandReference } from './sand-reference';

const LB_PER_KG = 1 / 0.45359237;
const MAX_ITERATIONS = 50;
export const RISERS_CALCULATOR = 'Sand Casting - Risers';
export const GATING_CALCULATOR = 'Sand Casting - Gating system';

type Row = Readonly<Record<string, unknown>>;
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export interface GatingRatio {
  sprue: number;
  runner: number;
  ingate: number;
  systemType: string;
  description: string;
  efficiency: number;
}

/** The tblGatingRatios row the plant's sprue, runner and ingate multipliers name. */
export function selectGatingRatio(ref: SandReference): { ratio: GatingRatio | null; missing: string[] } {
  const missing = ref.absent({ numbers: ['sprueMultiplier', 'runnerMultiplier', 'ingateMultiplier'], tables: ['tblGatingRatios'] });
  if (missing.length) return { ratio: null, missing };
  const [s, r, i] = [ref.number('sprueMultiplier')!, ref.number('runnerMultiplier')!, ref.number('ingateMultiplier')!];
  const row = ref.table('tblGatingRatios').find((g) => num(g['Sprue Multiplier']) === s && num(g['Runner Multiplier']) === r && num(g['Ingate Multiplier']) === i);
  if (!row) return { ratio: null, missing: [`tblGatingRatios has no row for the plant's ratio ${s}:${r}:${i}`] };
  return {
    ratio: { sprue: s, runner: r, ingate: i, systemType: String(row['System Type']), description: String(row['Description']), efficiency: num(row['Efficiency Coefficient'])! },
    missing: [],
  };
}

/**
 * Volume lost on solidifying (%), which the risers must feed: the tblSolidificationShrinkage row of the material's family. The family
 * is the whole part of the material's Cut Code (every one of the 117 sand materials falls in a staged family, and the families group
 * by material type: 8 gray iron, 9 ductile iron, 30 aluminum, 33 copper alloys, ...). null when the material has no cut code or its
 * family has no row.
 */
export function solidificationShrinkage(ref: SandReference, cutCode: number | null): { pct: number; source: string } | null {
  if (cutCode == null || !Number.isFinite(cutCode)) return null;
  const family = Math.floor(cutCode);
  const row = ref.table('tblSolidificationShrinkage').find((r) => num(r['Material Family']) === family);
  const pct = row ? num(row['Contraction Volume']) : null;
  return pct == null ? null : { pct, source: `tblSolidificationShrinkage, material family ${family} (cut code ${cutCode})` };
}

/** The pouring coefficient of the material's tblPouringCoefficients rows: by the pounds poured per mould or by the section in inches. */
export function pouringCoefficient(
  ref: SandReference,
  materialType: string | null,
  pounds: number,
  inches: number | null,
): { value: number; source: string } | { missing: string } {
  if (!materialType) return { missing: 'the material has no Material Type, which names its tblPouringCoefficients rows' };
  const rows = ref.table('tblPouringCoefficients').filter((r) => r['Material Name'] === materialType);
  if (rows.length === 0) return { missing: `tblPouringCoefficients has no rows for ${materialType}` };
  const byWeight = rows.some((r) => r['Dimension'] === 'weight');
  const x = (r: Row) => (r['Dimension'] === 'weight' ? pounds : inches);
  const hit = rows.find((r) => {
    const v = x(r);
    return v != null && v >= (num(r['Min Dim']) ?? Infinity) && v < (num(r['Max Dim']) ?? -Infinity);
  });
  if (!hit) return { missing: byWeight || inches != null ? `tblPouringCoefficients has no ${materialType} band for ${pounds.toFixed(1)} lb` : `the section thickness is not measured, which the ${materialType} pouring coefficient is read by` };
  const band = hit['Dimension'] === 'weight' ? `${pounds.toFixed(1)} lb poured per mould` : `${inches!.toFixed(2)} in section`;
  return { value: num(hit['Coefficient'])!, source: `tblPouringCoefficients ${materialType}, by ${band}` };
}

/** What the route has decided that the design needs, each with where it came from. */
export interface GatingMould {
  cavities: number;
  ingates: number;
  partLengthMm: { value: number; source: string };
  copeHeightMm: { value: number; source: string };
  /** The casting's height above the parting plane. */
  abovePartingMm: { value: number; source: string };
}

export interface GatingInput {
  netKg: number;
  volumeMm3: number;
  /** The casting's modulus (volume / surface), mm. */
  modulusMm: number;
  densityKgM3: number;
  materialName: string;
  materialType: string | null;
  cutCode: number | null;
  /** The part's nominal wall, mm, which the section-based pouring coefficients are read by. */
  wallNominalMm: number | null;
  mould: GatingMould;
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
}

export interface GatingSystem {
  ratio: string;
  systemType: string;
  pourTimeS: number;
  effectiveHeadMm: number;
  chokeAreaMm2: number;
  sprueDiameterMm: number;
  sprueHeightMm: number;
  wellDiameterMm: number;
  wellDepthMm: number;
  runnerWidthMm: number;
  runnerHeightMm: number;
  runnerLengthMm: number;
  ingates: number;
  ingateWidthMm: number;
  ingateHeightMm: number;
  ingateLengthMm: number;
  /** All ingates of one casting together. */
  ingateAreaMm2: number;
  /** The metal's speed at the choke and through the ingates (m/s): the mould's metal over its pouring time, over the area it passes. */
  chokeVelocityMs: number;
  ingateVelocityMs: number;
  risers: number;
  riserDiameterMm: number;
  riserHeightMm: number;
  /** Where the risers meet the casting (cut off and ground). */
  riserContactMm2: number;
  /** Per casting: its share of the sprue and well, its runner and ingates. */
  gatingKg: number;
  risersKg: number;
  /** The two calculator runs (inputs with sources, formulas), for the trace. */
  runs: { risers: ReferenceCalcRun; gating: ReferenceCalcRun };
}

/** The sizes of the designed system the viewer draws around the part (mm): what the calculators decided, none of their bookkeeping. */
export function gatingLayout(g: GatingSystem): SandGatingLayout {
  return {
    sprueDiameterMm: g.sprueDiameterMm, sprueHeightMm: g.sprueHeightMm, wellDiameterMm: g.wellDiameterMm, wellDepthMm: g.wellDepthMm,
    runnerWidthMm: g.runnerWidthMm, runnerHeightMm: g.runnerHeightMm, runnerLengthMm: g.runnerLengthMm,
    ingates: g.ingates, ingateWidthMm: g.ingateWidthMm, ingateHeightMm: g.ingateHeightMm, ingateLengthMm: g.ingateLengthMm,
    risers: g.risers, riserDiameterMm: g.riserDiameterMm, riserHeightMm: g.riserHeightMm,
  };
}

export function designGating(input: GatingInput): { system: GatingSystem | null; missing: string[] } {
  const fail = (...missing: string[]) => ({ system: null, missing });
  const { ref, mould } = input;
  const { ratio, missing: ratioMissing } = selectGatingRatio(ref);
  if (!ratio) return fail(...ratioMissing);
  const shrinkage = solidificationShrinkage(ref, input.cutCode);
  if (!shrinkage) return fail(`tblSolidificationShrinkage has no row for the material family of ${input.materialName} (cut code ${input.cutCode ?? 'missing'})`);
  const head = mould.copeHeightMm.value - mould.abovePartingMm.value / 2;
  if (head <= 0) return fail(`the casting stands ${mould.abovePartingMm.value.toFixed(0)} mm above the parting plane, more than twice the cope's ${mould.copeHeightMm.value.toFixed(0)} mm`);
  const risersSpec = input.spec.calculators.find((c) => c.name === RISERS_CALCULATOR);
  const gatingSpec = input.spec.calculators.find((c) => c.name === GATING_CALCULATOR);
  if (!risersSpec || !gatingSpec) return fail('the sand risers and gating calculators are not in the calculator spec');

  const material = valuesProvider({ density_kg_m3: { value: input.densityKgM3, source: `${input.materialName}: density (kg/m³)` } });
  const risersSeeds = seedsFor(risersSpec, {
    cad: valuesProvider({ modulus_mm: { value: input.modulusMm, source: 'casting modulus: volume / surface (mm)' }, volume_mm3: { value: input.volumeMm3, source: 'part volume (mm³)' } }),
    material,
    engine: valuesProvider({
      risers: { value: mould.ingates, source: 'one per ingate' },
      shrinkage_pct: { value: shrinkage.pct, source: shrinkage.source },
    }),
  });
  if (risersSeeds.missing.length) return fail(...risersSeeds.missing);
  const risers = runReferenceCalculator(input.calculators, RISERS_CALCULATOR, risersSeeds.seeds, 'Riser Weight');
  if (risers.value == null) return fail(...risers.missing);
  const risersKg = risers.value;

  const inches = input.wallNominalMm != null ? input.wallNominalMm / 25.4 : null;
  let gatingKg = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const perMould = (input.netKg + risersKg + gatingKg) * mould.cavities;
    const coefficient = pouringCoefficient(ref, input.materialType, perMould * LB_PER_KG, inches);
    if ('missing' in coefficient) return fail(coefficient.missing);
    const seeded = seedsFor(gatingSpec, {
      material,
      variable: variableProvider(ref),
      lookup: (key) => {
        if (key === 'tblPouringCoefficients.Coefficient') return { value: coefficient.value, source: coefficient.source, lookup: true };
        if (key === 'tblGatingRatios.Efficiency Coefficient') return { value: ratio.efficiency, source: `tblGatingRatios ${ratio.description}`, lookup: true };
        return null;
      },
      engine: valuesProvider({
        poured_per_mould_kg: { value: perMould, source: 'net, risers and gating x cavities' },
        cavities: { value: mould.cavities, source: 'layout, flask and sand borders' },
        cope_height_mm: mould.copeHeightMm,
        above_parting_mm: mould.abovePartingMm,
        part_length_mm: mould.partLengthMm,
        ingates: { value: mould.ingates, source: 'part length / variable ingateGap, rounded up' },
      }),
    });
    if (seeded.missing.length) return fail(...seeded.missing);
    const run = runReferenceCalculator(input.calculators, GATING_CALCULATOR, seeded.seeds, 'Gating Weight');
    if (run.value == null) return fail(...run.missing);
    const settled = Math.abs(run.value - gatingKg) <= 1e-9 * Math.abs(run.value);
    gatingKg = run.value;
    if (!settled) continue;
    const out = (name: string) => run.outputs[name]!;
    const riserDiameter = risers.outputs['Riser Diameter']!;
    return {
      missing: [],
      system: {
        ratio: ratio.description, systemType: ratio.systemType,
        pourTimeS: out('Pour Time'), effectiveHeadMm: out('Effective Head'), chokeAreaMm2: out('Choke Area'),
        sprueDiameterMm: out('Sprue Diameter'), sprueHeightMm: out('Sprue Height'), wellDiameterMm: out('Well Diameter'), wellDepthMm: out('Well Depth'),
        runnerWidthMm: out('Runner Width'), runnerHeightMm: out('Runner Height'), runnerLengthMm: out('Runner Length'),
        ingates: mould.ingates, ingateWidthMm: out('Ingate Width'), ingateHeightMm: out('Ingate Height'), ingateLengthMm: out('Ingate Length'), ingateAreaMm2: out('Ingate Area'),
        chokeVelocityMs: out('Choke Velocity'), ingateVelocityMs: out('Ingate Velocity'),
        risers: mould.ingates, riserDiameterMm: riserDiameter, riserHeightMm: risers.outputs['Riser Height']!,
        riserContactMm2: (mould.ingates * Math.PI * riserDiameter * riserDiameter) / 4,
        gatingKg, risersKg, runs: { risers, gating: run },
      },
    };
  }
  return fail('the gating design does not settle');
}

/** The flask of the moulding machine the route is costed on (mm): the sand the mould is made in, cope above the parting plane and drag below. */
export interface SandFlask {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}
