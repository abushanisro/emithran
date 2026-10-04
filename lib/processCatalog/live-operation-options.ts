/**
 * The "3. Operation" choices of the Edit Process Cost dialog, derived from this
 * part's live cost-engine lines.
 *
 * One identity for an operation everywhere: the engine's own name for the line
 * (`process`). Every writer saves exactly that into process_cost_records.operation
 * (apply-route, the default-route path, the dialog itself), so a reopened line
 * finds its own option. `operation` on a line is NOT used: it is the catalog
 * identity of the machine class, shared by every line on that machine.
 *
 * A line's feature breakdown (e.g. "Drilling Ø4.0mm ×2") describes what that one
 * line costs; it is shown as the option's detail, never offered as a separate
 * operation the line could be saved under.
 */

export interface LiveOperationLine {
  process: string;
  machineClass: string;
  cycleTimeMin: number;
  featureBreakdown?: ReadonlyArray<{ name: string }>;
  /** Catalog operation per feature a forming line performs in one go (the
   *  casting line: "As Cast" on SimpleHole x 3, ...). */
  featureOperations?: ReadonlyArray<{ operation: string | null; featureType: string; instances: ReadonlyArray<unknown> }>;
}

export interface LiveOperationOption {
  value: string;
  label: string;
  detail: string | null;
  /** The line's cycle time; 0 for a catalog operation of a multi-operation line
   *  (the line's time belongs to the whole shot, not to one operation). */
  cycleTimeMin: number;
  /** The live line this option belongs to (its engine name). */
  lineProcess: string;
}

/** Operations of the live lines that run on one of `machineClasses`, sorted by
 *  label. One per line name; `featureTypeByOperation` adds the catalog feature
 *  type to a label ("Drilling // SimpleHole") when the catalog pairs one with it.
 *
 *  A line that performs several catalog operations at once (a die casting shot
 *  forms every feature: "No Coring // SimpleHole", "As Cast // Void", ...)
 *  offers each of those catalog operations, with its feature count, rather than
 *  its process name (which would only repeat the Category). They share the
 *  line's cost: the shot is one cycle, so no operation carries a time of its own. */
export function liveOperationOptions(
  lines: readonly LiveOperationLine[],
  machineClasses: ReadonlySet<string>,
  featureTypeByOperation: ReadonlyMap<string, string>,
): LiveOperationOption[] {
  const byValue = new Map<string, LiveOperationOption>();
  for (const line of lines) {
    if (!machineClasses.has(line.machineClass) || byValue.has(line.process)) continue;
    const features = (line.featureBreakdown ?? []).map((f) => f.name);
    const detail = features.length > 0 ? features.join(', ') : null;
    const catalogOps = catalogOperationsOf(line);
    if (catalogOps.length > 0) {
      for (const c of catalogOps) {
        if (byValue.has(c.operation)) continue;
        byValue.set(c.operation, { value: c.operation, label: `${c.operation} [${c.count}]`, detail, cycleTimeMin: 0, lineProcess: line.process });
      }
      continue;
    }
    const featureType = featureTypeByOperation.get(line.process);
    byValue.set(line.process, {
      value: line.process,
      label: featureType ? `${line.process} // ${featureType}` : line.process,
      detail,
      cycleTimeMin: line.cycleTimeMin,
      lineProcess: line.process,
    });
  }
  return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The live operation a saved line stands for.
 *
 * Its saved name, when a live line still has it. Otherwise — a line written
 * before every writer saved the engine's line name, when apply-route stored the
 * machine class's catalog name ("CMM Inspection" for the "Inspection" line) —
 * the only identity it carries is its machine_class: when exactly one live line
 * runs on that class, that line is it. Several lines on the class name none of
 * them, and the saved name is returned unchanged for the engineer to re-pick.
 */
export function resolveSavedOperation(
  lines: readonly LiveOperationLine[],
  savedOperation: string,
  savedMachineClass: string,
): string {
  if (!savedOperation) return savedOperation;
  // A catalog operation of a multi-operation line is an operation as saved.
  if (lines.some((l) => catalogOperationsOf(l).some((c) => c.operation === savedOperation))) return savedOperation;
  // A multi-operation line's own process name is not one of its operations:
  // nothing is pre-selected, the engineer picks the operation.
  if (lines.some((l) => l.process === savedOperation && catalogOperationsOf(l).length > 0)) return '';
  if (lines.some((l) => l.process === savedOperation)) return savedOperation;
  const onClass = new Set(lines.filter((l) => l.machineClass === savedMachineClass).map((l) => l.process));
  return onClass.size === 1 ? [...onClass][0]! : savedOperation;
}

/** "Op // Feature" with its instance count, for each catalog operation group of a line. */
function catalogOperationsOf(line: LiveOperationLine): Array<{ operation: string; count: number }> {
  const byOp = new Map<string, number>();
  for (const f of line.featureOperations ?? []) {
    const op = `${f.operation ?? 'Operation not determined'} // ${f.featureType}`;
    byOp.set(op, (byOp.get(op) ?? 0) + f.instances.length);
  }
  return [...byOp].map(([operation, count]) => ({ operation, count }));
}
