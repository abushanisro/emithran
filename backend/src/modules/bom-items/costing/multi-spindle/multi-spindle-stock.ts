// The bar a Multi-Spindle Machining part is made from (memory/Multi-Spindle Maching, staged as 2026-Multi-Spindle by migrations 786 and
// 787). Pure.
//
// The bar is the part's outside size (its OD; across flats for hex bar, the side for square bar) plus the stock allowance on each side,
// snapped up to the next preferred size of the location (tblPreferredSizes: inch sizes in USA, metric elsewhere; user decision 2026-11-20)
// when the data snaps the form. The data's own rules (variables.csv):
// - round bar: percentStockAllowance of the OD, at least minStockAllowance and at most maxStockAllowance; snapped when snapStockSize;
// - hex and square bar: the flats are used as supplied unless finishingOnHexStock / finishingOnSquareStock (then hexPercentStockAllowance
//   or squarePercentStockAllowance, at least hexMinStockWidthAllowance or squareMinStockWidthAllowance, at most maxStockAllowance); hex bar
//   is snapped only when hexSnapStockSize, square bar when snapStockSize.
// Each part takes its length, the parting tool's width (tblPartingRingWidth: the first row whose diameter covers the bar's corners, the
// last for a larger bar) and the facing stock (minStockAllowance). What the bar costs per part is the "Multi-Spindle Machining - Bar
// Stock" calculator's (migration 1095).
import type { SandReference } from '../casting/sand/sand-reference';

export type BarForm = 'round' | 'hex' | 'square';
export type UnitSystem = 'US' | 'metric';

export interface PreferredSize {
  sizeMm: number;
  /** The table's own name for the size: 5/8", 16 mm. */
  label: string;
}

/** How a form's bar is sized from the part: the allowance on each side (a percent of the outside size, clamped) and whether it snaps. */
export interface BarSizing {
  percent: number;
  minMm: number;
  maxMm: number;
  snap: boolean;
}

export interface MultiSpindleStockReference {
  sizing: Readonly<Record<BarForm, BarSizing>>;
  facingStockMm: number;
  barLengthMm: number;
  /** By unit system, ascending. */
  preferredSizes: Readonly<Record<UnitSystem, readonly PreferredSize[]>>;
  /** Ascending by diameter. */
  partingRings: readonly { diameterMm: number; ringWidthMm: number }[];
}

export interface SelectedBar {
  form: BarForm;
  unitSystem: UnitSystem;
  /** The bar's diameter, or its width across flats. */
  sizeMm: number;
  sizeLabel: string;
  /** The circle round the bar's corners: the diameter it is turned from and parted through. */
  circumscribedMm: number;
  requiredMm: number;
  allowancePerSideMm: number;
  snapped: boolean;
  sectionAreaMm2: number;
  partingWidthMm: number;
  facingStockMm: number;
  /** The bar each part takes: its length, the parting width and the facing stock (the Bar Stock calculator's Length per Part). */
  lengthPerPartMm: number;
  /** The length the bar is bought in (standardStockLength). */
  barLengthMm: number;
}

/** Inch bar in USA, metric bar everywhere else (user decision 2026-11-20: bar sizes by location). */
export function unitSystemFor(location: string): UnitSystem {
  return location === 'USA' ? 'US' : 'metric';
}

/** The bar's cross-section: round π/4 D², hex √3/2 AF², square AF². */
export function barSectionAreaMm2(form: BarForm, sizeMm: number): number {
  if (form === 'hex') return (Math.sqrt(3) / 2) * sizeMm ** 2;
  if (form === 'square') return sizeMm ** 2;
  return (Math.PI / 4) * sizeMm ** 2;
}

/** The diameter of the circle through the bar's corners: round D, hex 2 AF / √3, square √2 AF. */
export function circumscribedDiameterMm(form: BarForm, sizeMm: number): number {
  if (form === 'hex') return (2 * sizeMm) / Math.sqrt(3);
  if (form === 'square') return Math.SQRT2 * sizeMm;
  return sizeMm;
}

const NUMBERS = [
  'percentStockAllowance', 'minStockAllowance', 'maxStockAllowance', 'standardStockLength',
  'hexPercentStockAllowance', 'hexMinStockWidthAllowance', 'squarePercentStockAllowance', 'squareMinStockWidthAllowance',
] as const;
const FLAGS = ['snapStockSize', 'hexSnapStockSize', 'finishingOnHexStock', 'finishingOnSquareStock'] as const;
const TABLES = ['tblPreferredSizes', 'tblPartingRingWidth'] as const;

/** The stock rules of the staged Multi-Spindle data, or what the data lacks. */
export function multiSpindleStockReference(ref: SandReference): { reference: MultiSpindleStockReference | null; missing: string[] } {
  const flag = (name: string): boolean | null => {
    const t = ref.text(name)?.trim().toLowerCase();
    return t === 'true' ? true : t === 'false' ? false : null;
  };
  const missing = [
    ...NUMBERS.filter((n) => ref.number(n) == null).map((n) => `Multi-Spindle variable ${n}`),
    ...FLAGS.filter((n) => flag(n) == null).map((n) => `Multi-Spindle variable ${n} (true or false)`),
    ...TABLES.filter((t) => ref.table(t).length === 0).map((t) => `Multi-Spindle lookup ${t} (migration 787)`),
  ];
  if (missing.length) return { reference: null, missing };
  const n = (name: (typeof NUMBERS)[number]) => ref.number(name)!;
  const flats = (finished: boolean, percent: number, minMm: number, snap: boolean): BarSizing =>
    finished ? { percent, minMm, maxMm: n('maxStockAllowance'), snap } : { percent: 0, minMm: 0, maxMm: 0, snap };
  // A system's own rows ("both" is the two systems together); sorted, one entry per size.
  const sizes = (system: UnitSystem): PreferredSize[] => {
    const rows = ref.table('tblPreferredSizes')
      .filter((r) => r.unitSystem === system && Number(r.sizeMm) > 0)
      .map((r) => ({ sizeMm: Number(r.sizeMm), label: String(r.comment ?? `${Number(r.sizeMm)} mm`).trim() }))
      .sort((a, b) => a.sizeMm - b.sizeMm);
    return rows.filter((s, i) => i === 0 || s.sizeMm !== rows[i - 1].sizeMm);
  };
  return {
    reference: {
      sizing: {
        round: { percent: n('percentStockAllowance'), minMm: n('minStockAllowance'), maxMm: n('maxStockAllowance'), snap: flag('snapStockSize')! },
        hex: flats(flag('finishingOnHexStock')!, n('hexPercentStockAllowance'), n('hexMinStockWidthAllowance'), flag('hexSnapStockSize')!),
        square: flats(flag('finishingOnSquareStock')!, n('squarePercentStockAllowance'), n('squareMinStockWidthAllowance'), flag('snapStockSize')!),
      },
      facingStockMm: n('minStockAllowance'),
      barLengthMm: n('standardStockLength'),
      preferredSizes: { US: sizes('US'), metric: sizes('metric') },
      partingRings: ref.table('tblPartingRingWidth')
        .map((r) => ({ diameterMm: Number(r.diameterMm), ringWidthMm: Number(r.ringWidthMm) }))
        .filter((r) => r.diameterMm > 0 && r.ringWidthMm > 0)
        .sort((a, b) => a.diameterMm - b.diameterMm),
    },
    missing: [],
  };
}

const FORM_NAME: Readonly<Record<BarForm, string>> = { round: 'round bar', hex: 'hex bar', square: 'square bar' };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The bar for a part of this outside size (its OD; across flats for hex and square bar) and length, or why there is none. */
export function selectBar(
  part: { outsideMm: number; form: BarForm; lengthMm: number },
  ref: MultiSpindleStockReference,
  unitSystem: UnitSystem,
): SelectedBar | { missing: string } {
  if (!(part.outsideMm > 0)) return { missing: 'the part\'s turned diameter (press Refresh analysis so the part is measured)' };
  if (!(part.lengthMm > 0)) return { missing: 'the part\'s turned length (press Refresh analysis so the part is measured)' };
  const s = ref.sizing[part.form];
  const allowance = Math.min(s.maxMm, Math.max(s.minMm, (s.percent / 100) * part.outsideMm));
  const requiredMm = part.outsideMm + 2 * allowance;
  let sizeMm = requiredMm;
  let label = `${r3(requiredMm)} mm`;
  if (s.snap) {
    const sizes = ref.preferredSizes[unitSystem];
    const size = sizes.find((x) => x.sizeMm >= requiredMm - 1e-9);
    if (!size) {
      return { missing: `no ${unitSystem === 'US' ? 'inch' : 'metric'} preferred bar size of at least ${r3(requiredMm)} mm in tblPreferredSizes (largest ${sizes.at(-1)?.sizeMm ?? 0} mm)` };
    }
    sizeMm = size.sizeMm;
    label = size.label;
  }
  const circumscribedMm = circumscribedDiameterMm(part.form, sizeMm);
  const ring = ref.partingRings.find((r) => r.diameterMm >= circumscribedMm - 1e-9) ?? ref.partingRings.at(-1);
  if (!ring) return { missing: 'tblPartingRingWidth has no rows' };
  return {
    form: part.form, unitSystem, sizeMm, sizeLabel: `${label} ${FORM_NAME[part.form]}`, circumscribedMm, requiredMm,
    allowancePerSideMm: allowance, snapped: s.snap, sectionAreaMm2: barSectionAreaMm2(part.form, sizeMm),
    partingWidthMm: ring.ringWidthMm, facingStockMm: ref.facingStockMm, lengthPerPartMm: part.lengthMm + ring.ringWidthMm + ref.facingStockMm,
    barLengthMm: ref.barLengthMm,
  };
}
