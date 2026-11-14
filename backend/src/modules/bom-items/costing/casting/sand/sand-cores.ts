// Cores of a sand casting. The geometry worker finds regions of air enclosed between metal along the draw axis; each is a sand core,
// made on a coremaking machine and held in the mould by core prints. Core boxes are tooling, amortised over the lifetime volume.
// The numbers come from the calculators "Core sand", "Coremaking", "Hot box coremaking" and "Core box"; the rules on which machine can make
// a core stay here. Ported from the retired petrus-demo prototype (its design records, D-numbers, are archived outside the repo): cores (D127, D143).
//
// Left out, as in the prototype: isocure (no cycle time in the data) and manual coremaking (its mixing rate alone gives seconds for a core;
// the curing time that dominates is not modelled). Hot box has no cycle time in the data: its calculator times the blow from the sand, the cure
// from heat conduction into the sand (the plant's box temperature, binder cure temperature and strip depth, set in the Cost Guide; none assumed)
// and the strip from the handling table.
import type { ReferenceCalcRun } from '../../shared/calculators/reference-calculator';
import { machineValue, type SandMachine } from './sand-machines';
import { handlingTime } from './sand-handling';
import { valuesProvider } from './sand-seeds';
import { energyBasisOf, runStep, selectAndCost, type CostedStep, type SandRouteContext, type StepOutcome } from './sand-steps';
import type { CostContext } from '../casting-finishing';
import { variableProvider } from './sand-seeds';

export const CORE_SAND = 'Sand Casting - Core sand';
export const COREMAKING = 'Sand Casting - Coremaking';
export const HOT_BOX = 'Sand Casting - Hot box coremaking';
export const CORE_BOX = 'Sand Casting - Core box';

/** A core region as the worker measured it: its volume and extents, largest first (mm). */
export interface CoreRegion {
  volumeMm3: number;
  /** The core's whole surface (mm²), exact from its body; null when it has none or the analysis predates it. */
  areaMm2: number | null;
  sizeMm: readonly [number, number, number];
}

/** The coremaking processes the data can cost: the process name and the HR Rates machine class. The first is the main process. */
export const CORE_PROCESSES = [
  { process: 'Hot Box', machineClass: 'sand_casting_hot_box', limitVariable: 'maxWeightHotBoxCore' },
  { process: 'CO2 Cured', machineClass: 'sand_casting_co2_coremaking', limitVariable: 'maxWeightGasCuredCore' },
  { process: 'No Bake', machineClass: 'sand_casting_no_bake', limitVariable: null },
  { process: 'Oil Core', machineClass: 'sand_casting_oil_core', limitVariable: null },
  { process: 'Shell', machineClass: 'sand_casting_shell', limitVariable: 'maxWeightShellCore' },
] as const;
export type CoreProcess = (typeof CORE_PROCESSES)[number];

/**
 * The hot box settings: the Cost Guide's, else the published values of US 5,365,995 (Ford, "Method of curing hot box sand cores"): "the 120° F. critical
 * cure temperature", "normal pattern operating temperatures (450 to 550° F.)", massive cores cured "to a shallower skin depth, 1/4 to 1/2 inch". The box is
 * taken at the range's lower bound and the skin at its upper bound: both the slower cure. The cured depth is capped at half the core's section (calculator).
 */
const HOT_BOX_PUBLISHED = {
  coreboxTempC: { value: 232.2, source: 'US 5,365,995: pattern 450-550 °F, the lower bound 450 °F (the slower cure)' },
  cureTempC: { value: 48.9, source: 'US 5,365,995: "the 120° F. critical cure temperature"' },
  curedDepthMm: { value: 12.7, source: 'US 5,365,995: massive cores cured to a skin of 1/4 to 1/2 inch, the upper bound 1/2 inch (the slower cure)' },
} as const;
const HOT_BOX_SET_IN = { coreboxTempC: 'core box temperature', cureTempC: "binder's cure temperature", curedDepthMm: 'cured depth before stripping' } as const;

function hotBoxValues(ctx: SandRouteContext): Record<keyof typeof HOT_BOX_PUBLISHED, { value: number; source: string }> {
  const of = (k: keyof typeof HOT_BOX_PUBLISHED) => {
    const set = ctx.hotBox[k];
    return set != null ? { value: set, source: `${HOT_BOX_SET_IN[k]} set in the Cost Guide` } : HOT_BOX_PUBLISHED[k];
  };
  return { coreboxTempC: of('coreboxTempC'), cureTempC: of('cureTempC'), curedDepthMm: of('curedDepthMm') };
}

/**
 * Why the hot box physics cannot work, or nothing: the box must be hotter than the binder's cure temperature and that hotter than the sand it is blown at
 * (otherwise the sand never gets there).
 */
export function hotBoxSettingsProblems(ctx: SandRouteContext): string[] {
  const { coreboxTempC: box, cureTempC: cure } = hotBoxValues(ctx);
  const start = ctx.ref.number('sandMoldTemp');
  if (start == null) return ['sand variable sandMoldTemp'];
  if (!(box.value > cure.value && cure.value > start)) {
    return [`hot box: the core box (${box.value} °C) must be hotter than the binder's cure temperature (${cure.value} °C), which must be above the sand's starting temperature (${start} °C)`];
  }
  return [];
}

export interface SandCore {
  region: CoreRegion;
  /** Core sand: the core plus its prints (kg). */
  kg: number;
  run: ReferenceCalcRun;
}

/**
 * The cores made of sand, and how many are too thin for that (below minSandCastableHoleDia across: left solid and machined later).
 * `missing` names what the data lacks; with anything missing no core is returned.
 */
export function sandCores(ctx: SandRouteContext, regions: readonly CoreRegion[]): { cores: SandCore[]; thin: number; missing: string[] } {
  const thinnest = ctx.ref.number('minSandCastableHoleDia');
  if (thinnest == null) return { cores: [], thin: 0, missing: ['sand variable minSandCastableHoleDia'] };
  const cores: SandCore[] = [];
  let thin = 0;
  for (const region of regions) {
    if (region.sizeMm[2] < thinnest || region.sizeMm[0] <= 0) {
      thin += 1;
      continue;
    }
    const r = runStep(
      ctx, CORE_SAND, null,
      { core_volume_mm3: { value: region.volumeMm3, source: 'worker' }, core_length_mm: { value: region.sizeMm[0], source: "worker: the core's longest side" } },
      {},
      'Core Sand',
    );
    if (!('run' in r)) return { cores: [], thin: 0, missing: r.reasons };
    cores.push({ region, kg: r.run.value!, run: r.run });
  }
  return { cores, thin, missing: [] };
}

/**
 * Making one core on one machine: within the process's weight limit and the machine's largest core box (each core side plus
 * coreboxLengthAllowance). Hot box is timed from the sand; the others by the machine's base cycle time (no cycle time in the data: refused).
 */
export function makeCoreStep(ctx: SandRouteContext, machine: SandMachine, core: SandCore): StepOutcome {
  const process = CORE_PROCESSES.find((p) => p.machineClass === machine.machineClass);
  if (!process) return { ok: false, reasons: [`${machine.machineClass} is not a coremaking class this route costs`] };
  if (process.limitVariable) {
    const most = ctx.ref.number(process.limitVariable);
    if (most == null) return { ok: false, reasons: [`sand variable ${process.limitVariable}`] };
    if (core.kg > most) return { ok: false, reasons: [`a ${core.kg.toFixed(1)} kg core is over ${process.limitVariable} (${most} kg)`] };
  }
  const allowance = ctx.ref.number('coreboxLengthAllowance');
  const box = ['max_corebox_length_mm', 'max_corebox_width_mm', 'max_corebox_height_mm'].map((k) => machineValue(machine, k));
  if (allowance == null) return { ok: false, reasons: ['sand variable coreboxLengthAllowance'] };
  if (box.some((v) => v == null)) return { ok: false, reasons: [`machine ${machine.name}: max core box length, width and height`] };
  const most = (box as number[]).sort((a, b) => b - a);
  if (core.region.sizeMm.some((side, i) => side + allowance > most[i]!)) {
    return { ok: false, reasons: [`core boxes up to ${most.map((v) => v.toFixed(0)).join(' x ')} mm`] };
  }
  const isHotBox = process.process === 'Hot Box';
  if (isHotBox) {
    const problems = hotBoxSettingsProblems(ctx);
    if (problems.length) return { ok: false, reasons: problems };
  }
  if (!isHotBox && !((machineValue(machine, 'base_cycle_time_s') ?? 0) > 0)) return { ok: false, reasons: ['no cycle time in the reference data'] };
  // The strip and handling time: the handling table's band that takes this core (its equipment is part of the source shown in the trace).
  const band = isHotBox ? handlingTime(ctx.ref, core.kg) : null;
  if (isHotBox && !band) return { ok: false, reasons: [`tblHandlingTimes has no band that takes a ${core.kg.toFixed(1)} kg core`] };
  const hot = hotBoxValues(ctx);
  const priced = ctx.energyPricePerKwh != null;
  const r = runStep(
    ctx, isHotBox ? HOT_BOX : COREMAKING, machine,
    {
      core_sand_kg: { value: core.kg, source: 'Sand Casting - Core sand' },
      // The core's smallest side: heat arrives from every face, so no sand is further from a face than half of it.
      core_section_mm: { value: core.region.sizeMm[2], source: "worker: the core's smallest side" },
    },
    isHotBox
      ? {
          scenario: valuesProvider({
            hot_box_corebox_temp_c: hot.coreboxTempC,
            hot_box_cure_temp_c: hot.cureTempC,
            hot_box_cured_depth_mm: hot.curedDepthMm,
            // As for melting: an energy price the user has not set is not assumed; the energy is then not charged, and the line says so.
            energy_price: { value: priced ? ctx.energyPricePerKwh! : 0, source: priced ? ctx.energyPriceSource ?? 'energy price (USD/kWh)' : 'no energy price: none set in the Cost Guide and none for the location' },
          }),
          lookup: valuesProvider({ 'tblHandlingTimes.Handling Time (s)': { value: band!.seconds, source: `tblHandlingTimes: ${band!.equipment} up to ${band!.maxKg} kg` } }),
        }
      : {},
  );
  if (!('run' in r)) return { ok: false, reasons: r.reasons };
  // The sand's sensible heat to the cure temperature (a lower bound: holding the box hot between shots costs more), priced with the energy price.
  const energyKwh = r.run.outputs['Energy'];
  const notes = isHotBox && !priced && energyKwh != null
    ? [`Hot box heating energy is not charged: no energy price for the location or in the Cost Guide (the sand's heat alone is ${energyKwh.toFixed(3)} kWh per core, a lower bound).`]
    : [];
  return { ok: true, sec: r.run.value!, run: r.run, energyCostUsd: isHotBox ? r.run.outputs['Energy Cost'] ?? 0 : 0, notes, ...(isHotBox && priced ? { energyBasis: energyBasisOf(ctx) } : {}) };
}

export interface CoreLine {
  step: CostedStep;
  process: string;
}

/**
 * The line that makes one core: the main process (hot box) whenever it can make the core, unless the user names another process;
 * otherwise the cheapest of the other processes that can. No process can: a named gap carrying every reason.
 */
export function coreLine(input: {
  ctx: SandRouteContext;
  core: SandCore;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  batchSize: number;
  costContext: CostContext;
  /** A coremaking process the user chose instead of the automatic choice. */
  chosenProcess?: string | null;
}): CoreLine {
  const cost = (p: CoreProcess) =>
    selectAndCost({
      process: `${p.process} coremaking`, machineClass: p.machineClass, machines: input.machinesByClass[p.machineClass] ?? [], batchSize: input.batchSize,
      costContext: input.costContext, ref: input.ctx.ref, evaluate: (m) => makeCoreStep(input.ctx, m, input.core),
      criteria: ["Within the process's core weight limit", "The core and its allowance fit the machine's largest core box", 'A machine hour rate and a cycle time on file'],
    });
  const candidates = input.chosenProcess ? CORE_PROCESSES.filter((p) => p.process === input.chosenProcess) : CORE_PROCESSES;
  const costed = candidates.map((p) => ({ p, step: cost(p) }));
  const main = costed.find((c) => c.p.process === 'Hot Box' && c.step.machine);
  const capable = costed.filter((c) => c.step.machine);
  const pick = main ?? [...capable].sort((a, b) => a.step.line.totalCost - b.step.line.totalCost)[0];
  if (pick) {
    // The main process (hot box) could not make this core and another did: say why, so the choice is never silent.
    const hotBox = costed.find((c) => c.p.process === 'Hot Box');
    if (hotBox && !hotBox.step.machine && pick.p.process !== 'Hot Box') {
      const reasons = [...new Set((hotBox.step.line.machineChoice?.candidates ?? []).flatMap((c) => c.reasons))];
      pick.step.warnings.push(`Hot box could not make a core: ${reasons.join('; ') || 'no machine'}. ${pick.p.process} is used instead.`);
    }
    return { step: pick.step, process: pick.p.process };
  }
  const first = costed[0];
  return { step: first!.step, process: first!.p.process };
}

export interface CoreboxTooling {
  material: string;
  boxes: number;
  toolingCostUsd: number;
  perPartUsd: number;
  run: ReferenceCalcRun;
}

/** One core's box tooling: the box material that costs least per part over the lifetime volume (the Core box calculator for each material row). */
export function coreboxTooling(ctx: SandRouteContext, lifetimeVolume: number): { tooling: CoreboxTooling | null; missing: string[] } {
  const rows = ctx.ref.table('tblCoreboxMaterial').filter((r) => Number(r['Corebox Refurb Life']) > 0);
  if (rows.length === 0) return { tooling: null, missing: ['sand lookup tblCoreboxMaterial (not staged, migration 853)'] };
  let best: CoreboxTooling | null = null;
  for (const row of rows) {
    const where = `tblCoreboxMaterial ${row['Type']}`;
    const r = runStep(
      ctx, CORE_BOX, null, {},
      {
        scenario: valuesProvider({ lifetime_volume: { value: lifetimeVolume, source: 'parts made over the tooling life (scenario)' } }),
        variable: variableProvider(ctx.ref),
        lookup: (key: string) => {
          const col = key.replace(/^tblCoreboxMaterial\./, '');
          const value = Number(row[col]);
          return key.startsWith('tblCoreboxMaterial.') && Number.isFinite(value) ? { value, source: where, lookup: true } : null;
        },
      },
      'Cost per Part',
    );
    if (!('run' in r)) return { tooling: null, missing: r.reasons };
    const t: CoreboxTooling = { material: String(row['Type']), boxes: r.run.outputs['Boxes']!, toolingCostUsd: r.run.outputs['Tooling Cost']!, perPartUsd: r.run.value!, run: r.run };
    if (!best || t.perPartUsd < best.perPartUsd) best = t;
  }
  return { tooling: best, missing: [] };
}
