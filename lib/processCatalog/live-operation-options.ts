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
}

export interface LiveOperationOption {
  value: string;
  label: string;
  detail: string | null;
  cycleTimeMin: number;
}

/** Operations of the live lines that run on one of `machineClasses`, one per line
 *  name, sorted by label. `featureTypeByOperation` adds the catalog feature type
 *  to a label ("Drilling // SimpleHole") when the catalog pairs one with it. */
export function liveOperationOptions(
  lines: readonly LiveOperationLine[],
  machineClasses: ReadonlySet<string>,
  featureTypeByOperation: ReadonlyMap<string, string>,
): LiveOperationOption[] {
  const byValue = new Map<string, LiveOperationOption>();
  for (const line of lines) {
    if (!machineClasses.has(line.machineClass) || byValue.has(line.process)) continue;
    const featureType = featureTypeByOperation.get(line.process);
    const features = (line.featureBreakdown ?? []).map((f) => f.name);
    byValue.set(line.process, {
      value: line.process,
      label: featureType ? `${line.process} // ${featureType}` : line.process,
      detail: features.length > 0 ? features.join(', ') : null,
      cycleTimeMin: line.cycleTimeMin,
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
  if (!savedOperation || lines.some((l) => l.process === savedOperation)) return savedOperation;
  const onClass = new Set(lines.filter((l) => l.machineClass === savedMachineClass).map((l) => l.process));
  return onClass.size === 1 ? [...onClass][0]! : savedOperation;
}
