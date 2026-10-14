import { findRouteDataGaps } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import {
  resolveSecondarySelection,
  secondaryProcessLine,
  SECONDARY_GROUP_LABEL,
  type SecondaryResultLike,
} from '../../../../../modules/bom-items/costing/shared/secondary-operations';

const drawing = { heat: ['Stress Relief'], surface: ['Anodize'], other: [] };

describe('secondary operations selection', () => {
  it('nothing saved: the drawing callouts are the selection', () => {
    expect(resolveSecondarySelection({}, drawing)).toEqual({ selection: drawing, source: 'drawing' });
    expect(resolveSecondarySelection(null, drawing).source).toBe('drawing');
  });

  it('a saved choice wins, including an empty one (the engineer unticked the drawing callout)', () => {
    const saved = { secondaryOperations: { heat: [], surface: ['Zinc Plating'], other: ['CMM Inspection'] } };
    expect(resolveSecondarySelection(saved, drawing)).toEqual({ selection: saved.secondaryOperations, source: 'scenario' });
  });

  it('a malformed saved value is not a choice', () => {
    expect(resolveSecondarySelection({ secondaryOperations: { heat: 'x' } }, drawing).source).toBe('drawing');
  });
});

describe('secondary operation as a quote line', () => {
  const costed: SecondaryResultLike = {
    process: 'Stress Relief', machineClass: 'heat_treat_stress_relief', status: 'costed', reason: 'priced by weight',
    machine: { id: 'm1', name: 'Oven', operators: 1 }, cycleTimeSec: 30, setupMin: 15,
    local: { machineRate: 20, laborRate: 30, costPerPart: 1.5 },
  };

  it('a costed result: its per-part cost, converted to the display currency, in its HR Rates group', () => {
    const line = secondaryProcessLine(costed, 'heat', 2);
    expect(line.totalCost).toBe(3);
    expect(line.hourlyRate).toBe(40);
    expect(line.labourRate).toBe(60);
    expect(line.cycleTimeMin).toBe(0.5);
    expect(line.processGroup).toBe(SECONDARY_GROUP_LABEL.heat);
    expect(line.physicsGap).toBeUndefined();
  });

  it('a selected process the reference cannot cost is a named, uncosted line', () => {
    const line = secondaryProcessLine({ ...costed, status: 'gap', reason: 'no machine', local: { machineRate: null, laborRate: null, costPerPart: null } }, 'surface', 1);
    expect(line.totalCost).toBe(0);
    expect(line.physicsGap).toBeDefined();
  });
});

// Reported on Rtp2 Mag2 Backframe: a route with Bead Blast selected could not be applied ("cycle time is
// unavailable"). Bead blast is a priced service (USD per m2, no machine time), costed at 0.2767 per part.
describe('a priced service (no machine time) is a per-part charge a route can be applied with', () => {
  const beadBlast: SecondaryResultLike = {
    process: 'Bead Blast', machineClass: 'surface_bead_blast', status: 'costed',
    reason: 'Priced per area from the reference machine rate (a priced service: no machine time).',
    machine: { id: 'm2', name: 'Default Bead Blast', operators: 1 }, cycleTimeSec: null, setupMin: null,
    local: { machineRate: 14, laborRate: 30, costPerPart: 0.2767 },
  };

  it('is marked as a per-part charge, so the apply does not ask for a cycle time', () => {
    const line = secondaryProcessLine(beadBlast, 'surface', 1);
    expect(line.rateSource).toBe('consumable_allowance');
    expect(line.totalCost).toBeCloseTo(0.2767, 4);
    expect(findRouteDataGaps([line])).toEqual([]);
  });

  it('a costed line with machine time stays a machine-time line', () => {
    const line = secondaryProcessLine({ ...beadBlast, process: 'Dot Peen', cycleTimeSec: 40, setupMin: 5 }, 'surface', 1);
    expect(line.rateSource).toBe('mhr_database');
    expect(findRouteDataGaps([line])).toEqual([]);
  });

  it('a priced service with no price is still a gap', () => {
    const line = secondaryProcessLine({ ...beadBlast, status: 'gap', local: { machineRate: null, laborRate: null, costPerPart: null } }, 'surface', 1);
    expect(findRouteDataGaps([line])).toHaveLength(1);
  });
});
