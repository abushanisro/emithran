import { computeDrilling, type DrillingInput } from './drilling';

import type { MachineCandidate } from '../rates/rate-book';

const machine = (over: Partial<MachineCandidate> & { name: string }): MachineCandidate => ({
  recordId: `id-${over.name}`,
  machineClass: 'drill_circuit_holes',
  location: 'USA',
  mhrPerHour: 20,
  lhrPerHour: 36,
  operators: 1,
  setupTimeHr: 0.5,
  currency: 'USD',
  specs: { table_length_mm: 650, table_width_mm: 600 },
  ...over,
});

const base: DrillingInput = {
  hitsPerBoard: 200,
  boardsPerPanel: 10,
  panelLengthMm: 457,
  panelWidthMm: 610,
  hitsPerSecond: 4,
  batchSize: 500,
  machines: [machine({ name: 'A' })],
};

describe('computeDrilling', () => {
  it('matches an independently worked cost', () => {
    // hits/panel = 200*10 = 2000; time/panel = 2000/4 = 500 s; panels/batch = ceil(500/10) = 50
    // crew rate = 20 + 36*1 = 56 /h; run/board = 500/3600*56/10 = 0.777778; setup/board = 0.5*56/500 = 0.056
    const r = computeDrilling(base);
    expect(r.status).toBe('costed');
    if (r.status !== 'costed') return;
    expect(r.hitsPerPanel).toBe(2000);
    expect(r.secondsPerPanel).toBe(500);
    expect(r.panelsPerBatch).toBe(50);
    expect(r.chosen.runCostPerBoard).toBeCloseTo(0.777778, 6);
    expect(r.chosen.setupCostPerBoard).toBeCloseTo(0.056, 6);
    expect(r.chosen.totalCostPerBoard).toBeCloseTo(0.833778, 6);
    expect(r.secondsPerBoard).toBe(50);
  });

  it('charges the whole crew, not one operator', () => {
    const r = computeDrilling({ ...base, machines: [machine({ name: 'A', operators: 2 })] });
    // crew = 20 + 72 = 92; run = 500/3600*92/10 = 1.277778
    expect(r.status === 'costed' && r.chosen.runCostPerBoard).toBeCloseTo(1.277778, 6);
  });

  it('picks the cheapest capable machine and ignores one the panel does not fit', () => {
    const r = computeDrilling({
      ...base,
      machines: [
        machine({ name: 'cheap-small', mhrPerHour: 1, specs: { table_length_mm: 300, table_width_mm: 300 } }),
        machine({ name: 'dear', mhrPerHour: 40 }),
        machine({ name: 'mid', mhrPerHour: 25 }),
      ],
    });
    expect(r.status === 'costed' && r.chosen.machine.name).toBe('mid');
    const small = r.candidates.find((c) => c.machine.name === 'cheap-small');
    expect(small?.capable).toBe(false);
    expect(small?.reason).toMatch(/exceeds the 300 x 300 mm table/);
  });

  it('accepts a panel that fits only when rotated', () => {
    const r = computeDrilling({
      ...base,
      panelLengthMm: 600,
      panelWidthMm: 640,
      machines: [machine({ name: 'A', specs: { table_length_mm: 650, table_width_mm: 610 } })],
    });
    expect(r.status).toBe('costed');
  });

  it('rejects a machine with no table size instead of assuming it fits', () => {
    const r = computeDrilling({ ...base, machines: [machine({ name: 'A', specs: {} })] });
    expect(r.status).toBe('gap');
    expect(r.candidates[0].reason).toMatch(/no table size/);
  });

  it('is a gap, never a zero, when there are no drilling machines', () => {
    const r = computeDrilling({ ...base, machines: [machine({ name: 'router', machineClass: 'router' })] });
    expect(r.status).toBe('gap');
  });

  it('breaks a cost tie by name so the choice is reproducible', () => {
    const r = computeDrilling({ ...base, machines: [machine({ name: 'B' }), machine({ name: 'A' })] });
    expect(r.status === 'costed' && r.chosen.machine.name).toBe('A');
  });

  it('amortises setup over the batch', () => {
    const a = computeDrilling({ ...base, batchSize: 100 });
    const b = computeDrilling({ ...base, batchSize: 1000 });
    expect(a.status === 'costed' && a.chosen.setupCostPerBoard).toBeCloseTo(0.28, 6);
    expect(b.status === 'costed' && b.chosen.setupCostPerBoard).toBeCloseTo(0.028, 6);
  });

  it.each([
    ['hitsPerBoard', 0],
    ['hitsPerSecond', -1],
    ['boardsPerPanel', 2.5],
    ['batchSize', NaN],
  ])('rejects invalid %s', (k, v) => {
    expect(() => computeDrilling({ ...base, [k]: v })).toThrow(RangeError);
  });
});
