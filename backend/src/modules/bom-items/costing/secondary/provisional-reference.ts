// Values a published source gives and memory/ does not. Not reference data: an engineer approved each as a provisional input for an operation memory/ cannot cost (see
// docs/secondary-operations-data-gaps.md), and every line that uses one says so (`provisional` on the result, the source and the range in its trace and warnings), so a price
// built on one is never mistaken for the reference's. A value here is read only where the staged reference has none, never in place of one.

export interface ProvisionalValue {
  value: number;
  unit: string;
  /** What the published sources span: the value is one point of it, not a bound. */
  range: readonly [number, number];
  /** Where the value comes from, and what it depends on that this model does not know. */
  source: string;
}

export const PROVISIONAL = {
  // Powder cure: 10 min at metal temperature (TGIC polyester data sheets), plus the time for the metal to reach it (about 5 min for thin sheet). A heavy part needs far longer.
  powderCureDwellMin: {
    value: 15, unit: 'min', range: [10, 45],
    source: 'Columbia Coatings TGIC polyester data sheets (10 min at 400 F metal temperature) + Products Finishing "Oven Dwell Time" (dwell = time to reach cure temperature + cure time; 15 + 10 min in its example; thin sheet heats in a few minutes). Heavy castings and thick brackets need 30 min or more to reach metal temperature: this underestimates them.',
  },
  // Hot black oxide: the bulletins of the chemistry suppliers span 5 to 60 min and disagree.
  blackOxideImmersionMin: {
    value: 15, unit: 'min', range: [5, 60],
    source: 'Hubbard-Hall Black-Magic Infusion bulletins ("immersion time will be from 5 to 20 minutes", by part mass, steel type and surface); Birchwood Technologies gives 30-60 min and STERC 15-30 min: the sources conflict. Steel only.',
  },
  // Vibratory (mass) finishing: low confidence; the published range is wide and depends on media, part material and burr size.
  vibratoryFinishingCycleMin: {
    value: 45, unit: 'min', range: [30, 120],
    source: 'Equipment-supplier and STERC figures of 30-60 min for deburring (up to 2 h for hardened steel); one blog gives 1-4 h by media. No authoritative per-media table exists. Depends on media type, part material and hardness.',
  },
  // Induction hardening: a single-shot cycle heats and quenches one part in seconds, not hours.
  inductionHardenScanSec: {
    value: 6, unit: 's', range: [4, 8],
    source: 'Induction-hardening supplier and trade literature: single-shot cycles of 4-8 s, typically about 6 s for a small shaft or pin. A long part scanned along its length, or a large case depth, takes longer: this underestimates them.',
  },
  // Powder film build: general industrial work specifies 2-4 mil; the density is the powder's specific gravity.
  powderFilmThicknessUm: {
    value: 75, unit: 'µm', range: [50, 100],
    source: 'Trade guides (Powder Coated Tough / Products Finishing / UnionFab): general industrial work 2-4 mil (50-100 µm), outdoor furniture 3-6 mil, heavy-duty structural 4-6 mil. 75 µm (3 mil) is the middle of the general range; a drawing that states a thickness replaces it.',
  },
  powderSpecificGravity: {
    value: 1.5, unit: 'g/cm³', range: [1.0, 2.0],
    source: 'Powder-coating coverage charts span specific gravity 1.0-2.0 and the worked examples use 1.5. A supplier data sheet gives the real value for a chosen powder.',
  },
} as const satisfies Record<string, ProvisionalValue>;

/** The line a trace shows for a provisional input. */
export const provisionalTrace = (label: string, p: ProvisionalValue) =>
  ({ label, value: p.value, unit: p.unit, source: `PROVISIONAL (not in memory/): ${p.value} ${p.unit}, published range ${p.range[0]}-${p.range[1]} ${p.unit}. ${p.source}` });

/** One warning for the line, naming what is provisional and how far the published range reaches. */
export const provisionalWarning = (what: string, p: ProvisionalValue) =>
  `Provisional: ${what} is ${p.value} ${p.unit}, a published figure and not reference data (published range ${p.range[0]}-${p.range[1]} ${p.unit}); the price moves with it.`;
