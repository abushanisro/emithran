// The material a process prices when the part's grade is not one of its own (user decision 2026-11-20: Apply never fails, every process
// route is costed). Each memory/<process> catalog holds its own materials with the process data its engine reads: a die-casting alloy's
// clamping pressure, a forging steel's flow stress, a resin's melt temperatures, a bar's stock price. A grade from another catalog has none
// of it, so the process prices its closest own material instead and says so; the part's own grade is not changed.
import { ADDITIVE, RAPID_PROTOTYPING } from '../../additive/additive-domain';
import { BAR_TUBE_PROCESS_GROUP } from '../../bar-tube/bar-tube-route';
import { CASTING_MATERIAL_GROUP } from '../../casting/casting-reference.service';
import { INVESTMENT_PROCESS_GROUP } from '../../casting/investment/investment-reference';
import { COMPOSITES_PROCESS_GROUP } from '../../composites/composites-route';
import { FORGING_PROCESS_GROUP } from '../../forging/forging-route';
import { POWDER_METAL_PROCESS_GROUP } from '../../powder-metal/powder-metal-route';

/**
 * The raw_materials group each part family's engine prices from, for the engines that price only their own materials. Machining and sheet
 * metal are not here: they price any grade from its own row (a PETG part is machined as PETG).
 */
export const PROCESS_OWN_MATERIAL_GROUP: Readonly<Record<string, string>> = {
  die_cast: CASTING_MATERIAL_GROUP.die_casting,
  sand_cast: CASTING_MATERIAL_GROUP.sand_casting,
  investment_cast: INVESTMENT_PROCESS_GROUP,
  forged: FORGING_PROCESS_GROUP,
  powder_metal: POWDER_METAL_PROCESS_GROUP,
  composite: COMPOSITES_PROCESS_GROUP,
  additive: ADDITIVE.materialGroup,
  bar_tube: BAR_TUBE_PROCESS_GROUP,
  plastic_molded: 'Plastic & Rubber',
};

/**
 * Process groups costed as another group's family that price from materials of their own: a Rapid Prototyping part is priced by the additive
 * engine, from memory/Rapid prototyping's materials, not Additive Manufacturing's.
 */
const PROCESS_GROUP_OWN_MATERIAL_GROUP: Readonly<Record<string, string>> = {
  [RAPID_PROTOTYPING.processGroup]: RAPID_PROTOTYPING.materialGroup,
};

/** The raw_materials group a part's engine prices from (its Process's own, else its family's); undefined when it prices any grade. */
export function ownMaterialGroup(family: string, processGroup: string | null | undefined): string | undefined {
  return (processGroup ? PROCESS_GROUP_OWN_MATERIAL_GROUP[processGroup] : undefined) ?? PROCESS_OWN_MATERIAL_GROUP[family];
}

/**
 * Families whose engine resolves the grade with the ranked material search (resolveMaterialForFamily), not by exact name: a grade the
 * search lands inside the group is the engine's own and is priced as given.
 */
const RANKED_SEARCH_FAMILIES: ReadonlySet<string> = new Set(['plastic_molded']);

export interface ProcessMaterial {
  name: string;
  grade: string | null;
  materialType: string | null;
  densityKgM3: number | null;
}

/** The material the part's grade resolves to anywhere in raw_materials (the ranked search), or null when it resolves to none. */
export interface OwnMaterial {
  name: string | null;
  grade: string | null;
  materialGroup: string | null;
  materialType: string | null;
  densityKgM3: number | null;
}

export interface PricedGrade {
  /** The grade the process prices: the part's own, or its closest material of the process. */
  grade: string;
  /** Said to the user when the process prices another material than the part's; null when it prices the part's own. */
  note: string | null;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** True when the material is the grade: its name or grade, case-insensitively (the rule every engine matches a grade with). */
export function isMaterialNamed(m: { name: string | null; grade: string | null }, grade: string): boolean {
  return same(m.name, grade) || same(m.grade, grade);
}

type Closeness = 'grade' | 'material type' | 'nearest density' | 'name';

/**
 * The process's material closest to the part's own, in one pass: the same name, then the same material type, then the nearest density,
 * then the first by name (a grade the search cannot place has no type or density, and still gets a material). Null only when the process
 * has no materials.
 */
export function closestProcessMaterial(own: OwnMaterial | null, materials: readonly ProcessMaterial[]): { material: ProcessMaterial; by: Closeness } | null {
  const sameName = (m: ProcessMaterial) => !!own && (isMaterialNamed(m, own.name ?? '') || isMaterialNamed(m, own.grade ?? ''));
  const sameType = (m: ProcessMaterial) => same(m.materialType, own?.materialType);
  const distance = (m: ProcessMaterial) => (own?.densityKgM3 != null && m.densityKgM3 != null ? Math.abs(m.densityKgM3 - own.densityKgM3) : Infinity);
  // Negative when a is closer than b. Two unknown densities are equally far (Infinity - Infinity is not a number).
  const compare = (a: ProcessMaterial, b: ProcessMaterial) =>
    Number(!sameName(a)) - Number(!sameName(b))
    || Number(!sameType(a)) - Number(!sameType(b))
    || (distance(a) === distance(b) ? 0 : distance(a) - distance(b))
    || a.name.localeCompare(b.name);
  if (materials.length === 0) return null;
  const best = materials.reduce((b, m) => (compare(m, b) < 0 ? m : b));
  const by: Closeness = sameName(best) ? 'grade' : sameType(best) ? 'material type' : Number.isFinite(distance(best)) ? 'nearest density' : 'name';
  return { material: best, by };
}

/**
 * The grade `family`'s engine prices (see the file comment). `materials` are the process group's rows and `own` the part grade's own row;
 * a family that prices any grade, or a grade of the group, is priced as given.
 */
export function pricedGradeFor(input: {
  family: string;
  /** The part's Process when it prices from materials of its own (ownMaterialGroup). */
  processGroup?: string | null;
  processLabel: string;
  grade: string;
  own: OwnMaterial | null;
  materials: readonly ProcessMaterial[];
}): PricedGrade {
  const { family, processLabel, grade, own, materials } = input;
  const group = ownMaterialGroup(family, input.processGroup);
  if (!group || materials.some((m) => isMaterialNamed(m, grade))) return { grade, note: null };
  if (own?.materialGroup === group) {
    // The search placed the grade in the group: an exact-name engine needs the row's own name; a ranked-search engine finds it as given.
    return { grade: RANKED_SEARCH_FAMILIES.has(family) ? grade : (own.name ?? own.grade ?? grade), note: null };
  }
  const closest = closestProcessMaterial(own, materials);
  if (!closest) return { grade, note: null };
  const by = closest.by === 'grade' ? 'the same grade' : closest.by === 'material type' ? `the same material type, ${closest.material.materialType ?? ''}` : closest.by;
  return {
    grade: closest.material.name,
    note: `"${grade}" is not a ${processLabel} material: priced as "${closest.material.name}", its closest ${processLabel} material (${by}). `
      + `Choose a ${processLabel} material in Material Grade to price another.`,
  };
}
