// The station plan of a multi-spindle (multi-spindle-stations.ts): the optimal partition checked against every partition, and the plans
// on the real machines' slide layouts (memory/machining/machine/simultaneous_turning_usa.csv).
import { multiSpindleMachinesFromMemory } from './multi-spindle-fixtures';
import { layoutOf } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route';
import {
  partitionOps, planStations, slideMakespan, type PlannedOp, type SpindleLayout, type StationPlan,
} from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-stations';

/** A deterministic pseudo-random sequence (mulberry32), so the cases are the same on every run. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The best slowest station over every way of cutting `durations` (in order) into `slides.length` contiguous, possibly empty, runs. */
function bruteForce(durations: number[], slides: number[], lastTakesTail: boolean): number {
  let best = Infinity;
  const station = new Array<number>(durations.length).fill(0);
  const visit = (i: number, from: number) => {
    if (i === durations.length) {
      if (lastTakesTail && station[durations.length - 1] !== slides.length - 1) return;
      const worst = Math.max(...slides.map((n, s) => slideMakespan(durations.filter((_, k) => station[k] === s), n)));
      best = Math.min(best, worst);
      return;
    }
    for (let s = from; s < slides.length; s++) {
      station[i] = s;
      visit(i + 1, s);
    }
  };
  visit(0, 0);
  return best;
}

const op = (seconds: number, name = `op ${seconds}`): PlannedOp => ({ name, slide: 'od', seconds });
const machine = (name: string) => {
  const m = multiSpindleMachinesFromMemory().find((x) => x.name === name);
  if (!m) throw new Error(`${name} is not in memory/machining/machine/simultaneous_turning_usa.csv`);
  return m;
};
const layout = (name: string): SpindleLayout => layoutOf(machine(name))!;
const plan = (p: ReturnType<typeof planStations>): StationPlan => {
  if ('missing' in p) throw new Error(p.missing);
  return p;
};

describe('slideMakespan', () => {
  it('one slide does them one after another; with a slide for each, the longest sets the time', () => {
    expect(slideMakespan([3, 4, 5], 1)).toBe(12);
    expect(slideMakespan([3, 4, 5], 3)).toBe(5);
    expect(slideMakespan([], 2)).toBe(0);
  });

  it('two slides: the best division of the operations between them, over every subset', () => {
    expect(slideMakespan([3, 3, 2, 2, 2], 2)).toBe(6);
    expect(slideMakespan([5, 4, 3, 3, 3], 2)).toBe(9);
  });

  it('no slide of the kind takes forever (the operation cannot be done there)', () => {
    expect(slideMakespan([1], 0)).toBe(Infinity);
  });
});

describe('partitionOps: the optimal linear partition', () => {
  it('finds the best slowest station of every partition (300 random cases, 1 or 2 slides per station)', () => {
    const next = random(20261120);
    for (let c = 0; c < 300; c++) {
      const n = 1 + Math.floor(next() * 7);
      const stations = 1 + Math.floor(next() * 4);
      const durations = Array.from({ length: n }, () => Math.round(next() * 200) / 10);
      const slides = Array.from({ length: stations }, () => (next() < 0.3 ? 2 : 1));
      const tail = next() < 0.5;
      const got = partitionOps(durations.map((d) => op(d)), slides.map((_, i) => i + 1), (s) => slides[s - 1], tail);
      expect({ c, seconds: got?.seconds }).toEqual({ c, seconds: expect.closeTo(bruteForce(durations, slides, tail), 9) });
    }
  });

  it('keeps the operations in order and gives the last station the final one when asked (the cut-off)', () => {
    const got = partitionOps([op(5, 'a'), op(5, 'b'), op(2, 'parting')], [1, 2, 3], () => 1, true)!;
    expect(got.groups.map((g) => g.map((o) => o.name))).toEqual([['a'], ['b'], ['parting']]);
    expect(got.seconds).toBe(5);
  });

  it('of equally fast partitions, starts the work at the first station', () => {
    const got = partitionOps([op(5, 'a'), op(5, 'b')], [1, 2, 3], () => 1)!;
    expect(got.groups.map((g) => g.map((o) => o.name))).toEqual([['a'], ['b'], []]);
    const parted = partitionOps([op(1, 'finish'), op(2, 'parting')], [1, 2, 3, 4, 5], () => 1, true)!;
    expect(parted.groups.map((g) => g.map((o) => o.name))).toEqual([['finish'], [], [], [], ['parting']]);
  });

  it('is null when an operation has no slide of its kind at any station', () => {
    expect(partitionOps([op(1)], [1, 2], () => 0)).toBeNull();
  });
});

describe('planStations on the machines of memory/', () => {
  const ops = [
    { name: 'Rough Turning', seconds: 20, slide: 'od' as const, split: 2 },
    { name: 'Finish Turning', seconds: 8, slide: 'od' as const },
    { name: 'Parting', seconds: 6, slide: 'od' as const, parting: true },
    { name: 'Drilling', seconds: 15, slide: 'end' as const },
    { name: 'Tapping', seconds: 5, slide: 'end' as const },
  ];
  const times = { toolPositioningSec: 0.9, partEjectSec: 1 };

  it('Index MS32-6 (6 spindles, back work on the 6th): five front stations, the cut-off at the 5th, the eject at the 6th', () => {
    expect(layout('Index MS32-6')).toEqual({ spindles: 6, od: [1, 2, 3, 4, 5, 6], end: [1, 2, 3, 4, 5, 6], live: [1, 2, 3, 4, 5, 6], back: [6] });
    const p = plan(planStations(ops, layout('Index MS32-6'), times));
    expect(p.stations.map((s) => s.spindle)).toEqual([1, 2, 3, 4, 5, 6]);
    // Rough turning in two passes of 10 s, each with the 0.9 s tool positioning, on successive stations.
    expect(p.stations.flatMap((s) => s.ops.map((o) => o.name))).toEqual(expect.arrayContaining(['Rough Turning (1/2)', 'Rough Turning (2/2)']));
    expect(p.stations[4].ops.map((o) => o.name)).toContain('Parting');
    expect(p.stations[5]).toEqual({ spindle: 6, back: true, ops: [], seconds: 1 });
    // The slowest is the drilling station: 15 + 0.9 s; every station is at most that.
    expect(p.slowest.seconds).toBeCloseTo(15.9, 9);
    expect(p.slowest.ops.map((o) => o.name)).toContain('Drilling');
    expect(Math.max(...p.stations.map((s) => s.seconds))).toBeCloseTo(15.9, 9);
  });

  it('Index MS40-8 (8 spindles, back work on the 7th and 8th): six front stations, the eject on the last back-work one', () => {
    const p = plan(planStations(ops, layout('Index MS40-8'), times));
    expect(p.stations.filter((s) => !s.back).map((s) => s.spindle)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.stations.filter((s) => s.back).map((s) => [s.spindle, s.seconds])).toEqual([[7, 0], [8, 1]]);
    expect(p.stations[5].ops.map((o) => o.name)).toContain('Parting');
  });

  it('HAAS DS-30Y (twin spindle, two turrets per spindle): one front station, its two OD turrets sharing the turning', () => {
    expect(layout('HAAS DS-30Y')).toEqual({ spindles: 2, od: [1, 1, 2, 2], end: [1, 2], live: [1, 2], back: [2] });
    const p = plan(planStations(ops.map(({ split: _split, ...o }) => o), layout('HAAS DS-30Y'), times));
    expect(p.stations.map((s) => [s.spindle, s.back])).toEqual([[1, false], [2, true]]);
    // OD on two turrets: {rough 20.9} and {finish 8.9 + parting 6.9 = 15.8} -> 20.9; end on one slide: 15.9 + 5.9 = 21.8.
    expect(p.stations[0].seconds).toBeCloseTo(21.8, 9);
    expect(p.slowest.spindle).toBe(1);
  });

  it('names the operations a machine has no slide for', () => {
    const noLive: SpindleLayout = { spindles: 6, od: [1, 2, 3, 4, 5, 6], end: [1, 2, 3, 4, 5, 6], live: [], back: [6] };
    expect(planStations([{ name: 'Live-tool drilling Ø3 mm x 2', seconds: 4, slide: 'live' }], noLive, times))
      .toEqual({ missing: 'no live-tool slide for Live-tool drilling Ø3 mm x 2' });
  });
});
