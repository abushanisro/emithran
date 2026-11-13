import { loadSandCastingCalculatorSpec, sandCastingCalculatorsByName } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { coreboxTooling, coreLine, makeCoreStep, sandCores, type CoreRegion } from '../../../../../modules/bom-items/costing/casting/sand/sand-cores';
import type { SandRouteContext } from '../../../../../modules/bom-items/costing/casting/sand/sand-steps';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { realSandReference, sandMachines, sandMaterial, sandRows, stagedLookups, stagedVariables, HOT_BOX } from './sand-test-data';

const ref = realSandReference();
const spec = loadSandCastingCalculatorSpec();
const iron = sandMaterial('ASTM Grade 20 Gray Iron');
const ctx: SandRouteContext = {
  ref, spec, calculators: sandCastingCalculatorsByName(), material: iron,
  part: { netKg: 8, modulusMm: 10, dimsMm: [300, 200, 100], wallNominalMm: 12 },
  cavities: 1, coresPerCasting: 1, poured: { perCastingKg: 11, perMouldKg: 11 }, energyPricePerKwh: null, hotBox: HOT_BOX, batchSize: 250,
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
const small: CoreRegion = { volumeMm3: 1.2e6, areaMm2: null, sizeMm: [200, 100, 60] };

describe('sandCores', () => {
  it('core sand = (volume + two prints of volume / length x print length) x sand density, hand-worked from the variables', () => {
    const { cores, thin, missing } = sandCores(ctx, [small]);
    expect(missing).toEqual([]);
    expect(thin).toBe(0);
    const kg = (small.volumeMm3 + ((2 * small.volumeMm3) / small.sizeMm[0]) * v('lengthCorePrint')) * 1e-9 * v('sandMoldDensity');
    expect(cores[0]!.kg).toBeCloseTo(kg, 12);
  });

  it('a core thinner than minSandCastableHoleDia is not a sand core: it is counted and left solid', () => {
    const thinner: CoreRegion = { volumeMm3: 1e5, areaMm2: null, sizeMm: [100, 50, v('minSandCastableHoleDia') - 0.1] };
    const r = sandCores(ctx, [small, thinner, { volumeMm3: 0, areaMm2: null, sizeMm: [0, 0, 0] }]);
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

  // The 200 x 100 x 60 mm core is 2.112 kg of sand ((1.2e6 + 2 x 1.2e6 / 200 x 10) mm3 x 1600 kg/m3): blown in 2.112 / 300 x 60 = 0.4224 s, stripped in the
  // handling table's 10 s band (up to 5 kg). Its smallest side is 60 mm, so with a strip criterion of 3 mm (half the side is 30) 3 mm is cured: with the box at
  // 245 C, the binder curing at 150 C and the sand at 20 C that is 52.28 s (the hand-worked table in docs/design/sand-casting-hotbox-gating.md).
  it('hot box is timed by physics: the blow from the sand, the cure by conduction into the sand, the strip from the handling table', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const out = makeCoreStep(ctx, m, core);
    expect(core.kg).toBeCloseTo(2.112, 3);
    expect(out.ok && out.sec).toBeCloseTo(0.4224 + 52.28 + 10, 1);
    expect(out.ok && out.run.outputs['Cure Time']).toBeCloseTo(52.28, 1);
  });

  it('the cure time follows the plant\'s settings: a hotter box, a lower cure temperature or a shallower strip depth cure sooner', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const cure = (hotBox: Partial<typeof HOT_BOX>) => {
      const out = makeCoreStep({ ...ctx, hotBox: { ...HOT_BOX, ...hotBox } }, m, core);
      return out.ok ? out.run.outputs['Cure Time']! : NaN;
    };
    const base = cure({});
    expect(cure({ coreboxTempC: 260 })).toBeLessThan(base);
    expect(cure({ cureTempC: 120 })).toBeLessThan(base);
    expect(cure({ curedDepthMm: 2 })).toBeCloseTo(23.2, 1);
    // depth is quadratic: doubling it quadruples the time
    expect(cure({ curedDepthMm: 6 }) / cure({ curedDepthMm: 3 })).toBeCloseTo(4, 9);
  });

  // 2.112 kg of sand x 1170 J/(kg K) x (150 - 20) K = 321 235.2 J = 0.08923 kWh; at 0.10 USD/kWh: 0.008923 USD a core.
  it('the heating energy is priced with the energy price, and not charged (and said so) while it is not set', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const priced = makeCoreStep({ ...ctx, energyPricePerKwh: 0.1 }, m, core);
    expect(priced.ok && priced.run.outputs['Energy']).toBeCloseTo(0.089232, 6);
    expect(priced.ok && priced.energyCostUsd).toBeCloseTo(0.0089232, 7);
    expect(priced.ok && priced.notes).toEqual([]);
    const unpriced = makeCoreStep({ ...ctx, energyPricePerKwh: null }, m, core);
    expect(unpriced.ok && unpriced.energyCostUsd).toBe(0);
    expect(unpriced.ok && unpriced.notes).toEqual([expect.stringMatching(/^Hot box heating energy is not charged: no energy price for the location or in the Cost Guide \(the sand's heat alone is 0\.089 kWh per core, a lower bound\)/)]);
  });

  it('the energy is added to the line, so a priced core costs more than an unpriced one by exactly that', () => {
    const line = (energyPricePerKwh: number | null) =>
      coreLine({ ctx: { ...ctx, energyPricePerKwh }, core, machinesByClass: byClass, batchSize: 250, costContext }).step.line;
    const diff = line(0.1).totalCost - line(null).totalCost;
    expect(diff).toBeCloseTo(0.0089232, 2); // the line rounds to cents: the difference is the energy to that precision
    expect(line(0.1).totalCost).toBeGreaterThanOrEqual(line(null).totalCost);
  });

  it('a core cured right through (thinner than twice the strip depth) is cured to its middle: a 4 mm side needs 2 mm, whatever the criterion', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const thin = { ...core, region: { ...core.region, sizeMm: [200, 100, 4] as [number, number, number] } };
    const out = makeCoreStep({ ...ctx, hotBox: { ...HOT_BOX, curedDepthMm: 10 } }, m, thin);
    expect(out.ok && out.run.outputs['Cured Depth']).toBe(2);
  });

  it('the strip time is the handling table\'s band for the core: a 25 kg core (beyond hands) takes the table\'s forklift band', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const out = makeCoreStep(ctx, m, { ...core, kg: 25 });
    // cycle = blow (25 / 300 x 60 s) + cure + strip, so the strip is what is left
    expect(out.ok && out.sec - (25 / v('coreBoxSandBlowingRate')) * 60 - out.run.outputs['Cure Time']!).toBeCloseTo(540, 6);
  });

  // US 5,365,995 (Ford, "Method of curing hot box sand cores"): "the 120° F. critical cure temperature", "normal pattern operating temperatures (450 to
  // 550° F.)", massive cores cured "to a shallower skin depth, 1/4 to 1/2 inch". Unset in the Cost Guide, the hot box uses these: the box at the range's
  // lower bound (232 °C) and the skin at its upper bound (12.7 mm), both the slower cure.
  it('without the Cost Guide settings the hot box uses the published values, named in the trace; a value set in the Cost Guide wins', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    const out = makeCoreStep({ ...ctx, hotBox: { coreboxTempC: null, cureTempC: null, curedDepthMm: null } }, m, core);
    if (!out.ok) throw new Error(out.reasons.join('; '));
    const input = (field: string) => out.run.trace.find((t) => t.fieldName === field)!;
    expect(input('Corebox Temperature')).toMatchObject({ value: 232.2, source: expect.stringContaining('US 5,365,995') as string });
    expect(input('Cure Temperature')).toMatchObject({ value: 48.9, source: expect.stringContaining('US 5,365,995') as string });
    expect(input('Required Cured Depth')).toMatchObject({ value: 12.7, source: expect.stringContaining('US 5,365,995') as string });
    const set = makeCoreStep({ ...ctx, hotBox: { coreboxTempC: 260, cureTempC: null, curedDepthMm: null } }, m, core);
    if (!set.ok) throw new Error(set.reasons.join('; '));
    expect(set.run.trace.find((t) => t.fieldName === 'Corebox Temperature')).toMatchObject({ value: 260, source: expect.stringContaining('Cost Guide') as string });
  });

  it('settings that cannot cure anything are refused with the reason: the box must be hotter than the cure temperature, which must be above the sand\'s', () => {
    const m = byClass.sand_casting_hot_box.find((x) => spec$(x, 'max_corebox_length_mm') >= 300)!;
    for (const hotBox of [{ ...HOT_BOX, cureTempC: 245 }, { ...HOT_BOX, cureTempC: 250 }, { ...HOT_BOX, cureTempC: 20 }, { ...HOT_BOX, cureTempC: 10 }]) {
      const out = makeCoreStep({ ...ctx, hotBox }, m, core);
      expect(out).toEqual({ ok: false, reasons: [expect.stringContaining('must be hotter than the binder')] });
    }
  });

  it('with the hot box unusable another process makes the core, and the line says why, so the choice is not silent', () => {
    const line = coreLine({
      ctx: { ...ctx, hotBox: { ...HOT_BOX, cureTempC: 250 } }, core, machinesByClass: byClass, batchSize: 250, costContext,
    });
    expect(line.process).not.toBe('Hot Box');
    expect(line.step.warnings.join(' ')).toMatch(/Hot box could not make a core: hot box: the core box .* must be hotter than the binder/);
    expect(line.step.warnings.join(' ')).toContain(`${line.process} is used instead`);
  });

  it('refuses a core over the process weight limit, one that does not fit the machine\'s core box, and a machine with no cycle time', () => {
    const heavy = { ...core, kg: v('maxWeightShellCore') + 1 };
    expect(makeCoreStep(ctx, shell[0]!, heavy)).toEqual({ ok: false, reasons: [expect.stringContaining('maxWeightShellCore')] });
    const big = sandCores(ctx, [{ volumeMm3: 1e6, areaMm2: null, sizeMm: [5000, 4000, 3000] }]).cores[0]!;
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
    const impossible = { ...core, kg: 1e6, region: { volumeMm3: 1, areaMm2: null, sizeMm: [1e5, 1e5, 1e5] as const } };
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
