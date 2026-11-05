// Forging reference data the closed-die engine reads, resolved from the staged
// rows of memory/Forging (machining_reference_data, source_version from the
// manifest's forging entry, migration 823). Pure: the caller loads the rows;
// nothing here holds a value.
//
//   variables  bandSawKerfWidth (mm)                   saw cut-off loss per mult
//              scaleLossAllowancePercentage (%)        gas furnace scale, of the forged volume incl. flash
//              scaleLossAllowancePercentageInductionHeating (%)  the same for induction heating
//              minBilletRatio, maxBilletRatio          valid mult length / diameter
//              inductionHeatMaxStockWidth (mm)         widest mult an induction line heats
//              inductionHeatMinMultRatio               shortest mult (L / D) that stays flat on it
//              press-, mechanicalPress-, hammer-, trimToolLifeNumberOfParts
//                                                      parts per tool before refurbish or replacement
//              enableScrapMaterialCredit, disableInvestmentAmortization  (true/false switches)
//              min/max FinishDieCost, min/max TrimDieCostWithOutMaterial  validity bounds (USD)
//   forging_partComplexityBasedData   part complexity 1-12 -> hot forging flash % of volume
//   forging_roundBarSizes             round bar diameters (mm)
//   forging_tblToolCoating            coating -> tool life improvement factor
//   material (Forging/forging_materials.csv), promoted by migration 855 to
//   raw_materials (material_group 'Forging') + raw_material_properties
//
// Any missing value is named in `missing`; the engine then decides nothing
// that depends on it rather than substitute a number. The formulas these
// coefficients feed are in docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE_v1.1.md.

import MANIFEST from '../../../processes/memory-reference-domains.json';

const FORGING_DOMAIN = MANIFEST.domains.find((d) => d.key === 'forging');
if (!FORGING_DOMAIN) throw new Error('memory-reference-domains.json has no forging entry (migration 823).');
export const FORGING_REFERENCE_SOURCE_VERSION: string = FORGING_DOMAIN.sourceVersion;

export const FORGING_VARIABLE_KEYS = [
  'bandSawKerfWidth', 'scaleLossAllowancePercentage', 'scaleLossAllowancePercentageInductionHeating',
  'minBilletRatio', 'maxBilletRatio', 'inductionHeatMaxStockWidth', 'inductionHeatMinMultRatio',
  'pressToolLifeNumberOfParts', 'mechanicalPressToolLifeNumberOfParts', 'hammerToolLifeNumberOfParts',
  'trimToolLifeNumberOfParts',
  'minFinishDieCost', 'maxFinishDieCost', 'minTrimDieCostWithOutMaterial', 'maxTrimDieCostWithOutMaterial',
] as const;

export const FORGING_SWITCH_KEYS = ['enableScrapMaterialCredit', 'disableInvestmentAmortization'] as const;

export const FORGING_LOOKUP_KEYS = [
  'forging_partComplexityBasedData', 'forging_roundBarSizes', 'forging_tblToolCoating',
] as const;

export type ForgingVariable = (typeof FORGING_VARIABLE_KEYS)[number];
export type ForgingSwitch = (typeof FORGING_SWITCH_KEYS)[number];

export interface ForgingReference {
  variables: Readonly<Record<ForgingVariable, number>>;
  switches: Readonly<Record<ForgingSwitch, boolean>>;
  /** Hot forging flash, % of volume, by part complexity score. */
  flashPctByComplexity: Map<number, number>;
  /** Round bar diameters (mm), ascending. */
  roundBarSizesMm: number[];
  /** Tool life improvement factor by coating type. */
  toolCoatingFactor: Map<string, number>;
}

export interface ForgingReferenceRows {
  variables: readonly { key: string; value: string | number | boolean | null }[];
  lookups: Readonly<Record<string, readonly Record<string, unknown>[] | undefined>>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A staged text cell: strings and numbers only, anything else is not a value. */
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const t = str(v)?.trim().toLowerCase();
  return t === 'true' ? true : t === 'false' ? false : null;
};

export function resolveForgingReference(rows: ForgingReferenceRows): { reference: ForgingReference | null; missing: string[] } {
  const missing: string[] = [];
  const raw = new Map(rows.variables.map((v) => [v.key, v.value]));

  const variables = {} as Record<ForgingVariable, number>;
  for (const k of FORGING_VARIABLE_KEYS) {
    const v = num(raw.get(k));
    if (v == null) missing.push(`variables ${k}`);
    else variables[k] = v;
  }
  const switches = {} as Record<ForgingSwitch, boolean>;
  for (const k of FORGING_SWITCH_KEYS) {
    const v = bool(raw.get(k));
    if (v == null) missing.push(`variables ${k}`);
    else switches[k] = v;
  }

  const flashPctByComplexity = new Map<number, number>();
  for (const r of rows.lookups.forging_partComplexityBasedData ?? []) {
    const score = num(r['Part Complexity']);
    const pct = num(r['Hot Forging - Flash Percentage Volume']);
    if (score != null && pct != null) flashPctByComplexity.set(score, pct);
  }
  if (flashPctByComplexity.size === 0) missing.push('forging_partComplexityBasedData');

  const roundBarSizesMm = (rows.lookups.forging_roundBarSizes ?? [])
    .map((r) => num(r['Size (mm)']))
    .filter((x): x is number => x != null && x > 0)
    .sort((a, b) => a - b);
  if (roundBarSizesMm.length === 0) missing.push('forging_roundBarSizes');

  const toolCoatingFactor = new Map<string, number>();
  for (const r of rows.lookups.forging_tblToolCoating ?? []) {
    const f = num(r['Tool Life Improvement Factor']);
    const coating = str(r['Coating Type']);
    if (coating != null && f != null) toolCoatingFactor.set(coating, f);
  }
  if (toolCoatingFactor.size === 0) missing.push('forging_tblToolCoating');

  if (missing.length) return { reference: null, missing };
  return { reference: { variables, switches, flashPctByComplexity, roundBarSizesMm, toolCoatingFactor }, missing };
}

export interface ForgingMaterial {
  name: string;
  materialType: string | null;
  densityKgM3: number | null;
  /** Round Bar Unit Cost (USD/kg): the only stock price memory/Forging gives. */
  roundBarUsdPerKg: number | null;
  cutCode: number | null;
  forgingTempC: number | null;
}

/** The raw_material_properties keys resolveForgingMaterial reads. */
export const FORGING_MATERIAL_PROPERTY_KEYS = ['forging_temperature'] as const;

/** A Forging raw material: the raw_materials row (migration 855) plus its properties. */
export function resolveForgingMaterial(input: {
  row: { name?: unknown; material_type?: unknown; density_kg_m3?: unknown; cost_usa?: unknown; cut_code?: unknown };
  properties: Readonly<Record<string, number | null>>;
}): ForgingMaterial {
  const { row, properties: p } = input;
  return {
    name: str(row.name) ?? '',
    materialType: str(row.material_type),
    densityKgM3: num(row.density_kg_m3),
    roundBarUsdPerKg: num(row.cost_usa),
    cutCode: num(row.cut_code),
    forgingTempC: p.forging_temperature ?? null,
  };
}
