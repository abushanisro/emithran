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
