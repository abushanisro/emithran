/**
 * The wall-thickness colour map: each face coloured by the thinnest wall the worker measured from it (casting.wall_mm.faces), on a continuous ramp from the
 * part's thinnest (red) to its thickest (blue) measured face, so the legend's numbers are the part's own. No rule or threshold is applied here: the
 * thin-wall overlay (face-overlay.ts) is the design check, this is the measurement. Pure, so it is tested.
 */

export interface FaceThickness {
  face: number;
  /** The thinnest wall measured from the face, mm. */
  min: number;
}

export interface ThicknessMap {
  colors: Map<number, string>;
  /** The thinnest and thickest measured face, mm: the ends of the ramp. */
  range: { min: number; max: number };
}

/** The ramp: red (thinnest) through yellow and green to blue (thickest), as hue 0 to 240 degrees. */
export function thicknessColor(t: number, range: { min: number; max: number }): string {
  const span = range.max - range.min;
  const x = span > 0 ? Math.min(1, Math.max(0, (t - range.min) / span)) : 0.5;
  return `hsl(${Math.round(240 * x)}, 80%, 50%)`;
}

/** CSS for the legend bar: the same ramp, thin to thick. */
export const THICKNESS_RAMP_CSS = "linear-gradient(to right, hsl(0,80%,50%), hsl(60,80%,50%), hsl(120,80%,50%), hsl(180,80%,50%), hsl(240,80%,50%))";

/** Face number to colour for the measured faces; null when no face has a usable measurement. */
export function thicknessMap(faces: readonly FaceThickness[]): ThicknessMap | null {
  const usable = faces.filter((f) => Number.isFinite(f.min) && f.min > 0);
  if (usable.length === 0) return null;
  const range = { min: Math.min(...usable.map((f) => f.min)), max: Math.max(...usable.map((f) => f.min)) };
  return { colors: new Map(usable.map((f) => [f.face, thicknessColor(f.min, range)])), range };
}
