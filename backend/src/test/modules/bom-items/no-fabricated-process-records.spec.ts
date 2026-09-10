import { readFileSync } from 'fs';
import { join } from 'path';

import {
  findRouteDataGaps,
  type RouteDataGapLine,
} from '../../../modules/bom-items/costing/shared/core/engine-kernel';

// A process_cost_record is a costing commitment. It must only ever be written
// from real, resolved manufacturing inputs.
//
// This existed once and did not hold: POST :id/auto-fill-processes built a full
// routing out of invented values whenever the real ones were missing — a steel
// grade for a missing material, 2mm for a missing thickness, 50 000mm² for a
// missing blank area, 400 MPa for a missing tensile strength, Ø6 for a missing
// hole size — and those five numbers then drove cut length, bend force and
// cycle time. It was removed on 2026-09-06 (no caller, no test, and no row in
// process_cost_records ever carried its `auto_fill_from_cad` marker).
//
// Two guards below: the constants cannot come back into the writer, and the
// surviving write path still refuses an operation whose real costing data is
// missing.

const CONTROLLER = join(
  __dirname, '..', '..', '..', 'modules', 'bom-items', 'bom-items.controller.ts',
);

/** Executable lines only - a comment may name a removed value while explaining it. */
const executable = (src: string) =>
  src.split(/\r?\n/).filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('no fabricated manufacturing inputs can reach process_cost_records', () => {
  const source = readFileSync(CONTROLLER, 'utf8');

  // Comments may name these values while explaining why they were removed;
  // only executable lines are checked.
  const code = source
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  it.each([
    ["a material grade for a missing material", /\?\?\s*['"]IS2062 E250['"]/],
    // Non-zero only: `?? 0` is an honest "unresolved" marker (it produces no
    // geometry and no cost), whereas any non-zero literal is a measurement
    // nobody took. bom-items.controller.ts:283 legitimately uses `?? 0`.
    ['a sheet thickness for a missing one', /sheetThicknessMm\s*\?\?\s*[1-9]/],
    ['a blank area for a missing one', /flatPatternAreaMm2\s*\?\?\s*[1-9]/],
    ['a tensile strength', /tensileStrengthMpa\s*:\s*\d/],
    ['a hole diameter', /diameterMm\s*:\s*\d+\s*[,}]/],
  ])('never substitutes %s', (_label, pattern) => {
    expect(code).not.toMatch(pattern);
  });

  it('has no auto-fill route that builds a routing from CAD gaps', () => {
    expect(code).not.toContain("auto-fill-processes");
    expect(code).not.toContain("auto_fill_from_cad");
  });
});

describe('the surviving write path refuses operations with missing costing data', () => {
  const line = (over: Partial<RouteDataGapLine> = {}): RouteDataGapLine => ({
    process: 'Laser Cutting', machineClass: 'fiber_laser', cycleTimeMin: 0.02, setupTimeMin: 30, ...over,
  });

  it('blocks a line whose cycle time could not be resolved', () => {
    // apply-route calls this before touching the database, so an operation with
    // no real cycle time is never persisted with a substituted one.
    const gaps = findRouteDataGaps([line({ process: 'Tandem Press', cycleTimeMin: 0 })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.reason).toContain('no cycle time was resolved');
  });

  it('blocks a line carrying a structured physics gap', () => {
    const gaps = findRouteDataGaps([line({
      physicsGap: { gapType: 'missing_lookup', requiredAction: 'Seed sm_lookup_router_cut.' },
    })]);
    expect(gaps[0]!.reason).toBe('Seed sm_lookup_router_cut.');
  });

  it('allows a fully resolved operation through', () => {
    expect(findRouteDataGaps([line()])).toEqual([]);
  });
});

// ── Setup time ───────────────────────────────────────────────────────────────
//
// process_cost_records.setup_time is NUMERIC NOT NULL (migration 034), so an
// unresolved setup cannot be stored as "unknown". It was stored as the literal
// 15 instead: `setup_time: line.setupTimeMin ?? 15`.
//
// That fired for real. PressStrokeEngine — Standard Press, Tandem Press,
// Progressive Die, and Shearing through the same shared formula — passed
// setupMin/batchSize into eMithranTerms but never put setupMin on the process
// line, so all four persisted a 15-minute setup while having been costed from
// 30min (PRESS_STROKE_SETUP_MIN, the setup_time_hr every one of the 8 real
// press machines carries) or 22.8min for shearing. The Cost Guide re-derives
// setup cost from the persisted column, so the record and the quote that
// produced it disagreed by roughly a factor of two.
describe('an unresolved setup time is a data gap, not a substituted 15 minutes', () => {
  const line = (over: Partial<RouteDataGapLine> = {}): RouteDataGapLine => ({
    process: 'Standard Press', machineClass: 'standard_press',
    cycleTimeMin: 0.5, setupTimeMin: 30, ...over,
  });

  it('blocks a line whose setup time was never resolved', () => {
    const gaps = findRouteDataGaps([line({ setupTimeMin: undefined })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.reason).toContain('will not persist a substituted one');
  });

  it('treats an explicit null the same as absent', () => {
    expect(findRouteDataGaps([line({ setupTimeMin: null })])).toHaveLength(1);
  });

  it('accepts a real zero — some operations genuinely have no setup', () => {
    // Deburring, Inspection and Surface Treatment all state 0 deliberately.
    expect(findRouteDataGaps([line({ process: 'Deburring', setupTimeMin: 0 })])).toEqual([]);
  });

  it('accepts the real press setup the engine costs from', () => {
    expect(findRouteDataGaps([line({ setupTimeMin: 30 })])).toEqual([]);
  });

  it('has no substituted setup time left in the write path', () => {
    expect(executable(readFileSync(CONTROLLER, 'utf8'))).not.toMatch(/setupTimeMin\s*\?\?\s*\d/);
  });
});
