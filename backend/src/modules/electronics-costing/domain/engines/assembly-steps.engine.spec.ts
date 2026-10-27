import { ASSEMBLY_ENGINES } from './assembly-steps.engine';
import { buildQuote } from '../quote/build-quote';
import { scenarioRateEntries, validateScenario, type ElectronicsScenario } from '../scenario/scenario';

import type { BoardFeatureGraph } from '../feature-graph/contract';
import type { MachineCandidate, RateBook } from '../rates/rate-book';

// Shaped like the OPT LI15020 set as extracted: a 2-up panel file, 24 bottom 1206 resistors, 168 two-lead THT LEDs.
const graph: BoardFeatureGraph = {
  contractVersion: '1.3',
  kind: 'board',
  inputTier: 'B',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 139.8, widthMm: 55.6 },
  layers: 2,
  placements: [{ side: 'bottom', packageClass: 'unknown', count: 24, footprint: 'OPT-1206' }],
  thtParts: [{ label: '2001-/-F03-1', count: 168, jointsPerPart: 2 }],
  provenance: {},
  unresolved: [],
};

const ids = {
  printer: '11111111-1111-4111-8111-111111111111',
  smt: '22222222-2222-4222-8222-222222222222',
  oven: '33333333-3333-4333-8333-333333333333',
  bench: '44444444-4444-4444-8444-444444444444',
};

const machine = (recordId: string, name: string, mhr: number, lhr: number, operators: number, location = 'India'): MachineCandidate => ({
  recordId, name, machineClass: 'test_class', location, mhrPerHour: mhr, lhrPerHour: lhr, operators, setupTimeHr: 0.5, currency: 'USD', specs: {},
});

const stated = (value: number) => ({ value, note: 'test datasheet' });

const fullScenario: ElectronicsScenario = {
  location: 'India',
  machines: {
    stencil_print_spi: ids.printer,
    pick_and_place: ids.smt,
    reflow: ids.oven,
    aoi: ids.printer,
    tht_insertion: ids.bench,
    selective_solder: ids.bench,
    depanel: ids.bench,
    line_setup: ids.smt,
  },
  inputs: {
    'panel.boards_in_files': stated(2),
    'stencil_print.cycle_time': stated(20),
    'spi.cycle_time': stated(10),
    'smt_placement.rated_cph': stated(12000),
    'smt_placement.cph_derating': stated(0.5),
    'reflow.conveyor_speed': stated(800),
    'aoi.inspection_speed': stated(3000),
    'tht_insertion.time_per_part': stated(4),
    'solder.time_per_joint': stated(2),
    'depanel_router.cutting_speed': stated(10),
    'depanel.route_length_per_board_mm': stated(320),
    'setup.line_changeover': stated(30),
    'setup.feeder_load': stated(2),
    'bare_pcb.price_per_board': stated(1.2),
    'components.cost_per_board': stated(3.4),
  },
};

const rates = (scenario: ElectronicsScenario): RateBook => ({
  entries: scenarioRateEntries(scenario),
  machines: [machine(ids.printer, 'Printer', 10, 5, 1), machine(ids.smt, 'SMT line', 36, 6, 1), machine(ids.oven, 'Oven', 18, 0, 0), machine(ids.bench, 'Bench', 2, 4, 1)],
});

const line = (q: ReturnType<typeof buildQuote>, process: string) => {
  const found = q.lines.find((l) => l.process === process);
  if (!found) throw new Error(`no ${process} line: ${JSON.stringify(q.gaps)}`);
  return found;
};

const reasonOf = (q: ReturnType<typeof buildQuote>, process: string): string | undefined => {
  const g = q.gaps.find((x) => x.process === process);
  return g && 'reason' in g ? g.reason : undefined;
};

describe('PCBA assembly engines', () => {
  it('prices every step from the graph counts, the chosen HR Rates machine and the stated inputs', () => {
    const q = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(fullScenario), { scenario: fullScenario });
    expect(q.gaps).toEqual([]);
    expect(q.complete).toBe(true);
    // pick & place: 24 / (12000 * 0.5) * 3600 / 2 boards = 7.2 s; crew 36 + 6*1 = 42 $/h
    expect(line(q, 'Pick and place').cycleTimeMin * 60).toBeCloseTo(7.2, 6);
    expect(line(q, 'Pick and place').runCost).toBeCloseTo((7.2 / 3600) * 42, 9);
    // stencil + SPI: 1 side * (20 + 10) / 2 = 15 s at 10 + 5 = 15 $/h
    expect(line(q, 'Stencil print + SPI').runCost).toBeCloseTo((15 / 3600) * 15, 9);
    // reflow: 139.8 / 800 * 60 / 2 = 5.2425 s; the oven has no operator, so labour is not charged
    expect(line(q, 'Reflow').cycleTimeMin * 60).toBeCloseTo(5.2425, 6);
    expect(line(q, 'Reflow').runCost).toBeCloseTo((5.2425 / 3600) * 18, 9);
    // THT: 168 * 4 / 2 = 336 s; solder: 336 joints * 2 / 2 = 336 s
    expect(line(q, 'THT insertion (manual)').cycleTimeMin * 60).toBeCloseTo(336, 6);
    expect(line(q, 'Selective / hand solder').cycleTimeMin * 60).toBeCloseTo(336, 6);
    // depanel: 320 mm / 10 mm/s = 32 s per board
    expect(line(q, 'Depanel (router)').cycleTimeMin * 60).toBeCloseTo(32, 6);
    // setup: (30 + 2 * 1 feeder) min = 1920 s per batch of 500 on the SMT line crew (42 $/h)
    expect(line(q, 'Line setup').setupCost).toBeCloseTo(((1920 / 3600) * 42) / 500, 9);
    expect(line(q, 'Bare PCB (fab quote)').totalCost).toBe(1.2);
    expect(q.assemblyCostPerUnit).toBeCloseTo(q.lines.reduce((s, l) => s + l.totalCost, 0), 9);
    expect(q.scenario).toEqual(fullScenario);
  });

  it('says which machine and which inputs are missing instead of pricing a step', () => {
    const partial: ElectronicsScenario = { location: 'India', machines: {}, inputs: { 'panel.boards_in_files': stated(2) } };
    const q = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(partial), { scenario: partial });
    expect(q.complete).toBe(false);
    expect(q.assemblyCostPerUnit).toBeNull();
    expect(reasonOf(q, 'Pick and place')).toBe('No machine is chosen for Pick and place.');
    const withMachine = { ...partial, machines: { pick_and_place: ids.smt } };
    const q2 = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(withMachine), { scenario: withMachine });
    expect(reasonOf(q2, 'Pick and place')).toBe('Missing inputs: smt_placement.rated_cph, smt_placement.cph_derating.');
  });

  it('refuses a machine from another location and a derating above 1', () => {
    const elsewhere = { ...fullScenario, location: 'USA' };
    const q = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(elsewhere), { scenario: elsewhere });
    expect(reasonOf(q, 'Pick and place')).toBe('SMT line is a India machine; the scenario location is USA.');
    const fast = { ...fullScenario, inputs: { ...fullScenario.inputs, 'smt_placement.cph_derating': stated(1.5) } };
    const q2 = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(fast), { scenario: fast });
    expect(reasonOf(q2, 'Pick and place')).toContain('at most 1');
  });

  it('does not depanel a file that holds a single board, and needs the board count first', () => {
    const single = { ...fullScenario, inputs: { ...fullScenario.inputs, 'panel.boards_in_files': stated(1) } };
    const q = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(single), { scenario: single });
    expect(q.lines.some((l) => l.process === 'Depanel (router)')).toBe(false);
    expect(q.complete).toBe(true);
    const { 'panel.boards_in_files': _drop, ...rest } = fullScenario.inputs;
    const unknown = { ...fullScenario, inputs: rest };
    const q2 = buildQuote(graph, ASSEMBLY_ENGINES, 500, rates(unknown), { scenario: unknown });
    expect(reasonOf(q2, 'Reflow')).toBe('How many boards the uploaded files hold is not stated.');
  });

  it('applies through-hole steps only to boards with through-hole parts', () => {
    const smtOnly: BoardFeatureGraph = { ...graph, thtParts: [] };
    const q = buildQuote(smtOnly, ASSEMBLY_ENGINES, 500, rates(fullScenario), { scenario: fullScenario });
    expect(q.lines.map((l) => l.process)).not.toContain('THT insertion (manual)');
    expect(q.lines.map((l) => l.process)).not.toContain('Selective / hand solder');
  });
});

describe('validateScenario', () => {
  it('accepts a full scenario and keeps every stated value with its note', () => {
    const v = validateScenario(fullScenario);
    expect(v.ok && v.scenario.inputs['reflow.conveyor_speed']).toEqual({ value: 800, note: 'test datasheet' });
  });

  it('refuses a value without a source, an unknown input key, a non-machine id and a missing location', () => {
    const v = validateScenario({
      location: '',
      machines: { pick_and_place: 'not-a-uuid', wave_solder: ids.smt },
      inputs: { 'reflow.conveyor_speed': { value: 800, note: '' }, 'made.up': { value: 1, note: 'x' }, 'panel.boards_in_files': { value: 1.5, note: 'x' } },
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.problems.map((p) => p.field).sort()).toEqual(['inputs.made.up', 'inputs.panel.boards_in_files', 'inputs.reflow.conveyor_speed', 'location', 'machines.pick_and_place', 'machines.wave_solder']);
  });
});
