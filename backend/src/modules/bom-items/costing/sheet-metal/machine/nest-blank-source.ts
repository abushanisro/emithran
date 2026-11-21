// What the Nest view nests when a part has no measured flat-pattern outline, so it always shows a nest: the best blank there is, said as what
// it is. Display only (the true-nest view is not a cost source). Pure.
import type { FlatPatternBlank } from './flat-pattern-blanks';

/**
 * wire_walk: the unfolded flat pattern's outline (verified geometry). hydroform_blank: the hydroform measurement's blank (a drawn part laid
 * out at its developed area, or its unfold). blank_rectangle: the flat pattern's (or blank's) rectangle, its outline not measured.
 * part_footprint: no flat pattern at all (a part that is not a sheet): the part's two largest sizes, an estimate.
 */
export type NestOutlineSource = 'wire_walk' | 'hydroform_blank' | 'blank_rectangle' | 'part_footprint';

export interface NestHole { cxMm: number; cyMm: number; diameterMm: number }

export interface NestBlankChoice {
  outlinePointsMm: number[][];
  holesMm: NestHole[];
  source: NestOutlineSource;
  /** Why this blank was nested instead of the true outline; null for a true outline. */
  note: string | null;
  blankIndex: number;
  blankCount: number;
}

export interface NestBlankInput {
  /** The blanks of a multi-body part (more than one), and the one asked for. */
  blanks?: readonly FlatPatternBlank[] | undefined;
  blankIndex: number;
  /** The single flat pattern: its outline and holes, and its rectangle. */
  flatOutline?: number[][] | null | undefined;
  flatHoles?: NestHole[] | undefined;
  flatRect?: { lengthMm: number | null; widthMm: number | null } | null | undefined;
  /** A hydroformed part's blank (summary.hydroformGeometry.blank): what its quote nests. */
  hydroformBlank?: { outline: number[][] | null; lengthMm: number | null; widthMm: number | null } | null | undefined;
  /** The part's bounding sizes (mm), for the footprint estimate. */
  partSizesMm?: readonly (number | null | undefined)[] | undefined;
  /** Why the analysis has no outline (the process choice conflicts with the geometry, the unfold failed, ...), said in the note. */
  whyNoOutline: string;
}

const isPolygon = (o: unknown): o is number[][] =>
  Array.isArray(o) && o.length >= 3 && o.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
const positive = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const mm = (v: number) => `${Math.round(v * 10) / 10}`;
const rectangle = (l: number, w: number): number[][] => [[0, 0], [l, 0], [l, w], [0, w]];

/** The blank the Nest view nests: the true outline when there is one, else the next best, each disclosed; null only with no size at all. */
export function chooseNestBlank(inp: NestBlankInput): NestBlankChoice | null {
  const rect = (l: number | null | undefined, w: number | null | undefined, what: string, blankIndex = 0, blankCount = 1): NestBlankChoice | null =>
    positive(l) && positive(w)
      ? { outlinePointsMm: rectangle(Math.max(l, w), Math.min(l, w)), holesMm: [], source: 'blank_rectangle', blankIndex, blankCount,
        note: `${inp.whyNoOutline} Nested as ${what}, ${mm(Math.max(l, w))} x ${mm(Math.min(l, w))} mm.` }
      : null;

  // A part cut from several blanks: the one asked for, its outline or its rectangle.
  if (inp.blanks && inp.blanks.length > 1) {
    const count = inp.blanks.length;
    const index = Math.min(Math.max(0, Math.floor(inp.blankIndex)), count - 1);
    const b = inp.blanks[index];
    if (isPolygon(b.outlinePointsMm)) {
      return { outlinePointsMm: b.outlinePointsMm, holesMm: b.holesMm.map((h) => ({ cxMm: h.cx_mm, cyMm: h.cy_mm, diameterMm: h.diameter_mm })), source: 'wire_walk', note: null, blankIndex: index, blankCount: count };
    }
    const r = rect(b.boundingLengthMm, b.boundingWidthMm, `blank ${index + 1}'s rectangle (its outline was not measured)`, index, count);
    if (r) return r;
  }
  // A hydroformed part: the blank its quote nests.
  if (inp.hydroformBlank && isPolygon(inp.hydroformBlank.outline)) {
    return { outlinePointsMm: inp.hydroformBlank.outline, holesMm: [], source: 'hydroform_blank', note: null, blankIndex: 0, blankCount: 1 };
  }
  if (isPolygon(inp.flatOutline)) {
    return { outlinePointsMm: inp.flatOutline, holesMm: inp.flatHoles ?? [], source: 'wire_walk', note: null, blankIndex: 0, blankCount: 1 };
  }
  const blankRect = rect(inp.hydroformBlank?.lengthMm, inp.hydroformBlank?.widthMm, "the hydroform blank's rectangle")
    ?? rect(inp.flatRect?.lengthMm, inp.flatRect?.widthMm, "the flat pattern's rectangle");
  if (blankRect) return blankRect;
  // No flat pattern at all: the part's footprint, its two largest sizes.
  const sizes = (inp.partSizesMm ?? []).filter(positive).sort((a, b) => b - a);
  if (sizes.length >= 2) {
    return {
      outlinePointsMm: rectangle(sizes[0], sizes[1]), holesMm: [], source: 'part_footprint', blankIndex: 0, blankCount: 1,
      note: `${inp.whyNoOutline} No flat pattern was measured, so the part's footprint, ${mm(sizes[0])} x ${mm(sizes[1])} mm, is nested as an estimate.`,
    };
  }
  return null;
}

export interface GridNest {
  outlinePointsMm: number[][];
  placements: { xMm: number; yMm: number; rotationDeg: number }[];
  partsPerSheet: number;
  utilizationPct: number;
  sheetsRequired: number | null;
  capped: boolean;
}

/** The most placements sent for one sheet (the count is not capped): a tiny part on a large sheet would otherwise send tens of thousands. */
export const GRID_PLACEMENT_CAP = 5000;

const shoelace = (pts: number[][]) => Math.abs(pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/**
 * The outline on a grid of its bounding rectangle, kerf apart, inside the edge margin, in whichever of its two orientations fits more: never
 * overlapping, never a guess at a closer packing. Used when the cad-engine cannot nest the outline, so the view still shows a nest.
 */
export function gridNest(outline: number[][], sheetWidthMm: number, sheetLengthMm: number, kerfMm: number, edgeMarginMm: number, quantity: number): GridNest {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const flat = outline.map((p) => [p[0] - x0, p[1] - y0]);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  const fit = (pw: number, ph: number) => {
    const cols = Math.floor((sheetWidthMm - 2 * edgeMarginMm + kerfMm) / (pw + kerfMm));
    const rows = Math.floor((sheetLengthMm - 2 * edgeMarginMm + kerfMm) / (ph + kerfMm));
    return { cols: Math.max(0, cols), rows: Math.max(0, rows) };
  };
  const upright = fit(w, h);
  const turned = fit(h, w);
  const turn = turned.cols * turned.rows > upright.cols * upright.rows;
  // Turned a quarter: (x, y) -> (h - y, x), still in the positive quadrant.
  const pts = turn ? flat.map(([x, y]) => [h - y, x]) : flat;
  const [pw, ph] = turn ? [h, w] : [w, h];
  const { cols, rows } = turn ? turned : upright;
  const count = cols * rows;
  const placements: GridNest['placements'] = [];
  for (let r = 0; r < rows && placements.length < GRID_PLACEMENT_CAP; r++) {
    for (let c = 0; c < cols && placements.length < GRID_PLACEMENT_CAP; c++) {
      placements.push({ xMm: edgeMarginMm + c * (pw + kerfMm), yMm: edgeMarginMm + r * (ph + kerfMm), rotationDeg: 0 });
    }
  }
  const sheetArea = sheetWidthMm * sheetLengthMm;
  return {
    outlinePointsMm: pts,
    placements,
    partsPerSheet: count,
    utilizationPct: sheetArea > 0 ? Math.round(((count * shoelace(pts)) / sheetArea) * 10000) / 100 : 0,
    sheetsRequired: count > 0 ? Math.ceil(Math.max(1, quantity) / count) : null,
    capped: count > placements.length,
  };
}
