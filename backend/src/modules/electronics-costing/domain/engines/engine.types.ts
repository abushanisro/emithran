import type { ManufacturingProcessEngine } from '../../../bom-items/costing/shared/core/manufacturing-process.types';
import type { PhysicsGap, ProcessLineCost } from '../../../bom-items/dto/cost-breakdown.dto';
import type { BoardFeatureGraph, HarnessFeatureGraph } from '../feature-graph/contract';
import type { SpecResolution } from '../bare-pcb/spec';
import type { ElectronicsScenario } from '../scenario/scenario';
import type { RateBook, RateEntry } from '../rates/rate-book';

// Canonical process ids, closed. A new process is one new member here plus one engine file.
export const ELECTRONICS_PROCESS_IDS = [
  'foundation_probe',
  'pcb_fab_drilling',
  'bare_pcb',
  'components',
  'stencil_print_spi',
  'pick_and_place',
  'reflow',
  'aoi',
  'tht_insertion',
  'selective_solder',
  'depanel',
  'line_setup',
] as const;
export type ElectronicsProcessId = (typeof ELECTRONICS_PROCESS_IDS)[number];

export type ElectronicsGraph = BoardFeatureGraph | HarnessFeatureGraph;

// What an engine is handed: the graph, the input it picked for itself, and the rate book it may
// read. A rate the book does not hold is a gap, never a default.
export interface ElectronicsContext<TInput> {
  graph: ElectronicsGraph;
  input: TInput;
  batchSize: number;
  rates: RateBook;
  /** The bare-board specification a person supplied, when the quote is for a board; engines report a gap without it. */
  spec?: SpecResolution;
  /** The costing scenario sent with the quote: location, the HR Rates machine per step, stated inputs. */
  scenario?: ElectronicsScenario;
}

// One engine run: exactly one of line / gap. A missing input is a PhysicsGap,
// never a zero-cost line (the repo-wide "no silent zero" rule).
export type ElectronicsResult =
  // ratesUsed: every rate entry the line was computed from, so the quote can cite them.
  | { status: 'costed'; line: ProcessLineCost; ratesUsed: RateEntry[] }
  | { status: 'gap'; gap: PhysicsGap }
  // The step does not apply to this scenario (for example depanelling a file that holds a single board).
  | { status: 'skipped' };

export interface ElectronicsCapability {
  capable: boolean;
  reason?: string;
}

// The kernel's own ManufacturingProcessEngine, specialised through its generic
// parameters. machineClass is omitted on purpose: MachineClass is keyed off
// MACHINE_REGISTRY, which gains SMT/reflow/crimp rows in Phase 2 together with their
// sourced rates. An engine joins the platform registry then, with no signature change.
export type ElectronicsEngine<TInput = unknown> = Omit<
  ManufacturingProcessEngine<ElectronicsContext<TInput>, ElectronicsResult, ElectronicsGraph, ElectronicsCapability>,
  'machineClass'
> & {
  readonly id: ElectronicsProcessId;
  applies(graph: ElectronicsGraph): boolean;
  inputs(graph: ElectronicsGraph): TInput;
};
