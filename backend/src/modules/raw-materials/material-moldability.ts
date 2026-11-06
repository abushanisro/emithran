// Whether a raw material can be injection molded, decided from what the catalog says about it and from the reference data the molding engine needs:
// one definition, used by the material picker (what is offered for Plastic Molding) and by the molding engine (what it will cost).
//
// Why it exists: the catalog holds 3D-printing feedstock (SLA / PolyJet / MJP resins, SLS powders) next to molding grades, and under the
// Plastic Molding process group. Such a material has no injection pressure, flow length, melt or mold temperature, so every step of the cost
// fails in turn; the user saw a dozen unrelated warnings instead of the one cause. The decision here is data, not family names: the form the
// material is supplied in, and whether the reference columns the engine reads are on file.

export interface MoldabilityMaterial {
  grade: string | null;
  /** raw_materials.stock_form, e.g. "Granules", "Liquid Resin (SLA)", "Powder (SLS)", "Rod / Sheet / Tube"; null when not recorded. */
  stockForm: string | null;
  /** raw_materials.matl_state, e.g. "Semi-Crystalline", "Photopolymer", "Nylon Powder". */
  matlState: string | null;
  injectionPressureMaxMpa: number | null;
  flowLengthRatio: number | null;
  meltingTempC: number | null;
  moldTempC: number | null;
  densityOfMeltKgM3: number | null;
  cureTimeMin: number | null;
}

export type MoldabilityKind = 'additive_feedstock' | 'not_molding_feedstock' | 'no_injection_data';

export interface MoldabilityGap {
  kind: MoldabilityKind;
  /** One sentence for the cost view: what the material is and what to do. */
  reason: string;
  /** The reference values the engine needs and the material lacks (empty for a material that is not molding feedstock at all). */
  missing: string[];
}

/** The words that make a stock form a 3D-printing feedstock: a printing resin, a wax, a sintering powder. */
const ADDITIVE_FORM_WORDS = ['resin', 'powder', 'wax'] as const;

/** A 3D-printing feedstock: those words, the printing process in brackets, or a photopolymer. */
const ADDITIVE_FORM = new RegExp(`\\((?:SLA|SLS|DLP|MJP|PolyJet|FDM|FFF)\\)|photopolymer|${ADDITIVE_FORM_WORDS.join('|')}`, 'i');

/**
 * The forms a molding grade is supplied in. Checked after ADDITIVE_FORM, because "Powder (SLS) / Granules" contains "Granules".
 * The picker's database filter is built from the same list (moldingFeedstockFilter), so the two cannot disagree.
 */
export const MOLDING_FEEDSTOCK_WORDS = ['granule', 'pellet', 'compound', 'prepreg'] as const;

export function isAdditiveFeedstock(stockForm: string | null, matlState: string | null): boolean {
  return ADDITIVE_FORM.test(stockForm ?? '') || /photopolymer|powder/i.test(matlState ?? '');
}

/** A form that is not molding feedstock: a rod, sheet or tube for machining or extrusion. A material with no form recorded is not ruled out. */
function isMoldingFeedstockForm(stockForm: string | null): boolean {
  if (stockForm == null || stockForm.trim() === '') return true;
  return MOLDING_FEEDSTOCK_WORDS.some((w) => stockForm.toLowerCase().includes(w));
}

/** The reference values the injection engine reads that this material does not have. */
export function missingInjectionData(m: MoldabilityMaterial): string[] {
  const missing: string[] = [];
  if (m.injectionPressureMaxMpa == null) missing.push('injection pressure');
  if (m.flowLengthRatio == null) missing.push('flow length ratio');
  if (!(m.meltingTempC != null && m.meltingTempC > 0)) missing.push('melt temperature');
  if (!(m.moldTempC != null && m.moldTempC > 0)) missing.push('mold temperature');
  if (!(m.densityOfMeltKgM3 != null && m.densityOfMeltKgM3 > 0)) missing.push('melt density');
  return missing;
}

/**
 * Why this material cannot be injection molded, or null when it can. `isLsr` is silicone molded with the cure model, which needs no injection
 * pressure or flow length but does need its cure time.
 */
export function injectionMoldabilityGap(m: MoldabilityMaterial, isLsr = false): MoldabilityGap | null {
  const label = m.grade ? `"${m.grade}"` : 'This material';
  const form = [m.stockForm, m.matlState].filter((s): s is string => !!s && s.trim() !== '').join(', ');
  if (isAdditiveFeedstock(m.stockForm, m.matlState)) {
    return {
      kind: 'additive_feedstock',
      reason: `${label} is 3D-printing feedstock (${form}), not an injection-molding material: it has no injection pressure, flow length, melt or mold temperature on file. Choose an injection-molding grade in Material Grade.`,
      missing: [],
    };
  }
  const missing = missingInjectionData(m);
  if (missing.length === 0) return null; // all the engine reads is on file: the form no longer matters
  if (!isMoldingFeedstockForm(m.stockForm)) {
    return {
      kind: 'not_molding_feedstock',
      reason: `${label} is supplied as ${m.stockForm}, which is not injection-molding feedstock (granules or pellets). Choose an injection-molding grade in Material Grade.`,
      missing: [],
    };
  }
  if (isLsr && m.cureTimeMin != null && m.cureTimeMin > 0) return null;
  return {
    kind: 'no_injection_data',
    reason: `No injection-molding reference data is on file for ${label}: missing ${missing.join(', ')}. Add it in Raw Materials or choose a grade that has it.`,
    missing,
  };
}

/**
 * The PostgREST `or` filter that keeps the materials a molding process can use: no form recorded (judged by its data), or a molding feedstock
 * form that is not also a 3D-printing form. Null when the process has no such rule. Row-level filtering only: the cost decision is
 * injectionMoldabilityGap.
 */
export function moldingFeedstockFilter(): string {
  const words = MOLDING_FEEDSTOCK_WORDS.map((w) => `stock_form.ilike.*${w}*`);
  // Not a printing resin, wax or sintering powder: "Powder (SLS) / Granules" names Granules too.
  const notAdditive = ADDITIVE_FORM_WORDS.map((w) => `stock_form.not.ilike.*${w}*`).join(',');
  return `stock_form.is.null,and(or(${words.join(',')}),${notAdditive})`;
}

/**
 * The PostgREST `or` filter that keeps the materials the molding engine can cost: an injection pressure on file (thermoplastics, the injection model)
 * or a cure time (silicone and thermosets, the cure model). The catalog still holds older rows of the same grades with neither: offering one only
 * ends in a quote that cannot be priced, so the picker does not offer it.
 */
export function moldingCostableFilter(): string {
  return 'im_injection_pressure_max_mpa.not.is.null,cure_time_min.not.is.null';
}

/**
 * The process groups whose picker offers only molding feedstock (see moldingFeedstockFilter). Their material group (Plastic & Rubber) also holds
 * 3D-printing resins and powders and stock shapes, which no molding route can use.
 */
export const MOLDING_PROCESS_GROUPS: ReadonlySet<string> = new Set(['Plastic Molding']);
