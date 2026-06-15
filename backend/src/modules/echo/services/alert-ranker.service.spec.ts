import { ConfigService } from '@nestjs/config';
import { AlertRankerService } from './alert-ranker.service';
import type { CandidateAlert } from './alert-detector.service';

describe('AlertRankerService', () => {
  const cfg = { get: () => '' } as unknown as ConfigService;

  const mkCandidate = (over: Partial<CandidateAlert> = {}): CandidateAlert => ({
    kind: 'rfq_pending',
    severity: 'warn',
    title: 'Pending RFQ',
    body: '4 days pending',
    ...over,
  });

  it('returns [] for empty input', async () => {
    const svc = new AlertRankerService(cfg);
    expect(await svc.rank([])).toEqual([]);
  });

  it('falls back to severity ordering when API key is absent', async () => {
    const svc = new AlertRankerService(cfg);
    const out = await svc.rank([
      mkCandidate({ severity: 'info', title: 'info alert' }),
      mkCandidate({ severity: 'urgent', title: 'urgent alert' }),
      mkCandidate({ severity: 'warn', title: 'warn alert' }),
    ]);
    expect(out[0].title).toBe('urgent alert');
    expect(out[1].title).toBe('warn alert');
    expect(out[2].title).toBe('info alert');
  });

  it('fallback supplies a default nextAction string per kind', async () => {
    const svc = new AlertRankerService(cfg);
    const out = await svc.rank([
      mkCandidate({ kind: 'rfq_pending' }),
      mkCandidate({ kind: 'cost_spike', title: 'cost spike' }),
      mkCandidate({ kind: 'stale_lot', title: 'stale lot' }),
    ]);
    for (const a of out) {
      expect(typeof a.nextAction).toBe('string');
      expect(a.nextAction.length).toBeGreaterThan(0);
    }
  });

  it('caps results at 5', async () => {
    const svc = new AlertRankerService(cfg);
    const many: CandidateAlert[] = Array.from({ length: 12 }, (_, i) =>
      mkCandidate({ title: `alert-${i}`, severity: i % 2 ? 'warn' : 'info' }),
    );
    const out = await svc.rank(many);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});
