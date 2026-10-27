// Panel utilization for a bare board: how many boards fit one production panel, and how much panel
// area each finished board consumes. Pure geometry; every dimension is an explicit input (a panel
// size, a border and a spacing come from the person or a sourced rate, never from this file).
//
// Rectangular nesting only: boards are placed on a grid by their bounding box, in the one of the two
// orientations that fits more. This is a calculated layout, not an optimised true-part nesting, and the
// result says so.

export interface PanelConfig {
  /** Production panel dimensions. */
  lengthMm: number;
  widthMm: number;
  /** Unused border on every edge (tooling and handling allowance). */
  borderMm: number;
  /** Gap between neighbouring boards. */
  spacingMm: number;
}

export interface BoardFootprint {
  lengthMm: number;
  widthMm: number;
  /** Net copper-clad area. When absent the bounding box is used, and the result says so. */
  areaMm2?: number;
}

export type PanelOrientation = 'as_drawn' | 'rotated';

export type PanelLayout =
  | {
      status: 'fits';
      nesting: 'rectangular_grid';
      orientation: PanelOrientation;
      boardsAcross: number;
      boardsDown: number;
      boardsPerPanel: number;
      panelAreaMm2: number;
      usablePanelAreaMm2: number;
      netBoardAreaMm2: number;
      /** 'outline' when the board's own area was supplied, 'bounding_box' otherwise. */
      netAreaBasis: 'outline' | 'bounding_box';
      /** Net board area on the panel / gross panel area, 0..1. */
      utilization: number;
      /** Gross panel area consumed per finished board (net + its share of waste). */
      grossPanelAreaPerBoardMm2: number;
    }
  | { status: 'does_not_fit'; reason: string };

function requirePositive(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a positive number, got ${v}`);
}

function requireNonNegative(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be zero or more, got ${v}`);
}

// Boards that fit in one direction: n boards need n*size + (n-1)*spacing <= usable.
function fitCount(usableMm: number, sizeMm: number, spacingMm: number): number {
  return Math.max(0, Math.floor((usableMm + spacingMm) / (sizeMm + spacingMm)));
}

export function computePanelLayout(board: BoardFootprint, panel: PanelConfig): PanelLayout {
  requirePositive('board.lengthMm', board.lengthMm);
  requirePositive('board.widthMm', board.widthMm);
  if (board.areaMm2 !== undefined) requirePositive('board.areaMm2', board.areaMm2);
  requirePositive('panel.lengthMm', panel.lengthMm);
  requirePositive('panel.widthMm', panel.widthMm);
  requireNonNegative('panel.borderMm', panel.borderMm);
  requireNonNegative('panel.spacingMm', panel.spacingMm);

  const usableL = panel.lengthMm - 2 * panel.borderMm;
  const usableW = panel.widthMm - 2 * panel.borderMm;
  if (usableL <= 0 || usableW <= 0) {
    return { status: 'does_not_fit', reason: `Panel borders (${panel.borderMm} mm each edge) leave no usable area on a ${panel.lengthMm} x ${panel.widthMm} mm panel.` };
  }

  const asDrawn = {
    orientation: 'as_drawn' as const,
    across: fitCount(usableL, board.lengthMm, panel.spacingMm),
    down: fitCount(usableW, board.widthMm, panel.spacingMm),
  };
  const rotated = {
    orientation: 'rotated' as const,
    across: fitCount(usableL, board.widthMm, panel.spacingMm),
    down: fitCount(usableW, board.lengthMm, panel.spacingMm),
  };
  // Ties keep the drawn orientation, so the same inputs always give the same layout.
  const best = rotated.across * rotated.down > asDrawn.across * asDrawn.down ? rotated : asDrawn;
  const count = best.across * best.down;
  if (count === 0) {
    return {
      status: 'does_not_fit',
      reason: `A ${board.lengthMm} x ${board.widthMm} mm board does not fit the ${usableL} x ${usableW} mm usable area (borders ${panel.borderMm} mm, spacing ${panel.spacingMm} mm) in either orientation.`,
    };
  }

  const panelArea = panel.lengthMm * panel.widthMm;
  const netArea = board.areaMm2 ?? board.lengthMm * board.widthMm;
  return {
    status: 'fits',
    nesting: 'rectangular_grid',
    orientation: best.orientation,
    boardsAcross: best.across,
    boardsDown: best.down,
    boardsPerPanel: count,
    panelAreaMm2: panelArea,
    usablePanelAreaMm2: usableL * usableW,
    netBoardAreaMm2: netArea,
    netAreaBasis: board.areaMm2 === undefined ? 'bounding_box' : 'outline',
    utilization: (count * netArea) / panelArea,
    grossPanelAreaPerBoardMm2: panelArea / count,
  };
}
