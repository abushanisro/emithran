import type { ElectronicsFeatureGraph } from './contract';

/** The few numbers a list row shows for a design, read straight from its feature graph (nothing is estimated). */
export type GraphSummary =
  | {
      kind: 'board';
      /** True when the files carried placements (a PCBA); false for a bare PCB. */
      assembled: boolean;
      layers: number;
      lengthMm: number;
      widthMm: number;
      thicknessMm: number | null;
      holeCount: number;
      placementCount: number;
      unresolvedCount: number;
    }
  | { kind: 'harness'; circuitCount: number; connectorCount: number; unresolvedCount: number };

export function summarizeGraph(graph: ElectronicsFeatureGraph): GraphSummary {
  if (graph.kind === 'board') {
    return {
      kind: 'board',
      assembled: graph.placements.length > 0,
      layers: graph.layers,
      lengthMm: graph.outline.lengthMm,
      widthMm: graph.outline.widthMm,
      thicknessMm: graph.outline.thicknessMm ?? null,
      holeCount: (graph.holes ?? []).reduce((n, h) => n + h.count, 0),
      placementCount: graph.placements.reduce((n, p) => n + p.count, 0),
      unresolvedCount: graph.unresolved.length,
    };
  }
  return { kind: 'harness', circuitCount: graph.circuits.length, connectorCount: graph.connectors.length, unresolvedCount: graph.unresolved.length };
}
