// How the casting alloys memory/Sand casting's tblPouringCoefficients does not list are poured (web research, 2026-11-20). The table lists
// aluminium, ductile iron, gray iron and steel, for the pour formula t = K x sqrt(W lb); 48 of the 117 sand-casting materials are none of
// them, and none of them could be costed.
//
// Copper-base alloys: the published pouring time of copper alloy castings is t = K x cube root of W (W kg, t s), K = 1.30 top gating,
// 1.80 bottom gating, 1.90 brass, 2.80 tin bronze (P. N. Rao, Manufacturing Technology: Foundry, Forming and Welding, gating design; as
// reproduced in https://www.scribd.com/doc/18229519/Gating-System-Design). The coefficient given to the table's formula is the one that
// gives that time at the weight poured, so the time is the published rule's exactly.
//
// No published pouring-time constant was found for magnesium or zinc alloys, malleable iron or stainless steel: each pours as the listed
// family it is cast like (magnesium and the zinc alloys as aluminium, the listed light, low-melting alloy; stainless as steel; malleable iron,
// cast as white iron, as gray iron), and the source says so.

/** The cube-root constant K of each copper-base Material Type: brasses 1.90, the other copper alloys the general bottom-gating 1.80. */
export const COPPER_ALLOY_POURING_K: Readonly<Record<string, number>> = {
  Copper: 1.8,
  Bronze: 1.8,
  'Aluminum Bronze': 1.8,
  Brass: 1.9,
  'Silicon Brass': 1.9,
  // C86300 / C86500: high-strength yellow brasses.
  'Manganese Bronze': 1.9,
};

/** The listed family each Material Type with no rows and no published constant pours as. */
export const POURS_AS: Readonly<Record<string, string>> = {
  Magnesium: 'Aluminum',
  Zinc: 'Aluminum',
  'Zinc-Aluminum': 'Aluminum',
  'Stainless Steel': 'Steel',
  'Malleable Cast Iron': 'Gray Iron',
};

const KG_PER_LB = 0.45359237;

/** The coefficient of t = K x sqrt(W lb) that gives the copper-alloy rule's t = K x cbrt(W kg) at `pounds` poured; null for another type. */
export function copperAlloyPouringCoefficient(materialType: string, pounds: number): { value: number; source: string } | null {
  const k = COPPER_ALLOY_POURING_K[materialType];
  if (k == null || !(pounds > 0)) return null;
  const value = (k * Math.cbrt(pounds * KG_PER_LB)) / Math.sqrt(pounds);
  return {
    value,
    source: `${materialType} pours by the copper-alloy rule t = ${k} x cbrt(W kg) (Rao, Manufacturing Technology, gating design): `
      + `${value.toFixed(4)} x sqrt(${pounds.toFixed(1)} lb) gives it at the weight poured (tblPouringCoefficients lists no copper alloy)`,
  };
}
