// What a Multi-Spindle Machining part asks of the machine (multi-spindle-work.ts): the turning engine's lines split into in-cycle slide
// operations, the lines that run off the machine and the operations the data could not time; the holes by diameter group.
import { multiSpindleWork, ringRemovalRatio, type HoleGroupWork } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-work';

import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const line = (process: string, minutes: number, gap?: string): ProcessLineCost => ({
  process, processGroup: 'Machining', processRoute: process, operation: process, setupCost: 0, runCost: minutes, totalCost: minutes,
  cycleTimeMin: minutes, hourlyRate: 60, rateSource: 'mhr_database', machineClass: 'simultaneous_turning', machineName: 'timing', commodityCode: null, labourRate: null,
  ...(gap ? { physicsGap: { gapType: 'unsupported_operation', process, machineClass: 'simultaneous_turning', reason: gap } } : {}),
});
const hole = (h: Partial<HoleGroupWork>): HoleGroupWork => ({ diameterMm: 6, depthMm: 30, endCount: 0, endSec: 0, liveCount: 0, liveSec: 0, missing: [], ...h });

// A Ø14 x 32 mm part on 5/8" round bar.
const bar = (Math.PI / 4) * 15.875 ** 2;
const part = { threads: [], partLengthMm: 32, partVolumeMm3: (Math.PI / 4) * 14 ** 2 * 32, turnedDiameterMm: 14, turnedLengthMm: 32, barSectionAreaMm2: bar, stockLengthMm: 32.79375 };

describe('multiSpindleWork', () => {
  it('turning and parting on the OD slides, reaming and rotary broaching on the end slides; the rest off the machine', () => {
    const lines = [
      line('Rough Turning', 0.5), line('Finish Turning', 0.2), line('Parting', 0.1), line('Reaming', 0.05), line('Rotary Broaching', 0.04),
      line('Deburring', 0.3), line('Inspection', 0.2), line('Cylindrical Grinding', 1),
      // replaced: the holes (by group) and threads (by size) on their slides, the index (the cycle's), the rechuck (the back-work spindle's)
      line('Drilling', 0.4), line('Tapping', 0.08), line('Index Transfer', 0.1), line('Secondary Setup (Rechuck)', 0.2),
    ];
    const w = multiSpindleWork({ ...part, lines, holes: [] });
    expect(w.ops.map((o) => [o.name, o.slide, Math.round(o.seconds * 1e6) / 1e6, o.parting ?? false])).toEqual([
      ['Rough Turning', 'od', 30, false], ['Finish Turning', 'od', 12, false], ['Parting', 'od', 6, true],
      ['Reaming', 'end', 3, false], ['Rotary Broaching', 'end', 2.4, false],
    ]);
    expect(w.offMachine.map((l) => l.process)).toEqual(['Deburring', 'Inspection', 'Cylindrical Grinding']);
    expect(w.gaps).toEqual([]);
  });

  it('rough turning carries its ring ratio: ring removed volume over all the volume removed from the part\'s stock', () => {
    const w = multiSpindleWork({ ...part, lines: [line('Rough Turning', 0.5)], holes: [] });
    const ring = (bar - (Math.PI / 4) * 14 ** 2) * 32;
    const removed = bar * 32.79375 - part.partVolumeMm3;
    expect(w.ops[0].splitBy).toEqual({ feature: 'Ring', operation: 'Rough Turning', ratio: expect.closeTo(ring / removed, 12), what: 'ring removed volume / total removed volume' });
    expect(ringRemovalRatio({ ...part, partVolumeMm3: bar * 40 })).toBe(0); // nothing removed: no ring share
  });

  it('holes by diameter group: those on the axis on an end slide with their depth ratio, those of a live tool on a live-tool slide', () => {
    const w = multiSpindleWork({ ...part, lines: [], holes: [hole({ endCount: 2, endSec: 12, liveCount: 1, liveSec: 5 })] });
    expect(w.ops).toEqual([
      { name: 'Drilling Ø6 mm x 2', seconds: 12, slide: 'end', splitBy: { feature: 'SimpleHole', operation: 'Drilling', ratio: 30 / 32, what: 'hole length 30 mm / part length 32 mm' } },
      { name: 'Live-tool drilling Ø6 mm x 1', seconds: 5, slide: 'live' },
    ]);
  });

  it('threads by size: tapped from an end slide on the centreline, with a live tool off it; a size the calculator cannot time is named', () => {
    const w = multiSpindleWork({
      ...part, lines: [], holes: [],
      threads: [
        { size: 'M2', endCount: 0, endSec: 0, liveCount: 2, liveSec: 3.2, missing: [] },
        { size: 'M6', endCount: 1, endSec: 2.5, liveCount: 0, liveSec: 0, missing: [] },
        { size: 'UNC 1/4', endCount: 1, endSec: 0, liveCount: 0, liveSec: 0, missing: ['a metric thread size (got "UNC 1/4")'] },
      ],
    });
    expect(w.ops).toEqual([
      { name: 'Live-tool tapping M2 x 2', seconds: 3.2, slide: 'live' },
      { name: 'Tapping M6 x 1', seconds: 2.5, slide: 'end' },
    ]);
    expect(w.gaps).toEqual([{ process: 'Tapping UNC 1/4', reason: 'Not priced — missing real input: a metric thread size (got "UNC 1/4").' }]);
  });

  it('names what could not be timed, and keeps the timed part of a line', () => {
    const w = multiSpindleWork({
      ...part,
      lines: [line('Parting', 0, 'Not priced — missing real input: tblVirtualPartoffInsertCutData row.'), line('Finish Turning', 0.1)],
      holes: [hole({ diameterMm: 3, endCount: 1, missing: ['tblDrilling row for Ø3 mm'] })],
    });
    expect(w.gaps).toEqual([
      { process: 'Parting', reason: 'Not priced — missing real input: tblVirtualPartoffInsertCutData row.' },
      { process: 'Drilling Ø3 mm', reason: 'Not priced — missing real input: tblDrilling row for Ø3 mm.' },
    ]);
    expect(w.ops.map((o) => o.name)).toEqual(['Finish Turning']);
  });

  it('with holes counted but none measured, the engine\'s drilling gap stays a gap', () => {
    const w = multiSpindleWork({ ...part, lines: [line('Drilling', 0, 'Not priced — missing real input: per-diameter CAD hole data (2 holes counted, no diameters/depths).')], holes: [] });
    expect(w.gaps).toEqual([{ process: 'Drilling', reason: 'Not priced — missing real input: per-diameter CAD hole data (2 holes counted, no diameters/depths).' }]);
  });
});
