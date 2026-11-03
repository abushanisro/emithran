import { createHash } from "node:crypto";

import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import {
  CASTING_SCHEMA_VERSION,
  CASTING_WORKER_VERSION,
  DEFAULT_CASTING_CONFIG,
  configHash,
  type CastingAnalysisRow,
} from "./casting-analysis.types";
import { SandCastingService } from "./sand-casting.service";

const BYTES = Buffer.from("ISO-10303-21; a part");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const input = {
  bomItemId: "item-1",
  userId: "user-1",
  organizationId: "org-1",
  token: "t",
};

const row = (over: Partial<CastingAnalysisRow> = {}): CastingAnalysisRow => ({
  id: "ca-1",
  organization_id: "org-1",
  bom_item_id: "item-1",
  requested_by: "user-1",
  input_sha256: SHA,
  worker_version: CASTING_WORKER_VERSION,
  schema_version: CASTING_SCHEMA_VERSION,
  config_hash: configHash(DEFAULT_CASTING_CONFIG),
  status: "queued",
  attempts: 0,
  error_code: null,
  error_detail: null,
  result: null,
  output_prefix: null,
  created_at: "",
  started_at: null,
  finished_at: null,
  ...over,
});

/**
 * Fakes for the two database clients and the store. `own` is the row already stored for this BOM item, `finished` a finished analysis
 * of the same file made for another item, `item` what the user's client can read (null: not visible to this user).
 */
function setup(
  options: {
    own?: CastingAnalysisRow | null;
    finished?: CastingAnalysisRow | null;
    item?: { id: string; file_3d_path: string | null } | null;
    bytes?: Buffer | null;
    raceOnInsert?: boolean;
  } = {},
) {
  const {
    own = null,
    finished = null,
    item = { id: "item-1", file_3d_path: "path/part.step" },
    bytes = BYTES,
    raceOnInsert = false,
  } = options;
  let current = own;
  const calls = {
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  };
  const admin = {
    from: () => ({
      select: () => {
        const chain: Record<string, unknown> = {};
        chain.eq = (column: string) =>
          column === "bom_item_id"
            ? {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: async () => ({ data: current, error: null }),
                      }),
                    }),
                  }),
                }),
              }
            : chain;
        chain.in = () => ({
          limit: async () => ({ data: finished ? [finished] : [], error: null }),
        });
        return chain;
      },
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            calls.inserts.push(values);
            if (raceOnInsert) {
              current = row({ id: "ca-raced" });
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            current = row(values as Partial<CastingAnalysisRow>);
            return { data: current, error: null };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              calls.updates.push(patch);
              current = {
                ...(current as CastingAnalysisRow),
                ...(patch as Partial<CastingAnalysisRow>),
              };
              return { data: current, error: null };
            },
          }),
        }),
      }),
    }),
  };
  const userClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: item, error: null }) }),
      }),
    }),
  };
  const runner = { wake: jest.fn() };
  const audit = { recordBestEffort: jest.fn(async () => undefined) };
  const objects = { get: jest.fn(async () => bytes) };
  const service = new SandCastingService(
    { getPrivilegedClient: () => admin, getUserClient: () => userClient } as never,
    runner as never,
    audit as never,
    objects as never,
  );
  return { service, calls, runner, audit, objects };
}

describe("SandCastingService.request", () => {
  it("queues a new analysis, identifies the file by its hash and the worker version, and wakes the runner", async () => {
    const { service, calls, runner, audit } = setup();
    const { analysis, reused } = await service.request(input);
    expect(reused).toBe(false);
    expect(analysis.status).toBe("queued");
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      organization_id: "org-1",
      bom_item_id: "item-1",
      requested_by: "user-1",
      input_sha256: SHA,
      worker_version: CASTING_WORKER_VERSION,
      schema_version: CASTING_SCHEMA_VERSION,
    });
    expect(runner.wake).toHaveBeenCalledTimes(1);
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "casting_analysis.requested",
        meta: { bomItemId: "item-1", reused: false },
      }),
    );
  });

  it("returns the existing analysis for the same file, without queueing or auditing again", async () => {
    const { service, calls, runner, audit } = setup({ own: row({ status: "running" }) });
    const { analysis, reused } = await service.request(input);
    expect(reused).toBe(true);
    expect(analysis.status).toBe("running");
    expect(calls.inserts).toHaveLength(0);
    expect(runner.wake).not.toHaveBeenCalled();
    expect(audit.recordBestEffort).not.toHaveBeenCalled();
  });

  it("copies a finished analysis of an identical file instead of running the worker again", async () => {
    const finished = row({
      id: "ca-0",
      bom_item_id: "item-0",
      status: "succeeded",
      result: { ok: true },
      output_prefix: "casting-analyses/org-1/ca-0",
    });
    const { service, calls, runner } = setup({ finished });
    const { reused } = await service.request(input);
    expect(reused).toBe(true);
    expect(calls.inserts[0]).toMatchObject({
      bom_item_id: "item-1",
      status: "succeeded",
      result: { ok: true },
      output_prefix: "casting-analyses/org-1/ca-0",
    });
    expect(runner.wake).not.toHaveBeenCalled();
  });

  it("requeues a failed analysis when it is asked for again", async () => {
    const { service, calls, runner } = setup({
      own: row({ status: "failed", attempts: 3, error_code: "worker_failed" }),
    });
    const { analysis, reused } = await service.request(input);
    expect(reused).toBe(false);
    expect(analysis.status).toBe("queued");
    expect(calls.updates[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      error_code: null,
    });
    expect(runner.wake).toHaveBeenCalled();
  });

  it("resolves a race with the same request to the existing row", async () => {
    const { service } = setup({ raceOnInsert: true });
    const { analysis, reused } = await service.request(input);
    expect(analysis.id).toBe("ca-raced");
    expect(reused).toBe(true);
  });

  it("refuses an item the user cannot see, an item without a 3D file, and a file that is gone", async () => {
    await expect(setup({ item: null }).service.request(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      setup({ item: { id: "item-1", file_3d_path: null } }).service.request(input),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(setup({ bytes: null }).service.request(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
