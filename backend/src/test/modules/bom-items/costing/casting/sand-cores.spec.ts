import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { coreboxTooling, coreLine, makeCoreStep, sandCores, type CoreRegion } from '../../../../../modules/bom-items/costing/casting/sand/sand-cores';
import type { SandRouteContext } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { realSandReference, sandMachines, sandMaterial, sandRows, stagedLookups, stagedVariables } from './sand-test-data';

const ref = realSandReference();
const spec = loadSandCastingCalculatorSpec();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const ctx: SandRouteContext = {
  ref, spec, calculators: sandCastingCalculatorsByName(), material: iron,
  part: { netKg: 8, modulusMm: 10, dimsMm: [300, 200, 100], wallNominalMm: 12 },
  cavities: 1, coresPerCasting: 1, poured: { perCastingKg: 11, perMouldKg: 11 }, energyPricePerKwh: null,
};
const spec$ = (m: { specs: Readonly<Record<string, unknown>> }, k: string) => Number(m.specs[k]);
const v = (k: string) => ref.number(k)!;
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

const byClass = {
  sand_casting_hot_box: sandMachines('machines_hot_box.csv', 'sand_casting_hot_box'),
  sand_casting_co2_coremaking: sandMachines('machines_co2_coremaking.csv', 'sand_casting_co2_coremaking'),
  sand_casting_no_bake: sandMachines('machines_no_bake_coremaking.csv', 'sand_casting_no_bake'),
  sand_casting_oil_core: sandMachines('machines_oil_core.csv', 'sand_casting_oil_core'),
  sand_casting_shell: sandMachines('machines_shell_coremaking.csv', 'sand_casting_shell'),
};
const small: CoreRegion = { volumeMm3: 1.2e6, sizeMm: [200, 100, 60] };

describe('sandCores', () => {
  it('core sand = (volume + two prints of volume / length x print length) x sand density, hand-worked from the variables', () => {
    const { cores, thin, missing } = sandCores(ctx, [small]);
    expect(missing).toEqual([]);
    expect(thin).toBe(0);
    const kg = (small.volumeMm3 + ((2 * small.volumeMm3) / small.sizeMm[0]) * v('lengthCorePrint')) * 1e-9 * v('sandMoldDensity');
    expect(cores[0]!.kg).toBeCloseTo(kg, 12);
  });

  it('a core thinner than minSandCastableHoleDia is not a sand core: it is counted and left solid', () => {
    const thinner: CoreRegion = { volumeMm3: 1e5, sizeMm: [100, 50, v('minSandCastableHoleDia') - 0.1] };
    const r = sandCores(ctx, [small, thinner, { volumeMm3: 0, sizeMm: [0, 0, 0] }]);
    expect(r.cores).toHaveLength(1);
    expect(r.thin).toBe(2);
  });

  it('names a variable the data lacks', () => {
    const noThreshold = { ...ctx, ref: realSandReferenceWithout('minSandCastableHoleDia') };
    expect(sandCores(noThreshold, [small]).missing).toEqual(['sand variable minSandCastableHoleDia']);
  });
});

/** The real sand reference with one variable removed, to see a step name what is missing. */
const realSandReferenceWithout = (name: string) => resolveSandReference({ variables: stagedVariables.filter((s) => s.key !== name), lookups: stagedLookups });

describe('makeCoreStep', () => {
  const core = sandCores(ctx, [small]).cores[0]!;
  const shell = byClass.sand_casting_shell;

  it('a shell machine makes a core in its base cycle time', () => {
    const m = shell.find((x) => spec$(x, 'base_cycle_time_s') > 0 && spec$(x, 'max_corebox_length_mm') >= 300)!;
    // the shell weight limit is 5 kg: the small core must be under it for this machine
    const out = makeCoreStep(ctx, m, core);
    expect(core.kg).toBeLessThan(v('maxWeightShellCore'));
    expect(out.ok && out.sec).toBeCloseTo(spec$(m, 'base_cycle_time_s'), 9);
  });

  it('hot box is timed from the sand: blow time at the plant\'s blowing rate plus the cure and strip estimates the calculator names', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const fields = spec.calculators.find((c) => c.name === 'Sand Casting - Hot box coremaking')!.fields;
    const estimate = (name: string) => Number(fields.find((f) => f.name === name)!.formula);
    const out = makeCoreStep(ctx, m, core);
    expect(out.ok && out.sec).toBeCloseTo((core.kg / v('coreBoxSandBlowingRate')) * 60 + estimate('Cure Time (estimate)') + estimate('Strip and Handling (estimate)'), 9);
  });

  it('refuses a core over the process weight limit, one that does not fit the machine\'s core box, and a machine with no cycle time', () => {
    const heavy = { ...core, kg: v('maxWeightShellCore') + 1 };
    expect(makeCoreStep(ctx, shell[0]!, heavy)).toEqual({ ok: false, reasons: [expect.stringContaining('maxWeightShellCore')] });
    const big = sandCores(ctx, [{ volumeMm3: 1e6, sizeMm: [5000, 4000, 3000] }]).cores[0]!;
    const hot = byClass.sand_casting_hot_box[0]!;
    expect(makeCoreStep(ctx, hot, { ...big, kg: 1 })).toEqual({ ok: false, reasons: [expect.stringContaining('core boxes up to')] });
    const noCycle = { ...shell[0]!, specs: { ...shell[0]!.specs, base_cycle_time_s: 0 } };
    expect(makeCoreStep(ctx, noCycle, core)).toEqual({ ok: false, reasons: ['no cycle time in the reference data'] });
  });

  it('refuses a machine class the route does not cost (isocure, manual coremaking)', () => {
    const iso = { ...shell[0]!, machineClass: 'sand_casting_isocure_gas' };
    expect(makeCoreStep(ctx, iso, core)).toEqual({ ok: false, reasons: [expect.stringContaining('not a coremaking class')] });
  });
});

describe('coreLine (which process makes the core)', () => {
  const core = sandCores(ctx, [small]).cores[0]!;
  const base = { ctx, core, machinesByClass: byClass, batchSize: 250, costContext };

  it('the main process (hot box) makes the core whenever it can', () => {
    const r = coreLine(base);
    expect(r.process).toBe('Hot Box');
    expect(r.step.machine).not.toBeNull();
  });

  it('a process the user names is the only one considered', () => {
    const r = coreLine({ ...base, chosenProcess: 'CO2 Cured' });
    expect(r.process).toBe('CO2 Cured');
  });

  it('a core hot box cannot make goes to the cheapest process that can', () => {
    const heavy = { ...core, kg: v('maxWeightHotBoxCore') + 1 };
    const r = coreLine({ ...base, core: heavy });
    expect(r.process).not.toBe('Hot Box');
    expect(r.step.machine).not.toBeNull(); // CO2 cured takes up to 115 kg, and the core's box fits
    const others = ['CO2 Cured', 'No Bake', 'Oil Core', 'Shell'].map((p) => coreLine({ ...base, core: heavy, chosenProcess: p })).filter((x) => x.step.machine);
    expect(others.length).toBeGreaterThan(0);
    expect(r.step.line.totalCost).toBe(Math.min(...others.map((x) => x.step.line.totalCost)));
  });

  it('no process able to make it gives a named gap, not a price', () => {
    const impossible = { ...core, kg: 1e6, region: { volumeMm3: 1, sizeMm: [1e5, 1e5, 1e5] as const } };
    const r = coreLine({ ...base, core: impossible });
    expect(r.step.machine).toBeNull();
    expect(r.step.line.totalCost).toBe(0);
    expect((r.step.line.physicsGap as { reason: string }).reason).toMatch(/no .* machine fits/);
  });
});

describe('coreboxTooling', () => {
  const rows = sandRows('Lookup/lookupTables_Component_tblCoreboxMaterial.csv');
  const lifetime = 10000;

  it('chooses the box material that costs least per part, boxes = lifetime / (refurb life x (refurbs + 1)), hand-worked per material', () => {
    const hand = rows.map((r) => {
      const boxes = Math.max(1, Math.ceil(lifetime / (Number(r['Corebox Refurb Life']) * (Number(r['Corebox Refurbs Per Tool']) + 1))));
      const tooling = boxes * Number(r['One Cavity Cost (USD)']) * v('toolShopRegionMultiplier');
      return { type: String(r['Type']), boxes, tooling, perPart: tooling / lifetime };
    });
    const best = hand.sort((a, b) => a.perPart - b.perPart)[0]!;
    const { tooling, missing } = coreboxTooling(ctx, lifetime);
    expect(missing).toEqual([]);
    expect(tooling).toMatchObject({ material: best.type, boxes: best.boxes });
    expect(tooling!.toolingCostUsd).toBeCloseTo(best.tooling, 9);
    expect(tooling!.perPartUsd).toBeCloseTo(best.perPart, 12);
  });

  it('a longer run shares the same boxes over more parts: the cost per part falls', () => {
    const short = coreboxTooling(ctx, 1000).tooling!;
    const long = coreboxTooling(ctx, 100000).tooling!;
    expect(long.perPartUsd).toBeLessThan(short.perPartUsd);
  });

  it('names an unstaged table', () => {
    const none = coreboxTooling({ ...ctx, ref: realSandReferenceWithout('toolShopRegionMultiplier') }, lifetime);
    expect(none.tooling).toBeNull();
    expect(none.missing.join(' ')).toMatch(/toolShopRegionMultiplier/);
  });
});
