// The routes of a Multi-Spindle Machining part (multi-spindle-route.ts) on the 15 machines of memory/machining (Simultaneous Turning), with
// the cycle calculator of migration 1095 and tblMultiSpindleOpSplitting.
import { readFileSync } from 'fs';
import { join } from 'path';

import { multiSpindleMachinesFromMemory, splitRulesFromMemory, stockReferenceFromMemory } from './multi-spindle-fixtures';
import { machineValue, type SandMachine } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import { loadMultiSpindleCalculatorSpec, multiSpindleCalculatorsByName } from '../../../../../modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculator-spec';
import {
  MULTI_SPINDLE_MACHINE_COLUMNS, MULTI_SPINDLE_ROUTES, buildMultiSpindleRoutes, capacityReasons, chooseMultiSpindleRoute, layoutOf, splitOps, type MultiSpindleWork,
} from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route';

const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const ZERO_CONTEXT = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const INDEX_COLUMNS = ['drum_index_time_s', 'transfer_time_s', 'stock_feed_time_s', 'speed_synchronization_time_s'];

// A Ø14 x 32 mm part on 5/8" bar: rough turning that removes mostly the ring, and a hole 30 of its 32 mm deep.
const work = (over: Partial<MultiSpindleWork> = {}): MultiSpindleWork => ({
  ops: [
    { name: 'Rough Turning', seconds: 30, slide: 'od', splitBy: { feature: 'Ring', operation: 'Rough Turning', ratio: 0.9, what: 'ring removed volume / total removed volume' } },
    { name: 'Finish Turning', seconds: 12, slide: 'od' },
    { name: 'Parting', seconds: 6, slide: 'od', parting: true },
    { name: 'Drilling Ø6 mm x 1', seconds: 15, slide: 'end', splitBy: { feature: 'SimpleHole', operation: 'Drilling', ratio: 30 / 32, what: 'hole length 30 mm / part length 32 mm' } },
  ],
  barCircumscribedMm: 15.875,
  lengthPerPartMm: 35.29375,
  ...over,
});
const build = (w: MultiSpindleWork = work(), machines: SandMachine[] = multiSpindleMachinesFromMemory()) => buildMultiSpindleRoutes({
  ref: stockReferenceFromMemory(), spec: loadMultiSpindleCalculatorSpec(), calculators: multiSpindleCalculatorsByName(),
  machines, work: w, rules: splitRulesFromMemory(), batchSize: 1000, costContext: ZERO_CONTEXT,
});
const spindlesOf = (key: string) => MULTI_SPINDLE_ROUTES.find((r) => r.key === key)!.spindles;
const machine = (name: string) => multiSpindleMachinesFromMemory().find((m) => m.name === name)!;

describe('the multi-spindle routes on the machines of memory/', () => {
  it('price each route on its cheapest capable machine of its spindle count', () => {
    const routes = build();
    expect(routes.map((r) => [r.key, r.complete])).toEqual([['6', true], ['8', true], ['twin', true]]);
    for (const r of routes) {
      expect(machineValue(r.machine!, 'number_spindles')).toBe(spindlesOf(r.key));
      const capable = r.line.machineChoice!.candidates.filter((c) => c.status !== 'rejected');
      expect(capable[0]).toMatchObject({ name: r.machine!.name, status: 'chosen' });
      expect(capable.every((c) => c.perPartCost! >= capable[0].perPartCost!)).toBe(true);
      expect(r.line).toMatchObject({ process: 'Simultaneous Turning', processGroup: 'Multi-Spindle Machining', machineClass: 'simultaneous_turning', machineName: r.machine!.name });
    }
  });

  it('a cycle is the slowest station plus the machine\'s index: drum index, transfer, stock feed and speed sync', () => {
    for (const r of build()) {
      const index = INDEX_COLUMNS.reduce((s, k) => s + machineValue(r.machine!, k)!, 0);
      expect(r.indexSec).toBeCloseTo(index, 9);
      expect(r.cycleSec).toBeCloseTo(r.plan!.slowest.seconds + index, 9);
      expect(r.line.cycleTimeMin).toBeCloseTo(r.cycleSec! / 60, 3);
    }
    // memory: 0.7 s drum index on a 6-spindle, 1.2 s on an 8-spindle, none on a twin-spindle center; transfer 1, feed 2.5, sync 1.5 s
    expect(build().map((r) => Math.round(r.indexSec! * 10) / 10)).toEqual([5.7, 6.2, 5]);
  });

  it('split rough turning and the deep hole as tblMultiSpindleOpSplitting says for the spindle count (none on a twin-spindle center)', () => {
    const [six, eight, twin] = build();
    expect(six.splits).toEqual([expect.stringContaining('Rough Turning split over 2 stations'), expect.stringContaining('Drilling Ø6 mm x 1 split over 3 stations')]);
    expect(eight.splits).toEqual([expect.stringContaining('Rough Turning split over 3 stations'), expect.stringContaining('Drilling Ø6 mm x 1 split over 3 stations')]);
    expect(twin.splits).toEqual([]);
    expect(six.plan!.stations.flatMap((s) => s.ops.map((o) => o.name))).toEqual(expect.arrayContaining(['Rough Turning (1/2)', 'Rough Turning (2/2)', 'Drilling Ø6 mm x 1 (3/3)']));
  });

  it('a ratio below the threshold is not split', () => {
    const { ops, notes } = splitOps([{ name: 'Rough Turning', seconds: 30, slide: 'od', splitBy: { feature: 'Ring', operation: 'Rough Turning', ratio: 0.1, what: 'ring' } }], 6, splitRulesFromMemory());
    expect(ops).toEqual([{ name: 'Rough Turning', seconds: 30, slide: 'od' }]);
    expect(notes).toEqual([]);
  });

  it('a bar beyond a machine\'s capacity, or a part longer than it takes, rules the machine out', () => {
    expect(capacityReasons(machine('Index MS32-6'), { barCircumscribedMm: 40, lengthPerPartMm: 150 })).toEqual([
      'takes bar up to Ø32 mm, the bar is Ø40 mm across its corners', 'takes parts up to 100 mm long, each part takes 150 mm of bar',
    ]);
    // Ø40 bar: of the 6-spindles only the large one (90 mm) takes it.
    expect(build(work({ barCircumscribedMm: 40 }))[0].machine!.name).toBe('Virtual CNC Multi-Spindle, 6 Spindles, Large');
  });

  it('with no machine of a route that fits, the route is a named gap and the others are still priced', () => {
    const routes = build(work({ barCircumscribedMm: 95 }));
    expect(routes.map((r) => r.complete)).toEqual([false, false, false]);
    expect(routes[0].line.physicsGap).toMatchObject({ reason: expect.stringContaining('no Simultaneous Turning machine fits') });
    expect(routes[0].line.totalCost).toBe(0);
    const near = build(work({ barCircumscribedMm: 85 }));
    expect(near.map((r) => r.complete)).toEqual([true, true, false]); // 90 mm multi-spindles; the largest twin-spindle center takes 82 mm
  });

  it('a machine without a slide an operation needs is not capable', () => {
    const noLive = { ...machine('Index MS32-6'), specs: { ...machine('Index MS32-6').specs, live_tooling_spindles: [] } };
    const routes = build(work({ ops: [{ name: 'Live-tool drilling Ø3 mm x 2', seconds: 4, slide: 'live' }] }), [noLive]);
    expect(routes[0].complete).toBe(false);
    expect(routes[0].line.physicsGap).toMatchObject({ reason: expect.stringContaining('no live-tool slide for Live-tool drilling Ø3 mm x 2') });
    expect(layoutOf({ ...noLive, specs: {} })).toBeNull();
  });
});

describe('chooseMultiSpindleRoute', () => {
  const routes = [{ key: '6', complete: true, cost: 3 }, { key: '8', complete: true, cost: 2 }, { key: 'twin', complete: false, cost: 1 }];
  it('quotes the route set by hand, else the cheapest complete one, else the first', () => {
    expect(chooseMultiSpindleRoute(routes, 'twin', (r) => r.cost)!.key).toBe('twin');
    expect(chooseMultiSpindleRoute(routes, null, (r) => r.cost)!.key).toBe('8');
    expect(chooseMultiSpindleRoute(routes, 'none', (r) => r.cost)!.key).toBe('8');
    expect(chooseMultiSpindleRoute(routes.map((r) => ({ ...r, complete: false })), null, (r) => r.cost)!.key).toBe('6');
  });
});

describe('what the routes read from HR Rates is in the database', () => {
  it('the typed columns are migration 788\'s (index times, spindles) and 1093\'s (limits); the slide layout and times are 1093\'s specs', () => {
    const m788 = readFileSync(join(MIGRATIONS, '788_add_simultaneous_turning_spindle_config.sql'), 'utf8');
    const m1093 = readFileSync(join(MIGRATIONS, '1093_multi_spindle_machine_limits.sql'), 'utf8');
    for (const c of MULTI_SPINDLE_MACHINE_COLUMNS) expect({ c, found: m788.includes(`ADD COLUMN IF NOT EXISTS ${c}`) || m1093.includes(`${c} = v.${c}`) }).toEqual({ c, found: true });
    for (const k of ['od_slide_spindles', 'end_slide_spindles', 'live_tooling_spindles', 'back_work_spindles', 'part_eject_time_s', 'tool_positioning_time_s']) {
      expect(m1093).toContain(`'${k}', v.${k}`);
    }
  });
});
