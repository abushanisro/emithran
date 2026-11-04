/**
 * The stages of making a sand casting, each tied to the route steps that cost it and to what the viewer shows during it. The stages are the order the route
 * itself runs (melt, cores, mould, pour, cool, shakeout, degate, clean/finish/inspect); a stage lists only the route lines that exist for this part, with
 * the cycle time the route gives them, and says nothing of a line the route does not have. What the viewer shows is assembly state (mould open or closed,
 * cores in, gating on): no fill or solidification is shown, because nothing computes them. Pure, so it is tested.
 */

export interface StageView {
  mould: boolean;
  /** 0 closed to 1 fully open. */
  open: number;
  cores: boolean;
  gating: boolean;
  /** The mould cut in half so the inside shows. */
  section: boolean;
}

export interface StageLine {
  process: string;
  cycleTimeMin: number;
}

export interface ProcessStage {
  key: string;
  label: string;
  /** What happens in this stage, in plain words. */
  what: string;
  view: StageView;
  /** The route lines of this stage that exist for this part, in route order. */
  lines: StageLine[];
}

interface StageDef {
  key: string;
  label: string;
  what: string;
  view: StageView;
  /** Whether a route line belongs to this stage. */
  has: (process: string, mouldingProcess: string | null) => boolean;
}

const DEFS: readonly StageDef[] = [
  {
    key: 'mould',
    label: 'Make the mould',
    what: 'Sand is packed around the pattern in the cope and the drag; the cavity, sprue, runner and risers take shape. The mould is open here.',
    view: { mould: true, open: 1, cores: false, gating: true, section: false },
    has: (p, m) => m != null && p === m,
  },
  {
    key: 'cores',
    label: 'Make and set the cores',
    what: 'Cores form the holes and voids the pattern cannot; each is set in the drag before the mould closes.',
    view: { mould: true, open: 1, cores: true, gating: true, section: false },
    has: (p) => /coremaking$/i.test(p),
  },
  {
    key: 'close',
    label: 'Close the mould',
    what: 'The cope is lowered on the drag. Shown cut in half so the part and cores inside can be seen.',
    view: { mould: true, open: 0, cores: true, gating: true, section: true },
    has: () => false,
  },
  {
    key: 'pour',
    label: 'Melt and pour',
    what: 'The metal is melted and poured into the basin; it runs down the sprue, along the runner and in through the ingates.',
    view: { mould: true, open: 0, cores: true, gating: true, section: true },
    has: (p) => p === 'Melting' || p === 'Pour',
  },
  {
    key: 'cool',
    label: 'Cool and solidify',
    what: 'The metal freezes, the thin parts first; the risers feed the casting as it shrinks.',
    view: { mould: true, open: 0, cores: true, gating: true, section: true },
    has: (p) => p === 'Cooling',
  },
  {
    key: 'shakeout',
    label: 'Shake out',
    what: 'The mould is broken up and the sand falls away from the casting with its gating still attached.',
    view: { mould: false, open: 0, cores: false, gating: true, section: false },
    has: (p) => p === 'Shakeout',
  },
  {
    key: 'degate',
    label: 'Cut off the gating',
    what: 'The sprue, runner, ingates and risers are cut or broken off the casting.',
    view: { mould: false, open: 0, cores: false, gating: true, section: false },
    has: (p) => p === 'Degating',
  },
  {
    key: 'finish',
    label: 'Clean, finish, inspect',
    what: 'The casting is blasted clean, the stubs and the parting line are ground, and it is inspected.',
    view: { mould: false, open: 0, cores: false, gating: false, section: false },
    has: (p) => p === 'Cleaning' || p === 'Finishing' || p === 'Visual Inspection',
  },
];

/** The stages in order, each with the route lines that belong to it. */
export function processStages(lines: readonly StageLine[] | null | undefined, mouldingProcess: string | null): ProcessStage[] {
  const all = lines ?? [];
  return DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    what: d.what,
    view: d.view,
    lines: all.filter((l) => d.has(l.process, mouldingProcess)),
  }));
}

/** The minutes a stage takes in the route, or null when the route has no line for it. */
export function stageMinutes(stage: ProcessStage): number | null {
  return stage.lines.length === 0 ? null : stage.lines.reduce((s, l) => s + l.cycleTimeMin, 0);
}
