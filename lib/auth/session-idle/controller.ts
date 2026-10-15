import {
  DEFAULT_SESSION_IDLE_POLICY,
  JOB_HEARTBEAT_INTERVAL_MS,
  USER_HEARTBEAT_INTERVAL_MS,
  isValidPolicy,
  sessionDeadline,
  type SessionIdlePolicy,
} from './policy';
import { getNumber, setMax, type IdleStorage, type SharedField } from './shared-state';

export type IdlePhase = 'active' | 'warning' | 'expired';

export interface IdleSnapshot {
  phase: IdlePhase;
  remainingMs: number;
  /** A protected CAD/BOM flow is running in this or another tab. */
  jobRunning: boolean;
}

export type ServerResult = { ok: true; policy?: unknown } | { ok: false; idle: boolean };

export interface IdleControllerDeps {
  now: () => number;
  storage: IdleStorage;
  /** GET /auth/session: policy, never counts as activity. */
  status: () => Promise<ServerResult>;
  /** POST /auth/session/activity. */
  beat: (kind: 'user' | 'job') => Promise<ServerResult>;
  /** Signs out and leaves the page. Called at most once. */
  onExpire: () => void | Promise<void>;
  /** Protected flows running in THIS tab. */
  localJobCount: () => number;
}

const SESSION_FIELDS: SharedField[] = [
  'lastActivityAt',
  'lastJobAt',
  'userBeatSentAt',
  'userBeatCovers',
  'jobBeatSentAt',
  'expiredSession',
];

/**
 * The browser half of the inactivity timeout, one per tab, all tabs sharing
 * state through IdleStorage. Drives the header countdown and the warning, and
 * signs out at the deadline. The server enforces the same deadline on its own,
 * so this is the user-facing half, not the security boundary.
 *
 * Keeping the two in step: the client's last-activity time is never reported
 * later than it happened, and a job only extends the client's deadline from
 * the moment its heartbeat was SENT, so the server (which stamps on receipt)
 * always has a deadline at least as late as the one shown here.
 */
export class SessionIdleController {
  private policy: SessionIdlePolicy = DEFAULT_SESSION_IDLE_POLICY;
  private expired = false;
  private lastActivityWrite = 0;
  private userBeatInFlight = false;
  private jobBeatInFlight = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly deps: IdleControllerDeps,
  ) {}

  start(): IdleSnapshot {
    const { storage, now } = this.deps;
    if (storage.get('sessionId') !== this.sessionId) {
      // A new sign-in, by any method, or a different user: its clock starts now.
      for (const f of SESSION_FIELDS) storage.remove(f);
      storage.set('sessionId', this.sessionId);
      storage.set('lastActivityAt', String(now()));
    }
    this.unsubscribe = storage.subscribe((field, value) => {
      if (field === 'expiredSession' && value === this.sessionId) void this.expire();
    });
    if (storage.get('expiredSession') === this.sessionId) {
      void this.expire();
      return this.snapshot(now());
    }
    // A session already past its deadline (e.g. a tab restored the next
    // morning) is ended here; otherwise opening the page is itself activity.
    const first = this.tick();
    if (first.phase === 'active') this.recordActivity();
    void this.deps.status().then((r) => { this.handle(r); });
    return first;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Real user input. Ignored once the warning is up: only "Stay signed in" counts then. */
  recordActivity(): void {
    if (this.expired || !this.owns()) return;
    const now = this.deps.now();
    if (now - this.lastActivityWrite < 1_000) return;
    if (this.snapshot(now).phase !== 'active') return;
    this.lastActivityWrite = now;
    setMax(this.deps.storage, 'lastActivityAt', now);
  }

  /** The warning's explicit "Stay signed in". Reported to the server straight away. */
  staySignedIn(): void {
    if (this.expired || !this.owns()) return;
    const now = this.deps.now();
    if (now >= this.deadline()) {
      void this.expire();
      return;
    }
    this.lastActivityWrite = now;
    setMax(this.deps.storage, 'lastActivityAt', now);
    void this.sendUserBeat(now);
  }

  /** The server reported this session as ended for inactivity. */
  serverReportedIdle(): void {
    void this.expire();
  }

  signOutNow(): void {
    void this.expire();
  }

  /** Call about once a second. */
  tick(): IdleSnapshot {
    const now = this.deps.now();
    if (this.expired || !this.owns()) return this.snapshot(now);
    if (now >= this.deadline()) {
      void this.expire();
      return this.snapshot(now);
    }
    this.maybeBeat(now);
    return this.snapshot(now);
  }

  private snapshot(now: number): IdleSnapshot {
    if (this.expired) return { phase: 'expired', remainingMs: 0, jobRunning: false };
    // Another tab signed in as a different session; this one is stale and will be replaced.
    if (!this.owns()) return { phase: 'active', remainingMs: this.policy.idleTimeoutMs, jobRunning: false };
    const remainingMs = Math.max(0, this.deadline() - now);
    const jobBeat = getNumber(this.deps.storage, 'jobBeatSentAt');
    const jobRunning =
      this.deps.localJobCount() > 0 || (jobBeat !== null && now - jobBeat < JOB_HEARTBEAT_INTERVAL_MS + 30_000);
    const phase: IdlePhase = remainingMs <= 0 ? 'expired' : remainingMs <= this.policy.warningMs ? 'warning' : 'active';
    return { phase, remainingMs, jobRunning };
  }

  private owns(): boolean {
    return this.deps.storage.get('sessionId') === this.sessionId;
  }

  private deadline(): number {
    const { storage, now } = this.deps;
    let lastActivityAt = getNumber(storage, 'lastActivityAt');
    if (lastActivityAt === null) {
      // Storage was cleared mid-session; restart the clock rather than guess.
      lastActivityAt = now();
      storage.set('lastActivityAt', String(lastActivityAt));
    }
    return sessionDeadline({ lastActivityAt, lastJobAt: getNumber(storage, 'lastJobAt') }, this.policy);
  }

  private maybeBeat(now: number): void {
    const s = this.deps.storage;
    const lastActivityAt = getNumber(s, 'lastActivityAt') ?? 0;
    if (
      lastActivityAt > (getNumber(s, 'userBeatCovers') ?? 0) &&
      now - (getNumber(s, 'userBeatSentAt') ?? 0) >= USER_HEARTBEAT_INTERVAL_MS
    ) {
      void this.sendUserBeat(now);
    }
    if (this.deps.localJobCount() > 0 && now - (getNumber(s, 'jobBeatSentAt') ?? 0) >= JOB_HEARTBEAT_INTERVAL_MS) {
      void this.sendJobBeat(now);
    }
  }

  private async sendUserBeat(now: number): Promise<void> {
    if (this.userBeatInFlight) return;
    this.userBeatInFlight = true;
    const s = this.deps.storage;
    const previousCovers = s.get('userBeatCovers');
    const covers = s.get('lastActivityAt') ?? String(now);
    // Claimed before sending, so other tabs don't send the same heartbeat.
    s.set('userBeatSentAt', String(now));
    s.set('userBeatCovers', covers);
    try {
      const result = await this.deps.beat('user');
      if (!result.ok && !result.idle && s.get('userBeatCovers') === covers) {
        // Not delivered: let the next heartbeat carry it.
        if (previousCovers === null) s.remove('userBeatCovers');
        else s.set('userBeatCovers', previousCovers);
      }
      this.handle(result);
    } finally {
      this.userBeatInFlight = false;
    }
  }

  private async sendJobBeat(now: number): Promise<void> {
    if (this.jobBeatInFlight) return;
    this.jobBeatInFlight = true;
    this.deps.storage.set('jobBeatSentAt', String(now));
    try {
      const result = await this.deps.beat('job');
      if (result.ok) setMax(this.deps.storage, 'lastJobAt', now);
      this.handle(result);
    } finally {
      this.jobBeatInFlight = false;
    }
  }

  private handle(result: ServerResult): void {
    if (result.ok) {
      if (isValidPolicy(result.policy)) this.policy = result.policy;
    } else if (result.idle) {
      void this.expire();
    }
  }

  private async expire(): Promise<void> {
    if (this.expired) return;
    this.expired = true;
    if (this.owns()) this.deps.storage.set('expiredSession', this.sessionId);
    await this.deps.onExpire();
  }
}
