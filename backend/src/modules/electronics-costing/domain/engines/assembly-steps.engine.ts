// PCBA assembly steps priced from the board's extracted features, the HR Rates machine a person chose for each step in
// the scenario, and the assembly inputs stated in the scenario (or a confirmed reference row). Every count comes from
// the feature graph; every rate and time from a named row or a stated value. Anything missing is a gap that says
// exactly what to add, never a default.
import { SCENARIO_FACT_KEYS, type AssemblyStepId, type ElectronicsScenario } from '../scenario/scenario';

import type { CalculationTraceStep, PhysicsGap } from '../../../bom-items/dto/cost-breakdown.dto';
import type { BoardFeatureGraph } from '../feature-graph/contract';
import type { MachineCandidate, RateBook, RateEntry } from '../rates/rate-book';
import type { ElectronicsCapability, ElectronicsContext, ElectronicsEngine, ElectronicsGraph, ElectronicsResult } from './engine.types';

/** What the files say about the board, read once for every step. Counts are per uploaded file set (a panel when 2-up). */
export interface BoardCounts {
  surfaceMount: number;
  surfaceSides: number;
  uniqueSurfaceFootprints: number;
  throughHoleParts: number;
  throughHoleJoints: number;
  lengthMm: number;
  widthMm: number;
}

export function boardCounts(graph: BoardFeatureGraph): BoardCounts {
  return {
    surfaceMount: graph.placements.reduce((n, p) => n + p.count, 0),
    surfaceSides: new Set(graph.placements.map((p) => p.side)).size,
    uniqueSurfaceFootprints: new Set(graph.placements.map((p) => p.footprint ?? `${p.side}:${p.packageClass}`)).size,
    throughHoleParts: graph.thtParts.reduce((n, t) => n + t.count, 0),
    throughHoleJoints: graph.thtParts.reduce((n, t) => n + t.count * t.jointsPerPart, 0),
    lengthMm: graph.outline.lengthMm,
    widthMm: graph.outline.widthMm,
  };
}

type StepTime =
  | { ok: true; secondsPerBoard: number; setupSecondsPerBatch?: number; trace: CalculationTraceStep[] }
  | { ok: false; reason: string; requiredCapability: string };

interface StepDefinition {
  id: AssemblyStepId;
  label: string;
  /** Engine input keys (stated in the scenario or a confirmed reference row) the time needs. */
  inputKeys: readonly string[];
  applies(c: BoardCounts): boolean;
  time(c: BoardCounts, v: Record<string, number>, boardsInFiles: number): StepTime;
}

const input = (fieldName: string, displayLabel: string, value: number, unit: string, source: string): CalculationTraceStep => ({ fieldName, displayLabel, kind: 'input', value, unit, source });
const calc = (fieldName: string, displayLabel: string, value: number, unit: string, formula: string): CalculationTraceStep => ({ fieldName, displayLabel, kind: 'calculated', value, unit, formula });
const GRAPH = 'feature graph (copper, drill and Pick Place files)';

export const STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    id: 'stencil_print_spi',
    label: 'Stencil print + SPI',
    inputKeys: ['stencil_print.cycle_time', 'spi.cycle_time'],
    applies: (c) => c.surfaceMount > 0,
    time: (c, v, b) => {
      const s = (c.surfaceSides * (v['stencil_print.cycle_time'] + v['spi.cycle_time'])) / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('surfaceSides', 'Sides printed', c.surfaceSides, 'sides', GRAPH),
        calc('secondsPerBoard', 'Print + SPI time per board', s, 's', 'surfaceSides * (printCycle + spiCycle) / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'pick_and_place',
    label: 'Pick and place',
    inputKeys: ['smt_placement.rated_cph', 'smt_placement.cph_derating'],
    applies: (c) => c.surfaceMount > 0,
    time: (c, v, b) => {
      const derating = v['smt_placement.cph_derating'];
      if (derating > 1) return { ok: false, reason: `the CPH derating ratio is ${derating}; a derating is at most 1`, requiredCapability: 'State the effective share of the rated speed (for example 0.6).' };
      const effective = v['smt_placement.rated_cph'] * derating;
      const s = (c.surfaceMount / effective) * 3600 / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('placements', 'Surface-mount placements in the files', c.surfaceMount, 'parts', `${GRAPH}; every Pick Place row that is not a through-hole part`),
        calc('effectiveCph', 'Effective placements per hour', effective, 'placements/h', 'ratedCph * derating (one ratio for every package class)'),
        calc('secondsPerBoard', 'Placement time per board', s, 's', 'placements / effectiveCph * 3600 / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'reflow',
    label: 'Reflow',
    inputKeys: ['reflow.conveyor_speed'],
    applies: (c) => c.surfaceMount > 0,
    time: (c, v, b) => {
      const s = (c.surfaceSides * c.lengthMm / v['reflow.conveyor_speed']) * 60 / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('lengthMm', 'Length through the oven (outline as uploaded)', c.lengthMm, 'mm', GRAPH),
        input('passes', 'Reflow passes (sides with surface-mount parts)', c.surfaceSides, 'passes', GRAPH),
        calc('secondsPerBoard', 'Conveyor time per board', s, 's', 'passes * lengthMm / conveyorSpeed * 60 / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'aoi',
    label: 'AOI (post-reflow)',
    inputKeys: ['aoi.inspection_speed'],
    applies: (c) => c.surfaceMount > 0,
    time: (c, v, b) => {
      const area = c.lengthMm * c.widthMm;
      const s = (c.surfaceSides * area / v['aoi.inspection_speed']) / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('areaMm2', 'Inspected area (outline envelope as uploaded)', area, 'mm2', GRAPH),
        calc('secondsPerBoard', 'Inspection time per board', s, 's', 'surfaceSides * area / inspectionSpeed / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'tht_insertion',
    label: 'THT insertion (manual)',
    inputKeys: ['tht_insertion.time_per_part'],
    applies: (c) => c.throughHoleParts > 0,
    time: (c, v, b) => {
      const s = (c.throughHoleParts * v['tht_insertion.time_per_part']) / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('throughHoleParts', 'Through-hole parts in the files', c.throughHoleParts, 'parts', `${GRAPH}; mount type read from plated holes at the part pins`),
        calc('secondsPerBoard', 'Insertion time per board', s, 's', 'throughHoleParts * timePerPart / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'selective_solder',
    label: 'Selective / hand solder',
    inputKeys: ['solder.time_per_joint'],
    applies: (c) => c.throughHoleJoints > 0,
    time: (c, v, b) => {
      const s = (c.throughHoleJoints * v['solder.time_per_joint']) / b;
      return { ok: true, secondsPerBoard: s, trace: [
        input('joints', 'Through-hole joints in the files', c.throughHoleJoints, 'joints', GRAPH),
        calc('secondsPerBoard', 'Solder time per board', s, 's', 'joints * timePerJoint / boardsInFiles'),
      ] };
    },
  },
  {
    id: 'depanel',
    label: 'Depanel (router)',
    inputKeys: ['depanel_router.cutting_speed', 'depanel.route_length_per_board_mm'],
    applies: () => true, // decided per scenario: only when the files hold more than one board
    time: (_c, v) => {
      const s = v['depanel.route_length_per_board_mm'] / v['depanel_router.cutting_speed'];
      return { ok: true, secondsPerBoard: s, trace: [
        calc('secondsPerBoard', 'Routing time per board', s, 's', 'routeLengthPerBoard / cuttingSpeed'),
      ] };
    },
  },
  {
    id: 'line_setup',
    label: 'Line setup',
    inputKeys: ['setup.line_changeover', 'setup.feeder_load'],
    applies: (c) => c.surfaceMount > 0,
    time: (c, v) => {
      const s = (v['setup.line_changeover'] + v['setup.feeder_load'] * c.uniqueSurfaceFootprints) * 60;
      return { ok: true, secondsPerBoard: 0, setupSecondsPerBatch: s, trace: [
        input('feeders', 'Feeders to load (distinct surface-mount footprints)', c.uniqueSurfaceFootprints, 'feeders', GRAPH),
        calc('setupSecondsPerBatch', 'Setup time per batch', s, 's', '(lineChangeover + feederLoad * feeders) * 60'),
      ] };
    },
  },
];

// A stated scenario value outranks a confirmed reference row for the same key: the scenario is what this quote is for.
function readInput(rates: RateBook, key: string): RateEntry | undefined {
  const all = rates.entries.filter((e) => e.kind === 'reference' && e.key === key);
  return all.find((e) => e.scope === 'scenario') ?? (all.length === 1 ? all[0] : undefined);
}

export function boardsInFiles(graph: BoardFeatureGraph, rates: RateBook): { value: number; source: string } | null {
  if (graph.panel) return { value: graph.panel.boardsPerPanel, source: 'supplied with the upload (panel.boardsPerPanel)' };
  const stated = readInput(rates, 'panel.boards_in_files');
  return stated ? { value: stated.value, source: stated.sourceRef } : null;
}

const positive = (v: number) => Number.isFinite(v) && v > 0;

export class AssemblyStepEngine implements ElectronicsEngine<BoardCounts | null> {
  readonly processFamily = 'electronics';
  readonly id: AssemblyStepId;
  readonly processLabel: string;

  constructor(private readonly step: StepDefinition) {
    this.id = step.id;
    this.processLabel = step.label;
  }

  applies(graph: ElectronicsGraph): boolean {
    return graph.kind === 'board' && this.step.applies(boardCounts(graph));
  }

  inputs(graph: ElectronicsGraph): BoardCounts | null {
    return graph.kind === 'board' ? boardCounts(graph) : null;
  }

  checkCapability(): ElectronicsCapability {
    return { capable: true };
  }

  private gap(reason: string, requiredCapability: string): ElectronicsResult {
    const g: PhysicsGap = { gapType: 'unsupported_operation', process: this.step.label, machineClass: this.step.id, reason, requiredCapability };
    return { status: 'gap', gap: g };
  }

  computeCost(ctx: ElectronicsContext<BoardCounts | null>): ElectronicsResult {
    const { graph, input: counts, batchSize, rates, scenario } = ctx;
    if (graph.kind !== 'board' || !counts) return this.gap('Not a board graph.', 'A board feature graph.');
    if (!scenario) return this.gap('No scenario was given with this quote.', 'Set the location, machines and inputs in the Scenario tab and calculate again.');

    const boards = boardsInFiles(graph, rates);
    if (!boards) return this.gap('How many boards the uploaded files hold is not stated.', `State "${SCENARIO_FACT_KEYS['panel.boards_in_files'].label}" in the Scenario.`);
    if (this.step.id === 'depanel' && boards.value <= 1) return { status: 'skipped' };

    const machine = this.machine(scenario, rates);
    if ('reason' in machine) return this.gap(machine.reason, machine.required);

    const values: Record<string, number> = {};
    const used: RateEntry[] = [];
    const missing: string[] = [];
    for (const key of this.step.inputKeys) {
      const entry = readInput(rates, key);
      if (!entry || !positive(entry.value)) missing.push(key);
      else { values[key] = entry.value; used.push(entry); }
    }
    if (missing.length > 0) return this.gap(`Missing input${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`, 'State each value in the Scenario with where it comes from (datasheet, line study, quote).');

    const time = this.step.time(counts, values, boards.value);
    if (!time.ok) return this.gap(time.reason, time.requiredCapability);

    const m = machine.machine;
    const crew = m.mhrPerHour + m.lhrPerHour * m.operators;
    const runCost = (time.secondsPerBoard / 3600) * crew;
    const setupCost = time.setupSecondsPerBatch ? ((time.setupSecondsPerBatch / 3600) * crew) / batchSize : 0;
    const machineRates: RateEntry[] = [
      { kind: 'machine_rate', key: 'mhr_usd_per_hour', scope: m.name, value: m.mhrPerHour, unit: 'usd/h', currency: m.currency, sourceRef: `mhr_records:${m.recordId}`, recordId: m.recordId, recordVersion: m.recordVersion, recordedAt: m.recordedAt },
      ...(m.operators > 0 ? [{ kind: 'labour_rate' as const, key: 'lhr_usd_per_hour', scope: m.name, value: m.lhrPerHour, unit: 'usd/h', currency: m.currency, sourceRef: `mhr_records:${m.recordId}`, recordId: m.recordId, recordVersion: m.recordVersion, recordedAt: m.recordedAt }] : []),
    ];
    const inputTrace = used.map((e) => input(e.key, e.key, e.value, e.unit, e.sourceRef));
    return {
      status: 'costed',
      ratesUsed: [...used, ...machineRates],
      line: {
        process: this.step.label,
        setupCost,
        runCost,
        totalCost: setupCost + runCost,
        cycleTimeMin: time.secondsPerBoard / 60,
        setupTimeMin: (time.setupSecondsPerBatch ?? 0) / 60,
        setupTimeSource: time.setupSecondsPerBatch ? 'calculator' : 'none',
        operators: m.operators,
        hourlyRate: m.mhrPerHour,
        labourRate: m.lhrPerHour,
        rateSource: 'mhr_database',
        machineClass: m.machineClass,
        machineName: m.name,
        commodityCode: null,
        mhrId: m.recordId,
        calculationTrace: [
          input('boardsInFiles', 'Boards in the uploaded files', boards.value, 'boards', boards.source),
          ...inputTrace,
          ...time.trace,
          calc('crewHourlyCost', 'Machine + crew rate', crew, 'usd/h', 'mhr + lhr * operators'),
          calc('runCostPerBoard', 'Run cost per board', runCost, 'usd', 'secondsPerBoard / 3600 * crewHourlyCost'),
          ...(time.setupSecondsPerBatch ? [calc('setupCostPerBoard', 'Setup cost per board', setupCost, 'usd', 'setupSecondsPerBatch / 3600 * crewHourlyCost / batchSize')] : []),
        ],
      },
    };
  }

  private machine(scenario: ElectronicsScenario, rates: RateBook): { machine: MachineCandidate } | { reason: string; required: string } {
    const id = scenario.machines[this.step.id];
    if (!id) return { reason: `No machine is chosen for ${this.step.label}.`, required: 'Pick the HR Rates machine that runs this step in the Scenario.' };
    const m = (rates.machines ?? []).find((c) => c.recordId === id);
    if (!m) return { reason: 'The chosen HR Rates machine was not found (deleted, or not visible to this organisation).', required: 'Pick the machine again in the Scenario.' };
    if (m.location.trim().toLowerCase() !== scenario.location.trim().toLowerCase()) {
      return { reason: `${m.name} is a ${m.location} machine; the scenario location is ${scenario.location}.`, required: `Pick a ${scenario.location} machine, or change the location.` };
    }
    if (!positive(m.mhrPerHour)) return { reason: `${m.name} has no machine-hour rate in HR Rates.`, required: 'Enter its machine-hour rate in HR Rates, or pick another machine.' };
    if (m.operators > 0 && !positive(m.lhrPerHour)) return { reason: `${m.name} has ${m.operators} operator(s) but no labour rate in HR Rates.`, required: 'Enter its labour rate in HR Rates, or pick another machine.' };
    return { machine: m };
  }
}

// The two material lines of a PCBA. Both are stated prices (the bare board from the fabricator's quote, the components
// from BOM pricing); the platform computes neither.
export class StatedMaterialEngine implements ElectronicsEngine<null> {
  readonly processFamily = 'electronics';

  constructor(readonly id: 'bare_pcb' | 'components', private readonly key: 'bare_pcb.price_per_board' | 'components.cost_per_board', readonly processLabel: string) {}

  applies(graph: ElectronicsGraph): boolean {
    return graph.kind === 'board';
  }

  inputs(): null {
    return null;
  }

  checkCapability(): ElectronicsCapability {
    return { capable: true };
  }

  computeCost(ctx: ElectronicsContext<null>): ElectronicsResult {
    const entry = readInput(ctx.rates, this.key);
    if (!entry || !positive(entry.value)) {
      const g: PhysicsGap = { gapType: 'unsupported_operation', process: this.processLabel, machineClass: this.id, reason: `${SCENARIO_FACT_KEYS[this.key].label} is not stated.`, requiredCapability: 'State it in the Scenario with its source.' };
      return { status: 'gap', gap: g };
    }
    return {
      status: 'costed',
      ratesUsed: [entry],
      line: {
        process: this.processLabel,
        setupCost: 0,
        runCost: entry.value,
        totalCost: entry.value,
        cycleTimeMin: 0,
        hourlyRate: 0,
        rateSource: 'no_db_rate',
        machineClass: this.id,
        machineName: null,
        commodityCode: null,
        calculationTrace: [input(this.key, SCENARIO_FACT_KEYS[this.key].label, entry.value, 'usd/board', entry.sourceRef)],
      },
    };
  }
}

export const ASSEMBLY_ENGINES: readonly ElectronicsEngine<any>[] = [
  new StatedMaterialEngine('bare_pcb', 'bare_pcb.price_per_board', 'Bare PCB (fab quote)'),
  new StatedMaterialEngine('components', 'components.cost_per_board', 'Components (BOM pricing)'),
  ...STEP_DEFINITIONS.map((d) => new AssemblyStepEngine(d)),
];

export interface ScenarioStepOption {
  id: AssemblyStepId;
  label: string;
  /** Whether the board's extracted features call for this step (depanel only when the files hold more than one board). */
  applies: boolean;
  inputs: { key: string; unit: string; requiredSource: string }[];
}

export interface ScenarioOptions {
  steps: ScenarioStepOption[];
  facts: { key: string; unit: string; label: string; integer: boolean }[];
  counts: BoardCounts;
}

// What the Scenario tab offers for one board: every assembly step with whether it applies and the inputs it reads
// (unit and the source that would close it, from the engine-input ledger), and the scenario facts.
export function scenarioOptions(graph: BoardFeatureGraph, ledger: readonly { inputs: readonly { key: string; unit: string; requiredSource: string }[] }[]): ScenarioOptions {
  const counts = boardCounts(graph);
  const describe = (key: string) => {
    for (const engine of ledger) for (const i of engine.inputs) if (i.key === key) return { key, unit: i.unit, requiredSource: i.requiredSource };
    const fact = SCENARIO_FACT_KEYS[key as keyof typeof SCENARIO_FACT_KEYS];
    return { key, unit: fact?.unit ?? '', requiredSource: fact?.label ?? key };
  };
  return {
    steps: STEP_DEFINITIONS.map((d) => ({ id: d.id, label: d.label, applies: d.applies(counts), inputs: d.inputKeys.map(describe) })),
    facts: Object.entries(SCENARIO_FACT_KEYS).map(([key, f]) => ({ key, unit: f.unit, label: f.label, integer: f.integer })),
    counts,
  };
}
