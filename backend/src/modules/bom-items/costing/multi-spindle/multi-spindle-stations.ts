// The station plan of a multi-spindle: which spindle position does which operation, and so the cycle. Pure.
//
// Every station of the machine cuts at once and one part comes off per index, so the cycle is the slowest station plus the index
// (MULTI_SPINDLE_CYCLE_SOURCE). The part passes the front spindles in order, is cut off at the last one and taken off by the back-work
// spindles (memory/Machining/machine/simultaneous_turning_usa.csv slide_configuration: back_work_spindles 6, 7-8 or 2). Each spindle carries
// OD, end and live-tool slides (a spindle listed twice carries two of the kind: the twin turrets of a sub-spindle turning center).
//
// The plan: each slide's operations keep their machining order and are split into contiguous station groups over the front spindles by
// the optimal linear partition (dynamic programming over the stations, O(stations x ops²)), which makes the slowest group as fast as it
// can be; a group's time is the least time it takes on that station's slides of its kind (exact for one or two slides, which every machine
// here has), each operation with the machine's tool positioning time. The slides of one station work independently, so a station takes as
// long as its slowest slide. Parting closes the front stations; the cut-off part is ejected from the last back-work spindle (the last front
// one on a machine without back work). No turning engine operation is a back-face one, so the back-work spindles cut nothing here.

export type Slide = 'od' | 'end' | 'live';
export const SLIDES: readonly Slide[] = ['od', 'end', 'live'];
const SLIDE_NAME: Readonly<Record<Slide, string>> = { od: 'OD', end: 'end', live: 'live-tool' };

export interface StationOp {
  name: string;
  seconds: number;
  slide: Slide;
  /** Split into this many equal passes on successive stations (tblMultiSpindleOpSplitting); 1 or absent: not split. */
  split?: number;
  /** The cut-off: done at the last front station. */
  parting?: boolean;
}

export interface SpindleLayout {
  spindles: number;
  /** The spindle numbers carrying each slide; a spindle listed twice carries two. */
  od: readonly number[];
  end: readonly number[];
  live: readonly number[];
  back: readonly number[];
}

export interface PlannedOp {
  name: string;
  slide: Slide;
  /** Its cutting time plus the tool positioning. */
  seconds: number;
}

export interface PlannedStation {
  spindle: number;
  back: boolean;
  ops: PlannedOp[];
  /** The slowest of its slides, plus the part eject on the last back-work station. */
  seconds: number;
}

export interface StationPlan {
  stations: PlannedStation[];
  slowest: PlannedStation;
}

/** The least time these operations take on `slides` parallel slides of one station, each operation on one slide. */
export function slideMakespan(durations: readonly number[], slides: number): number {
  if (durations.length === 0) return 0;
  if (slides <= 0) return Infinity;
  const total = durations.reduce((s, d) => s + d, 0);
  if (slides === 1) return total;
  if (durations.length <= slides) return Math.max(...durations);
  if (slides === 2 && durations.length <= 16) {
    // Exact: the best division of the operations between the two slides, over every subset.
    let best = total;
    for (let mask = 0; mask < 1 << durations.length; mask++) {
      let a = 0;
      for (let i = 0; i < durations.length; i++) if (mask & (1 << i)) a += durations[i];
      best = Math.min(best, Math.max(a, total - a));
    }
    return best;
  }
  // Longest processing time first: each operation on the least loaded slide.
  const loads = new Array<number>(slides).fill(0);
  for (const d of [...durations].sort((x, y) => y - x)) loads[loads.indexOf(Math.min(...loads))] += d;
  return Math.max(...loads);
}

/** Station times this close (s) are the same time: the partition then keeps the one that starts the work earliest. */
const SAME_TIME_S = 1e-9;

/**
 * The optimal linear partition of `ops` (in order) over `stations` (in order): station s takes a contiguous run, its time the makespan on its
 * slides; minimises the slowest station. `lastTakesTail`: the last station takes at least the final operation (the cut-off). Null when an
 * operation has no slide of its kind at any station.
 */
export function partitionOps(
  ops: readonly PlannedOp[],
  stations: readonly number[],
  slidesAt: (spindle: number) => number,
  lastTakesTail = false,
): { groups: PlannedOp[][]; seconds: number } | null {
  const n = ops.length;
  const f = stations.length;
  if (n === 0) return { groups: stations.map(() => []), seconds: 0 };
  if (f === 0) return null;
  const cost = (s: number, j: number, i: number) => slideMakespan(ops.slice(j, i).map((o) => o.seconds), slidesAt(stations[s]));
  // best[s][i]: the slowest station when stations 0..s-1 take ops 0..i-1; from[s][i]: where station s-1's run starts. Of equally fast
  // partitions the one whose later stations take the fewest operations is kept (the latest start), so the work begins at the first station.
  const best = Array.from({ length: f + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: f + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let s = 1; s <= f; s++) {
    for (let i = 0; i <= n; i++) {
      const tail = lastTakesTail && s === f && i === n;
      for (let j = 0; j <= (tail ? i - 1 : i); j++) {
        const v = Math.max(best[s - 1][j], cost(s - 1, j, i));
        if (v <= best[s][i] + SAME_TIME_S) {
          best[s][i] = Math.min(v, best[s][i]);
          from[s][i] = j;
        }
      }
    }
  }
  if (!Number.isFinite(best[f][n])) return null;
  const groups: PlannedOp[][] = new Array(f);
  for (let s = f, i = n; s >= 1; s--) {
    const j = from[s][i];
    groups[s - 1] = ops.slice(j, i);
    i = j;
  }
  return { groups, seconds: best[f][n] };
}

/** The station plan of `ops` on a machine of this layout, or the operations no slide of the machine can take. */
export function planStations(
  ops: readonly StationOp[],
  layout: SpindleLayout,
  times: { toolPositioningSec: number; partEjectSec: number },
): StationPlan | { missing: string } {
  const back = [...new Set(layout.back)].sort((a, b) => a - b);
  const front = Array.from({ length: layout.spindles }, (_, i) => i + 1).filter((s) => !back.includes(s));
  if (front.length === 0) return { missing: 'the machine has no front spindle' };
  const slidesOf = (slide: Slide) => (spindle: number) => layout[slide].filter((s) => s === spindle).length;

  // Each operation, split into its passes, with the tool positioning of each pass.
  const expanded = ops.filter((o) => o.seconds > 0).flatMap((o) => {
    const k = Math.max(1, Math.floor(o.split ?? 1));
    return Array.from({ length: k }, (_, p) => ({
      op: { name: k > 1 ? `${o.name} (${p + 1}/${k})` : o.name, slide: o.slide, seconds: o.seconds / k + times.toolPositioningSec },
      parting: o.parting === true,
    }));
  });

  const opsAt = new Map<number, PlannedOp[]>(front.map((s) => [s, []]));
  const timeAt = new Map<number, number>(front.map((s) => [s, 0]));
  for (const slide of SLIDES) {
    // The cut-off goes last on the OD slides, at the last front station.
    const mine = expanded.filter((e) => e.op.slide === slide);
    const ordered = [...mine.filter((e) => !e.parting), ...mine.filter((e) => e.parting)].map((e) => e.op);
    if (ordered.length === 0) continue;
    const plan = partitionOps(ordered, front, slidesOf(slide), slide === 'od' && mine.some((e) => e.parting));
    if (!plan) return { missing: `no ${SLIDE_NAME[slide]} slide for ${ordered.map((o) => o.name).join(', ')}` };
    plan.groups.forEach((group, i) => {
      const spindle = front[i];
      opsAt.get(spindle)!.push(...group);
      timeAt.set(spindle, Math.max(timeAt.get(spindle)!, slideMakespan(group.map((o) => o.seconds), slidesOf(slide)(spindle))));
    });
  }

  const stations: PlannedStation[] = [
    ...front.map((spindle) => ({ spindle, back: false, ops: opsAt.get(spindle)!, seconds: timeAt.get(spindle)! })),
    ...back.map((spindle) => ({ spindle, back: true, ops: [] as PlannedOp[], seconds: 0 })),
  ];
  stations.at(-1)!.seconds += times.partEjectSec;
  const slowest = stations.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  return { stations, slowest };
}
