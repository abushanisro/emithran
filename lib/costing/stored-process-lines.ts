// ── Snapshot staleness ────────────────────────────────────────────────────────
// Mirrors `findStaleInputKeys` in
// backend/src/modules/bom-items/costing/shared/physics/costing-inputs.ts —
// deliberately a mirror, not an import: the frontend and backend are separate
// builds, and this repo already mirrors the costing DTOs across that boundary
// the same way. Both sides must agree, so keep the rule identical: a key is
// stale iff the persisted value is PRESENT and differs. A null/absent persisted
// value is unknown, never stale — otherwise every legacy row that predates the
// column would light up as outdated.
//
// Only batchSize and location are compared: they are the two costing inputs a
// process_cost_records row itself persists, and the two that change a per-part
// process line. Annual volume and production life drive tooling amortisation,
// which is not a process cost record.
//
// What each side DOES about a stale key is not mirrored, and should not be: this
// function only answers "which inputs differ". The display policy that follows
// from that lives in UNREPAIRABLE_INPUT_KEYS below.

export type StaleInputKey = 'batchSize' | 'location';

export function findStaleInputKeys(
  persisted: { batchSize?: number | null; location?: string | null },
  effective: { batchSize: number; location: string | null },
): StaleInputKey[] {
  const stale: StaleInputKey[] = [];

  const persistedBatch = Number(persisted.batchSize);
  if (Number.isFinite(persistedBatch) && persistedBatch >= 1 && Math.floor(persistedBatch) !== effective.batchSize) {
    stale.push('batchSize');
  }

  const persistedLocation = typeof persisted.location === 'string' ? persisted.location.trim() : '';
  if (persistedLocation.length > 0 && effective.location !== null && persistedLocation !== effective.location) {
    stale.push('location');
  }

  return stale;
}

// Per-part cost of a saved process_cost_records row, and whether that saved row
// still describes the scenario currently being viewed.
//
// Extracted verbatim from the Cost Guide, which computed this arithmetic TWICE —
// once for the grand total and once per rendered row — with a comment admitting
// the two had to be kept in step by hand:
//
//   "Must use the exact same live-data preference as the per-row display below
//    ... otherwise this grand total silently disagrees with what the individual
//    rows show and their percentages stop summing to 100%."
//
// One function now feeds both, so they cannot diverge.
//
// The one behavioural change is the setup denominator. It used to be the batch
// size FROZEN INTO THE SAVED ROW, so after changing Batch Size the header read
// "batch 10,000" while every row below still amortised over "÷ 100,000". It is
// now the current effective batch — identical whenever the row is not stale,
// and honest when it is. Which total actually gets used is decided separately by
// selectProcessTotal: a snapshot computed under different inputs never overrides
// the fresh engine result.

/** A saved process_cost_records row, as the process-costs API returns it. */
export interface StoredProcessRow {
  id?: string;
  machineClass?: string | null;
  machineName?: string | null;
  mhrId?: string | null;
  machineRate?: number | null;
  laborRate?: number | null;
  setupTime?: number | null;
  setupManning?: number | null;
  batchSize?: number | null;
  location?: string | null;
  cycleTime?: number | null;
  heads?: number | null;
  partsPerCycle?: number | null;
  scrap?: number | null;
}

/** Only the parts of a live engine line this module needs. */
export interface EngineLineLite {
  machineClass?: string | null;
  cycleTimeMin: number;
  machineSelection?: {
    overridden?: boolean;
    balanced?: { candidate?: { hourlyRate: number; machineName?: string | null } | null } | null;
  } | null;
}

/**
 * The live machine recommendation carried by a caller's own engine-line type.
 * Resolving it here rather than re-deriving it at the call site keeps the
 * "a saved machine link wins over the live star" trust rule in one place —
 * consumers that need a field this module does not model (machineId, capability,
 * availability) read it off this candidate instead of recomputing the rule.
 */
export type LiveCandidateOf<L extends EngineLineLite> =
  | NonNullable<NonNullable<NonNullable<L['machineSelection']>['balanced']>['candidate']>
  | null;

export interface ResolvedStoredLine<
  L extends EngineLineLite = EngineLineLite,
  R extends StoredProcessRow = StoredProcessRow,
> {
  row: R;
  /**
   * The live engine line for the same machine class, when one exists. Typed as
   * the CALLER's line type, not the lite shape: the Cost Guide row renderer
   * needs the full line (feature breakdown, calculation trace, the machine
   * picker's alternatives) from the same match this module already performed.
   */
  matchedEngineLine: L | null;
  /** A saved machine link is a deliberate pick, so it wins over the live recommendation. */
  hasSavedMachine: boolean;
  /** Live star recommendation, used only when the row was never given a machine. */
  liveMachineName: string | null;
  /** The same recommendation as a whole, for fields this module does not model. */
  liveCandidate: LiveCandidateOf<L>;

  machineRate: number;
  laborRate: number;
  setupMin: number;
  setupManning: number;
  cycleSec: number;
  heads: number;
  partsPerCycle: number;
  scrap: number;

  /** Batch the cost below is amortised over — the CURRENT effective batch. */
  batchSize: number;
  /** Batch this row was saved at, when known. Differs from batchSize iff stale. */
  persistedBatchSize: number | null;

  setupPerPart: number;
  cyclePerPart: number;
  /** setup + cycle, with scrap applied — the row's contribution per part. */
  totalPerPart: number;

  /** Which of this snapshot's own costing inputs no longer match the scenario. */
  staleInputKeys: StaleInputKey[];
}

export interface EffectiveCostingInputs {
  batchSize: number;
  location: string | null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolves every saved row against the live engine lines and the current
 * effective costing inputs.
 *
 * Live-data preference is preserved exactly as the Cost Guide had it, and the
 * two halves of it are deliberately asymmetric:
 *
 * CYCLE TIME — live always wins when a matching engine line exists. It is an
 * INPUT field on the saved row, not something any cost formula derives, so it
 * is whatever was last written there and goes stale the moment the CAD
 * geometry-driven cycle-time formula improves — while the feature breakdown
 * displayed beside it is always recomputed from current geometry. `is_override`
 * is NOT a usable signal for gating this: every record saved via
 * ProcessCostDialog gets `is_override = true` unconditionally (confirmed
 * directly against the DB), which made an is_override gate a no-op for every
 * manually-saved line, i.e. effectively all of them. The stored value is used
 * only when the machine class has no live engine counterpart at all (e.g. Hand
 * Deburring with no linked machine_class).
 *
 * MACHINE — the saved link wins instead. A machine is not a derived formula
 * output; it is a deliberate pick made through Edit Process Cost or the machine
 * picker, and that flow writes a real, current machine. The live star
 * recommendation is taken only when the row was never given a machine at all
 * (an AI/geometry-generated line with NULL machine fields — the original bug
 * this fallback exists for).
 */
export function resolveStoredProcessLines<
  L extends EngineLineLite,
  R extends StoredProcessRow,
>(
  rows: readonly R[],
  engineLines: readonly L[],
  effective: EffectiveCostingInputs,
): ResolvedStoredLine<L, R>[] {
  const batchSize = Math.max(num(effective.batchSize, 1), 1);

  return rows.map((row) => {
    const matchedEngineLine = engineLines.find(
      (l) => l.machineClass && row.machineClass && l.machineClass === row.machineClass,
    ) ?? null;

    const liveCycleSec = matchedEngineLine ? matchedEngineLine.cycleTimeMin * 60 : null;
    const hasSavedMachine = Boolean(row.mhrId) || Boolean(row.machineName);
    const liveCandidate = (!hasSavedMachine && !matchedEngineLine?.machineSelection?.overridden)
      ? matchedEngineLine?.machineSelection?.balanced?.candidate ?? null
      : null;

    const machineRate = hasSavedMachine
      ? num(row.machineRate)
      : (liveCandidate ? num(liveCandidate.hourlyRate) : num(row.machineRate));
    const laborRate = num(row.laborRate);
    const setupMin = num(row.setupTime);
    const setupManning = Math.max(num(row.setupManning, 1), 1);
    const cycleSec = liveCycleSec ?? num(row.cycleTime);
    const heads = Math.max(num(row.heads, 1), 1);
    const partsPerCycle = Math.max(num(row.partsPerCycle, 1), 1);
    const scrap = num(row.scrap);

    const setupPerPart = ((setupMin / 60) * (machineRate + laborRate * setupManning)) / batchSize;
    const cyclePerPart = ((cycleSec / 3600) * (machineRate + laborRate * heads)) / partsPerCycle;

    const persistedBatchSize = Number.isFinite(Number(row.batchSize)) && Number(row.batchSize) >= 1
      ? Math.floor(Number(row.batchSize))
      : null;

    return {
      row,
      matchedEngineLine,
      hasSavedMachine,
      liveMachineName: hasSavedMachine ? null : (liveCandidate?.machineName ?? null),
      liveCandidate: liveCandidate ?? null,
      machineRate, laborRate, setupMin, setupManning, cycleSec, heads, partsPerCycle, scrap,
      batchSize,
      persistedBatchSize,
      setupPerPart,
      cyclePerPart,
      totalPerPart: (setupPerPart + cyclePerPart) * (1 + scrap / 100),
      staleInputKeys: findStaleInputKeys(
        { batchSize: row.batchSize ?? null, location: row.location ?? null },
        { batchSize, location: effective.location },
      ),
    };
  });
}

/** Sum of every saved row's per-part contribution, in the same units as the rows. */
export function totalStoredProcessCost(
  lines: readonly ResolvedStoredLine[],
): number {
  return lines.reduce((sum, l) => sum + l.totalPerPart, 0);
}

export type ProcessTotalSource = 'none' | 'stored' | 'engine';

/**
 * Costing inputs a saved row CANNOT be re-derived for, so a mismatch invalidates
 * the whole row rather than being repaired in place.
 *
 * `location` is the only one. A row persists rates — machine hourly rate, labour
 * rate — that were resolved against that location's rate tables when the route
 * was applied. Nothing on the row makes it possible to re-resolve them for a
 * different location, so a row saved for USA cannot be shown as an India cost;
 * only the engine can answer that, and it must win.
 *
 * `batchSize` is deliberately NOT here. The row persists the setup MINUTES and
 * the rates separately from the denominator, so resolveStoredProcessLines simply
 * re-amortises setup over the current effective batch — the mismatch is repaired,
 * not merely detected. Forcing the engine total on a batch change instead would
 * make the grand total disagree with the very rows displayed beneath it, whose
 * percentages are taken against that total; keeping those two in agreement is
 * the reason this module exists.
 */
const UNREPAIRABLE_INPUT_KEYS: readonly StaleInputKey[] = ['location'];

export interface ProcessTotalSelection {
  total: number;
  source: ProcessTotalSource;
  /** Every input on which a saved row differs from the current scenario. */
  staleInputKeys: StaleInputKey[];
  /** The subset that could not be repaired, and so forced the engine result. */
  blockingInputKeys: StaleInputKey[];
}

/**
 * The ONE precedence rule for which process total a quote shows.
 *
 * - No committed material record -> $0. Every process parameter (laser speed,
 *   press-brake tonnage, LHR derating) derives from the material, so without one
 *   there is no basis for any figure. Unchanged behaviour.
 * - Saved rows whose mismatches were all repairable -> the saved rows win,
 *   re-amortised over the current effective batch.
 * - Saved rows stale on an UNREPAIRABLE input -> the fresh engine result wins. A
 *   snapshot priced against another location answers a different question and
 *   must not override a calculation made under the current inputs.
 */
export function selectProcessTotal(args: {
  hasStoredMaterial: boolean;
  storedLines: readonly ResolvedStoredLine[];
  engineTotalProcess: number;
}): ProcessTotalSelection {
  const { hasStoredMaterial, storedLines, engineTotalProcess } = args;

  if (!hasStoredMaterial) {
    return { total: 0, source: 'none', staleInputKeys: [], blockingInputKeys: [] };
  }
  // No applied route -> no process cost. This used to fall through to the live
  // engine estimate, so a part with a material but no applied route showed a
  // quote built from operations the user had never applied — every row labelled
  // "not saved", each carrying a figure, all of them summed into the grand
  // total. Confirmed live: $0.14 of "not saved" process cost inside a $0.19
  // total. The chain is route -> Apply -> persisted records -> Cost Guide;
  // nothing earlier in it may price the part.
  if (storedLines.length === 0) {
    return { total: 0, source: 'none', staleInputKeys: [], blockingInputKeys: [] };
  }

  const staleInputKeys = [...new Set(storedLines.flatMap((l) => l.staleInputKeys))];
  const blockingInputKeys = staleInputKeys.filter((k) => UNREPAIRABLE_INPUT_KEYS.includes(k));

  if (blockingInputKeys.length > 0) {
    return { total: engineTotalProcess, source: 'engine', staleInputKeys, blockingInputKeys };
  }

  return {
    total: totalStoredProcessCost(storedLines),
    source: 'stored',
    staleInputKeys,
    blockingInputKeys: [],
  };
}
