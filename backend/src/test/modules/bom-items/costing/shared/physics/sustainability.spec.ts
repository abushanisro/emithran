import { applySustainabilityFactors, type SustainabilityFactors } from '../../../../../../modules/bom-items/costing/shared/physics/sustainability';

// R_M-0230-032 lead nut housing as applied (local database): its lines' cycle times, and each line's machine power from mhr_records.
const line = (process: string, machineClass: string, machineName: string, cycleSec: number) =>
  ({ process, machineClass, machineName, cycleTimeMin: cycleSec / 60 }) as never;
const lines = [
  line('Rough Turning', '2_axis_bar_feed_lathe_with_sub_spindle', 'Haas DS-30 with BAR3010SS Feeder', 1.92),
  line('Drilling', '2_axis_bar_feed_lathe_with_sub_spindle', 'Haas DS-30 with BAR3010SS Feeder', 55.19),
  line('Deburring', 'manual_deburr', 'Default Manual Deburr', 23.27),
  line('Inspection', 'machining_inspection', 'Default', 400),
];
const POWER: Record<string, number> = { 'Haas DS-30 with BAR3010SS Feeder': 40.67, 'Default Manual Deburr': 1.5, Default: 0 };
const measured = { netWeightKg: 0.015, scrapKg: 0.052, wasteCostInr: 0, materialUtilizationPct: 22.4 };
const factors = (over: Partial<SustainabilityFactors> = {}): SustainabilityFactors => ({
  grid: { kgCo2ePerKwh: 0.4, source: 'test grid' },
  material: { label: 'Aluminium (primary)', kgCo2ePerKg: 15, recyclingPct: 90, source: 'test', lowerCarbonOption: { label: 'recycled aluminium', kgCo2ePerKg: 0.6 } },
  machinePowerKw: (l) => POWER[l.machineName ?? ''] ?? null,
  stock: 'bar_or_billet',
  batchSize: 3,
  ...over,
});

describe('applySustainabilityFactors', () => {
  it('prices each line\'s energy at its own machine power: a manual inspection station (0 kW) uses none', () => {
    const s = applySustainabilityFactors(measured, lines, factors());
    const insp = s.processCo2Breakdown.find((p) => p.process === 'Inspection')!;
    expect(insp).toMatchObject({ energyKwh: 0, co2Kg: 0, energySource: 'machine' });
    const drill = s.processCo2Breakdown.find((p) => p.process === 'Drilling')!;
    expect(drill.energyKwh).toBeCloseTo((55.19 / 3600) * 40.67, 3);
    expect(drill.co2Kg).toBeCloseTo(drill.energyKwh * 0.4, 3);
  });

  it('a machine with no power on file falls back to its class figure, and says so', () => {
    const s = applySustainabilityFactors(measured, [line('Rough Turning', '2_axis_lathe', 'Unknown lathe', 60)], factors());
    expect(s.processCo2Breakdown[0]!.energySource).toBe('lookup');
    expect(s.processCo2Breakdown[0]!.energyKwh).toBeCloseTo(5.5 / 60, 3);
  });

  it('charges the material at its class factor on the stock bought (net + chips), with its source', () => {
    const s = applySustainabilityFactors(measured, lines, factors());
    expect(s.materialCo2Kg).toBeCloseTo((0.015 + 0.052) * 15, 3);
    expect(s.materialCo2Source).toBe('lookup');
    expect(s.recyclabilityPct).toBe(90);
    expect(s.factorsSource).toContain('Aluminium (primary) 15 kg CO2e/kg');
  });

  it('the grid of the location sets the process carbon: a cleaner grid, less CO2 for the same kWh', () => {
    const dirty = applySustainabilityFactors(measured, lines, factors({ grid: { kgCo2ePerKwh: 0.7, source: 'g' } }));
    const clean = applySustainabilityFactors(measured, lines, factors({ grid: { kgCo2ePerKwh: 0.05, source: 'g' } }));
    expect(clean.totalProcessEnergyKwh).toBe(dirty.totalProcessEnergyKwh);
    expect(clean.totalProcessCo2Kg).toBeLessThan(dirty.totalProcessCo2Kg);
  });

  it('a location with no published grid factor carries no process CO2 and says so (never another country\'s grid)', () => {
    const s = applySustainabilityFactors(measured, lines, factors({ grid: null }));
    expect(s.totalProcessCo2Kg).toBe(0);
    expect(s.factorsSource).toContain('no published factor on file');
  });

  it('advises by how the stock is made: chips for bar stock, nesting only for sheet; and the lower-carbon version of the same material', () => {
    const bar = applySustainabilityFactors(measured, lines, factors()).opportunities.join(' ');
    expect(bar).toContain('machined away as chips');
    expect(bar).not.toContain('nesting');
    expect(bar).toContain('recycled aluminium is 0.6 kg CO2e/kg against 15');
    expect(applySustainabilityFactors(measured, lines, factors({ stock: 'sheet' })).opportunities.join(' ')).toContain('nesting layout');
  });

  it('keeps what the engine measured: net weight, scrap, waste cost and utilisation', () => {
    const s = applySustainabilityFactors({ ...measured, wasteCostInr: 1.23 }, lines, factors());
    expect(s).toMatchObject({ netWeightKg: 0.015, scrapKg: 0.052, wasteCostInr: 1.23, materialUtilizationPct: 22.4 });
  });
});
