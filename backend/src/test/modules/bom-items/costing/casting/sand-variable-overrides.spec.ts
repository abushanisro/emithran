import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { buildSandRoute, type SandRouteInput } from '../../../../../modules/bom-items/costing/casting/sand/sand-route';
import { checkOverride, overrideViews, overridesMap } from '../../../../../modules/bom-items/costing/casting/sand/sand-variable-overrides';
import { allSandMachines, realSandReference, sandMaterial, HOT_BOX } from './sand-test-data';

const plant = realSandReference();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const REMELT = 'defaultRemeltAllowanceSandCasting';

const inputWith = (ref: typeof plant): SandRouteInput => ({
  ref, spec: loadSandCastingCalculatorSpec(), calculators: sandCastingCalculatorsByName(), material: iron,
  part: {
    volumeMm3: (8 / iron.columns['density_kg_m3']!) * 1e9, surfaceAreaMm2: 250000, dimsMm: [300, 200, 100], wallNominalMm: 12,
    partingLineMm: 900, abovePartingMm: 50, cores: [],
  },
  machinesByClass: allSandMachines(),
  scenario: { batchSize: 250, cavities: null, mouldingClass: null, chosenCoreProcess: null, energyPricePerKwh: 0.1, hotBox: HOT_BOX, lifetimeVolume: 10000 },
  costContext,
});

describe("a part's own values for plant variables", () => {
  it('replace the plant value on a copy: the shared reference is not changed', () => {
    const before = plant.number(REMELT)!;
    const mine = plant.withOverrides(new Map([[REMELT, String(before / 2)]]));
    expect(mine.number(REMELT)).toBe(before / 2);
    expect(mine.overridden(REMELT)).toBe(true);
    expect(mine.plantValue(REMELT)).toBe(String(before));
    expect(plant.number(REMELT)).toBe(before);
    expect(plant.overridden(REMELT)).toBe(false);
  });

  it('with none, the same reference is used; a name that is not a plant variable is ignored', () => {
    expect(plant.withOverrides(new Map())).toBe(plant);
    const ignored = plant.withOverrides(new Map([['notAVariable', '1']]));
    expect(ignored.number('notAVariable')).toBeNull();
    expect(ignored.overridden('notAVariable')).toBe(false);
  });

  it('change the calculation, and the trace says whose value it used and what the plant value is', () => {
    const base = buildSandRoute(inputWith(plant)).route!;
    const plantValue = plant.number(REMELT)!;
    const mine = buildSandRoute(inputWith(plant.withOverrides(new Map([[REMELT, String(plantValue === 0 ? 0.5 : plantValue / 2)]])))).route!;
    expect(mine.material.costUsd).not.toBe(base.material.costUsd);
    const source = (r: typeof base) => r.material.runs[1]!.trace.find((t) => t.kind === 'input' && t.source?.includes(REMELT))?.source;
    expect(source(base)).toMatch(new RegExp(`^Sand casting variable ${REMELT}`));
    expect(source(mine)).toBe(`Your value for sand casting variable ${REMELT}${plant.unit(REMELT) ? ` (${plant.unit(REMELT)})` : ''}: the plant value is ${plantValue}`);
  });
});

describe('checking a value against the plant variable it replaces', () => {
  it('a number stays a number, text takes text, an unknown name is refused', () => {
    expect(checkOverride(plant, REMELT, ' 0.3 ')).toEqual({ value: '0.3' });
    expect(checkOverride(plant, REMELT, 'abc')).toMatchObject({ error: expect.stringContaining('is a number') });
    expect(checkOverride(plant, REMELT, '  ')).toEqual({ error: 'The value is empty' });
    expect(checkOverride(plant, 'autoCoreboxCalcMode', 'Single Cavity')).toEqual({ value: 'Single Cavity' });
    expect(checkOverride(plant, 'noSuchVariable', '1')).toEqual({ error: 'noSuchVariable is not a sand casting variable' });
  });

  it('shows the plant value beside the stored one, from the shared reference even on an overlaid copy', () => {
    const row = { variable: REMELT, value: '9', reason: 'why', set_by: 'u', set_at: 't' };
    const [v] = overrideViews(plant.withOverrides(overridesMap([row])), [row]);
    expect(v).toMatchObject({ variable: REMELT, value: '9', plantValue: String(plant.number(REMELT)), reason: 'why' });
  });
});
