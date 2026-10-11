import { PHYSICS_REGISTRY } from '../../../modules/calculators/physics-registry';

// Deslag calculator (migration 896): Total Time = Burr Edge Length x Deburr Time Per mm.
describe('PHYSICS_REGISTRY.deburring', () => {
  const run = PHYSICS_REGISTRY.deburring!;

  it('time = burr edge length x the machine time per mm; costs follow the rates', () => {
    const r = run({ 'Burr Edge Length': 285.5, 'Deburr Time Per mm': 0.01, 'MHR per Hour': 36, 'LHR per Hour': 36, OLE: 100 });
    expect(r['Total Time']).toBeCloseTo(2.855, 6);
    expect(r['Machine Cost']).toBeCloseTo(36 * 2.855 / 3600, 9);
    expect(r['Total Process Cost']).toBeCloseTo(2 * 36 * 2.855 / 3600, 9);
  });

  it.each([
    [{ 'Deburr Time Per mm': 0.01 }],
    [{ 'Burr Edge Length': 285.5 }],
    [{ 'Burr Edge Length': 0, 'Deburr Time Per mm': 0.01 }],
  ])('leaves Total Time unresolved (a reported gap, never a default rate) when an input is missing: %j', (inputs) => {
    const r = run({ ...inputs, 'MHR per Hour': 36, 'LHR per Hour': 36 });
    expect(r['Total Time']).toBeUndefined();
    expect(String(r._warnings)).toContain('both required');
  });

  it('no longer reads cut length or pierce count', () => {
    const r = run({ 'Length Of Cut (mm)': 1000, 'No Of Starts': 50, 'MHR per Hour': 36, 'LHR per Hour': 36 });
    expect(r['Total Time']).toBeUndefined();
  });
});
