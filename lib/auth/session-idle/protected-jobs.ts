/**
 * Browser-run flows that may hold the session open past the idle deadline.
 *
 * Only the flows whose later steps run from the browser, and so would be cut
 * off by a logout, are protected:
 *   - CAD auto-fill (the result is only delivered by polling)
 *   - Apply Scenario (several dependent requests in a row)
 *   - batch BOM item creation (create, override, upload per file)
 * While one is running, the session idle controller sends 'job' heartbeats,
 * which the server honours for at most 15 minutes past the idle deadline.
 * Server-side work (process plan generation, apply-route) needs no protection:
 * it finishes and is saved whether or not the browser is still there.
 */
export type ProtectedJob = 'cad-autofill' | 'apply-scenario' | 'bom-batch-create';

type Listener = (count: number) => void;

const running = new Map<number, ProtectedJob>();
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  for (const l of listeners) l(running.size);
}

/** Marks a protected flow as running until the returned function is called. */
export function beginProtectedJob(job: ProtectedJob): () => void {
  const id = nextId++;
  running.set(id, job);
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running.delete(id);
    notify();
  };
}

/** Runs fn as a protected flow; it stops counting when fn settles, success or failure. */
export async function runProtectedJob<T>(job: ProtectedJob, fn: () => Promise<T>): Promise<T> {
  const end = beginProtectedJob(job);
  try {
    return await fn();
  } finally {
    end();
  }
}

export function protectedJobCount(): number {
  return running.size;
}

export function subscribeProtectedJobs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
