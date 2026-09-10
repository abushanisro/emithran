import { describe, it, expect } from 'vitest';

import {
  findStaleInputKeys,
  resolveStoredProcessLines,
  totalStoredProcessCost,
  selectProcessTotal,
  type StoredProcessRow,
  type EngineLineLite,
} from '@/lib/costing/stored-process-lines';

// The Cost Guide used to compute this arithmetic twice — once for the grand
// total, once per rendered row — kept in step only by a comment. It also
// amortised setup over the batch size FROZEN INTO THE SAVED ROW, so after a
// Batch Size change the header read "batch 10,000" while every row below still
// divided by 100,000, and the stale stored total silently replaced the freshly
// computed engine result.

const EFFECTIVE = { batchSize: 100_000, location: 'USA' };

/** A saved row matching the reported scenario's Bend Brake line. */
function row(overrides: Partial<StoredProcessRow> = {}): StoredProcessRow {
  return {
    id: 'r1',
    machineClass: 'press_brake',
    machineName: '11010 (Heller-hydraulic)',
    mhrId: 'mhr-1',
    machineRate: 19.83,
    laborRate: 47,
    setupTime: 45,
    setupManning: 1,
    batchSize: 100_000,
    location: 'USA',
    cycleTime: 10,
    heads: 1,
    partsPerCycle: 1,
    scrap: 0,
    ...overrides,
  };
}

const ENGINE_LINES: EngineLineLite[] = [
  { machineClass: 'press_brake', cycleTimeMin: 10 / 60 },
];

describe('resolveStoredProcessLines — arithmetic preserved from the Cost Guide', () => {
  it('reproduces the original setup and cycle per-part formulas exactly', () => {
    const [line] = resolveStoredProcessLines([row()], [], EFFECTIVE);
    // setupPerPart = (setupMin/60 * (machineRate + laborRate*manning)) / batch
    expect(line!.setupPerPart).toBeCloseTo((45 / 60) * (19.83 + 47 * 1) / 100_000, 12);
    // cyclePerPart = (cycleSec/3600 * (machineRate + laborRate*heads)) / partsPerCycle
    expect(line!.cyclePerPart).toBeCloseTo((10 / 3600) * (19.83 + 47 * 1) / 1, 12);
    expect(line!.totalPerPart).toBeCloseTo(line!.setupPerPart + line!.cyclePerPart, 12);
  });

  it('applies scrap as a multiplier on the combined per-part cost', () => {
    const [line] = resolveStoredProcessLines([row({ scrap: 10 })], [], EFFECTIVE);
    expect(line!.totalPerPart).toBeCloseTo((line!.setupPerPart + line!.cyclePerPart) * 1.1, 12);
  });

  it('prefers the live engine cycle time when an engine line matches the class', () => {
    const [line] = resolveStoredProcessLines([row({ cycleTime: 999 })], ENGINE_LINES, EFFECTIVE);
    expect(line!.cycleSec).toBeCloseTo(10, 9);
  });

  it('keeps a saved machine link over the live recommendation — a deliberate pick is not stale data', () => {
    const withLive: EngineLineLite[] = [{
      machineClass: 'press_brake', cycleTimeMin: 10 / 60,
      machineSelection: { balanced: { candidate: { hourlyRate: 74, machineName: 'Generic Brake' } } },
    }];
    const [line] = resolveStoredProcessLines([row()], withLive, EFFECTIVE);
    expect(line!.hasSavedMachine).toBe(true);
    expect(line!.machineRate).toBe(19.83);
    expect(line!.liveMachineName).toBeNull();
  });

  it('falls back to the live recommendation only when the row was never given a machine', () => {
    const withLive: EngineLineLite[] = [{
      machineClass: 'press_brake', cycleTimeMin: 10 / 60,
      machineSelection: { balanced: { candidate: { hourlyRate: 74, machineName: 'Generic Brake' } } },
    }];
    const [line] = resolveStoredProcessLines(
      [row({ mhrId: null, machineName: null })], withLive, EFFECTIVE,
    );
    expect(line!.machineRate).toBe(74);
    expect(line!.liveMachineName).toBe('Generic Brake');
  });

  it('does not take the live candidate when the selection was manually overridden', () => {
    const overridden: EngineLineLite[] = [{
      machineClass: 'press_brake', cycleTimeMin: 10 / 60,
      machineSelection: { overridden: true, balanced: { candidate: { hourlyRate: 74, machineName: 'Generic' } } },
    }];
    const [line] = resolveStoredProcessLines(
      [row({ mhrId: null, machineName: null, machineRate: 19.83 })], overridden, EFFECTIVE,
    );
    expect(line!.machineRate).toBe(19.83);
  });
});

describe('resolveStoredProcessLines — the setup denominator follows the effective batch', () => {
  it('is unchanged when the saved row matches the current batch', () => {
    const [line] = resolveStoredProcessLines([row()], [], EFFECTIVE);
    expect(line!.batchSize).toBe(100_000);
    expect(line!.persistedBatchSize).toBe(100_000);
    expect(line!.staleInputKeys).toEqual([]);
  });

  it('divides by the CURRENT batch, not the one frozen into the row', () => {
    // The reported symptom: header said "batch 10,000", rows said "÷ 100,000".
    const [line] = resolveStoredProcessLines(
      [row({ batchSize: 100_000 })], [], { batchSize: 10_000, location: 'USA' },
    );
    expect(line!.batchSize).toBe(10_000);
    expect(line!.persistedBatchSize).toBe(100_000);
    expect(line!.staleInputKeys).toEqual(['batchSize']);
    expect(line!.setupPerPart).toBeCloseTo((45 / 60) * (19.83 + 47) / 10_000, 12);
  });

  it('scales setup cost inversely with batch size, exactly once', () => {
    const at1k = resolveStoredProcessLines([row()], [], { batchSize: 1_000, location: 'USA' })[0]!;
    const at10k = resolveStoredProcessLines([row()], [], { batchSize: 10_000, location: 'USA' })[0]!;
    expect(at1k.setupPerPart / at10k.setupPerPart).toBeCloseTo(10, 9);
    // Cycle cost is per-part and must NOT move with batch size.
    expect(at1k.cyclePerPart).toBeCloseTo(at10k.cyclePerPart, 12);
  });
});

describe('selectProcessTotal — the one precedence rule', () => {
  const engineTotal = 0.42;

  it('is $0 without a committed material record, whatever else exists', () => {
    const lines = resolveStoredProcessLines([row()], [], EFFECTIVE);
    expect(selectProcessTotal({ hasStoredMaterial: false, storedLines: lines, engineTotalProcess: engineTotal }))
      .toEqual({ total: 0, source: 'none', staleInputKeys: [], blockingInputKeys: [] });
  });

  it('uses the saved rows when none of them is stale — unchanged behaviour', () => {
    const lines = resolveStoredProcessLines([row()], [], EFFECTIVE);
    const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: lines, engineTotalProcess: engineTotal });
    expect(sel.source).toBe('stored');
    expect(sel.total).toBeCloseTo(totalStoredProcessCost(lines), 12);
    expect(sel.staleInputKeys).toEqual([]);
  });

  it('keeps the saved rows on a batch change — the mismatch is repaired, not fatal', () => {
    // The rows displayed beneath this total are re-amortised over the SAME
    // effective batch, so taking the engine total here would make the grand
    // total contradict the rows whose percentages are computed against it.
    const lines = resolveStoredProcessLines([row({ batchSize: 100_000 })], [], { batchSize: 10_000, location: 'USA' });
    const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: lines, engineTotalProcess: engineTotal });
    expect(sel.source).toBe('stored');
    expect(sel.total).toBeCloseTo(totalStoredProcessCost(lines), 12);
    // Reported for disclosure even though it did not block.
    expect(sel.staleInputKeys).toEqual(['batchSize']);
    expect(sel.blockingInputKeys).toEqual([]);
  });

  it('lets the FRESH engine result win when a saved row was priced for another location', () => {
    // Unrepairable: the row persists rates resolved against the old location and
    // nothing on it allows re-resolving them for the new one.
    const lines = resolveStoredProcessLines([row({ location: 'India' })], [], EFFECTIVE);
    const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: lines, engineTotalProcess: engineTotal });
    expect(sel.source).toBe('engine');
    expect(sel.total).toBe(engineTotal);
    expect(sel.blockingInputKeys).toEqual(['location']);
  });

  it('rejects the whole stored set when only ONE row carries a blocking mismatch', () => {
    // A mixed set cannot be part-trusted — the total would mix two rate bases.
    const lines = resolveStoredProcessLines(
      [row({ id: 'a' }), row({ id: 'b', location: 'India' })], [], EFFECTIVE,
    );
    const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: lines, engineTotalProcess: engineTotal });
    expect(sel.source).toBe('engine');
  });

  it('charges nothing when no route has been applied, even with a material', () => {
    // The engine can price the part, but nobody applied that route. Falling
    // through to its estimate put operations the user never applied into the
    // quote — "not saved" rows, each with a figure, all summed into the total.
    const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: [], engineTotalProcess: engineTotal });
    expect(sel).toEqual({ total: 0, source: 'none', staleInputKeys: [], blockingInputKeys: [] });
  });

  it('keeps the grand total equal to the sum of the rows shown beneath it', () => {
    // The invariant the extraction exists to guarantee: row percentages must
    // still sum to 100%, at any batch size.
    const saved = [row({ id: 'a', batchSize: 100_000 }), row({ id: 'b', batchSize: 100_000, setupTime: 12 })];
    for (const batchSize of [100_000, 10_000, 250_000]) {
      const lines = resolveStoredProcessLines(saved, [], { batchSize, location: 'USA' });
      const sel = selectProcessTotal({ hasStoredMaterial: true, storedLines: lines, engineTotalProcess: engineTotal });
      const rowSum = lines.reduce((s2, l) => s2 + l.totalPerPart, 0);
      expect(sel.total).toBeCloseTo(rowSum, 12);
    }
  });
});

describe('findStaleInputKeys — mirrors the backend rule', () => {
  it('flags a differing batch or location, and both together', () => {
    expect(findStaleInputKeys({ batchSize: 250, location: 'USA' }, EFFECTIVE)).toEqual(['batchSize']);
    expect(findStaleInputKeys({ batchSize: 100_000, location: 'India' }, EFFECTIVE)).toEqual(['location']);
    expect(findStaleInputKeys({ batchSize: 250, location: 'India' }, EFFECTIVE)).toEqual(['batchSize', 'location']);
  });

  it('treats an unknown persisted value as unknown, never stale', () => {
    // Legacy rows predating the columns must not all light up as outdated.
    expect(findStaleInputKeys({}, EFFECTIVE)).toEqual([]);
    expect(findStaleInputKeys({ batchSize: null, location: null }, EFFECTIVE)).toEqual([]);
    expect(findStaleInputKeys({ batchSize: 0, location: '  ' }, EFFECTIVE)).toEqual([]);
  });

  it('does not flag location when the current scenario has none to compare against', () => {
    expect(findStaleInputKeys({ batchSize: 100_000, location: 'USA' }, { batchSize: 100_000, location: null }))
      .toEqual([]);
  });
});

describe('sequential input changes leave no stale carry-over', () => {
  it('re-resolves cleanly across 100,000 -> 10,000 -> 250,000 -> 100,000', () => {
    const saved = [row({ batchSize: 100_000 })];
    const seen = [100_000, 10_000, 250_000, 100_000].map((batchSize) => {
      const lines = resolveStoredProcessLines(saved, [], { batchSize, location: 'USA' });
      return {
        batchSize,
        denominator: lines[0]!.batchSize,
        stale: lines[0]!.staleInputKeys.length > 0,
        setup: lines[0]!.setupPerPart,
      };
    });

    // Every result corresponds to the inputs in force at that step.
    expect(seen.map((s) => s.denominator)).toEqual([100_000, 10_000, 250_000, 100_000]);
    expect(seen.map((s) => s.stale)).toEqual([false, true, true, false]);
    // Returning to the original batch reproduces the original number exactly.
    expect(seen[3]!.setup).toBeCloseTo(seen[0]!.setup, 12);
  });
});
