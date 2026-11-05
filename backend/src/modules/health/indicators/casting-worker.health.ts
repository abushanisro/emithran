import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { connect } from 'node:net';

const PROBE_TIMEOUT_MS = 2_000;

// Reachability of the casting worker host (the sandboxed sand-casting geometry worker), for READINESS only. The host treats a connection that closes
// without sending anything as a health probe, so this connects and closes: no job is run and nothing is sent. The host serves one job at a time, but
// a connection is accepted by the operating system even while a job runs, so a busy host is ready, not down. The result carries a short reason code,
// never the socket path (/api/health/ready is public).
@Injectable()
export class CastingWorkerHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  /**
   * Not configured (no CASTING_WORKER_SOCKET, or the runner switched off with CASTING_ANALYSIS_RUNNER=off) is reported `configured: false` and does
   * not fail readiness: analyses then stay queued, and the part page says so itself.
   */
  async check(key: string): Promise<HealthIndicatorResult> {
    const socketPath = this.config.get<string>('CASTING_WORKER_SOCKET', '').trim();
    if (!socketPath || this.config.get<string>('CASTING_ANALYSIS_RUNNER', '') === 'off') return this.getStatus(key, true, { configured: false });
    const reason = await probe(socketPath);
    if (reason === null) return this.getStatus(key, true, { configured: true });
    throw new HealthCheckError(`${key} is not ready`, this.getStatus(key, false, { configured: true, reason }));
  }
}

/** null when the socket accepted a connection; else a short reason code. */
function probe(socketPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const done = (reason: string | null) => {
      socket.destroy();
      resolve(reason);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done('timeout'));
    socket.once('connect', () => done(null));
    socket.once('error', () => done('unreachable'));
  });
}
