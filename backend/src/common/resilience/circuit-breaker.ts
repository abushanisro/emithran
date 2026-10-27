// A circuit breaker for calls to an external service (the Python CAD and ECAD engines). After `failureThreshold`
// consecutive failures the breaker opens and every call fails at once with CircuitOpenError, instead of each request
// waiting out the full timeout while the service is down. After `openMs` one trial call is let through (half-open):
// success closes the breaker, failure opens it again.
//
// Only failures that mean "the service is unavailable" count (the caller decides, with `isFailure`): a network error,
// a timeout, a 5xx. A 4xx is the service answering that the input is wrong; it is not a reason to stop calling it.
//
// State is per process. With several backend instances each keeps its own breaker, which is what a breaker needs: it
// protects this process's requests from this process's view of the service.
import { Logger } from '@nestjs/common';

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  constructor(readonly service: string, readonly retryInMs: number) {
    super(`${service} is unavailable (circuit open after repeated failures); retrying in ${Math.ceil(retryInMs / 1000)} s`);
    this.name = 'CircuitOpenError';
  }
}

export interface BreakerOptions {
  failureThreshold: number;
  openMs: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface BreakerSnapshot {
  service: string;
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;
  private readonly now: () => number;
  private readonly logger = new Logger(`CircuitBreaker:${this.service}`);

  constructor(readonly service: string, private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  snapshot(): BreakerSnapshot {
    return { service: this.service, state: this.currentState(), consecutiveFailures: this.failures, openedAt: this.openedAt };
  }

  private currentState(): BreakerState {
    if (this.state === 'open' && this.openedAt !== null && this.now() - this.openedAt >= this.options.openMs) return 'half_open';
    return this.state;
  }

  async exec<T>(work: () => Promise<T>, isFailure: (error: unknown) => boolean = () => true): Promise<T> {
    const state = this.currentState();
    if (state === 'open') throw new CircuitOpenError(this.service, this.options.openMs - (this.now() - (this.openedAt ?? this.now())));
    if (state === 'half_open') {
      // One trial at a time; everything else keeps failing fast until it settles.
      if (this.trialInFlight) throw new CircuitOpenError(this.service, 0);
      this.trialInFlight = true;
    }
    try {
      const value = await work();
      this.onSuccess();
      return value;
    } catch (error) {
      if (isFailure(error)) this.onFailure();
      else if (state === 'half_open') this.onSuccess(); // the service answered: it is up
      throw error;
    } finally {
      if (state === 'half_open') this.trialInFlight = false;
    }
  }

  private onSuccess(): void {
    if (this.state !== 'closed') this.logger.log(`${this.service} answered again; circuit closed`);
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    this.failures += 1;
    const wasHalfOpen = this.currentState() === 'half_open';
    if (wasHalfOpen || this.failures >= this.options.failureThreshold) {
      if (this.state !== 'open' || wasHalfOpen) this.logger.warn(`${this.service} failed ${this.failures} time(s) in a row; circuit open for ${this.options.openMs} ms`);
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The process-wide breaker for one external service. ENGINE_BREAKER_FAILURES / ENGINE_BREAKER_OPEN_MS tune it. */
export function breakerFor(service: string): CircuitBreaker {
  let breaker = breakers.get(service);
  if (!breaker) {
    breaker = new CircuitBreaker(service, { failureThreshold: envInt('ENGINE_BREAKER_FAILURES', 5), openMs: envInt('ENGINE_BREAKER_OPEN_MS', 30_000) });
    breakers.set(service, breaker);
  }
  return breaker;
}

export function breakerSnapshots(): BreakerSnapshot[] {
  return [...breakers.values()].map((b) => b.snapshot());
}

/**
 * Whether an HTTP call's error means the service is unavailable: no response (refused, reset, DNS, timeout or abort) or
 * a 5xx. Works for axios errors (error.response.status) and fetch (a thrown TypeError/AbortError has no status).
 */
export function isServiceUnavailable(error: unknown): boolean {
  if (error instanceof CircuitOpenError) return false;
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status === 'number') return status >= 500;
  return true;
}

export const CAD_ENGINE = 'cad-engine';
export const ECAD_ENGINE = 'ecad-engine';
