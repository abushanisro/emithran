import {
  resolveScenarioBatchSize,
  resolveScenarioLocation,
  resolveScenarioProductionLifeYears,
} from './scenario-overrides';

// ── The canonical costing-input resolution layer ──────────────────────────────
//
// One place that answers "what batch size / location / annual volume /
// production life is THIS costing request actually being computed at", and the
// ONLY place a default for any of them is written.
//
// Root cause this exists to remove (traced 2026-09-06): each costing entry
// point read these inputs ad-hoc, with its own fallback, so the same logical
// input had several different values depending on which line of code asked:
//   - batchSize      `batchSize ? parseInt(batchSize, 10) : 1` at the controller,
//                    but useState(250) on the Cost Guide — two different
//                    "defaults" for one input.
//   - annualVolume   `((item as any).annualVolume ...) ?? undefined` in one
//                    place, `?? null` in another, and `?? 10_000` in a third.
//   - productionLife `productionLifeYears: 5` hardcoded at three call sites,
//                    while the UI presented it as an editable field that
//                    reached nothing.
//
// The flow is now: UI draft -> Apply/commit -> persisted scenario input ->
// THIS resolver -> costing engine -> fresh result -> UI. Consumers receive a
// resolved value and never apply a fallback of their own.
//
// Deliberately pure and Nest-free so the whole priority chain is unit-testable
// without a database, matching scenario-overrides.ts's own convention.

/**
 * The ONLY place a costing-input default is written.
 *
 * `batchSize: 1` — an unset batch must be obvious rather than silently
 * amortising setup across an order size nobody chose. This is the value the API
 * has always returned to every other consumer; the Cost Guide's own
 * `useState(250)` was a second, conflicting default and is removed.
 *
 * `productionLifeYears: 5` — preserves the figure the three costing call sites
 * hardcoded before this layer existed, so a scenario with no production-life
 * override prices exactly as it did. Kept here for that backward compatibility
 * and nowhere else.
 *
 * There is deliberately NO annualVolume default: `bom_items.annual_volume` is
 * the authoritative source, and a part with no real volume on file must report
 * that rather than be priced against an invented one.
 */
/**
 * Production runs per year — the planning rule that turns a part's annual volume
 * into a batch size (annual volume / 4, i.e. quarterly releases).
 *
 * A scheduling policy, not manufacturing data: it does not describe a machine,
 * a material or a process, and it is overridden the moment anyone sets a real
 * batch size on the scenario. Named here so the one place that applies it is
 * also the one place it can be changed.
 */
export const BATCHES_PER_YEAR = 4;

export const COSTING_INPUT_DEFAULTS = {
  batchSize: 1,
  productionLifeYears: 5,
} as const;

/**
 * Where a resolved value actually came from. Returned rather than inferred, so
 * a consumer can tell a real persisted figure from a fallback — and so a
 * disclosure ("no annual volume on file") is driven by provenance instead of by
 * probing for a sentinel value.
 */
export type CostingInputSource =
  | 'request'           // explicit query parameter on this costing call
  | 'scenario_override' // persisted bom_items.scenario_overrides key
  | 'item_column'       // the bom_items row's own real column
  | 'derived'           // computed from another real input on this item
  | 'default'           // COSTING_INPUT_DEFAULTS
  | 'absent';           // no real value anywhere — the resolved value is null

export interface CostingInputProvenance {
  batchSize: CostingInputSource;
  location: CostingInputSource;
  annualVolume: CostingInputSource;
  productionLifeYears: CostingInputSource;
}

export interface CostingInputs {
  readonly batchSize: number;
  readonly location: string | null;
  /** null when no real annual volume is on file — never a fabricated figure. */
  readonly annualVolume: number | null;
  readonly productionLifeYears: number;
  /**
   * The batch size this item's own annual volume implies, whether or not it won
   * the resolution above — null when there is no real annual volume to derive
   * from.
   *
   * Exposed so a UI can say "a saved override of 125,000 is suppressing the
   * 3,750 your annual volume implies" WITHOUT re-implementing the rule.
   * BATCHES_PER_YEAR is a scheduling policy that must live in exactly one
   * place; a component that divides by 4 itself is a second copy of it that
   * will silently disagree the day the policy changes.
   *
   * This is disclosure only. It is never the resolved value — `batchSize`
   * above is, and `provenance.batchSize` says which tier produced it.
   */
  readonly derivedBatchSize: number | null;
  readonly provenance: CostingInputProvenance;
}

export interface ResolveCostingInputsArgs {
  /** Explicit values supplied on this costing request (query params). */
  requested?: {
    batchSize?: number | null;
    location?: string | null;
    productionLifeYears?: number | null;
  } | null;
  /** bom_items.scenario_overrides — the persisted scenario. */
  scenarioOverrides?: Record<string, unknown> | null;
  /** The bom_items row, for columns that are authoritative in their own right. */
  item?: { annualVolume?: number | null } | null;
}

function positiveInt(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolves every costing input for one request, in strict
 * most-explicit-real-source-first order.
 *
 * | input               | chain                                                        |
 * |---------------------|--------------------------------------------------------------|
 * | batchSize           | request -> scenario override -> default (1)                   |
 * | location            | request -> scenario override -> absent                         |
 * | annualVolume        | bom_items.annual_volume -> absent                              |
 * | productionLifeYears | request -> scenario override -> default (5)                    |
 *
 * `annualVolume` deliberately has no request or override tier: the column is
 * the single source of truth and is read by many other screens, so a
 * per-scenario copy would let them disagree.
 */
export function resolveCostingInputs(args: ResolveCostingInputsArgs): CostingInputs {
  const { requested, scenarioOverrides, item } = args;

  // ── annual volume ──────────────────────────────────────────────────────────
  // Resolved first: batch size derives from it below.
  const columnAnnualVolume = positiveInt(item?.annualVolume);
  const annualVolume = columnAnnualVolume;
  const annualVolumeSource: CostingInputSource = columnAnnualVolume !== null ? 'item_column' : 'absent';

  // ── batch size ─────────────────────────────────────────────────────────────
  // request -> saved scenario -> derived from annual volume -> canonical default.
  //
  // The derived tier is the shop's own planning rule: a year's demand is
  // released in BATCHES_PER_YEAR runs, so an item that states a real annual
  // volume starts at a real batch size instead of 1. It is a derivation from
  // this item's own data, not a guess, and provenance says so ('derived') so it
  // is never mistaken for a figure someone entered.
  const requestedBatch = positiveInt(requested?.batchSize);
  const overrideBatch = resolveScenarioBatchSize(scenarioOverrides);
  const derivedBatch = annualVolume !== null
    ? Math.max(1, Math.ceil(annualVolume / BATCHES_PER_YEAR))
    : null;
  const batchSize = requestedBatch ?? overrideBatch ?? derivedBatch ?? COSTING_INPUT_DEFAULTS.batchSize;
  const batchSource: CostingInputSource =
    requestedBatch !== null ? 'request'
      : overrideBatch !== null ? 'scenario_override'
        : derivedBatch !== null ? 'derived'
          : 'default';

  // ── location ───────────────────────────────────────────────────────────────
  const requestedLocation = nonEmptyString(requested?.location);
  const overrideLocation = resolveScenarioLocation(scenarioOverrides);
  const location = requestedLocation ?? overrideLocation;
  const locationSource: CostingInputSource =
    requestedLocation !== null ? 'request' : overrideLocation !== null ? 'scenario_override' : 'absent';

  // ── production life ────────────────────────────────────────────────────────
  const requestedLife = positiveNumber(requested?.productionLifeYears);
  const overrideLife = resolveScenarioProductionLifeYears(scenarioOverrides);
  const productionLifeYears = requestedLife ?? overrideLife ?? COSTING_INPUT_DEFAULTS.productionLifeYears;
  const lifeSource: CostingInputSource =
    requestedLife !== null ? 'request' : overrideLife !== null ? 'scenario_override' : 'default';

  return {
    batchSize,
    location,
    annualVolume,
    productionLifeYears,
    derivedBatchSize: derivedBatch,
    provenance: {
      batchSize: batchSource,
      location: locationSource,
      annualVolume: annualVolumeSource,
      productionLifeYears: lifeSource,
    },
  };
}

// ── Persisted-snapshot staleness ──────────────────────────────────────────────
//
// A process_cost_records row is a snapshot of what one operation cost under the
// inputs in force when the route was applied. When those inputs no longer match
// the scenario being viewed, the snapshot describes a different question and
// must not override the freshly computed engine result.
//
// Only batch size and location are compared: they are the two costing inputs
// the row itself persists, and they are the two that change a per-part process
// line. Annual volume and production life drive tooling amortisation, which is
// not a process_cost_record, so no extra column is needed to decide staleness.

export type StaleInputKey = 'batchSize' | 'location';

export interface PersistedCostingInputs {
  batchSize?: number | null;
  location?: string | null;
}

/**
 * Which of a persisted snapshot's own costing inputs no longer match the
 * current effective ones.
 *
 * A persisted value of null/undefined is UNKNOWN, never stale — absence of
 * evidence is not evidence of staleness, and flagging it would mark every
 * legacy row that predates the column as outdated.
 */
export function findStaleInputKeys(
  persisted: PersistedCostingInputs,
  effective: Pick<CostingInputs, 'batchSize' | 'location'>,
): StaleInputKey[] {
  const stale: StaleInputKey[] = [];

  const persistedBatch = positiveInt(persisted.batchSize);
  if (persistedBatch !== null && persistedBatch !== effective.batchSize) stale.push('batchSize');

  const persistedLocation = nonEmptyString(persisted.location);
  if (
    persistedLocation !== null &&
    effective.location !== null &&
    persistedLocation !== effective.location
  ) {
    stale.push('location');
  }

  return stale;
}
