import { createHash } from "node:crypto";

import {
  CASTING_SCHEMA_VERSION,
  CASTING_WORKER_VERSION,
  type CastingAnalysisConfig,
  type CastingAnalysisRow,
} from "./casting-analysis.types";
import { CastingAnalysisRunner } from "./casting-analysis-runner";
import { type HostOutput, WorkerRunError } from "./worker-host-client";

// The schema itself is checked against the worker's own output by casting-worker/check.sh; here the runner's decisions are.
jest.mock("./casting-result", () => ({
  parseCastingResult: (raw: { bad?: boolean }) => {
    if (raw.bad) throw new Error("outside its contract");
    return raw;
  },
}));

const BYTES = Buffer.from("ISO-10303-21; a part");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const claimed = (over: Partial<CastingAnalysisRow> = {}): CastingAnalysisRow => ({
  id: "ca-1",
  organization_id: "org-1",
  bom_item_id: "item-1",
  requested_by: "u",
  input_sha256: SHA,
  source_path: "path/part.step",
  worker_version: CASTING_WORKER_VERSION,
  schema_version: CASTING_SCHEMA_VERSION,
  config_hash: "h",
  config: { drawDirection: "auto" },
  status: "running",
  attempts: 1,
  error_code: null,
  error_detail: null,
  result: null,
  output_prefix: null,
  created_at: "",
  started_at: "",
  finished_at: null,
  ...over,
});
const resultJson = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      schema_version: CASTING_SCHEMA_VERSION,
      units: "mm",
      status: "complete",
      diagnostics: { worker_version: CASTING_WORKER_VERSION },
      ...over,
    }),
  );

class TestRunner extends CastingAnalysisRunner {
  answer: () => Promise<HostOutput> = async () => ({
    result: resultJson(),
    parts: new Map(),
  });
  configs: CastingAnalysisConfig[] = [];
  protected runWorker(_bytes: Buffer, config: CastingAnalysisConfig): Promise<HostOutput> {
    this.configs.push(config);
    return this.answer();
  }
}

function setup(
  rows: CastingAnalysisRow[],
  options: { path?: string | null; bytes?: Buffer | null } = {},
) {
  const { path = "p/part.step", bytes = BYTES } = options;
  const queue = [...rows];
  const updates: { patch: Record<string, unknown>; where: Record<string, unknown> }[] =
    [];
  const admin = {
    rpc: async () => ({ data: queue.splice(0, 1), error: null }),
    from: (table: string) =>
      table === "bom_items"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { file_3d_path: path }, error: null }),
              }),
            }),
          }
        : {
            update: (patch: Record<string, unknown>) => ({
              eq: (c1: string, v1: unknown) => ({
                eq: async (c2: string, v2: unknown) => {
                  updates.push({ patch, where: { [c1]: v1, [c2]: v2 } });
                  return { error: null };
                },
              }),
            }),
          },
  };
  const stored: string[] = [];
  const objects = {
    get: async () => bytes,
    put: async (_b: string, key: string) => void stored.push(key),
  };
  const audit = { recordBestEffort: jest.fn(async () => undefined) };
  process.env.CASTING_WORKER_SOCKET = "/unused.sock";
  const runner = new TestRunner(
    { getPrivilegedClient: () => admin } as never,
    audit as never,
    objects as never,
  );
  return { runner, updates, stored, audit, queue };
}

afterEach(() => {
  delete process.env.CASTING_WORKER_SOCKET;
});

describe("CastingAnalysisRunner", () => {
  it("stores a complete result as succeeded, with the worker's files under the analysis's own folder", async () => {
    const t = setup([claimed()]);
    t.runner.answer = async () => ({
      result: resultJson(),
      parts: new Map([["p1.glb", Buffer.from("g")]]),
    });
    await t.runner.tick();
    expect(t.stored).toEqual(["casting-analyses/org-1/ca-1/p1.glb"]);
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].patch).toMatchObject({
      status: "succeeded",
      output_prefix: "casting-analyses/org-1/ca-1",
      error_code: null,
    });
    expect(t.updates[0].where).toEqual({ id: "ca-1", status: "running" }); // only a row it still holds
  });

  it("stores a partial result as partial", async () => {
    const t = setup([claimed()]);
    t.runner.answer = async () => ({
      result: resultJson({ status: "partial" }),
      parts: new Map(),
    });
    await t.runner.tick();
    expect(t.updates[0].patch).toMatchObject({ status: "partial" });
  });

  it("fails for good when the file is at fault, and audits it", async () => {
    const t = setup([claimed()]);
    t.runner.answer = async () => {
      throw new WorkerRunError("unreadable_step", "bad", true);
    };
    await t.runner.tick();
    expect(t.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "unreadable_step",
    });
    expect(t.audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "casting_analysis.failed",
        meta: { errorCode: "unreadable_step" },
      }),
    );
  });

  it("puts a retryable failure back in the queue, and stops draining so the retry waits for the next poll", async () => {
    const t = setup([claimed({ attempts: 1 }), claimed({ id: "ca-2" })]);
    t.runner.answer = async () => {
      throw new WorkerRunError("worker_killed", "crash", false);
    };
    await t.runner.tick();
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].patch).toMatchObject({
      status: "queued",
      error_code: "worker_killed",
    });
    expect(t.queue).toHaveLength(1); // the second analysis was not started
    expect(t.audit.recordBestEffort).not.toHaveBeenCalled();
  });

  it("fails a retryable failure for good on the last attempt", async () => {
    const t = setup([claimed({ attempts: 3 })]);
    t.runner.answer = async () => {
      throw new WorkerRunError("worker_killed", "crash", false);
    };
    await t.runner.tick();
    expect(t.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "worker_killed",
    });
  });

  it("refuses a file that changed since the request, a missing file, and a worker it was not built for", async () => {
    const changed = setup([claimed({ input_sha256: "other" })]);
    await changed.runner.tick();
    expect(changed.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "input_changed",
    });

    const missing = setup([claimed()], { bytes: null });
    await missing.runner.tick();
    expect(missing.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "cad_file_missing",
    });

    const skew = setup([claimed()]);
    skew.runner.answer = async () => ({
      result: resultJson({ diagnostics: { worker_version: "9.9.9" } }),
      parts: new Map(),
    });
    await skew.runner.tick();
    expect(skew.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "worker_version_mismatch",
    });
  });

  it("treats a result outside the contract, or no result at all, as a worker failure", async () => {
    const bad = setup([claimed({ attempts: 3 })]);
    bad.runner.answer = async () => ({
      result: Buffer.from('{"bad":true}'),
      parts: new Map(),
    });
    await bad.runner.tick();
    expect(bad.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "invalid_result",
    });

    const none = setup([claimed({ attempts: 3 })]);
    none.runner.answer = async () => ({ result: null, parts: new Map() });
    await none.runner.tick();
    expect(none.updates[0].patch).toMatchObject({
      status: "failed",
      error_code: "no_result",
    });
  });

  it("does nothing, and claims nothing, without a worker socket", async () => {
    const t = setup([claimed()]);
    delete process.env.CASTING_WORKER_SOCKET;
    const off = new TestRunner(
      {
        getPrivilegedClient: () => {
          throw new Error("must not be used");
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(off.tick()).resolves.toBeUndefined();
    expect(t.queue).toHaveLength(1);
  });
});

describe("CastingAnalysisRunner: the engineer's draw direction", () => {
  const casting = (axis: string, source: string) => ({ parts: [{ casting: { draw_axis: axis, draw_axis_source: source } }, { casting: null }] });

  it("runs the worker with the configuration of the row, and stores the result when the worker measured along the asked axis", async () => {
    const t = setup([claimed({ config: { drawDirection: "y" } })]);
    t.runner.answer = async () => ({ result: resultJson(casting("y", "requested")), parts: new Map() });
    await t.runner.tick();
    expect(t.runner.configs).toEqual([{ drawDirection: "y" }]);
    expect(t.updates[0].patch).toMatchObject({ status: "succeeded" });
  });

  it("an automatic analysis is run automatic and must say the worker chose", async () => {
    const t = setup([claimed()]);
    t.runner.answer = async () => ({ result: resultJson(casting("x", "auto")), parts: new Map() });
    await t.runner.tick();
    expect(t.runner.configs).toEqual([{ drawDirection: "auto" }]);
    expect(t.updates[0].patch).toMatchObject({ status: "succeeded" });
  });

  it("a result along another axis than asked is refused for good, never stored as the answer", async () => {
    const t = setup([claimed({ config: { drawDirection: "y" } })]);
    t.runner.answer = async () => ({ result: resultJson(casting("x", "auto")), parts: new Map() });
    await t.runner.tick();
    expect(t.updates[0].patch).toMatchObject({ status: "failed", error_code: "draw_direction_mismatch" });
    expect(t.stored).toEqual([]);
  });

  it("a configuration this backend does not know is refused without running the worker", async () => {
    const t = setup([claimed({ config: { drawDirection: "w" } as never })]);
    await t.runner.tick();
    expect(t.runner.configs).toEqual([]);
    expect(t.updates[0].patch).toMatchObject({ status: "failed", error_code: "invalid_config" });
  });
});
