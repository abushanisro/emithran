import {
  applyPersistedRouteToSummary,
  selectAppliedGeneration,
  detectAppliedGenerationDrift,
  type AppliedProcessCostRecord,
} from '../../../modules/bom-items/costing/shared/core/cost-engine';
import type { CostSummaryDto } from '../../../modules/bom-items/dto/cost-breakdown.dto';
import { getProcessLabelForClass } from '../../../modules/bom-items/costing/shared/core/manufacturing-process-registry';

// An applied route is a COMPLETE costing snapshot: every persisted operation is
// authoritative, including the secondary ones the old overlay recomputed live.
//
// The fixtures below are the real generation measured on item 83e8d472
// (sm-standard-press, USA, batch 250), including the CMM row whose persisted
// machine_rate was 0 while the engine later resolved a $40/hr inspection bench.
// That single operation was the entire 0.18 gap between the persisted
// generation (1.033693) and what the Cost Guide reported (1.213693).
const TAG = 'auto_fill_from_route:sm-standard-press';

const row = (over: Partial<AppliedProcessCostRecord>): AppliedProcessCostRecord => ({
  machine_class: 'standard_press',
  machine_name: 'Standard Press - 3,000kN Press Force',
  mhr_id: 'mhr-sp-1',
  operation: 'std_press',
  process_group: 'Sheet Metal',
  process_route: 'Bending/Floating /Forming',
  cycle_time: 1.8,
  setup_time: 30,
  direct_rate: 99.47,
  setup_cost_per_part: 0.1782,
  total_cycle_cost_per_part: 0.049525,
  total_cost_per_part: 0.283693,
  op_nbr: 10,
  currency: 'USD',
  cost_currency_basis: 'local',
  batch_size: 250,
  location: 'USA',
  notes: TAG,
  ...over,
});

const GENERATION: AppliedProcessCostRecord[] = [
  row({}),
  row({
    op_nbr: 20, machine_class: 'deburring', machine_name: 'Default Deslag',
    operation: 'deslag', cycle_time: 19.62, setup_time: 0, direct_rate: 53.36,
    setup_cost_per_part: 0, total_cycle_cost_per_part: 0.24, total_cost_per_part: 0.3,
  }),
  row({
    op_nbr: 30, machine_class: 'pem_press', machine_name: 'PEM Insertion Press',
    operation: 'pem_insertion', cycle_time: 7.98, setup_time: 5, direct_rate: 74.17,
    setup_cost_per_part: 0.02, total_cycle_cost_per_part: 0.16, total_cost_per_part: 0.24,
  }),
  row({
    op_nbr: 40, machine_class: 'cmm', machine_name: null, mhr_id: null,
    operation: 'cmm_inspection', cycle_time: 16.2, setup_time: 0, direct_rate: 46.67,
    setup_cost_per_part: 0, total_cycle_cost_per_part: 0.21, total_cost_per_part: 0.21,
  }),
];

const PERSISTED_TOTAL = 0.283693 + 0.3 + 0.24 + 0.21; // 1.033693

const CTX = { summaryCurrency: 'USD', resolvedBatchSize: 250, resolvedLocation: 'USA' };

/**
 * A live summary whose secondary operations cost DIFFERENT amounts from the
 * persisted ones — the CMM line at 0.39, exactly the divergence measured in
 * production. If any of these leaks into the result, the hybrid model is back.
 */
const liveSummary = (): CostSummaryDto => ({
  processLines: [
    { process: 'Standard Press', machineClass: 'standard_press', machineName: 'live', cycleTimeMin: 0.03, setupCost: 0.1782, runCost: 0.049525, totalCost: 0.283693, hourlyRate: 99.47 },
    { process: 'Deburring', machineClass: 'deburring', machineName: 'live', cycleTimeMin: 0.327, setupCost: 0, runCost: 0.24, totalCost: 0.3, hourlyRate: 53.36 },
    { process: 'PEM Insertion', machineClass: 'pem_press', machineName: 'live', cycleTimeMin: 0.133, setupCost: 0.02, runCost: 0.16, totalCost: 0.24, hourlyRate: 74.17 },
    { process: 'Inspection', machineClass: 'cmm', machineName: 'Manual Inspection Bench (benchmark)', cycleTimeMin: 0.27, setupCost: 0, runCost: 0.39, totalCost: 0.39, hourlyRate: 86.67 },
  ],
  cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0.327, totalMin: 0.76 },
  totalProcessCost: 1.213693,
  materialCost: 0.0419,
  totalCost: 1.255593,
  warnings: [],
} as unknown as CostSummaryDto);

const overlay = (rows: AppliedProcessCostRecord[]) =>
  applyPersistedRouteToSummary(liveSummary(), rows, getProcessLabelForClass());

describe('applied generation is authoritative in full', () => {
  it('1. returns the PERSISTED cmm cost, not the freshly resolved one', () => {
    const out = overlay(GENERATION);
    const cmm = out.processLines.find((l) => l.machineClass === 'cmm')!;
    expect(cmm.totalCost).toBeCloseTo(0.21, 8);
    // 0.39 is what the live engine charges now that a $40/hr bench resolves.
    expect(cmm.totalCost).not.toBeCloseTo(0.39, 3);
    expect(out.totalProcessCost).toBeCloseTo(PERSISTED_TOTAL, 8);
  });

  it('2. a changed CMM machine rate does not move an applied quote', () => {
    // Same generation, two different "current" worlds: one where inspection
    // resolves no machine, one where it resolves a $40/hr bench at 0.39.
    const cheapWorld = liveSummary();
    const dearWorld = liveSummary();
    (dearWorld.processLines.find((l: { machineClass: string }) => l.machineClass === 'cmm') as { totalCost: number }).totalCost = 9.99;

    const a = applyPersistedRouteToSummary(cheapWorld, GENERATION, getProcessLabelForClass());
    const b = applyPersistedRouteToSummary(dearWorld, GENERATION, getProcessLabelForClass());
    expect(a.totalProcessCost).toBeCloseTo(b.totalProcessCost, 10);
    expect(b.processLines.find((l) => l.machineClass === 'cmm')!.totalCost).toBeCloseTo(0.21, 8);
  });

  it('3. deburring and PEM also come from the generation', () => {
    const out = overlay(GENERATION);
    const deb = out.processLines.find((l) => l.machineClass === 'deburring')!;
    const pem = out.processLines.find((l) => l.machineClass === 'pem_press')!;
    expect(deb.totalCost).toBeCloseTo(0.3, 8);
    expect(deb.machineName).toBe('Default Deslag');
    expect(pem.totalCost).toBeCloseTo(0.24, 8);
    expect(pem.setupCost).toBeCloseTo(0.02, 8);
    // Read straight from the columns -- not rate x time, not re-amortised.
    expect(pem.setupTimeMin).toBe(5);
    expect(pem.cycleTimeMin).toBeCloseTo(7.98 / 60, 8);
  });

  it('4. every persisted operation is represented, in op order', () => {
    const out = overlay(GENERATION);
    expect(out.processLines).toHaveLength(GENERATION.length);
    expect(out.processLines.map((l) => l.machineClass))
      .toEqual(['standard_press', 'deburring', 'pem_press', 'cmm']);
  });

  it('5. no core-class allowlist decides what is authoritative', () => {
    // cmm, deburring and pem_press are NOT route-core classes. Under the old
    // overlay they were never even fetched. A generation made only of
    // secondary operations must still be honoured in full.
    const secondaryOnly = GENERATION.filter((r) => r.machine_class !== 'standard_press');
    const out = overlay(secondaryOnly);
    expect(out.processLines).toHaveLength(3);
    expect(out.processLines.map((l) => l.machineClass)).toEqual(['deburring', 'pem_press', 'cmm']);
    expect(out.totalProcessCost).toBeCloseTo(0.3 + 0.24 + 0.21, 8);
    // Crucially the live standard_press line is gone: the generation, not the
    // classification, defines the quote.
    expect(out.processLines.find((l) => l.machineClass === 'standard_press')).toBeUndefined();
  });

  it('derives the time summary from the same rows as the cost summary', () => {
    const out = overlay(GENERATION);
    expect(out.cycleTimes.deburrMin).toBeCloseTo(19.62 / 60, 8);
    expect(out.cycleTimes.laserMin).toBe(0);
    expect(out.cycleTimes.pressBrakeMin).toBe(0);
    const expected = (1.8 + 19.62 + 7.98 + 16.2) / 60;
    expect(out.cycleTimes.totalMin).toBeCloseTo(expected, 2);
  });

  it('leaves the live summary untouched when there is no generation', () => {
    const live = liveSummary();
    expect(applyPersistedRouteToSummary(live, [], getProcessLabelForClass())).toEqual(live);
  });
});

describe('selectAppliedGeneration fails closed (6)', () => {
  it('accepts the real generation', () => {
    const v = selectAppliedGeneration(GENERATION, CTX);
    expect(v.usable).toBe(true);
    if (v.usable) {
      expect(v.rows.map((r) => r.op_nbr)).toEqual([10, 20, 30, 40]);
      expect(v.tag).toBe(TAG);
    }
  });

  it('rejects a generation with an uncosted operation rather than mixing', () => {
    const rows = [...GENERATION.slice(0, 3), row({ op_nbr: 40, machine_class: 'cmm', total_cost_per_part: null as unknown as number })];
    const v = selectAppliedGeneration(rows, CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/no persisted cost/);
  });

  it('rejects manually created rows -- a set of those is not a route snapshot', () => {
    const v = selectAppliedGeneration([...GENERATION, row({ op_nbr: 50, machine_class: 'tapping', notes: null })], CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/not written by applying a route/);
  });

  it('rejects rows spanning two generations', () => {
    const v = selectAppliedGeneration(
      [...GENERATION, row({ op_nbr: 50, notes: 'auto_fill_from_route:sm-laser' })], CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/span 2 generations/);
  });

  // Cost per part is a function of batch size, so a snapshot taken at another
  // batch answers a different question -- showing it would be as wrong as
  // recomputing it.
  it('rejects a snapshot costed at a different batch size', () => {
    const v = selectAppliedGeneration(GENERATION, { ...CTX, resolvedBatchSize: 1000 });
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/costed at batch 250, this request resolves batch 1000/);
  });

  it('rejects a snapshot from another location', () => {
    const v = selectAppliedGeneration(GENERATION, { ...CTX, resolvedLocation: 'India' });
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/differs from the requested India/);
  });

  it('rejects rows that disagree with each other on batch or location', () => {
    expect(selectAppliedGeneration([...GENERATION.slice(0, 3), row({ op_nbr: 40, batch_size: 500 })], CTX).usable).toBe(false);
    expect(selectAppliedGeneration([...GENERATION.slice(0, 3), row({ op_nbr: 40, location: 'China' })], CTX).usable).toBe(false);
  });

  it('rejects an empty set', () => {
    const v = selectAppliedGeneration([], CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/no active process cost records/);
  });
});

// 8. The currency contract from 707/708 and P1b-iv-a must not regress.
describe('currency and provenance are preserved (8)', () => {
  it('rejects a generation denominated in another currency', () => {
    const inr = GENERATION.map((r) => ({ ...r, currency: 'INR', cost_currency_local: 'INR' }));
    const v = selectAppliedGeneration(inr, CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/persisted in INR, summary computed in USD/);
  });

  it('rejects an unverified basis even when the currency label matches', () => {
    const legacy = GENERATION.map((r) => ({ ...r, cost_currency_basis: 'legacy_unverified' as const }));
    const v = selectAppliedGeneration(legacy, CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/unverified/);
  });

  it('rejects one bad row out of four -- all or nothing, never a blend', () => {
    const oneBad = [...GENERATION.slice(0, 3), row({ op_nbr: 40, machine_class: 'cmm', currency: 'INR' })];
    const v = selectAppliedGeneration(oneBad, CTX);
    expect(v.usable).toBe(false);
    if (!v.usable) expect(v.reason).toMatch(/op40 \(cmm\)/);
  });

  it('an accepted local-basis INR generation works when the summary is INR', () => {
    const inr = GENERATION.map((r) => ({ ...r, currency: 'INR', location: 'India' }));
    const v = selectAppliedGeneration(inr, { summaryCurrency: 'INR', resolvedBatchSize: 250, resolvedLocation: 'India' });
    expect(v.usable).toBe(true);
  });
});

// The root issue behind the 0.21 vs 0.39 CMM divergence: a snapshot records its
// inputs but nothing about the engine/rate state it was resolved under, so a
// stale generation is indistinguishable from a current one.
//
// Verified behaviourally on a scratch clone: today's writer persists the
// inspection benchmark link and its $40/hr rate correctly (benchmark_mhr_id
// bm-mhr-251, machine_rate 40, total 0.39). The production row holding 0.21 with
// machine_rate 0 and no machine link is therefore simply OLD -- written before
// that resolution worked.
//
// Freezing it silently is as wrong as recomputing it silently, so drift is
// detected and disclosed while the snapshot stays authoritative.
describe('stale snapshots are detected, not hidden', () => {
  const liveLines = liveSummary().processLines;

  it('detects the real CMM drift: persisted 0.21 against a current 0.39', () => {
    const drift = detectAppliedGenerationDrift(GENERATION, liveLines, getProcessLabelForClass());
    expect(drift).toHaveLength(1);
    expect(drift[0].machineClass).toBe('cmm');
    expect(drift[0].persistedTotalCost).toBeCloseTo(0.21, 8);
    expect(drift[0].liveTotalCost).toBeCloseTo(0.39, 8);
  });

  it('reports nothing when the snapshot still matches the engine', () => {
    // The other three operations agree exactly -- which is precisely why the
    // old hybrid model looked correct.
    const inAgreement = GENERATION.filter((r) => r.machine_class !== 'cmm');
    expect(detectAppliedGenerationDrift(inAgreement, liveLines, getProcessLabelForClass())).toEqual([]);
  });

  it('does not flag sub-cent float noise as drift', () => {
    const noisy = GENERATION.map((r) =>
      r.machine_class === 'cmm' ? { ...r, total_cost_per_part: 0.39 + 1e-12 } : r);
    expect(detectAppliedGenerationDrift(noisy, liveLines, getProcessLabelForClass())).toEqual([]);
  });

  it('ignores an operation the engine no longer composes at all', () => {
    // Absence is not drift -- there is no current number to compare against,
    // and the persisted operation remains authoritative regardless.
    const extra = [...GENERATION, row({ op_nbr: 50, machine_class: 'tapping', total_cost_per_part: 0.5 })];
    const drift = detectAppliedGenerationDrift(extra, liveLines, getProcessLabelForClass());
    expect(drift.map((d) => d.machineClass)).toEqual(['cmm']);
  });

  it('detecting drift does not change the authoritative cost', () => {
    // The whole point: disclosure without mutation.
    const out = overlay(GENERATION);
    const drift = detectAppliedGenerationDrift(GENERATION, liveLines, getProcessLabelForClass());
    expect(drift).toHaveLength(1);
    expect(out.processLines.find((l) => l.machineClass === 'cmm')!.totalCost).toBeCloseTo(0.21, 8);
    expect(out.totalProcessCost).toBeCloseTo(PERSISTED_TOTAL, 8);
  });
});

// 7. Re-apply is the explicit refresh: a new snapshot legitimately changes cost.
describe('re-apply produces a new snapshot (7)', () => {
  it('the same operation at a newly resolved rate yields a different quote', () => {
    const before = overlay(GENERATION);
    const reapplied = GENERATION.map((r) =>
      r.machine_class === 'cmm'
        ? { ...r, direct_rate: 86.67, total_cycle_cost_per_part: 0.39, total_cost_per_part: 0.39 }
        : r);
    const after = overlay(reapplied);
    expect(before.totalProcessCost).toBeCloseTo(1.033693, 8);
    expect(after.totalProcessCost).toBeCloseTo(1.213693, 8);
    // Which is exactly the 0.18 that used to appear without anyone re-applying.
    expect(after.totalProcessCost - before.totalProcessCost).toBeCloseTo(0.18, 8);
  });
});
