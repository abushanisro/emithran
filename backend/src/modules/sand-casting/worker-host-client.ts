import { connect } from "node:net";

// The client half of core/crates/runner/src/wire.rs: one connection carries one job. The geometry worker lives in its own
// sandboxed container (no network, no credentials) behind `cad-worker-host`; the only channel is a Unix socket on a shared volume.
//
//   client -> host   header { deadline_ms, inputs: [{ name, len }] }, then each input's bytes in that order
//   host -> client   header { outcome, outputs: [{ name, len }] }, then each output's bytes
//
// A header is a 4-byte big-endian length followed by that much JSON. Names are plain file names; outputs are `result.json` or
// `parts/<name>`. Nothing here builds a path from a name the host chose.

const MAX_HEADER_BYTES = 1 << 20;
const MAX_NAME_BYTES = 255;

export type Ended = { exited: number } | "signalled" | "overran" | { not_run: string };
export interface WorkerOutcome {
  ended: Ended;
  tail: string;
}

export interface HostOutput {
  result: Buffer | null;
  parts: Map<string, Buffer>;
}

/** Why a run failed, for the job: `permanent` means the file is at fault and a retry cannot help. */
export class WorkerRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface HostLimits {
  deadlineMs: number;
  /** Past the deadline, how long to wait for the answer before giving up on this attempt. */
  answerMarginMs: number;
  maxOutputs: number;
  maxOutputBytes: number;
}

const isPlainName = (name: string): boolean =>
  name !== "" &&
  Buffer.byteLength(name) <= MAX_NAME_BYTES &&
  name !== "." &&
  name !== ".." &&
  !/[/\0]/.test(name);

export const isOutputName = (name: string): boolean =>
  name === "result.json" ||
  (name.startsWith("parts/") && isPlainName(name.slice("parts/".length)));

/** The worker's exit codes (casting-worker/src/main.cpp): 2 unreadable STEP and 3 no solids are the file's fault; the rest may pass on a retry. */
export function classifyOutcome(outcome: WorkerOutcome): void {
  const tail = outcome.tail.replace(/\s+/g, " ").trim().slice(0, 400);
  const detail = (what: string) => (tail ? `${what}: ${tail}` : what);
  const ended = outcome.ended;
  if (ended === "signalled")
    throw new WorkerRunError(
      "worker_killed",
      "the worker was killed by a signal (a crash or a resource limit)",
      false,
    );
  if (ended === "overran")
    throw new WorkerRunError(
      "deadline_exceeded",
      "the worker did not stop at its deadline and was killed",
      false,
    );
  if ("not_run" in ended)
    throw new WorkerRunError("worker_not_run", detail(ended.not_run), false);
  switch (ended.exited) {
    case 0:
      return;
    case 2:
      throw new WorkerRunError(
        "unreadable_step",
        detail("The STEP file could not be read"),
        true,
      );
    case 3:
      throw new WorkerRunError(
        "no_solids",
        detail("The STEP file holds no solids"),
        true,
      );
    case 4:
      throw new WorkerRunError(
        "deadline_exceeded",
        detail("the worker hit its deadline"),
        false,
      );
    default:
      throw new WorkerRunError(
        "worker_failed",
        detail(`the worker exited with code ${ended.exited}`),
        false,
      );
  }
}

/** Collects what arrives on a socket so a header and bodies of exact lengths can be read in turn. */
class Reader {
  private chunks: Buffer[] = [];
  private length = 0;
  private ended = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(socket: import("node:net").Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.length += chunk.length;
      this.notify();
    });
    socket.on("end", () => {
      this.ended = true;
      this.notify();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.notify();
    });
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async read(bytes: number): Promise<Buffer> {
    while (this.length < bytes) {
      if (this.failure) throw this.failure;
      if (this.ended)
        throw new Error("the connection closed before the whole answer arrived");
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
    const all = Buffer.concat(this.chunks);
    this.chunks = [all.subarray(bytes)];
    this.length = all.length - bytes;
    return all.subarray(0, bytes);
  }
}

export class WorkerHostClient {
  constructor(
    private readonly socketPath: string,
    private readonly limits: HostLimits,
  ) {}

  /** Runs the worker on `inputs` and returns what it wrote. Throws WorkerRunError for what the ending means for the job. */
  async run(inputs: { name: string; bytes: Buffer }[]): Promise<HostOutput> {
    const budget = this.limits.deadlineMs + this.limits.answerMarginMs;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new WorkerRunError(
              "host_timeout",
              "the geometry worker host did not answer in time",
              false,
            ),
          ),
        budget,
      );
    });
    try {
      const { outcome, output } = await Promise.race([this.exchange(inputs), timeout]);
      classifyOutcome(outcome);
      return output;
    } finally {
      clearTimeout(timer);
    }
  }

  private async exchange(
    inputs: { name: string; bytes: Buffer }[],
  ): Promise<{ outcome: WorkerOutcome; output: HostOutput }> {
    const socket = connect(this.socketPath);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      }).catch((error: Error) => {
        throw new WorkerRunError(
          "host_unreachable",
          `cannot reach the geometry worker host at ${this.socketPath}: ${error.message}`,
          false,
        );
      });
      const reader = new Reader(socket);
      const header = Buffer.from(
        JSON.stringify({
          deadline_ms: this.limits.deadlineMs,
          inputs: inputs.map((i) => ({ name: i.name, len: i.bytes.length })),
        }),
      );
      if (header.length > MAX_HEADER_BYTES)
        throw new WorkerRunError(
          "request_too_large",
          "the request header is too large",
          true,
        );
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(header.length);
      socket.write(prefix);
      socket.write(header);
      for (const input of inputs) socket.write(input.bytes);

      const answerLength = (await reader.read(4)).readUInt32BE();
      if (answerLength > MAX_HEADER_BYTES)
        throw new WorkerRunError(
          "host_protocol",
          `an answer header of ${answerLength} bytes is larger than allowed`,
          false,
        );
      const answer = JSON.parse((await reader.read(answerLength)).toString("utf8")) as {
        outcome: WorkerOutcome;
        outputs: { name: string; len: number }[];
      };
      this.checkOutputs(answer.outputs);
      const output: HostOutput = { result: null, parts: new Map() };
      for (const entry of answer.outputs) {
        const bytes = await reader.read(entry.len);
        if (entry.name === "result.json") output.result = Buffer.from(bytes);
        else output.parts.set(entry.name.slice("parts/".length), Buffer.from(bytes));
      }
      return { outcome: answer.outcome, output };
    } catch (error) {
      if (error instanceof WorkerRunError) throw error;
      throw new WorkerRunError(
        "host_protocol",
        `the geometry worker host's answer was unusable: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    } finally {
      socket.destroy();
    }
  }

  private checkOutputs(outputs: { name: string; len: number }[]): void {
    const bad = (why: string) =>
      new WorkerRunError(
        "host_protocol",
        `the geometry worker host's answer is outside its contract: ${why}`,
        false,
      );
    if (!Array.isArray(outputs)) throw bad("no output list");
    if (outputs.length > this.limits.maxOutputs)
      throw bad(`${outputs.length} files, more than ${this.limits.maxOutputs}`);
    const seen = new Set<string>();
    let total = 0;
    for (const entry of outputs) {
      if (typeof entry.name !== "string" || !isOutputName(entry.name))
        throw bad(`${JSON.stringify(entry.name)} is not an allowed file name`);
      if (!Number.isSafeInteger(entry.len) || entry.len < 0)
        throw bad(`${entry.name} has an invalid length`);
      if (seen.has(entry.name)) throw bad(`${entry.name} is listed twice`);
      seen.add(entry.name);
      total += entry.len;
    }
    if (total > this.limits.maxOutputBytes)
      throw bad(`${total} bytes, more than ${this.limits.maxOutputBytes}`);
  }
}
