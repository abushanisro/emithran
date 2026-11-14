import type { CalculationTraceStep } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { buildSandRoute, type SandRouteInput } from '../../../../../modules/bom-items/costing/casting/sand/sand-route';
import { allSandMachines, realSandReference, sandMaterial, HOT_BOX } from './sand-test-data';

// Every input a sand calculator reads from a record or a table says which, so the calculator dialog's eye can open it and highlight the
// value: the machine and material records with the column, the variable by name, the lookup row, the CAD faces, and Poured Weight's own
// calculation (with the part volume's faces).
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const input: SandRouteInput = {
  ref: realSandReference(), spec: loadSandCastingCalculatorSpec(), calculators: sandCastingCalculatorsByName(), material: iron,
  part: {
    volumeMm3: (8 / iron.columns['density_kg_m3']!) * 1e9, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12,
    partingLineMm: 900, abovePartingMm: 50, cores: [{ volumeMm3: 1.2e6, areaMm2: 64000, sizeMm: [200, 100, 60] }],
  },
  machinesByClass: allSandMachines(),
  scenario: { batchSize: 250, cavities: null, mouldingClass: null, chosenCoreProcess: null, energyPricePerKwh: 0.1, hotBox: HOT_BOX, lifetimeVolume: 10000 },
  costContext: { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 },
};
const { route } = buildSandRoute(input);
const traceOf = (process: string): CalculationTraceStep[] => route!.lines.find((l) => l.process === process)!.calculationTrace ?? [];
const step = (process: string, field: string) => traceOf(process).find((s) => s.kind === 'input' && s.fieldName === field)!;

describe('sand calculator inputs carry where they were read (SourceRef)', () => {
  it('Melting: the furnace record and column, the alloy record and column, the plant variable by name', () => {
    const furnace = route!.lines.find((l) => l.process === 'Melting')!;
    // The fixture's machines come from memory/ CSVs, which have no HR Rates location: the ref carries the record's own (null here).
    expect(step('Melting', 'Yield Loss Factor').ref).toEqual({
      kind: 'machine', machineId: expect.any(String), machineName: furnace.machineName, machineClass: expect.any(String), location: null, column: 'yield_loss_factor',
    });
    expect(step('Melting', 'Specific Heat').ref).toEqual({ kind: 'material', materialId: iron.id, materialName: iron.name, column: 'specific_heat_rt_j_kg_k' });
    expect(step('Melting', 'Ambient Temperature').ref).toEqual({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' });
  });

  it('Poured Weight opens the metal-per-casting calculation, whose part volume shows the faces it was measured on', () => {
    const poured = step('Melting', 'Poured Weight');
    expect(poured.ref).toMatchObject({ kind: 'calculation', name: 'Sand Casting - Metal per casting', evidence: 'part_volume' });
    expect(poured.evidence).toBe('part_volume');
    const steps = (poured.ref as { steps: CalculationTraceStep[] }).steps;
    expect(steps.find((s) => s.kind === 'input' && s.ref?.kind === 'cad')?.ref).toEqual({ kind: 'cad', evidence: 'part_volume' });
    expect(steps.some((s) => s.kind === 'calculated' && s.fieldName === 'Poured Weight')).toBe(true);
  });

  it('a lookup names its staged table and column, and the row when the step matched one (grinding by the part\'s weight band)', () => {
    const grinding = traceOf('Finishing').find((s) => s.ref?.kind === 'lookup' && s.ref.column === 'Ingate Height (mm)');
    expect(grinding?.ref).toEqual({
      kind: 'lookup', domain: 'sand_casting', table: 'lookupTables_Component_tblGrindingDimensions', column: 'Ingate Height (mm)',
      row: { 'Max Weight (kg)': expect.any(Number) },
    });
  });

  it('gives no ref to a value the engine decided (scenario, route choices): there is no record to open', () => {
    const engineOnly = traceOf('Melting').filter((s) => s.kind === 'input' && !s.ref).map((s) => s.fieldName);
    expect(engineOnly).not.toContain('Specific Heat');
  });
});
