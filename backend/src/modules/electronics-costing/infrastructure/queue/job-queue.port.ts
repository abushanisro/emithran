// The only queue surface the electronics module depends on. Today it is backed by
// pg-boss on the existing Postgres; swapping to BullMQ later means one new adapter
// implementing this interface, with no change to the use cases or the controller.

export const ELECTRONICS_JOB_QUEUE = Symbol('ELECTRONICS_JOB_QUEUE');

export const ELECTRONICS_QUEUES = {
  parse: 'electronics.parse',
  quote: 'electronics.quote',
} as const;
export type ElectronicsQueueName = (typeof ELECTRONICS_QUEUES)[keyof typeof ELECTRONICS_QUEUES];

export type JobState = 'queued' | 'running' | 'completed' | 'failed';

export interface JobStatus {
  state: JobState;
  attempts: number;
  /** What the handler returned, when completed. Ids only, never customer data. */
  output?: Record<string, unknown>;
  /** Failure message of the last attempt, when failed. */
  error?: string;
}

// A handler returns a small, JSON-safe output (ids). Throwing marks the attempt failed.
export type JobHandler<TPayload extends object> = (payload: TPayload) => Promise<Record<string, unknown>>;

export interface QueueHealth {
  /** False when no queue backend was configured at all (the feature then reports that itself). */
  configured: boolean;
  /** True when the backend answered a cheap probe just now. */
  ready: boolean;
}

export interface JobQueue {
  /** Connects and creates the queues. Safe to call once at module init. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Payloads carry ids only; a handler re-reads anything else under its own access rules. */
  enqueue<TPayload extends object>(queue: ElectronicsQueueName, payload: TPayload): Promise<string>;
  work<TPayload extends object>(queue: ElectronicsQueueName, handler: JobHandler<TPayload>): Promise<void>;
  status(queue: ElectronicsQueueName, jobId: string): Promise<JobStatus | null>;
  /** Cheap reachability probe for readiness. Bounded; resolves (never rejects) with what it found. */
  health(): Promise<QueueHealth>;
  /** Jobs waiting to run (queued or awaiting retry); null when the backend cannot tell. For the depth metric. */
  depth(queue: ElectronicsQueueName): Promise<number | null>;
}
