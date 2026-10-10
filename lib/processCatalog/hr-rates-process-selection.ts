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

/** The fields these rules read — real mhr_records rows carry all of them. */
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

/** A picker's options with its current value kept in them.
 *
 *  A Select renders blank when its value matches none of its items, and the
 *  options above come from the loaded rows: while they load, or when a search,
 *  location or retired machine leaves no row for the chosen value, the choice
 *  vanishes from the control although it is still in effect. Keeping it listed
 *  keeps it visible. */
export function optionsKeepingSelection(options: readonly string[], selected: string): string[] {
  return selected && !options.includes(selected) ? [...options, selected].sort() : [...options];
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
  return [...buildHrRatesIndex(rows).categoriesOf(processGroup)];
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
  return new Set(buildHrRatesIndex(rows).machineClassesOf(processGroup, category));
}

/**
 * The Process and Category a saved line's machine_class is in, for a line with
 * no linked machine to read them off (e.g. an inspection line whose resource
 * HR Rates does not price).
 *
 * The reverse of categoryMachineClassesOf: the rows of that class, within the
 * line's Process when it has one. Each field is returned only when those rows
 * agree on a single value — a class spread over several categories names none
 * of them, and the engineer picks.
 */
export function selectionForMachineClass(
  rows: readonly MachineRowForSelection[],
  machineClass: string,
  processGroup: string,
): { processGroup?: string; category?: string } {
  return buildHrRatesIndex(rows).selectionForMachineClass(machineClass, processGroup);
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

/**
 * The catalog rows that name a machine class's route/operation: its active
 * rows, or — when it has none — its inactive ones. is_active means "a
 * calculator is wired", not "this route exists" (Black Oxide: one real row,
 * no calculator yet). A class with active rows ignores its inactive ones
 * (deactivated duplicates). Same rule as the backend's identityRows.
 */
export function identityMappings<T extends { isActive?: boolean }>(mappingsForClass: readonly T[]): T[] {
  const active = mappingsForClass.filter((m) => m.isActive);
  return active.length > 0 ? active : [...mappingsForClass];
}

// ─── The index ──────────────────────────────────────────────────────────────
//
// Every question above is answered from one structure built in a single pass
// over the rows, instead of re-filtering every row per question. Each row's
// group and category are resolved once; after that every picker lookup is a
// Map read. It is held in both directions because the pickers ask both ways:
// Process -> Category -> machine classes (the cascade), and machine class ->
// Process -> Category (opening a saved line with no machine).
//
// Build it once per loaded row set (useMemo on the rows) and read every picker
// from it, so all of them come from the same snapshot of HR Rates.

export interface HrRatesIndex {
  /** Process groups, sorted. */
  readonly processGroups: readonly string[];
  /** Categories within a process group, sorted; empty for an unknown group. */
  categoriesOf(processGroup: string): readonly string[];
  /** The machine classes a Process + Category resolves to. */
  machineClassesOf(processGroup: string, category: string): ReadonlySet<string>;
  /** See the selectionForMachineClass wrapper above. */
  selectionForMachineClass(machineClass: string, processGroup: string): { processGroup?: string; category?: string };
}

const NO_CLASSES: ReadonlySet<string> = new Set();

type Nested = Map<string, Map<string, Set<string>>>;

function addNested(map: Nested, a: string, b: string, c: string): void {
  let inner = map.get(a);
  if (!inner) map.set(a, (inner = new Map()));
  let leaf = inner.get(b);
  if (!leaf) inner.set(b, (leaf = new Set()));
  leaf.add(c);
}

/** The single member of a set, or undefined when it has none or several. */
function only<T>(values: Iterable<T>): T | undefined {
  let found: T | undefined;
  let count = 0;
  for (const v of values) {
    if (++count > 1) return undefined;
    found = v;
  }
  return found;
}

export function buildHrRatesIndex(rows: readonly MachineRowForSelection[]): HrRatesIndex {
  // group -> category -> machine classes
  const byGroup: Nested = new Map();
  // machine class -> group -> categories
  const byClass: Nested = new Map();

  for (const row of rows) {
    const group = effectiveProcessGroupOf(row);
    if (group === '-') continue;
    const category = mhrCategoryOf(row);
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    if (category === '-') continue;
    if (!byGroup.get(group)!.has(category)) byGroup.get(group)!.set(category, new Set());
    if (row.machineClass) {
      addNested(byGroup, group, category, row.machineClass);
      addNested(byClass, row.machineClass, group, category);
    }
  }

  const processGroups = [...byGroup.keys()].sort();
  const sortedCategories = new Map<string, readonly string[]>();
  for (const [group, categories] of byGroup) sortedCategories.set(group, [...categories.keys()].sort());

  return {
    processGroups,
    categoriesOf: (processGroup) => sortedCategories.get(processGroup) ?? [],
    machineClassesOf: (processGroup, category) => byGroup.get(processGroup)?.get(category) ?? NO_CLASSES,
    selectionForMachineClass(machineClass, processGroup) {
      const groups = machineClass ? byClass.get(machineClass) : undefined;
      if (!groups) return {};
      const group = processGroup || only(groups.keys());
      if (!group) return {};
      const category = only(groups.get(group) ?? []);
      return { processGroup: group, ...(category ? { category } : {}) };
    },
  };
}
