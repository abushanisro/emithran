/**
 * How long to wait before the next poll of a running job.
 *
 * A poll that keeps failing (the API is down or restarting) must not keep hitting it at full speed from every open tab: when it comes back, all
 * tabs would call at the same instant. While the last answer was an error the wait doubles with each failure, up to a cap; one good answer
 * returns to the normal rate. Pure, so it is tested without a browser.
 */
export const BACKOFF_CAP_MS = 30_000;

export function pollDelay(normalMs: number, lastAnswerFailed: boolean, failuresInARow: number): number {
  if (!lastAnswerFailed) return normalMs;
  return Math.min(normalMs * 2 ** Math.min(Math.max(failuresInARow, 1), 10), BACKOFF_CAP_MS);
}
