import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

const PROBE_TIMEOUT_MS = 2_000;

// Reachability of a Python engine, for READINESS only (never liveness: an engine outage must not
// restart or remove the API). The result carries a short reason code, never the engine's URL or the
// transport error text, because /api/health/ready is public and those would reveal internal hosts.
@Injectable()
export class EngineHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  /**
   * @param urlVariable env var holding the engine base URL
   * @param path        the engine's own probe route (cad-engine: /health, ecad-engine: /ready)
   * An unconfigured engine is reported `configured: false` and does not fail readiness: the feature
   * that needs it says so itself (ExtractionUnavailable); the API is not unhealthy because of it.
   */
  async check(key: string, urlVariable: 'CAD_ENGINE_URL' | 'ECAD_ENGINE_URL', path: string): Promise<HealthIndicatorResult> {
    const base = this.config.get<string>(urlVariable, '').trim();
    if (!base) return this.getStatus(key, true, { configured: false });

    let reason: string;
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (response.ok) return this.getStatus(key, true, { configured: true });
      reason = `http_${response.status}`;
    } catch (error) {
      // By name, not instanceof: the DOMException AbortSignal.timeout throws can come from another realm.
      reason = (error as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'unreachable';
    }
    throw new HealthCheckError(`${key} is not ready`, this.getStatus(key, false, { configured: true, reason }));
  }
}
