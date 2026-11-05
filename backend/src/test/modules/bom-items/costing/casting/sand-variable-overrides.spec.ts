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

import { SandVariableOverridesService } from '../../../../../modules/bom-items/costing/casting/sand/sand-variable-overrides.service';
import { SandSnapshotsService } from '../../../../../modules/bom-items/costing/casting/sand/sand-snapshots.service';

/** A client whose table read answers with the given error (select ... eq ... [order]). */
const failingClient = (error: { code: string; message: string }) => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.order = () => Promise.resolve({ data: null, error });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: null, error });
  return { from: () => q };
};

describe('a database that predates the overrides and the frozen costs', () => {
  const missing = { code: 'PGRST205', message: "Could not find the table 'public.sand_variable_overrides' in the schema cache" };

  it("has no part values of its own, so the plant values apply (and the costing does not fail)", async () => {
    await expect(SandVariableOverridesService.rows(failingClient(missing) as never, 'item-1')).resolves.toEqual([]);
  });

  it('still stops on any other failure: a part with values of its own must not be priced with the plant\'s', async () => {
    await expect(SandVariableOverridesService.rows(failingClient({ code: '57014', message: 'canceling statement due to statement timeout' }) as never, 'item-1')).rejects.toThrow(/Could not read the sand variable overrides/);
  });

  it('has no frozen costs: the list is empty', async () => {
    const database = { getUserClient: () => ({ from: (t: string) => (t === 'bom_items' ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'item-1' }, error: null }) }) }) } : failingClient({ ...missing, message: "Could not find the table 'public.sand_cost_snapshots' in the schema cache" }).from()) }) };
    const service = new SandSnapshotsService(database as never, {} as never);
    await expect(service.list('item-1', 't')).resolves.toEqual([]);
  });
});
