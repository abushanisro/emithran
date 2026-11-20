// What a Multi-Spindle Machining part asks of the machine: its in-cycle operations, each on the slide that does it, and the turning
// engine's other lines, which run off the machine (deburring, inspection, grinding, ...). Pure.
//
// The operation times are the turning engine's (cost-machining-engine.ts computeTurningCostSummary) on the part's bar, run raw: not
// divided by stations and without its index line, which the station plan and the cycle calculator replace. Holes are timed per diameter
// group with the same drilling calculator (computeDrillCycle), and threads per size with the same tapping calculator (computeTapCycle):
// those a live tool makes (cross and off-axis holes and threads, live-tooling.ts, feature-holes.ts) on a live-tool slide, the others on an
// end slide.
//
// Rough turning and the end-slide drilling carry the ratio their tblMultiSpindleOpSplittingThresholds row is read against: ring removed
// volume to total removed volume (Ring, Rough Turning), and hole length to part length (SimpleHole, Drilling).
import type { Slide, StationOp } from './multi-spindle-stations';
import type { PhysicsGap, ProcessLineCost } from '../../dto/cost-breakdown.dto';

/** The turning engine's lines that run in the multi-spindle's cycle, by the slide that does them. */
export const IN_CYCLE_SLIDE: Readonly<Record<string, Slide>> = {
  'Rough Turning': 'od', 'Finish Turning': 'od', Parting: 'od', Reaming: 'end', 'Rotary Broaching': 'end',
};

/**
 * Its lines the multi-spindle does otherwise: the holes (per diameter group) and the threads (per size), each on the slide that makes
 * them, the index (the cycle's) and the rechuck (the back-work spindle's).
 */
export const REPLACED_LINES: ReadonlySet<string> = new Set(['Drilling', 'Tapping', 'Index Transfer', 'Secondary Setup (Rechuck)']);

export interface WorkOp extends StationOp {
  /** The tblMultiSpindleOpSplitting rule the operation is split by, and the part's ratio its threshold is read against. */
  splitBy?: { feature: 'Ring' | 'SimpleHole'; operation: 'Rough Turning' | 'Drilling'; ratio: number; what: string };
}

/** One hole-diameter group, timed by the drilling calculator: the holes drilled on the turning axis, and those a live tool drills. */
export interface HoleGroupWork {
  diameterMm: number;
  depthMm: number | null;
  endCount: number;
  endSec: number;
  liveCount: number;
  liveSec: number;
  /** What the drilling calculator lacked for the group; empty when it is timed. */
  missing: readonly string[];
}

/** One thread size, timed by the tapping calculator: the threads tapped from an end slide, and those a live tool taps (off the centreline). */
export interface ThreadGroupWork {
  size: string;
  endCount: number;
  endSec: number;
  liveCount: number;
  liveSec: number;
  /** What the tapping calculator lacked for the size; empty when it is timed. */
  missing: readonly string[];
}

export interface MultiSpindleWorkInput {
  lines: readonly ProcessLineCost[];
  holes: readonly HoleGroupWork[];
  threads: readonly ThreadGroupWork[];
  partLengthMm: number;
  partVolumeMm3: number;
  turnedDiameterMm: number;
  turnedLengthMm: number;
  /** The bar's section and the length of it the part's machining works on (the part and its facing stock). */
  barSectionAreaMm2: number;
  stockLengthMm: number;
}

export interface MultiSpindleWorkResult {
  ops: WorkOp[];
  /** The lines that run off the machine, as the turning engine costed them. */
  offMachine: ProcessLineCost[];
  /** In-cycle operations the data could not time: named, never priced. */
  gaps: { process: string; reason: string }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const reasonOf = (g: PhysicsGap): string => ('reason' in g ? g.reason : g.requiredAction);

/** Ring removed volume (the bar down to the turned diameter, over the turned length) to all the volume removed from the part's stock. */
export function ringRemovalRatio(input: Pick<MultiSpindleWorkInput, 'barSectionAreaMm2' | 'stockLengthMm' | 'partVolumeMm3' | 'turnedDiameterMm' | 'turnedLengthMm'>): number {
  const removed = input.barSectionAreaMm2 * input.stockLengthMm - input.partVolumeMm3;
  const ring = Math.max(0, input.barSectionAreaMm2 - (Math.PI / 4) * input.turnedDiameterMm ** 2) * input.turnedLengthMm;
  return removed > 0 ? Math.min(1, ring / removed) : 0;
}

export function multiSpindleWork(input: MultiSpindleWorkInput): MultiSpindleWorkResult {
  const ops: WorkOp[] = [];
  const offMachine: ProcessLineCost[] = [];
  const gaps: { process: string; reason: string }[] = [];
  const ring = ringRemovalRatio(input);
  for (const line of input.lines) {
    if (REPLACED_LINES.has(line.process)) {
      // With no hole groups (holes counted, no diameters measured) the engine's Drilling line is the only word on them: its gap stays one.
      if (line.process === 'Drilling' && input.holes.length === 0 && line.physicsGap) gaps.push({ process: line.process, reason: reasonOf(line.physicsGap) });
      continue;
    }
    const slide = IN_CYCLE_SLIDE[line.process];
    if (!slide) {
      offMachine.push(line);
      continue;
    }
    if (line.physicsGap) gaps.push({ process: line.process, reason: reasonOf(line.physicsGap) });
    if (!(line.cycleTimeMin > 0)) continue;
    ops.push({
      name: line.process, seconds: line.cycleTimeMin * 60, slide,
      ...(line.process === 'Parting' ? { parting: true } : {}),
      ...(line.process === 'Rough Turning'
        ? { splitBy: { feature: 'Ring' as const, operation: 'Rough Turning' as const, ratio: ring, what: 'ring removed volume / total removed volume' } }
        : {}),
    });
  }
  for (const h of input.holes) {
    const name = `Ø${h.diameterMm} mm`;
    if (h.missing.length) gaps.push({ process: `Drilling ${name}`, reason: `Not priced — missing real input: ${h.missing.join('; ')}.` });
    if (h.endSec > 0) {
      const ratio = h.depthMm != null && input.partLengthMm > 0 ? h.depthMm / input.partLengthMm : 0;
      ops.push({
        name: `Drilling ${name} x ${h.endCount}`, seconds: h.endSec, slide: 'end',
        splitBy: { feature: 'SimpleHole', operation: 'Drilling', ratio, what: `hole length ${r1(h.depthMm ?? 0)} mm / part length ${r1(input.partLengthMm)} mm` },
      });
    }
    if (h.liveSec > 0) ops.push({ name: `Live-tool drilling ${name} x ${h.liveCount}`, seconds: h.liveSec, slide: 'live' });
  }
  for (const t of input.threads) {
    if (t.missing.length) gaps.push({ process: `Tapping ${t.size}`, reason: `Not priced — missing real input: ${t.missing.join('; ')}.` });
    if (t.endSec > 0) ops.push({ name: `Tapping ${t.size} x ${t.endCount}`, seconds: t.endSec, slide: 'end' });
    if (t.liveSec > 0) ops.push({ name: `Live-tool tapping ${t.size} x ${t.liveCount}`, seconds: t.liveSec, slide: 'live' });
  }
  return { ops, offMachine, gaps };
}
