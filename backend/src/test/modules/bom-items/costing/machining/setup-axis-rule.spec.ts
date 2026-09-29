/**
 * The minimum milling class comes from the features' tool axes and the
 * reference setup rule, never from a feature-count threshold. The rule rows
 * are the real ones from memory/Machining/variables.csv (migration 639).
 */
import {
  resolveSetupAxisRule,
  requiredMilledClassFromToolAxes,
} from '../../../../../modules/bom-items/costing/machining/setup-axis-rule';

const REFERENCE_ROWS = [
  { key: 'perpendicularCountFor3AM', value: '4' },
  { key: 'maxOblique4AMSetups', value: '0' },
  { key: 'allowedAngleDeviationSetupAxisToolAxis', value: '0' },
];
const { rule } = resolveSetupAxisRule(REFERENCE_ROWS);

const blind = (...axes: number[][]) => ({ occurrences: axes.map((tool_axis) => ({ tool_axis })) });
const through = (...axes: number[][]) => ({ occurrences: axes.map((tool_axis) => ({ tool_axis, tool_axis_bidirectional: true })) });

describe('resolveSetupAxisRule', () => {
  it('reads the three reference variables', () => {
    expect(rule).toEqual({ perpendicularCountFor3AM: 4, maxOblique4AMSetups: 0, allowedAngleDeviationDeg: 0 });
  });

  it('names what is missing instead of assuming a value', () => {
    const r = resolveSetupAxisRule(REFERENCE_ROWS.slice(1));
    expect(r.rule).toBeNull();
    expect(r.missing).toEqual(['perpendicularCountFor3AM']);
  });
});

describe('requiredMilledClassFromToolAxes', () => {
  it('derives nothing (no class excluded) when no feature carries a tool axis', () => {
    const r = requiredMilledClassFromToolAxes([{ occurrences: [{}] }], rule);
    expect(r.required).toBeNull();
    expect(r.reason).toMatch(/no feature tool axes/);
  });

  it('derives nothing when the rule is not staged', () => {
    expect(requiredMilledClassFromToolAxes([blind([0, 0, 1])], null).required).toBeNull();
  });

  it('top and bottom blind features: 2 perpendicular setups -> 3 axis mill', () => {
    const r = requiredMilledClassFromToolAxes([blind([0, 0, 1], [0, 0, 1]), blind([0, 0, -1])], rule);
    expect(r).toMatchObject({ required: '3_axis_mill', principalSetups: 2, obliqueSetups: 0 });
  });

  it('a through hole shares an existing opposite setup instead of adding one', () => {
    const r = requiredMilledClassFromToolAxes([blind([0, 0, -1]), through([0, 0, 1])], rule);
    expect(r.principalSetups).toBe(1);
  });

  it('five perpendicular faces exceed perpendicularCountFor3AM (4) -> 4 axis mill', () => {
    const r = requiredMilledClassFromToolAxes(
      [blind([0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0])], rule,
    );
    expect(r).toMatchObject({ required: '4_axis_mill', principalSetups: 5 });
  });

  it('any oblique setup exceeds maxOblique4AMSetups (0) -> 5 axis mill', () => {
    const r = requiredMilledClassFromToolAxes([blind([0, 0, 1], [0.7071, 0, 0.7071])], rule);
    expect(r).toMatchObject({ required: '5_axis_mill', obliqueSetups: 1 });
  });

  it('equal directions after the engine 1e-4 rounding collapse to one setup', () => {
    const r = requiredMilledClassFromToolAxes([blind([0.5774, 0.5774, 0.5773], [0.5773, 0.5774, 0.5774])], rule);
    expect(r.obliqueSetups).toBe(1);
  });
});
