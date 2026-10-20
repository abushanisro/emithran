import type { ElectronicsEngine, ElectronicsGraph } from '../engines/engine.types';

export interface RoutedOperation {
  engine: ElectronicsEngine<any>;
  input: unknown;
}

// "Route first, cost the route": the graph decides which registered engines apply.
// Pure, so routing is testable without a database or a queue.
export function routeGraph(
  graph: ElectronicsGraph,
  registry: readonly ElectronicsEngine<any>[],
): RoutedOperation[] {
  return registry.filter((e) => e.applies(graph)).map((engine) => ({ engine, input: engine.inputs(graph) }));
}
