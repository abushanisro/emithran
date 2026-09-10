import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';

// The ONE set of rules for reading a Process / Category / machine selection out
// of the HR Rates database (mhr_records).
//
// Both surfaces that present this data use these functions: the HR Rates page
// itself (grouping and filtering its table) and Edit Process Cost (its Process
// and Category pickers, and the Machine list under them). That is the whole
// point of the module — before it, each surface derived "what process group is
// this row in" its own way, and they disagreed.
//
// Every rule here encodes a real property of the data that is easy to get
// subtly wrong and impossible to see going wrong: the failure mode is always a
// machine silently missing from a list, or one from an unrelated process
// silently present in it.

/** The fields these rules read. Real mhr_records rows carry all of them;
 *  mhr_benchmark_rates rows carry only machineClass, which is why they are
 *  matched by class (see benchmarkMatchesCategory) rather than by category. */
export interface MachineRowForSelection {
  machineClass?: string | undefined;
  benchmarkSourceKey?: string | undefined;
  processGroup?: string | null | undefined;
  commodityCode?: string | null | undefined;
}

/**
 * The process group a row is REALLY in, as displayed.
 *
 * `process_group` alone is not it. Only migrations 130, 646/647 and 694 ever
 * populated that column, each for a specific set of rows; everything imported
 * before them carries the group in `commodity_code` instead. Reading
 * process_group alone drops the overwhelming majority of real Sheet Metal rows
 * — which is also exactly why neither surface may push a process-group filter
 * down to the server, whose filter is an exact `process_group = ...` match with
 * no knowledge of this fallback. Filter on this value client-side instead.
 */
export function effectiveProcessGroupOf(row: MachineRowForSelection): string {
  return row.processGroup || row.commodityCode || '-';
}

/** Real distinct process groups AS DISPLAYED, for a Process picker.
 *
 *  Deliberately derived from the loaded rows rather than from the
 *  /mhr/process-groups endpoint, which queries only the real process_group
 *  column and therefore misses every commodity-code-only group. */
export function processGroupOptionsFrom(rows: readonly MachineRowForSelection[]): string[] {
  const groups = rows.map(effectiveProcessGroupOf).filter((g) => g !== '-');
  return [...new Set(groups)].sort();
}

/** Real distinct machine categories within one process group, for a Category
 *  picker — the same grouping the HR Rates table shows its rows under.
 *
 *  Derived from the loaded rows for the same reason as above: the
 *  /mhr/categories endpoint scopes by the raw process_group column (with a
 *  machine_class fallback) and so cannot see a commodity-code-only group. */
export function categoryOptionsFrom(
  rows: readonly MachineRowForSelection[],
  processGroup: string,
): string[] {
  if (!processGroup) return [];
  const cats = rows
    .filter((r) => effectiveProcessGroupOf(r) === processGroup)
    .map((r) => mhrCategoryOf(r))
    .filter((c) => c !== '-');
  return [...new Set(cats)].sort();
}

/**
 * Does this real mhr_records row belong to the chosen Process + Category?
 *
 * Category is matched by `mhrCategoryOf`, the same resolver the HR Rates table
 * groups its rows with, so a category offered in the picker and the machines
 * shown for it cannot disagree.
 *
 * The group is matched too, because category names are not globally unique
 * ("Inspection" exists under more than one process group) and category alone
 * would let another group's machines through.
 */
export function matchesProcessAndCategory(
  row: MachineRowForSelection,
  processGroup: string,
  category: string,
): boolean {
  if (mhrCategoryOf(row) !== category) return false;
  return effectiveProcessGroupOf(row) === processGroup;
}

/**
 * The real machine_class values a chosen Category resolves to, read off the
 * rows that are actually in it — never assumed from the category name.
 *
 * machine_class is deliberately a many-categories-to-one-class cost-engine
 * grouping (migration 569 maps both "3D Laser Cutting Machine" and "Fiber Laser
 * Cutting Machine" onto fiber_laser), so the name-to-class direction is
 * ambiguous while the row-to-its-own-class direction is a fact. This reads the
 * direction that is a fact.
 */
export function categoryMachineClassesOf(
  rows: readonly MachineRowForSelection[],
  processGroup: string,
  category: string,
): Set<string> {
  const set = new Set<string>();
  if (!category) return set;
  for (const r of rows) {
    if (matchesProcessAndCategory(r, processGroup, category) && r.machineClass) {
      set.add(r.machineClass);
    }
  }
  return set;
}

/**
 * Does this mhr_benchmark_rates row belong to the chosen Category?
 *
 * Benchmark rows carry machine_class but NO benchmark_source_key, so
 * `mhrCategoryOf` would humanise the slug ("Roll Bending 3") and never match a
 * real category name ("3 Roll Bender") — silently hiding every benchmark
 * machine. They are matched on the real classes the category resolves to
 * instead: the same join by a different key, not a looser one.
 */
export function benchmarkMatchesCategory(
  row: MachineRowForSelection,
  categoryClasses: ReadonlySet<string>,
): boolean {
  if (categoryClasses.size === 0) return false;
  return !!row.machineClass && categoryClasses.has(row.machineClass);
}

/**
 * The catalog rows that could price a line, joined on machine_class — a real
 * column on both mhr_records and process_calculator_mappings, so this is a
 * genuine join and not a name match.
 */
export function calculatorMappingsForMachineClass<T extends { machineClass?: string }>(
  mappings: readonly T[],
  machineClass: string,
): T[] {
  if (!machineClass) return [];
  return mappings.filter((m) => m.machineClass === machineClass);
}

/**
 * The single authoritative catalog row for a machine class, or undefined when
 * the class is ambiguous.
 *
 * A class maps to several operations by design — press_brake covers both "Bend
 * Brake" and "Progressive Die Press", which are priced by genuinely different
 * formulas. Returning one of them would let a bent part be costed with a
 * stamping formula and show nothing on screen about it, so an ambiguous class
 * resolves to nothing and the caller surfaces the alternatives instead.
 */
export function unambiguousMapping<T>(mappingsForClass: readonly T[]): T | undefined {
  return mappingsForClass.length === 1 ? mappingsForClass[0] : undefined;
}
