// Sand cores of a gravity die casting: Coremaking, Core Refractory Coat,
// Refractory Coat Air Dry / Oven Dry, and the corebox. Pure: the caller loads
// the staged rows (CastingReferenceService.getCoreReference) and the HR Rates
// machines; nothing here holds a reference value.
//
// Cores are the measured regions no die half reaches by a straight pull
// (cad-engine shared/core_geometry.py): volume, box (sorted), outer area.
//
// Coremaking (HR Rates class die_casting_coremaking, memory/Die Casting/
// Machine/core_making_machines.csv): a machine is capable when every core's
// box plus the coreboxMaterial Corebox Length Allowance (each side, for the
// machine's Corebox Material) fits its Max Corebox Length / Width / Height
// (largest to largest) and the core's smallest side is at least its Smallest
// Core. One core per blow at the machine Base Cycle Time; the cheapest per part
// is chosen. Several cores per corebox (variable coreboxCalcMode
// 'Opportunistic') has no rule in memory for how many fit, so one per blow.
//
// Core sand: each core's volume x the density and New Cost of the machine's
// Core Sand Type (sand table), charged as its own consumable line.
//
// Core Refractory Coat (class die_casting_core_refractory_coat), when
// defaultCoreRefractoryCoatingInclusion: core area / the tblRefractoryCoating
// Application Rate of defaultCoreRefractoryCoatingMethod, x
// defaultNumCoreRefractoryCoatingApplications, with
// defaultCoreRefractoryCoatingNumOperators and the slurry preparation
// defaultRefractoryCoatingCorePreparationTime as setup. The coating used is
// Average Output Volume x coating time at the density of the
// defaultRefractoryBaseLiquid coating (processConsumables): reported; memory
// holds no coating price, so it is not charged.
//
// Drying: the batch's coated cores dry in loads; a load holds as many as the
// bed volume allows (oven: x defaultRefractoryCoatOvenSpaceAvailableFactor)
// by core box volume, at most the batch. Per part = loads x dry time / batch,
// air (defaultAirDryAndCoolTime, Refractory Coat Air Dry machines) or oven
// (defaultOvenDryAndCoolTime, Refractory Coat Oven Dry machines), preparation
// time as setup; the cheaper is chosen. Loading labour is not charged: memory
// gives the laborer counts but no load / unload time.
//
// Corebox (user decision 2026-10-04): one per core, the coreboxMaterial One
// Cavity Cost of the coremaking machine's Corebox Material, lasting Refurb
// Life x (Refurbs Per Tool + 1) cores; amortised over annual volume x
// production life like the die (not costed when either is not set).
//
// Every number is computed by a die-casting calculator (Coremaking, Core Sand,
// Core Refractory Coat, Refractory Coat Air / Oven Dry, Corebox; migration 893). Corebox Cost Intercept / Percent / Learning
// Rate have no formula in memory and are not used.

import type { CalculatorRunDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runReferenceCalculator, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { castingSeed, runOnLine, runView, SeedSet } from './casting-calculator-seeds';
import { gap, line, type CostContext, type FinishingMachine } from './casting-finishing';
import { machineChoice, type ChoiceEval } from './machine-choice';

export interface CastingCore { volumeMm3: number; boxMm: [number, number, number]; areaMm2: number }

export const CORE_VARIABLE_KEYS = [
  'defaultNumCoreRefractoryCoatingApplications', 'defaultCoreRefractoryCoatingNumOperators',
  'defaultRefractoryCoatingCorePreparationTime', 'defaultAirDryAndCoolTime', 'defaultOvenDryAndCoolTime',
  'defaultRefractoryCoatOvenSpaceAvailableFactor', 'defaultRefractoryCoatingAirDryPreparationTime',
  'defaultRefractoryCoatingOvenDryPreparationTime',
] as const;
export const CORE_TEXT_VARIABLE_KEYS = [
  'defaultCoreRefractoryCoatingInclusion', 'defaultCoreRefractoryCoatingMethod', 'defaultRefractoryBaseLiquid',
] as const;
export const CORE_LOOKUP_KEYS = ['sand', 'coreboxMaterial', 'tblRefractoryCoating', 'processConsumables'] as const;

export interface CoreReference {
  v: Record<(typeof CORE_VARIABLE_KEYS)[number], number>;
  coat: boolean;
  coatMethod: { name: string; m2PerMin: number; litresPerMin: number };
  coatingLiquid: string;
  /** kg/m3 of the defaultRefractoryBaseLiquid coating. */
  coatingDensityKgM3: number;
  sand: Map<string, { densityKgM3: number; newCostUsdPerKg: number }>;
  corebox: Map<string, { oneCavityCostUsd: number; lengthAllowanceMm: number; refurbLife: number; refurbsPerTool: number | null }>;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function resolveCoreReference(rows: {
  variables: ReadonlyArray<{ key: string; value: string | number | null }>;
  lookups: Readonly<Record<string, ReadonlyArray<Record<string, unknown>> | undefined>>;
}): { reference: CoreReference | null; missing: string[] } {
  const missing: string[] = [];
  const raw = new Map(rows.variables.map((x) => [x.key, x.value]));
  const v = {} as CoreReference['v'];
  for (const k of CORE_VARIABLE_KEYS) {
    const n = num(raw.get(k));
    if (n == null) missing.push(`variables: ${k}`);
    v[k] = n ?? NaN;
  }
  const text = (k: string) => {
    const t = String(raw.get(k) ?? '').trim();
    if (!t) missing.push(`variables: ${k}`);
    return t;
  };
  const inclusion = text('defaultCoreRefractoryCoatingInclusion').toLowerCase();
  const methodName = text('defaultCoreRefractoryCoatingMethod');
  const liquid = text('defaultRefractoryBaseLiquid');
  const table = (k: string) => {
    const t = rows.lookups[k];
    if (!t || t.length === 0) missing.push(`${k} (not staged)`);
    return t ?? [];
  };
  const methodRow = table('tblRefractoryCoating').find((r) => r['Application Method'] === methodName);
  if (!methodRow) missing.push(`tblRefractoryCoating: no ${methodName || '(method)'} row`);
  const coatingName = `${liquid} Refractory Coating`;
  const coatingRow = table('processConsumables').find((r) => r['Consumable Name'] === coatingName);
  const coatingDensity = num(coatingRow?.['Density (kg / m^3)']);
  if (coatingDensity == null) missing.push(`processConsumables: ${coatingName} density`);
  const sand = new Map<string, { densityKgM3: number; newCostUsdPerKg: number }>();
  for (const r of table('sand')) {
    const d = num(r['Density (kg / m^3)']);
    const c = num(r['New Cost (USD / kg)']);
    if (d != null && c != null) sand.set(String(r['Name']), { densityKgM3: d, newCostUsdPerKg: c });
  }
  const corebox = new Map<string, CoreReference['corebox'] extends Map<string, infer V> ? V : never>();
  for (const r of table('coreboxMaterial')) {
    const cost = num(r['One Cavity Cost (USD)']);
    const allow = num(r['Corebox Length Allowance (mm)']);
    const life = num(r['Corebox Refurb Life']);
    if (cost != null && allow != null && life != null) {
      corebox.set(String(r['Type']), { oneCavityCostUsd: cost, lengthAllowanceMm: allow, refurbLife: life, refurbsPerTool: num(r['Corebox Refurbs Per Tool']) });
    }
  }
  const reference: CoreReference = {
    v, coat: inclusion === 'true',
    coatMethod: { name: methodName, m2PerMin: num(methodRow?.['Application Rate (m^2 / min)']) ?? NaN, litresPerMin: num(methodRow?.['Average Output Volume (L / min)']) ?? NaN },
    coatingLiquid: liquid, coatingDensityKgM3: coatingDensity ?? NaN, sand, corebox,
  };
  return { reference: missing.length ? null : reference, missing };
}

interface CoreRouteInput {
  reference: CoreReference;
  /** The die-casting calculators (database), keyed by calculator key. */
  calculators: ReferenceCalculators | null;
  cores: readonly CastingCore[];
  coremakers: readonly FinishingMachine[];
  coaters: readonly FinishingMachine[];
  airDryers: readonly FinishingMachine[];
  ovens: readonly FinishingMachine[];
  batchSize: number;
  /** USD -> the line currency (machine rates are already converted by the caller). */
  usdToLocal: number;
  annualVolume: number | null;
  productionLifeYears: number | null;
  costContext: CostContext;
}

export interface CoreRouteResult {
  lines: ProcessLineCost[];
  /** Coreboxes, USD (separate from the piece cost, like the die). */
  corebox: { boxes: number; costUsd: number; perPartUsd: number | null; detail: string; run: CalculatorRunDto } | null;
  warnings: string[];
}

const GROUP = 'Die Casting';
const sorted3 = (xs: readonly number[]) => [...xs].sort((a, b) => b - a) as [number, number, number];

export function priceCoreRoute(input: CoreRouteInput): CoreRouteResult {
  const ref = input.reference;
  const calcs = input.calculators;
  const warnings: string[] = [];
  const lines: ProcessLineCost[] = [];
  if (input.cores.length === 0) return { lines, corebox: null, warnings };
  const batch = Math.max(input.batchSize, 1);
  const coreCount = input.cores.length;
  const coreCountSeed = castingSeed.cad(coreCount, 'sand cores (trapped regions no die half reaches)');

  // ── Coremaking (calculator Coremaking) ──────────────────────────────────
  const cmEvals = input.coremakers.map((m) => {
    const mat = String(m.specs['corebox_material'] ?? '');
    const box = ref.corebox.get(mat);
    const sandType = String(m.specs['core_sand_type'] ?? '');
    const sandRow = ref.sand.get(sandType);
    const maxBox = sorted3([num(m.specs['max_corebox_length_mm']) ?? 0, num(m.specs['max_corebox_width_mm']) ?? 0, num(m.specs['max_corebox_height_mm']) ?? 0]);
    const smallest = num(m.specs['smallest_core_mm']);
    const blow = num(m.specs['base_cycle_time_s']);
    const reasons: string[] = [];
    if (!box) reasons.push(`Corebox Material ${mat || '(none)'} has no coreboxMaterial row`);
    if (!sandRow) reasons.push(`Core Sand Type ${sandType || '(none)'} has no sand row`);
    if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (!(blow! > 0)) reasons.push('no Base Cycle Time on file');
    if (smallest == null || maxBox[2] <= 0) reasons.push('no max corebox size / smallest core on file');
    if (reasons.length === 0) {
      for (const [i, c] of input.cores.entries()) {
        const need = sorted3(c.boxMm.map((d) => d + 2 * box!.lengthAllowanceMm));
        if (!need.every((d, k) => d <= maxBox[k]!)) reasons.push(`core ${i + 1} corebox ${need.map(r2).join(' x ')} mm larger than ${maxBox.join(' x ')} mm`);
        if (Math.min(...c.boxMm) < smallest!) reasons.push(`core ${i + 1} ${r2(Math.min(...c.boxMm))} mm below the ${smallest} mm Smallest Core`);
      }
    }
    if (reasons.length) return { m, reasons, run: null, sec: 0, blow: 0, box: null, boxMaterial: mat, sandType, sandRow: null, cost: Infinity };
    const run = runReferenceCalculator(calcs, 'Coremaking', {
      'Base Cycle Time': castingSeed.machine(m.name, 'Base Cycle Time (s)', blow!),
      'Core Count': coreCountSeed,
    });
    if (run.value == null) return { m, reasons: run.missing, run: null, sec: 0, blow: 0, box: null, boxMaterial: mat, sandType, sandRow: null, cost: Infinity };
    const hourly = m.machineRatePerHr! + (m.operators != null ? (m.labourRatePerHr ?? 0) * m.operators : 0);
    return { m, reasons, run, sec: run.value, blow: blow!, box: box!, boxMaterial: mat, sandType, sandRow: sandRow!, cost: (hourly * run.value) / 3600 };
  });
  const cmBest = cmEvals.filter((e) => e.reasons.length === 0).sort((a, b) => a.cost - b.cost)[0];
  const cmChoice = machineChoice({
    rule: 'Cheapest run cost per part among the capable core machines (machine + crew rate x one blow per core)',
    criteria: [
      "Every core's box plus the coreboxMaterial Corebox Length Allowance each side fits the Max Corebox Length / Width / Height",
      'Every core at least the machine Smallest Core',
      'Machine hour rate, Base Cycle Time, Corebox Material and Core Sand Type on file',
    ],
    evals: cmEvals.map((e): ChoiceEval => ({ name: e.m.name, reasons: e.reasons, cost: e.reasons.length ? null : e.cost, note: e.reasons.length ? undefined : `${e.blow} s blow, ${e.boxMaterial} corebox, ${e.sandType}` })),
    chosen: cmBest?.m.name ?? null,
  });
  if (!cmBest) {
    const big = sorted3(input.cores.map((c) => c.boxMm[0]));
    lines.push({ ...gap('Coremaking', GROUP, 'die_casting_coremaking',
      `no core machine in HR Rates fits all ${coreCount} cores (largest ${r2(big[0])} mm) with its corebox allowance, smallest core and a rate`), machineChoice: cmChoice });
    return { lines, corebox: null, warnings };
  }
  const cm = { ...cmBest, box: cmBest.box!, sandRow: cmBest.sandRow! };
  lines.push({
    ...line({
      process: 'Coremaking', processGroup: GROUP, processRoute: 'Coremaking', machineClass: 'die_casting_coremaking', machine: cm.m,
      sec: cm.sec, batchSize: batch, costContext: input.costContext, warnings, run: cm.run!,
      breakdown: `${coreCount} core${coreCount === 1 ? '' : 's'} × ${cm.blow} s blow (one core per corebox)`,
    }),
    machineChoice: cmChoice,
  });

  // Core sand, a consumable of the coremaking line (calculator Core Sand).
  const coreVolume = input.cores.reduce((s, c) => s + c.volumeMm3, 0);
  const sandRun = runReferenceCalculator(calcs, 'Core Sand', {
    'Core Volume': castingSeed.cad(coreVolume, `volume of the ${coreCount} core${coreCount === 1 ? '' : 's'} (mm³)`),
    'Sand Density': castingSeed.lookup('sand', 'Density (kg / m^3)', cm.sandRow.densityKgM3, { Name: cm.sandType }),
    'Sand New Cost': castingSeed.lookup('sand', 'New Cost (USD / kg)', cm.sandRow.newCostUsdPerKg, { Name: cm.sandType }),
    'USD to Local': castingSeed.engine(input.usdToLocal, 'exchange rate USD to the factory currency (FX snapshot)'),
  }, 'Cost per Part');
  if (sandRun.value == null) lines.push(gap('Core Sand', GROUP, 'die_casting_coremaking', sandRun.missing.join('; ')));
  else {
    lines.push({
      process: 'Core Sand', processGroup: GROUP, processRoute: 'Coremaking', operation: 'Core Sand',
      setupCost: 0, runCost: r2(sandRun.value), totalCost: r2(sandRun.value), cycleTimeMin: 0,
      hourlyRate: 0, rateSource: 'consumable_allowance', machineClass: 'die_casting_coremaking', machineName: cm.m.name,
      commodityCode: null, labourRate: null,
      featureBreakdown: [{ name: `${r3(sandRun.outputs['Sand Weight']!)} kg ${cm.sandType} × $${cm.sandRow.newCostUsdPerKg}/kg (sand New Cost)`, featureType: 'Part', timeSec: 0, count: 1 }],
      ...runOnLine(sandRun),
    });
  }

  // ── Core Refractory Coat (calculator Core Refractory Coat) ───────────────
  const coreArea = input.cores.reduce((s, c) => s + c.areaMm2, 0);
  if (!ref.coat) {
    warnings.push('Cores are not refractory coated (defaultCoreRefractoryCoatingInclusion is false).');
    return withCorebox();
  }
  const coatRun = runReferenceCalculator(calcs, 'Core Refractory Coat', {
    'Core Area': castingSeed.cad(coreArea, `outer area of the ${coreCount} core${coreCount === 1 ? '' : 's'} (mm²)`),
    'Application Rate': castingSeed.lookup('tblRefractoryCoating', 'Application Rate (m^2 / min)', ref.coatMethod.m2PerMin, { 'Application Method': ref.coatMethod.name }),
    'Coat Applications': castingSeed.variable('defaultNumCoreRefractoryCoatingApplications', ref.v.defaultNumCoreRefractoryCoatingApplications),
  });
  const coatOps = ref.v.defaultCoreRefractoryCoatingNumOperators;
  const coatHourly = (m: FinishingMachine) => m.machineRatePerHr! + (m.labourRatePerHr ?? 0) * coatOps;
  const coater = input.coaters.filter((m) => m.machineRatePerHr != null).sort((a, b) => coatHourly(a) - coatHourly(b))[0];
  const coatSec = coatRun.value;
  const coatChoice = machineChoice({
    rule: 'Cheapest run cost per part among the stations (coating time is the same on every one)',
    criteria: [
      `${r3(coreArea / 1e6)} m² of core area at ${ref.coatMethod.m2PerMin} m²/min (${ref.coatMethod.name}) x ${ref.v.defaultNumCoreRefractoryCoatingApplications} coat, ${coatOps} operator (defaultCoreRefractoryCoatingNumOperators)`,
      'Machine hour rate on file',
    ],
    evals: input.coaters.map((m): ChoiceEval => m.machineRatePerHr == null || coatSec == null
      ? { name: m.name, reasons: m.machineRatePerHr == null ? ['no machine hour rate on file'] : coatRun.missing }
      : { name: m.name, reasons: [], cost: (coatHourly(m) * coatSec) / 3600 }),
    chosen: coatSec != null ? coater?.name ?? null : null,
  });
  if (coatSec == null) lines.push({ ...gap('Core Refractory Coat', GROUP, 'die_casting_core_refractory_coat', coatRun.missing.join('; ')), machineChoice: coatChoice });
  else if (!coater) lines.push({ ...gap('Core Refractory Coat', GROUP, 'die_casting_core_refractory_coat', 'no core refractory coat station in HR Rates'), machineChoice: coatChoice });
  else {
    lines.push({
      ...line({
        process: 'Core Refractory Coat', processGroup: GROUP, processRoute: 'Core Refractory Coat', machineClass: 'die_casting_core_refractory_coat',
        machine: { ...coater, operators: coatOps, setupTimeHr: ref.v.defaultRefractoryCoatingCorePreparationTime },
        sec: coatSec, batchSize: batch, costContext: input.costContext, warnings, run: coatRun,
        breakdown: `${r3(coreArea / 1e6)} m² core area / ${ref.coatMethod.m2PerMin} m²/min (${ref.coatMethod.name}) × ${ref.v.defaultNumCoreRefractoryCoatingApplications} coat`,
      }),
      machineChoice: coatChoice,
    });
    const coatingKg = ((coatSec / 60) * ref.coatMethod.litresPerMin / 1000) * ref.coatingDensityKgM3;
    warnings.push(`Core coating used: ${r3(coatingKg)} kg ${ref.coatingLiquid} refractory coating per part, not charged (memory has no coating price).`);
  }

  // ── Refractory dry: air or oven, the cheaper (calculators Refractory Coat Air / Oven Dry) ──
  const setVolume = input.cores.reduce((s, c) => s + c.boxMm[0] * c.boxMm[1] * c.boxMm[2], 0);
  const common = {
    'Core Set Box Volume': castingSeed.cad(setVolume, `box volume of one part's ${coreCount} core${coreCount === 1 ? '' : 's'} (mm³)`),
    'Batch Size': castingSeed.scenario(batch, 'batch size'),
  };
  const dryOptions = [
    ...input.airDryers.map((m) => ({ m, kind: 'Refractory Coat Air Dry', cls: 'die_casting_refractory_coat_air_dry', minutes: ref.v.defaultAirDryAndCoolTime, prepHr: ref.v.defaultRefractoryCoatingAirDryPreparationTime,
      extra: { 'Dry Time': castingSeed.variable('defaultAirDryAndCoolTime', ref.v.defaultAirDryAndCoolTime) } })),
    ...input.ovens.map((m) => ({ m, kind: 'Refractory Coat Oven Dry', cls: 'die_casting_refractory_coat_oven_dry', minutes: ref.v.defaultOvenDryAndCoolTime, prepHr: ref.v.defaultRefractoryCoatingOvenDryPreparationTime,
      extra: {
        'Dry Time': castingSeed.variable('defaultOvenDryAndCoolTime', ref.v.defaultOvenDryAndCoolTime),
        'Space Available Factor': castingSeed.variable('defaultRefractoryCoatOvenSpaceAvailableFactor', ref.v.defaultRefractoryCoatOvenSpaceAvailableFactor),
      } })),
  ].map((o) => {
    const dims = { L: num(o.m.specs['bed_length_mm']), W: num(o.m.specs['bed_width_mm']), H: num(o.m.specs['bed_height_mm']) };
    const reasons: string[] = [];
    if (o.m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (!(dims.L! > 0 && dims.W! > 0 && dims.H! > 0)) reasons.push('no bed size on file');
    if (reasons.length) return { ...o, reasons, run: null, sec: 0, cost: Infinity };
    const run = runReferenceCalculator(calcs, o.kind, {
      ...common, ...o.extra,
      'Bed Length': castingSeed.machine(o.m.name, 'Bed Length (mm)', dims.L!),
      'Bed Width': castingSeed.machine(o.m.name, 'Bed Width (mm)', dims.W!),
      'Bed Height': castingSeed.machine(o.m.name, 'Bed Height (mm)', dims.H!),
    });
    if (run.value == null) return { ...o, reasons: run.missing, run: null, sec: 0, cost: Infinity };
    if (!(run.outputs['Parts per Load']! >= 1)) return { ...o, reasons: ['the bed does not hold one part core set'], run: null, sec: 0, cost: Infinity };
    return { ...o, reasons, run, sec: run.value, cost: (o.m.machineRatePerHr! * run.value) / 3600 };
  });
  const dry = dryOptions.filter((e) => e.reasons.length === 0).sort((a, b) => a.cost - b.cost)[0];
  const dryChoice = machineChoice({
    rule: 'Cheapest run cost per part, air dry areas and ovens alike (loads x dry time spread over the batch at the machine rate)',
    criteria: [
      `The bed (oven: x defaultRefractoryCoatOvenSpaceAvailableFactor ${ref.v.defaultRefractoryCoatOvenSpaceAvailableFactor}) holds at least one part core set by box volume; a load is at most the batch of ${batch}`,
      `Air dry ${ref.v.defaultAirDryAndCoolTime} min, oven ${ref.v.defaultOvenDryAndCoolTime} min per load`,
      'Machine hour rate and bed size on file',
    ],
    evals: dryOptions.map((e): ChoiceEval => ({
      name: `${e.m.name} (${e.kind.replace('Refractory Coat ', '')})`, reasons: e.reasons, cost: e.reasons.length ? null : e.cost,
      note: e.run ? `${e.run.outputs['Parts per Load']} part core sets per load, ${e.run.outputs['Loads']} load${e.run.outputs['Loads'] === 1 ? '' : 's'}` : undefined,
    })),
    chosen: dry ? `${dry.m.name} (${dry.kind.replace('Refractory Coat ', '')})` : null,
  });
  if (!dry) lines.push({ ...gap('Refractory Coat Oven Dry', GROUP, 'die_casting_refractory_coat_oven_dry', 'no refractory dry area or oven in HR Rates holds a part core set'), machineChoice: dryChoice });
  else {
    const loads = dry.run!.outputs['Loads']!;
    lines.push({
      ...line({
        process: dry.kind, processGroup: GROUP, processRoute: dry.kind, machineClass: dry.cls,
        machine: { ...dry.m, operators: null, setupTimeHr: dry.prepHr },
        sec: dry.sec, batchSize: batch, costContext: input.costContext, warnings, run: dry.run!,
        breakdown: `${loads} load${loads === 1 ? '' : 's'} × ${dry.minutes} min for ${batch} parts (${dry.run!.outputs['Parts per Load']} part core sets per load)`,
      }),
      machineChoice: dryChoice,
    });
    warnings.push(`${dry.kind}: loading labour is not charged (memory gives laborer counts but no load / unload time).`);
  }
  return withCorebox();

  // Coreboxes (calculator Corebox), amortised over the production like the die.
  function withCorebox(): CoreRouteResult {
    const b = cm!.box;
    const seeds = new SeedSet()
      .put('Refurbs per Tool', b.refurbsPerTool, (x) => castingSeed.lookup('coreboxMaterial', 'Corebox Refurbs Per Tool', x, { Type: cm!.boxMaterial }), `coreboxMaterial has no Refurbs Per Tool for ${cm!.boxMaterial}`)
      .put('Annual Volume', input.annualVolume, (x) => castingSeed.scenario(x, 'annual volume'), 'annual volume')
      .put('Production Life', input.productionLifeYears, (x) => castingSeed.scenario(x, 'production life (yr)'), 'production life');
    if (seeds.missing.length) {
      warnings.push(`Corebox (${cm!.boxMaterial}) not costed: ${seeds.missing.join(', ')} not set.`);
      return { lines, corebox: null, warnings };
    }
    const run = runReferenceCalculator(calcs, 'Corebox', seeds.with({
      'Core Count': coreCountSeed,
      'Refurb Life': castingSeed.lookup('coreboxMaterial', 'Corebox Refurb Life', b.refurbLife, { Type: cm!.boxMaterial }),
      'One Cavity Cost': castingSeed.lookup('coreboxMaterial', 'One Cavity Cost (USD)', b.oneCavityCostUsd, { Type: cm!.boxMaterial }),
    }), 'Corebox per Part');
    if (run.value == null) {
      warnings.push(`Corebox (${cm!.boxMaterial}) not costed: ${run.missing.join('; ')}.`);
      return { lines, corebox: null, warnings };
    }
    const o = run.outputs;
    return {
      lines,
      corebox: {
        boxes: o['Boxes']!, costUsd: o['Corebox Cost']!, perPartUsd: run.value,
        detail: `${coreCount} core${coreCount === 1 ? '' : 's'} × ${o['Boxes']! / coreCount} ${cm!.boxMaterial} corebox${o['Boxes']! / coreCount === 1 ? '' : 'es'} × $${b.oneCavityCostUsd} (One Cavity Cost; ${o['Cores per Box']!.toLocaleString()} cores each = Refurb Life ${b.refurbLife} × (${b.refurbsPerTool} refurbs + 1))`,
        run: runView('Die Casting - Corebox', 'Corebox per Part', run),
      },
      warnings,
    };
  }
}
