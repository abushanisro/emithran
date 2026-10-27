import { computeDrilling, DRILLING_MACHINE_CLASS } from '../bare-pcb/drilling';
import { computePanelLayout } from '../bare-pcb/panel';
import { findRates } from '../rates/rate-book';

import type { PhysicsGap } from '../../../bom-items/dto/cost-breakdown.dto';
import type { RateEntry } from '../rates/rate-book';
import type { ElectronicsCapability, ElectronicsContext, ElectronicsEngine, ElectronicsGraph, ElectronicsResult } from './engine.types';

const PROCESS_LABEL = 'PCB drilling';
export const DRILLING_RATE_KEY = 'pcb.drillingRate_circuitHoles';

export interface DrillingEngineInput {
  /** Drilled hits on one board, or null when the graph carries no drill data. */
  hitsPerBoard: number | null;
}

const gap = (reason: string, requiredCapability: string): ElectronicsResult => {
  const g: PhysicsGap = { gapType: 'unsupported_operation', process: PROCESS_LABEL, machineClass: DRILLING_MACHINE_CLASS, reason, requiredCapability };
  return { status: 'gap', gap: g };
};

// Bare-board circuit-hole drilling. Reads the board's real drill hits, the supplied panel and location, the staged
// hole rate and the capable machines at that location. Anything missing is a gap that says what would close it.
export class PcbFabDrillingEngine implements ElectronicsEngine<DrillingEngineInput> {
  readonly id = 'pcb_fab_drilling' as const;
  readonly processFamily = 'electronics';
  readonly processLabel = PROCESS_LABEL;

  applies(graph: ElectronicsGraph): boolean {
    return graph.kind === 'board';
  }

  inputs(graph: ElectronicsGraph): DrillingEngineInput {
    if (graph.kind !== 'board' || !graph.holes || graph.holes.length === 0) return { hitsPerBoard: null };
    return { hitsPerBoard: graph.holes.reduce((sum, h) => sum + h.count, 0) };
  }

  checkCapability(): ElectronicsCapability {
    return { capable: true };
  }

  computeCost(ctx: ElectronicsContext<DrillingEngineInput>): ElectronicsResult {
    const { graph, input, batchSize, rates, spec } = ctx;
    if (graph.kind !== 'board') return gap('Not a board graph.', 'A board feature graph.');
    if (!spec) return gap('No bare-board specification has been supplied.', 'Supply the bare-board specification (stack-up, panel, finish, volumes, location).');
    if (spec.status === 'incomplete') {
      return gap(
        `The bare-board specification is incomplete: ${spec.problems.map((p) => `${p.field} (${p.reason})`).join('; ')}.`,
        'Complete the missing specification fields.',
      );
    }
    if (input.hitsPerBoard === null || input.hitsPerBoard <= 0) {
      return gap('The board has no drill data (no Excellon holes were extracted).', 'Upload the Excellon drill file for this board.');
    }

    const rateEntries = findRates(rates, DRILLING_RATE_KEY, 'pcb');
    const distinctValues = new Set(rateEntries.map((e) => e.value));
    if (rateEntries.length === 0) {
      return gap(`No drilling hole rate (${DRILLING_RATE_KEY}) is staged.`, 'Stage the PCB reference variables (memory/PCBA/pcb_variables.csv).');
    }
    if (distinctValues.size > 1) {
      return gap(`The drilling hole rate (${DRILLING_RATE_KEY}) has conflicting staged values: ${[...distinctValues].join(', ')}.`, 'Resolve the duplicate staged variable.');
    }
    const holeRate = rateEntries[0];

    const s = spec.spec;
    const layout = computePanelLayout(
      { lengthMm: graph.outline.lengthMm, widthMm: graph.outline.widthMm, areaMm2: graph.outline.areaMm2 },
      s.panel.value,
    );
    if (layout.status === 'does_not_fit') return gap(layout.reason, 'Supply a panel the board fits on.');

    const wanted = s.location.value.trim().toLowerCase();
    const machines = (rates.machines ?? []).filter((m) => m.location.trim().toLowerCase() === wanted);
    const result = computeDrilling({
      hitsPerBoard: input.hitsPerBoard,
      boardsPerPanel: layout.boardsPerPanel,
      panelLengthMm: s.panel.value.lengthMm,
      panelWidthMm: s.panel.value.widthMm,
      hitsPerSecond: holeRate.value,
      batchSize,
      machines,
    });
    if (result.status === 'gap') {
      return gap(`${result.reason} (location ${s.location.value}).`, `Add ${DRILLING_MACHINE_CLASS} machines with a table size for this location, or choose a smaller panel.`);
    }

    const m = result.chosen.machine;
    const machineRates: RateEntry[] = [
      { kind: 'machine_rate', key: 'mhr_usd_per_hour', scope: m.name, value: m.mhrPerHour, unit: 'usd/h', currency: m.currency, sourceRef: `mhr_records:${m.recordId}`, recordId: m.recordId, recordVersion: m.recordVersion, recordedAt: m.recordedAt },
      { kind: 'labour_rate', key: 'lhr_usd_per_hour', scope: m.name, value: m.lhrPerHour, unit: 'usd/h', currency: m.currency, sourceRef: `mhr_records:${m.recordId}`, recordId: m.recordId, recordVersion: m.recordVersion, recordedAt: m.recordedAt },
    ];
    const c = result.chosen;
    return {
      status: 'costed',
      ratesUsed: [holeRate, ...machineRates],
      line: {
        process: PROCESS_LABEL,
        setupCost: c.setupCostPerBoard,
        runCost: c.runCostPerBoard,
        totalCost: c.totalCostPerBoard,
        cycleTimeMin: result.secondsPerBoard / 60,
        setupTimeMin: m.setupTimeHr * 60,
        setupTimeSource: 'machine',
        operators: m.operators,
        hourlyRate: m.mhrPerHour,
        labourRate: m.lhrPerHour,
        rateSource: 'mhr_database',
        machineClass: DRILLING_MACHINE_CLASS,
        machineName: m.name,
        commodityCode: null,
        mhrId: m.recordId,
        calculationTrace: [
          { fieldName: 'hitsPerBoard', displayLabel: 'Drilled hits per board', kind: 'input', value: input.hitsPerBoard, source: 'Excellon holes (feature graph)' },
          { fieldName: 'boardsPerPanel', displayLabel: 'Boards per panel', kind: 'input', value: layout.boardsPerPanel, unit: 'boards', source: `rectangular grid, ${layout.orientation}, utilization ${(layout.utilization * 100).toFixed(2)}%` },
          { fieldName: 'hitsPerSecond', displayLabel: 'Drilling rate', kind: 'input', value: holeRate.value, unit: 'holes/s', source: holeRate.sourceRef },
          { fieldName: 'secondsPerPanel', displayLabel: 'Drilling time per panel', kind: 'calculated', value: result.secondsPerPanel, unit: 's', formula: 'hitsPerBoard * boardsPerPanel / hitsPerSecond' },
          { fieldName: 'crewHourlyCost', displayLabel: 'Machine + crew rate', kind: 'calculated', value: result.crewHourlyCost, unit: 'usd/h', formula: 'mhr + lhr * operators', source: `mhr_records:${m.recordId}` },
          { fieldName: 'runCostPerBoard', displayLabel: 'Run cost per board', kind: 'calculated', value: c.runCostPerBoard, unit: 'usd', formula: 'secondsPerPanel / 3600 * crewHourlyCost / boardsPerPanel' },
          { fieldName: 'setupCostPerBoard', displayLabel: 'Setup cost per board', kind: 'calculated', value: c.setupCostPerBoard, unit: 'usd', formula: 'setupTimeHr * crewHourlyCost / batchSize' },
          ...result.assumptions.map((a, i) => ({ fieldName: `assumption_${i + 1}`, displayLabel: 'Assumption', kind: 'input' as const, value: a })),
        ],
        machineChoice: undefined,
      },
    };
  }
}
