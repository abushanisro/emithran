import { PcbFabDrillingEngine, DRILLING_RATE_KEY } from './pcb-fab-drilling.engine';
import { resolveBarePcbSpec, type BarePcbSpecDraft } from '../bare-pcb/spec';
import { buildQuote } from '../quote/build-quote';

import type { BoardFeatureGraph } from '../feature-graph/contract';
import type { MachineCandidate, RateBook, RateEntry } from '../rates/rate-book';

const engine = new PcbFabDrillingEngine();

const board: BoardFeatureGraph = {
  contractVersion: '1.2',
  kind: 'board',
  inputTier: 'A',
  reviewStatus: 'confirmed',
  outline: { lengthMm: 100, widthMm: 80 },
  layers: 2,
  holes: [
    { diameterMm: 0.8, plated: true, count: 150 },
    { diameterMm: 3.2, plated: false, count: 4 },
  ],
  placements: [],
  thtParts: [],
  provenance: {},
  unresolved: [],
};

const s = <T>(value: T) => ({ value, note: 'fabrication drawing rev A' });
const draft: BarePcbSpecDraft = {
  layers: s(2),
  finishedThicknessMm: s(1.6),
  outerCopperOz: s(1),
  surfaceFinish: s('hasl' as const),
  panel: s({ lengthMm: 457, widthMm: 610, borderMm: 12.7, spacingMm: 2.54 }),
  batchSize: s(500),
  annualVolume: s(6000),
  location: s('USA'),
};
const spec = resolveBarePcbSpec(draft);

const holeRate: RateEntry = {
  kind: 'reference',
  key: DRILLING_RATE_KEY,
  scope: 'pcb',
  value: 4,
  unit: 'holes/s',
  sourceRef: 'machining_reference_data:2026-PCB:drillingRate_circuitHoles',
};
const drill = (over: Partial<MachineCandidate> = {}): MachineCandidate => ({
  recordId: 'rec-1',
  name: 'Excellon HS-2L',
  machineClass: 'drill_circuit_holes',
  location: 'USA',
  mhrPerHour: 20.39,
  lhrPerHour: 36.3,
  operators: 1,
  setupTimeHr: 0.5,
  currency: 'USD',
  specs: { table_length_mm: 828, table_width_mm: 722 },
  ...over,
});
const book = (over: Partial<RateBook> = {}): RateBook => ({ entries: [holeRate], machines: [drill()], ...over });
const run = (rates: RateBook, g = board, sp = spec, batchSize = 500) =>
  engine.computeCost({ graph: g, input: engine.inputs(g), batchSize, rates, spec: sp });

describe('PcbFabDrillingEngine', () => {
  it('costs a board from its real drill hits, the supplied panel and the staged rate', () => {
    // 100x80 on 457x610 (border 12.7, spacing 2.54): 28 boards/panel. hits/board = 154.
    // time/panel = 154*28/4 = 1078 s; crew = 20.39 + 36.3 = 56.69 /h
    // run/board = 1078/3600*56.69/28 = 0.606268; setup/board = 0.5*56.69/500 = 0.05669
    const r = run(book());
    expect(r.status).toBe('costed');
    if (r.status !== 'costed') return;
    expect(r.line.runCost).toBeCloseTo(0.606268, 5);
    expect(r.line.setupCost).toBeCloseTo(0.05669, 6);
    expect(r.line.totalCost).toBeCloseTo(0.662958, 5);
    expect(r.line.machineName).toBe('Excellon HS-2L');
    expect(r.ratesUsed.map((e) => e.kind).sort()).toEqual(['labour_rate', 'machine_rate', 'reference']);
  });

  it('gives different costs for different boards (derived, not scenario-coded)', () => {
    const more = { ...board, holes: [{ diameterMm: 0.8, plated: true, count: 600 }] };
    const a = run(book());
    const b = run(book(), more);
    expect(a.status === 'costed' && b.status === 'costed' && b.line.runCost > a.line.runCost).toBe(true);
  });

  it.each([
    ['no spec', () => engine.computeCost({ graph: board, input: engine.inputs(board), batchSize: 500, rates: book() }), /No bare-board specification/],
    ['incomplete spec', () => run(book(), board, resolveBarePcbSpec({})), /incomplete/],
    ['no drill data', () => run(book(), { ...board, holes: undefined }), /no drill data/],
    ['no staged rate', () => run(book({ entries: [] })), /No drilling hole rate/],
    ['conflicting staged rate', () => run(book({ entries: [holeRate, { ...holeRate, value: 5 }] })), /conflicting/],
    ['no machine at the location', () => run(book({ machines: [drill({ location: 'India' })] })), /no drill_circuit_holes machine/],
    ['board does not fit the panel', () => run(book(), { ...board, outline: { lengthMm: 900, widthMm: 900 } }), /does not fit/],
    ['panel too big for every machine', () => run(book({ machines: [drill({ specs: { table_length_mm: 300, table_width_mm: 300 } })] })), /no available drilling machine/],
  ])('is a gap, never a zero cost: %s', (_name, act, message) => {
    const r = act();
    expect(r.status).toBe('gap');
    if (r.status === 'gap' && r.gap.gapType === 'unsupported_operation') expect(r.gap.reason).toMatch(message);
  });

  it('matches the location case-insensitively but not by guessing another one', () => {
    expect(run(book({ machines: [drill({ location: ' usa ' })] })).status).toBe('costed');
  });

  it('keeps the quote incomplete (total withheld) while this engine reports a gap', () => {
    const q = buildQuote(board, [engine], 500, book({ machines: [] }), { spec });
    expect(q.complete).toBe(false);
    expect(q.assemblyCostPerUnit).toBeNull();
    expect(q.gaps).toHaveLength(1);
  });

  it('produces a reproducible quote and a different rate version when a rate changes', () => {
    const a = buildQuote(board, [engine], 500, book(), { spec });
    const b = buildQuote(board, [engine], 500, book(), { spec });
    const c = buildQuote(board, [engine], 500, book({ machines: [drill({ mhrPerHour: 25 })] }), { spec });
    expect(a).toEqual(b);
    expect(a.rateVersion).not.toBe(c.rateVersion);
    expect(a.complete).toBe(true);
  });
});
