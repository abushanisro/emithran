import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionIdleController, type IdleControllerDeps, type ServerResult } from '@/lib/auth/session-idle/controller';
import {
  DEFAULT_SESSION_IDLE_POLICY,
  sessionDeadline,
} from '@/lib/auth/session-idle/policy';
import {
  beginProtectedJob,
  protectedJobCount,
  runProtectedJob,
} from '@/lib/auth/session-idle/protected-jobs';
import { getNumber, type IdleStorage, type SharedField } from '@/lib/auth/session-idle/shared-state';

const SEC = 1_000;
const MIN = 60 * SEC;
const T0 = Date.parse('2026-10-15T09:00:00Z');

/** localStorage shared by "tabs": a write in one notifies the others, like the storage event. */
function sharedStorage() {
  const map = new Map<SharedField, string>();
  const listeners = new Set<{ owner: object; fn: (f: SharedField, v: string | null) => void }>();
  const forTab = (owner: object): IdleStorage => ({
    get: (f) => map.get(f) ?? null,
    set: (f, v) => {
      map.set(f, v);
      for (const l of listeners) if (l.owner !== owner) l.fn(f, v);
    },
    remove: (f) => {
      map.delete(f);
      for (const l of listeners) if (l.owner !== owner) l.fn(f, null);
    },
    subscribe: (fn) => {
      const entry = { owner, fn };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
  });
  return { map, forTab };
}

/** Lets the fake server calls (which resolve as microtasks) and their handlers finish. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeTab(
  shared: ReturnType<typeof sharedStorage>,
  clock: { now: number },
  over: Partial<IdleControllerDeps> = {},
  sessionId = 'session-1',
) {
  const beats: ('user' | 'job')[] = [];
  const deps: IdleControllerDeps = {
    now: () => clock.now,
    storage: shared.forTab({}),
    status: vi.fn((): Promise<ServerResult> => Promise.resolve({ ok: true, policy: DEFAULT_SESSION_IDLE_POLICY })),
    beat: vi.fn((kind: 'user' | 'job'): Promise<ServerResult> => {
      beats.push(kind);
      return Promise.resolve({ ok: true });
    }),
    onExpire: vi.fn(),
    localJobCount: () => 0,
    ...over,
  };
  const controller = new SessionIdleController(sessionId, deps);
  return { controller, deps, beats };
}

/** Advances the clock one second at a time, ticking every tab, like the 1 s interval. */
async function run(clock: { now: number }, ms: number, ...tabs: SessionIdleController[]) {
  const end = clock.now + ms;
  while (clock.now < end) {
    clock.now = Math.min(end, clock.now + SEC);
    for (const t of tabs) t.tick();
    await flush();
  }
}

describe('session idle policy (browser copy)', () => {
  it('matches the server rule: 30 min idle, job grace 2 min, job cap 15 min past the idle deadline', () => {
    const p = DEFAULT_SESSION_IDLE_POLICY;
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: null }, p)).toBe(T0 + 30 * MIN);
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 35 * MIN }, p)).toBe(T0 + 37 * MIN);
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 90 * MIN }, p)).toBe(T0 + 45 * MIN);
    expect(sessionDeadline({ lastActivityAt: T0, lastJobAt: T0 + 5 * MIN }, p)).toBe(T0 + 30 * MIN);
  });
});

describe('SessionIdleController', () => {
  let shared: ReturnType<typeof sharedStorage>;
  let clock: { now: number };
  beforeEach(() => {
    shared = sharedStorage();
    clock = { now: T0 };
  });

  it('starts a new session with a full 30 minutes and reports activity to the server', async () => {
    const tab = makeTab(shared, clock);
    const snap = tab.controller.start();
    await flush();
    expect(snap).toMatchObject({ phase: 'active', remainingMs: 30 * MIN });
    expect(tab.beats).toEqual(['user']);
    expect(tab.deps.status).toHaveBeenCalled();
  });

  it('warns at 28 minutes and signs out at exactly 30 minutes of inactivity', async () => {
    const tab = makeTab(shared, clock);
    tab.controller.start();
    await run(clock, 28 * MIN - SEC, tab.controller);
    expect(tab.controller.tick().phase).toBe('active');
    await run(clock, SEC, tab.controller);
    expect(tab.controller.tick()).toMatchObject({ phase: 'warning', remainingMs: 2 * MIN });
    await run(clock, 2 * MIN - SEC, tab.controller);
    expect(tab.deps.onExpire).not.toHaveBeenCalled();
    await run(clock, SEC, tab.controller);
    expect(tab.deps.onExpire).toHaveBeenCalledTimes(1);
    expect(tab.controller.tick().phase).toBe('expired');
  });

  it('ignores passive activity during the warning; only "Stay signed in" extends, and reports it at once', async () => {
    const tab = makeTab(shared, clock);
    tab.controller.start();
    await run(clock, 29 * MIN, tab.controller);
    tab.controller.recordActivity();
    expect(tab.controller.tick().phase).toBe('warning');

    tab.beats.length = 0;
    tab.controller.staySignedIn();
    await flush();
    expect(tab.controller.tick()).toMatchObject({ phase: 'active', remainingMs: 30 * MIN });
    expect(tab.beats).toEqual(['user']);
  });

  it('sends at most one activity heartbeat every 5 minutes however busy the user is, and never one for no activity', async () => {
    const tab = makeTab(shared, clock);
    tab.controller.start();
    await flush();
    tab.beats.length = 0;
    for (let i = 0; i < 15 * 60; i++) {
      tab.controller.recordActivity();
      await run(clock, SEC, tab.controller);
    }
    expect(tab.beats.length).toBe(3);
    // Activity just after a beat is still delivered, by the next one 5 minutes on...
    await run(clock, 5 * SEC, tab.controller);
    tab.controller.recordActivity();
    await run(clock, 10 * MIN, tab.controller);
    expect(tab.beats.length).toBe(4);
    // ...and with no further activity nothing more is sent.
    await run(clock, 10 * MIN, tab.controller);
    expect(tab.beats.length).toBe(4);
  });

  it('keeps every tab alive while the user works in any one of them, and warns them together', async () => {
    const a = makeTab(shared, clock);
    const b = makeTab(shared, clock);
    a.controller.start();
    b.controller.start();
    await run(clock, 20 * MIN, a.controller, b.controller);
    a.controller.recordActivity();
    await run(clock, 20 * MIN, a.controller, b.controller);
    expect(b.controller.tick()).toMatchObject({ phase: 'active', remainingMs: 10 * MIN });
    await run(clock, 8 * MIN, a.controller, b.controller);
    expect(a.controller.tick().phase).toBe('warning');
    expect(b.controller.tick().phase).toBe('warning');
  });

  it('"Stay signed in" in one tab closes the warning in every tab', async () => {
    const a = makeTab(shared, clock);
    const b = makeTab(shared, clock);
    a.controller.start();
    b.controller.start();
    await run(clock, 29 * MIN, a.controller, b.controller);
    a.controller.staySignedIn();
    expect(b.controller.tick().phase).toBe('active');
  });

  it('signs every tab out when one tab ends the session', async () => {
    const a = makeTab(shared, clock);
    const b = makeTab(shared, clock);
    a.controller.start();
    b.controller.start();
    a.controller.signOutNow();
    await flush();
    expect(a.deps.onExpire).toHaveBeenCalledTimes(1);
    expect(b.deps.onExpire).toHaveBeenCalledTimes(1);
  });

  it('signs out at once when the server reports the session idle', async () => {
    const tab = makeTab(shared, clock, {
      beat: vi.fn((): Promise<ServerResult> => Promise.resolve({ ok: false, idle: true })),
    });
    tab.controller.start();
    await flush();
    expect(tab.deps.onExpire).toHaveBeenCalledTimes(1);
  });

  it('ends a session restored after its deadline instead of counting the page load as activity', async () => {
    const first = makeTab(shared, clock);
    first.controller.start();
    first.controller.stop();
    clock.now += 40 * MIN; // e.g. the browser restored the tab the next morning
    const restored = makeTab(shared, clock);
    expect(restored.controller.start().phase).toBe('expired');
    await flush();
    expect(restored.deps.onExpire).toHaveBeenCalledTimes(1);
    expect(restored.beats).toEqual([]);
  });

  it('gives a new sign-in its own fresh clock, whatever the previous session left behind', () => {
    const old = makeTab(shared, clock, {}, 'old-session');
    old.controller.start();
    old.controller.stop();
    clock.now += 50 * MIN;
    const fresh = makeTab(shared, clock, {}, 'new-session');
    expect(fresh.controller.start()).toMatchObject({ phase: 'active', remainingMs: 30 * MIN });
    expect(fresh.deps.onExpire).not.toHaveBeenCalled();
  });

  it('retries an activity heartbeat that did not reach the server', async () => {
    let fail = true;
    const tab = makeTab(shared, clock, {
      beat: vi.fn((): Promise<ServerResult> => Promise.resolve(fail ? { ok: false, idle: false } : { ok: true })),
    });
    tab.controller.start();
    await flush();
    fail = false;
    await run(clock, 5 * MIN + SEC, tab.controller);
    expect(tab.deps.beat).toHaveBeenCalledTimes(2);
    expect(getNumber(shared.forTab({}), 'userBeatCovers')).toBe(T0);
  });

  it('adopts the policy the server enforces', async () => {
    const tab = makeTab(shared, clock, {
      status: vi.fn((): Promise<ServerResult> => Promise.resolve({
        ok: true,
        policy: { idleTimeoutMs: 10 * MIN, warningMs: MIN, jobExtensionMaxMs: 5 * MIN, jobGraceMs: MIN },
      })),
    });
    tab.controller.start();
    await flush();
    expect(tab.controller.tick().remainingMs).toBe(10 * MIN);
  });

  describe('protected CAD/BOM flows', () => {
    it('hold the session open while running, but never more than 15 minutes past the idle deadline', async () => {
      let jobs = 1;
      const tab = makeTab(shared, clock, { localJobCount: () => jobs });
      tab.controller.start();
      await run(clock, 44 * MIN, tab.controller);
      expect(tab.deps.onExpire).not.toHaveBeenCalled();
      expect(tab.controller.tick()).toMatchObject({ phase: 'warning', jobRunning: true });
      await run(clock, MIN, tab.controller);
      expect(tab.deps.onExpire).toHaveBeenCalledTimes(1);
      expect(clock.now).toBe(T0 + 45 * MIN);
      jobs = 0;
    });

    it('end the session 2 minutes after the job heartbeats stop, once past the idle deadline', async () => {
      let jobs = 1;
      const tab = makeTab(shared, clock, { localJobCount: () => jobs });
      tab.controller.start();
      await run(clock, 33 * MIN, tab.controller); // last job beat sent at 33:00
      jobs = 0;
      await run(clock, 2 * MIN - SEC, tab.controller);
      expect(tab.deps.onExpire).not.toHaveBeenCalled();
      await run(clock, SEC, tab.controller);
      expect(tab.deps.onExpire).toHaveBeenCalledTimes(1);
    });

    it('do not extend the session when the job heartbeat is not accepted by the server', async () => {
      const tab = makeTab(shared, clock, {
        localJobCount: () => 1,
        beat: vi.fn(
          (kind: 'user' | 'job'): Promise<ServerResult> =>
            Promise.resolve(kind === 'job' ? { ok: false, idle: false } : { ok: true }),
        ),
      });
      tab.controller.start();
      await run(clock, 30 * MIN, tab.controller);
      expect(tab.deps.onExpire).toHaveBeenCalledTimes(1);
    });

    it('extend the session for a job running in another tab too', async () => {
      const worker = makeTab(shared, clock, { localJobCount: () => 1 });
      const idle = makeTab(shared, clock);
      worker.controller.start();
      idle.controller.start();
      await run(clock, 40 * MIN, worker.controller, idle.controller);
      expect(idle.deps.onExpire).not.toHaveBeenCalled();
      expect(idle.controller.tick().jobRunning).toBe(true);
    });
  });
});

describe('protected job registry', () => {
  it('counts a job until it settles, including when it throws', async () => {
    expect(protectedJobCount()).toBe(0);
    const failing = runProtectedJob('apply-scenario', () => {
      expect(protectedJobCount()).toBe(1);
      return Promise.reject(new Error('boom'));
    });
    await expect(failing).rejects.toThrow('boom');
    expect(protectedJobCount()).toBe(0);
  });

  it('ends a job only once even if its end function is called twice', () => {
    const endA = beginProtectedJob('cad-autofill');
    const endB = beginProtectedJob('bom-batch-create');
    endA();
    endA();
    expect(protectedJobCount()).toBe(1);
    endB();
    expect(protectedJobCount()).toBe(0);
  });
});
