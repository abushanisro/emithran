import * as http from 'http';
import * as https from 'https';

/**
 * Ends a fixture process without calling process.exit() while handles are still closing: on Windows that races libuv's
 * teardown and aborts the process with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c`
 * (seen in about 1 run in 20 under load, after the fixture had already printed a correct result).
 *
 * It closes the keep-alive connections the fixture's own HTTP clients opened, sets the exit code, and lets the event
 * loop drain. process.exit() stays only as a failsafe, on a timer that does not itself keep the process alive.
 */
export async function finish(code = 0, failsafeMs = 15_000): Promise<void> {
  process.exitCode = code;
  http.globalAgent.destroy();
  https.globalAgent.destroy();
  try {
    // Node's built-in fetch (undici) keeps its connections open for a few seconds.
    const dispatcher = (globalThis as Record<symbol, { close?: () => Promise<void> } | undefined>)[Symbol.for('undici.globalDispatcher.1')];
    await dispatcher?.close?.();
  } catch {
    // nothing left to close
  }
  setTimeout(() => process.exit(code), failsafeMs).unref();
}
