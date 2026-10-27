import type { MachineCandidate } from '../rates/rate-book';

// Circuit-hole drilling of a bare board, costed per finished board. Pure: every rate, speed and machine arrives as
// an input read from the rate book. The drilling speed is one hole-hit rate per machine (the staged variable
// drillingRate_circuitHoles states "holes per second by the drilling machine"); head count is NOT multiplied in,
// because nothing in the source says the rate is per head. The result reports that assumption.

export const DRILLING_MACHINE_CLASS = 'drill_circuit_holes';

export interface DrillingInput {
  /** Every drilled hit on one board (plated and non-plated), from the Excellon files. */
  hitsPerBoard: number;
  boardsPerPanel: number;
  panelLengthMm: number;
  panelWidthMm: number;
  hitsPerSecond: number;
  batchSize: number;
  machines: readonly MachineCandidate[];
}

export interface DrillingCandidate {
  machine: MachineCandidate;
  capable: boolean;
  /** Why the machine was rejected; absent when capable. */
  reason?: string;
  /** Per finished board; present only for capable machines. */
  runCostPerBoard?: number;
  setupCostPerBoard?: number;
  totalCostPerBoard?: number;
}

type CostedCandidate = DrillingCandidate & { runCostPerBoard: number; setupCostPerBoard: number; totalCostPerBoard: number };

export type DrillingResult =
  | {
      status: 'costed';
      chosen: CostedCandidate;
      candidates: DrillingCandidate[];
      hitsPerPanel: number;
      panelsPerBatch: number;
      secondsPerPanel: number;
      secondsPerBoard: number;
      crewHourlyCost: number;
      assumptions: string[];
    }
  | { status: 'gap'; reason: string; candidates: DrillingCandidate[] };

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Round money to a fixed number of places so the same inputs always give byte-identical results.
const money = (v: number) => Math.round(v * 1e6) / 1e6;

function capability(machine: MachineCandidate, panelLengthMm: number, panelWidthMm: number): string | undefined {
  const tl = machine.specs['table_length_mm'];
  const tw = machine.specs['table_width_mm'];
  if (!finitePositive(tl) || !finitePositive(tw)) return 'no table size on file for this machine';
  const fits = (panelLengthMm <= tl && panelWidthMm <= tw) || (panelLengthMm <= tw && panelWidthMm <= tl);
  return fits ? undefined : `panel ${panelLengthMm} x ${panelWidthMm} mm exceeds the ${tl} x ${tw} mm table`;
}

export function computeDrilling(input: DrillingInput): DrillingResult {
  for (const [name, v] of Object.entries({
    hitsPerBoard: input.hitsPerBoard,
    boardsPerPanel: input.boardsPerPanel,
    panelLengthMm: input.panelLengthMm,
    panelWidthMm: input.panelWidthMm,
    hitsPerSecond: input.hitsPerSecond,
    batchSize: input.batchSize,
  })) {
    if (!finitePositive(v)) throw new RangeError(`${name} must be a positive number, got ${v}`);
  }
  if (!Number.isInteger(input.boardsPerPanel) || !Number.isInteger(input.batchSize)) {
    throw new RangeError('boardsPerPanel and batchSize must be whole numbers');
  }

  const hitsPerPanel = input.hitsPerBoard * input.boardsPerPanel;
  const secondsPerPanel = hitsPerPanel / input.hitsPerSecond;
  const panelsPerBatch = Math.ceil(input.batchSize / input.boardsPerPanel);

  const candidates: DrillingCandidate[] = input.machines
    .filter((m) => m.machineClass === DRILLING_MACHINE_CLASS)
    .map((machine) => {
      const reason = capability(machine, input.panelLengthMm, input.panelWidthMm);
      if (reason) return { machine, capable: false, reason };
      const crewHourly = machine.mhrPerHour + machine.lhrPerHour * machine.operators;
      const runCostPerBoard = money(((secondsPerPanel / 3600) * crewHourly) / input.boardsPerPanel);
      const setupCostPerBoard = money((machine.setupTimeHr * crewHourly) / input.batchSize);
      return { machine, capable: true, runCostPerBoard, setupCostPerBoard, totalCostPerBoard: money(runCostPerBoard + setupCostPerBoard) };
    });

  const capable = candidates.filter((c): c is CostedCandidate => c.capable);
  if (capable.length === 0) {
    return {
      status: 'gap',
      reason: candidates.length === 0 ? `no ${DRILLING_MACHINE_CLASS} machine is available for this location` : 'no available drilling machine can take this panel',
      candidates,
    };
  }
  // Cheapest per board; equal cost falls to the name, so the choice is reproducible.
  const chosen = [...capable].sort((a, b) => a.totalCostPerBoard - b.totalCostPerBoard || a.machine.name.localeCompare(b.machine.name))[0];
  return {
    status: 'costed',
    chosen,
    candidates,
    hitsPerPanel,
    panelsPerBatch,
    secondsPerPanel,
    secondsPerBoard: secondsPerPanel / input.boardsPerPanel,
    crewHourlyCost: chosen.machine.mhrPerHour + chosen.machine.lhrPerHour * chosen.machine.operators,
    assumptions: [
      'Drilling speed is the staged per-machine hole rate; the machine head count is not applied.',
      'Every drilled hit is costed as a circuit hole; registration holes are not separated.',
      'No drilling yield is applied: none is sourced.',
    ],
  };
}
