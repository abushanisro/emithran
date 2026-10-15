import { SessionController } from '../../../common/session/session.controller';
import { type SessionActivityService } from '../../../common/session/session-activity.service';
import { SESSION_IDLE_POLICY } from '../../../common/session/session-idle-policy';

const T0 = Date.parse('2026-10-15T09:00:00Z');
const MIN = 60_000;

function makeService() {
  return {
    assertActive: jest.fn().mockResolvedValue({ lastActivityAt: T0, lastJobAt: null }),
    recordActivity: jest.fn().mockResolvedValue({ lastActivityAt: T0 + 5 * MIN, lastJobAt: null }),
  } as unknown as SessionActivityService & { assertActive: jest.Mock; recordActivity: jest.Mock };
}

describe('SessionController', () => {
  it('returns the enforced policy and the session deadline without recording activity', async () => {
    const service = makeService();
    const res = await new SessionController(service).status('s1', 'u1', 'tok');
    expect(res).toEqual({ policy: SESSION_IDLE_POLICY, enforced: true, deadline: T0 + 30 * MIN });
    expect(service.assertActive).toHaveBeenCalledWith('s1', 'u1', 'tok');
    expect(service.recordActivity).not.toHaveBeenCalled();
  });

  it('records a heartbeat of the given kind and returns the new deadline', async () => {
    const service = makeService();
    const res = await new SessionController(service).activity({ kind: 'job' }, 's1', 'u1');
    expect(service.recordActivity).toHaveBeenCalledWith('s1', 'u1', 'job');
    expect(res.deadline).toBe(T0 + 35 * MIN);
  });

  it('reports the development bypass (no Supabase session) as not enforced, and stores nothing', async () => {
    const service = makeService();
    const controller = new SessionController(service);
    await expect(controller.status(undefined, 'dev', 'minted')).resolves.toMatchObject({ enforced: false, deadline: null });
    await expect(controller.activity({ kind: 'user' }, undefined, 'dev')).resolves.toMatchObject({ enforced: false });
    expect(service.assertActive).not.toHaveBeenCalled();
    expect(service.recordActivity).not.toHaveBeenCalled();
  });
});
