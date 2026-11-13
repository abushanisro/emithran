import { machineChoice, MACHINE_CHOICES } from '../../../../../modules/bom-items/costing/casting/machine-choice';

// "Why this machine" on every casting line: the chosen machine and the next cheapest capable ones, at most MACHINE_CHOICES; how many were capable
// and how many were checked. The machines that are not capable are counted, not listed.
describe('machineChoice', () => {
  const evals = [
    { name: 'E', reasons: [], cost: 5 }, { name: 'B', reasons: [], cost: 2 }, { name: 'X', reasons: ['too small'] },
    { name: 'D', reasons: [], cost: 4 }, { name: 'A', reasons: [], cost: 1 }, { name: 'C', reasons: [], cost: 3 }, { name: 'Y', reasons: ['too cold'] },
  ];

  it('lists the chosen machine and the next cheapest capable ones, at most 3, and counts the rest', () => {
    const c = machineChoice({ rule: 'cheapest', criteria: ['fits'], evals, chosen: 'A' });
    expect(MACHINE_CHOICES).toBe(3);
    expect(c.candidates.map((x) => [x.name, x.status])).toEqual([['A', 'chosen'], ['B', 'capable'], ['C', 'capable']]);
    expect(c).toMatchObject({ capableCount: 5, checkedCount: 7, chosen: 'A' });
  });

  it('puts the chosen machine first even when it is not the cheapest (a preferred machine)', () => {
    const c = machineChoice({ rule: 'preferred', criteria: [], evals, chosen: 'D' });
    expect(c.candidates.map((x) => x.name)).toEqual(['D', 'A', 'B']);
  });

  it('when no machine is capable, lists up to 3 with the criteria they failed: that is why the line is a gap', () => {
    const none = Array.from({ length: 5 }, (_, i) => ({ name: `M${i}`, reasons: [`reason ${i}`] }));
    const c = machineChoice({ rule: 'cheapest', criteria: [], evals: none, chosen: null });
    expect(c).toMatchObject({ capableCount: 0, checkedCount: 5, chosen: null });
    expect(c.candidates).toEqual([0, 1, 2].map((i) => ({ name: `M${i}`, status: 'rejected', perPartCost: null, reasons: [`reason ${i}`] })));
  });
});
