import { benchStepsFor, isFerrousMaterial } from '../../../../../modules/bom-items/costing/machining/bench-steps';

// memory/Machining variables: defaultIdentingTime 45 (Time, seconds), defaultSparkTestTime 2 (min).
const STEPS = [
  { operation: 'Identing', sec: 45, source: 'variables defaultIdentingTime = 45 Time' },
  { operation: 'Spark Testing', sec: 120, source: 'variables defaultSparkTestTime = 2 min' },
];

describe('the bench steps a machined part gets', () => {
  it('a steel or an iron gets both: identing and the spark test', () => {
    for (const [type, grade] of [['Steel', 'Steel, AISI 4140'], ['Stainless Steel', '304'], ['Ductile Iron', 'GGG40'], ['Gray Iron', 'Class 30']]) {
      expect(benchStepsFor(STEPS, type, grade)).toEqual({ steps: STEPS, notes: [] });
    }
  });

  it('an aluminium forging (Cannula Holder Right, AA 380.0) is not spark tested, and the note says why', () => {
    const r = benchStepsFor(STEPS, 'Aluminum', 'Aluminum, AA 380.0');
    expect(r.steps.map((s) => s.operation)).toEqual(['Identing']);
    expect(r.notes).toEqual(['Spark Testing not charged: Aluminum, AA 380.0 is not a steel or an iron, and a spark test identifies only those (by the sparks they throw on a grinding wheel).']);
  });

  it('copper, titanium, magnesium and plastic are not ferrous; an unknown or generic type is judged by the grade', () => {
    for (const type of ['Brass', 'Copper', 'Titanium', 'Magnesium', 'Zinc', 'Nylon']) expect(isFerrousMaterial(type, null)).toBe(false);
    expect(isFerrousMaterial('Generic', 'AISI 1018')).toBe(true);
    expect(isFerrousMaterial(null, '6061-T6')).toBe(false);
    expect(isFerrousMaterial(null, '17-4 PH')).toBe(true);
    expect(isFerrousMaterial(null, null)).toBe(false);
  });
});
