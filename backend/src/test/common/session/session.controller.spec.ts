import { SessionController } from '../../../common/session/session.controller';
import { type SessionActivityService } from '../../../common/session/session-activity.service';
import { SESSION_IDLE_POLICY } from '../../../common/session/session-idle-policy';

const T0 = Date.parse('2026-10-15T09:00:00Z');
const MIN = 60_000;

function makeService() {
  return {
    assertActive: jest.fn().mockResolvedValue({ lastActivityAt: T0, lastJobAt: null }),
    recordActivity: jest.fn().mockResolvedValue({ lastActivityAt: T0 + 5 * MIN, lastJobAt: null }),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionActivityService & { assertActive: jest.Mock; recordActivity: jest.Mock; end: jest.Mock };
}

describe('SessionController', () => {
  it('returns the enforced policy and the session deadline without recording activity', async () => {
    const service = makeService();
    const res = await new SessionController(service).status('s1', 'u1');
    expect(res).toEqual({ policy: SESSION_IDLE_POLICY, enforced: true, deadline: T0 + 30 * MIN });
    expect(service.assertActive).toHaveBeenCalledWith('s1', 'u1');
    expect(service.recordActivity).not.toHaveBeenCalled();
  });

  it('records a heartbeat of the given kind and returns the new deadline', async () => {
    const service = makeService();
    const res = await new SessionController(service).activity({ kind: 'job' }, 's1', 'u1');
    expect(service.recordActivity).toHaveBeenCalledWith('s1', 'u1', 'job');
    expect(res.deadline).toBe(T0 + 35 * MIN);
  });

  it('ends the caller\'s own session at logout', async () => {
    const service = makeService();
    await new SessionController(service).end('s1', 'u1');
    expect(service.end).toHaveBeenCalledWith('s1', 'u1');
  });

  it('has nothing to end for the development bypass (no session)', async () => {
    const service = makeService();
    await new SessionController(service).end(undefined, 'dev');
    expect(service.end).not.toHaveBeenCalled();
  });

  it('reports the development bypass (no session) as not enforced, and stores nothing', async () => {
    const service = makeService();
    const controller = new SessionController(service);
    await expect(controller.status(undefined, 'dev')).resolves.toMatchObject({ enforced: false, deadline: null });
    await expect(controller.activity({ kind: 'user' }, undefined, 'dev')).resolves.toMatchObject({ enforced: false });
    expect(service.assertActive).not.toHaveBeenCalled();
    expect(service.recordActivity).not.toHaveBeenCalled();
  });

  describe('with the inactivity timeout switched off', () => {
    const previous = process.env.SESSION_IDLE_TIMEOUT_ENABLED;
    beforeEach(() => { process.env.SESSION_IDLE_TIMEOUT_ENABLED = 'false'; });
    afterEach(() => {
      if (previous === undefined) delete process.env.SESSION_IDLE_TIMEOUT_ENABLED; else process.env.SESSION_IDLE_TIMEOUT_ENABLED = previous;
    });

    it('reports not enforced with no deadline, so the browser starts no countdown, and counts no activity', async () => {
      const service = makeService();
      const controller = new SessionController(service);
      await expect(controller.status('s1', 'u1')).resolves.toMatchObject({ enforced: false, deadline: null });
      await expect(controller.activity({ kind: 'user' }, 's1', 'u1')).resolves.toMatchObject({ enforced: false, deadline: null });
      expect(service.assertActive).not.toHaveBeenCalled();
      expect(service.recordActivity).not.toHaveBeenCalled();
    });
  });
});
