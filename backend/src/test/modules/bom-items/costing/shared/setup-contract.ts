import { findRouteDataGaps, type RouteDataGapLine } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';

/**
 * The setup-time rule every family engine obeys, asserted the same way for each:
 *  - a machine with a setup time on file puts it on the line, from the machine, and the route has no setup gap;
 *  - a machine with none leaves the line without a setup time (never 0 with source 'none'), so the route is a data gap and cannot be applied.
 * A family engine's own spec calls this with its lines for both cases; a new family is held to the same rule by adding the call.
 */
export function expectSetupContract(
  lines: readonly (RouteDataGapLine & { setupTimeSource?: string | null })[],
  setupOnFile: boolean,
  process: string,
): void {
  const line = lines.find((l) => l.process === process);
  if (!line) throw new Error(`no "${process}" line among ${lines.map((l) => l.process).join(', ')}`);
  const setupGaps = findRouteDataGaps(lines).filter((g) => g.process === process && /setup time/.test(g.reason));
  if (setupOnFile) {
    expect(line.setupTimeMin).toBeGreaterThan(0);
    expect(line.setupTimeSource).toBe('machine');
    expect(setupGaps).toEqual([]);
  } else {
    expect(line.setupTimeMin == null).toBe(true);
    expect(setupGaps).toHaveLength(1);
  }
}
