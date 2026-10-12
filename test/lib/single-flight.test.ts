import { describe, expect, it } from 'vitest';

import { createSingleFlight } from '@/lib/utils/single-flight';

describe('createSingleFlight (Apply re-entrancy guard)', () => {
  it('ignores a second call while the first is still running', async () => {
    const run = createSingleFlight();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = run(async () => { runs++; await gate; return 'done'; });
    const second = run(() => { runs++; return Promise.resolve('second'); });

    expect(await second).toBeUndefined();
    release();
    expect(await first).toBe('done');
    expect(runs).toBe(1);
  });

  it('releases after success, so the next call runs', async () => {
    const run = createSingleFlight();
    expect(await run(() => Promise.resolve(1))).toBe(1);
    expect(await run(() => Promise.resolve(2))).toBe(2);
  });

  it('releases after a failure, so a failed apply does not lock the button', async () => {
    const run = createSingleFlight();
    await expect(run(() => Promise.reject(new Error('apply failed')))).rejects.toThrow('apply failed');
    expect(await run(() => Promise.resolve('retried'))).toBe('retried');
  });

  it('keeps separate guards independent', async () => {
    const a = createSingleFlight();
    const b = createSingleFlight();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = a(() => gate);
    expect(await b(() => Promise.resolve('b ran'))).toBe('b ran');
    release();
    await pending;
  });
});
