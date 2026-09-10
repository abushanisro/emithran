import { describe, it, expect } from 'vitest';

import {
  resolveLineSetup,
  roundSetupMinutes,
  type ProcessLineSetupSource,
} from '@/lib/costing/process-line-setup';

// Real figures from the reported part (SECC, 1.5 mm, USA): a 4.8-minute laser
// setup and a 5.0-minute PEM setup, at $19.83/hr machine + $47/hr labour, as
// they cross the API at three different batch sizes.
const LASER = (setupCost: number): ProcessLineSetupSource => ({
  setupTimeMin: 4.8, operators: 2, setupCost, hourlyRate: 36.49, labourRate: 36.3,
});

describe('resolveLineSetup — the exact figure always wins', () => {
  it('takes setupTimeMin from the line, whatever the amortised cost rounded to', () => {
    for (const [batch, setupCost] of [[1, 5.82], [250, 0.02], [100_000, 0]] as const) {
      const r = resolveLineSetup(LASER(setupCost), batch);
      expect(r.setupTimeMin).toBe(4.8);
      expect(r.setupTimeSource).toBe('line');
    }
  });

  it('is the fix for the reported symptom: 100,000 no longer collapses 4.8 min to 0', () => {
    // Reverse-deriving from a $0.00 setupCost gave exactly 0.0 minutes, which is
    // what put "Setup (0.0 min / 100000)" on every persisted row.
    const derived = (0 * 100_000 * 60) / (36.49 + 36.3);
    expect(derived).toBe(0);
    expect(resolveLineSetup(LASER(0), 100_000).setupTimeMin).toBe(4.8);
  });

  it('keeps a genuine zero setup as zero rather than deriving over it', () => {
    const r = resolveLineSetup({ setupTimeMin: 0, setupCost: 5, hourlyRate: 20, labourRate: 40 }, 1);
    expect(r.setupTimeMin).toBe(0);
    expect(r.setupTimeSource).toBe('line');
  });

  it('does not round — full precision is preserved for the caller', () => {
    expect(resolveLineSetup({ setupTimeMin: 4.8333333 }, 1).setupTimeMin).toBe(4.8333333);
  });
});

describe('resolveLineSetup — crew size', () => {
  it('persists the real machine crew instead of the literal 1', () => {
    expect(resolveLineSetup({ setupTimeMin: 4.8, operators: 2 }, 1).setupManning).toBe(2);
  });

  it('falls back to 1 only when the line reports no crew at all', () => {
    for (const operators of [undefined, null, 0, -3, Number.NaN]) {
      expect(resolveLineSetup({ setupTimeMin: 4.8, operators }, 1).setupManning).toBe(1);
    }
  });
});

describe('resolveLineSetup — lossy fallback, only when nothing exact exists', () => {
  it('reproduces the old derivation for a producer that reports no setupTimeMin', () => {
    const line: ProcessLineSetupSource = { setupCost: 5.82, hourlyRate: 36.49, labourRate: 36.3 };
    const r = resolveLineSetup(line, 1);
    expect(r.setupTimeSource).toBe('derived');
    expect(r.setupTimeMin).toBeCloseTo((5.82 * 1 * 60) / (36.49 + 36.3), 6);
  });

  it('reports absent rather than deriving 0 from a rounded-away cost', () => {
    // The distinction that matters: "the engine charged no setup" and "the cost
    // rounded to zero so we cannot tell" must not both silently persist as 0
    // with no trace.
    const r = resolveLineSetup({ setupCost: 0, hourlyRate: 36.49, labourRate: 36.3 }, 100_000);
    expect(r.setupTimeMin).toBe(0);
    expect(r.setupTimeSource).toBe('absent');
  });

  it('reports absent when there is no rate to divide by', () => {
    expect(resolveLineSetup({ setupCost: 5 }, 1).setupTimeSource).toBe('absent');
  });

  it('uses the batch the line was amortised over', () => {
    const line: ProcessLineSetupSource = { setupCost: 0.02, hourlyRate: 36.49, labourRate: 36.3 };
    expect(resolveLineSetup(line, 250).setupTimeMin)
      .toBeCloseTo((0.02 * 250 * 60) / (36.49 + 36.3), 6);
    expect(resolveLineSetup(line, 1).setupTimeMin)
      .toBeCloseTo((0.02 * 1 * 60) / (36.49 + 36.3), 6);
  });

  it('treats a non-positive batch as 1 rather than dividing by nothing', () => {
    const line: ProcessLineSetupSource = { setupCost: 1, hourlyRate: 10, labourRate: 10 };
    expect(resolveLineSetup(line, 0).setupTimeMin).toBeCloseTo((1 * 1 * 60) / 20, 9);
  });
});

describe('roundSetupMinutes', () => {
  it('rounds only at the boundary, to the column precision', () => {
    expect(roundSetupMinutes(4.8333333)).toBe(4.83);
    expect(roundSetupMinutes(4.8)).toBe(4.8);
    expect(roundSetupMinutes(0)).toBe(0);
  });
});
