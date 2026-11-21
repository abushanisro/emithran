// A material's cut code and its family in memory's lookup tables. Pure.
//
// memory numbers a cut code "family.subtype": 1.1 a galvanized carbon steel, 2.1 an alloy steel, 5.11 a martensitic and 5.2 an austenitic
// stainless, 20.21 a nickel alloy, 23.21 a titanium, 30.11 an aluminium, 33.3 a brass, 51.21 a thermoplastic, 52.32 a thermoset. Every
// lookup keyed by "Material Cut Code Family" (saw and band saw rates, laser seam speeds, forging, machining hardness, waterjet, finishing)
// lists the family: the whole number, never a subtype (memory, 11 tables, 2026-11-21).

/**
 * The family a lookup lists for a cut code: its whole number (stainless 5.21 is family 5, not the thermosets' 52; galvanized 1.50 is
 * family 1); null when the lookup lists none of it.
 */
export function cutCodeFamilyOf(families: ReadonlySet<string>, cutCode: number | null): string | null {
  if (cutCode == null || !Number.isFinite(cutCode)) return null;
  const family = String(Math.trunc(cutCode));
  return families.has(family) ? family : null;
}

/** The catalog's general material groups: each lists a material once, with the cut code of the material as it is bought (wrought). */
const GENERAL_MATERIAL_GROUPS: ReadonlySet<string> = new Set(['Ferrous & Non-Ferrous', 'Plastic & Rubber']);

/**
 * The cut code of a material listed under several material groups, which do not all give the same one: its general group's (a wrought
 * grade's own code); else the family most of its rows give (the casting groups list a cast variant, 15.21 for a stainless; Rapid
 * Prototyping a placeholder 1.50 for a plastic), the lowest code in it. Null when no row has one.
 */
export function preferredCutCode(rows: readonly { cutCode: number | null; group: string | null }[]): number | null {
  const coded = rows.filter((r): r is { cutCode: number; group: string | null } => r.cutCode != null && Number.isFinite(r.cutCode));
  const general = coded.find((r) => r.group != null && GENERAL_MATERIAL_GROUPS.has(r.group));
  if (general) return general.cutCode;
  const byFamily = new Map<number, number[]>();
  for (const r of coded) byFamily.set(Math.trunc(r.cutCode), [...(byFamily.get(Math.trunc(r.cutCode)) ?? []), r.cutCode]);
  const best = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).at(0);
  return best ? Math.min(...best[1]) : null;
}
