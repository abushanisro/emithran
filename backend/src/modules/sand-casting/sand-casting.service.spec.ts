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
  source_path: "path/part.step",
  worker_version: CASTING_WORKER_VERSION,
  schema_version: CASTING_SCHEMA_VERSION,
  config_hash: configHash(DEFAULT_CASTING_CONFIG),
  config: DEFAULT_CASTING_CONFIG,
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
    /** The item's draw-direction override as the user's client reads it (null: none, automatic). */
    direction?: { axis: string; reason: string; set_by: string; set_at: string; source_path?: string | null; geometry?: unknown } | null;
    /** The result of the item's automatic analysis of its current file, the geometry a replaced file is compared with (null: none finished). */
    autoResult?: unknown;
  } = {},
) {
  const {
    own = null,
    finished = null,
    item = { id: "item-1", file_3d_path: "path/part.step" },
    bytes = BYTES,
    raceOnInsert = false,
    direction = null,
    autoResult = null,
  } = options;
  let current = own;
  let storedDirection = direction;
  const calls = {
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    deletes: 0,
  };
  const directionsAdmin = {
    upsert: async (values: Record<string, unknown>) => {
      calls.upserts.push(values);
      storedDirection = { axis: String(values.axis), reason: String(values.reason), set_by: String(values.set_by), set_at: String(values.set_at), source_path: values.source_path as string | null, geometry: values.geometry };
      return { error: null };
    },
    delete: () => ({
      eq: async () => {
        calls.deletes += 1;
        storedDirection = null;
        return { error: null };
      },
    }),
  };
  const admin = {
    from: (table: string) => table === "casting_draw_directions" ? directionsAdmin : ({
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
  // The user's analyses of the item (only the automatic analysis of its current file is asked for here: the geometry to compare a replaced file with).
  const analysesChain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) analysesChain[m] = () => analysesChain;
  analysesChain.limit = async () => ({ data: autoResult ? [{ result: autoResult }] : [], error: null });
  const userClient = {
    from: (table: string) =>
      table === "casting_analyses"
        ? analysesChain
        : {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: table === "casting_draw_directions" ? storedDirection : item, error: null }) }),
            }),
          },
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
      source_path: "path/part.step",
      worker_version: CASTING_WORKER_VERSION,
      schema_version: CASTING_SCHEMA_VERSION,
    });
    expect(runner.wake).toHaveBeenCalledTimes(1);
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "casting_analysis.requested",
        meta: { bomItemId: "item-1", reused: false, drawDirection: "auto" },
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

describe("SandCastingService: the file's path, and finding a result by it", () => {
  it("the same bytes uploaded again under a new path move the existing analysis to that path", async () => {
    const { service, calls } = setup({ own: row({ status: "succeeded", source_path: "old/path.step" }) });
    const { analysis, reused } = await service.request(input);
    expect(reused).toBe(true);
    expect(calls.updates[0]).toEqual({ source_path: "path/part.step" });
    expect(analysis.source_path).toBe("path/part.step");
  });

  function latest(rows: unknown[] | null, error: { message: string } | null = null, direction: { axis: string; reason: string; set_by: string; set_at: string } | null = null) {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => ((filters[c] = v), chain),
      in: (c: string, v: unknown) => ((filters[c] = v), chain),
      order: () => chain,
      limit: async () => ({ data: rows, error }),
    };
    const directions = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: direction, error: null }) }) }) };
    const service = new SandCastingService({ getUserClient: () => ({ from: (t: string) => (t === "casting_draw_directions" ? directions : chain) }) } as never, {} as never, {} as never, {} as never);
    return { service, filters };
  }

  it("returns the newest finished result of the item's current file for the worker this backend was built for", async () => {
    const { service, filters } = latest([{ result: { schema_version: 1 }, worker_version: CASTING_WORKER_VERSION }]);
    expect(await service.latestResult("item-1", "path/part.step", "t")).toEqual({ result: { schema_version: 1 }, workerVersion: CASTING_WORKER_VERSION });
    expect(filters).toMatchObject({ bom_item_id: "item-1", source_path: "path/part.step", worker_version: CASTING_WORKER_VERSION, schema_version: CASTING_SCHEMA_VERSION, status: ["succeeded", "partial"] });
  });

  it("is null without a path, without a row, with no result stored, or on a read error", async () => {
    expect(await latest([]).service.latestResult("item-1", null, "t")).toBeNull();
    expect(await latest([]).service.latestResult("item-1", "p", "t")).toBeNull();
    expect(await latest([{ result: null, worker_version: "x" }]).service.latestResult("item-1", "p", "t")).toBeNull();
    expect(await latest(null, { message: "down" }).service.latestResult("item-1", "p", "t")).toBeNull();
  });
});

describe("SandCastingService.meshUrl", () => {
  const result = { parts: [{ glb: "parts/p.glb", casting: { cores_glb: "parts/p-cores.glb" } }] };
  function build(over: { analysis?: Partial<CastingAnalysisRow> | null; exists?: boolean } = {}) {
    const analysis = over.analysis === null ? null : row({ status: "succeeded", result, output_prefix: "casting-analyses/org-1/ca-1", ...over.analysis });
    const userClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: analysis, error: null }) }) }) }) };
    const objects = { exists: jest.fn(async () => over.exists ?? true), signedGetUrl: jest.fn(async (_b: string, key: string, ttl: number) => `https://store.example/${key}?ttl=${ttl}`) };
    const service = new SandCastingService({ getUserClient: () => userClient } as never, {} as never, {} as never, objects as never);
    return { service, objects };
  }

  it("signs a short-lived URL for a mesh the result lists, at the analysis's own folder", async () => {
    const { service, objects } = build();
    const r = await service.meshUrl("ca-1", "parts/p-cores.glb", "t");
    expect(r).toEqual({ name: "parts/p-cores.glb", url: "https://store.example/casting-analyses/org-1/ca-1/p-cores.glb?ttl=300", expiresInSeconds: 300 });
    expect(objects.signedGetUrl).toHaveBeenCalledWith("bom-files", "casting-analyses/org-1/ca-1/p-cores.glb", 300);
  });

  it("another organization's analysis is not found (row-level security returns nothing), and nothing is signed", async () => {
    const { service, objects } = build({ analysis: null });
    await expect(service.meshUrl("ca-1", "parts/p.glb", "t")).rejects.toBeInstanceOf(NotFoundException);
    expect(objects.signedGetUrl).not.toHaveBeenCalled();
  });

  it("refuses a name the result does not list, however close, and an analysis with no stored files or a missing object", async () => {
    for (const name of ["parts/other.glb", "parts/../p.glb", "model.glb", "parts/p.glb/", ""]) {
      await expect(build().service.meshUrl("ca-1", name, "t")).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(build({ analysis: { output_prefix: null } }).service.meshUrl("ca-1", "parts/p.glb", "t")).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ exists: false }).service.meshUrl("ca-1", "parts/p.glb", "t")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SandCastingService: the engineer's draw direction", () => {
  // A part of 100 x 60 x 40 mm with 12 faces, as an analysis measured it; the override was set on it, on the item's file.
  const partResult = (over: Record<string, unknown> = {}) => ({
    parts: [{ solids: 1, faces: 12, edges: 24, volume_mm3: 216000, area_mm2: 30400, box_mm: { size: [100, 60, 40] }, ...over }],
  });
  const GEOMETRY = { solids: 1, faces: 12, edges: 24, volumeMm3: 216000, areaMm2: 30400, boxMm: [100, 60, 40] };
  const set = { axis: "y", reason: "the pattern is split along the long side", set_by: "u", set_at: "2026-11-04T10:00:00.000Z", source_path: "path/part.step", geometry: GEOMETRY };

  it("without an override the analysis is the automatic one; with one, the analysis along that axis (a different key, so the automatic one is kept)", async () => {
    const auto = setup();
    await auto.service.request(input);
    expect(auto.calls.inserts[0]).toMatchObject({ config: { drawDirection: "auto" }, config_hash: configHash({ drawDirection: "auto" }) });
    const fixed = setup({ direction: set });
    await fixed.service.request(input);
    expect(fixed.calls.inserts[0]).toMatchObject({ config: { drawDirection: "y" }, config_hash: configHash({ drawDirection: "y" }) });
    expect(configHash({ drawDirection: "y" })).not.toBe(configHash({ drawDirection: "auto" }));
  });

  it("setting it stores axis, trimmed reason, user and organization, audits the change with the previous axis, and asks for the analysis along it", async () => {
    const { service, calls, audit } = setup();
    const out = await service.setDrawDirection(input, "z", "  foundry splits it flat  ");
    expect(calls.upserts).toEqual([expect.objectContaining({ bom_item_id: "item-1", organization_id: "org-1", axis: "z", reason: "foundry splits it flat", set_by: "user-1" })]);
    expect(audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.set", targetId: "item-1", meta: { axis: "z", reason: "foundry splits it flat", previousAxis: null } }));
    expect(calls.inserts[0]).toMatchObject({ config: { drawDirection: "z" } });
    expect(out.drawDirection).toMatchObject({ axis: "z", reason: "foundry splits it flat", setBy: "user-1" });
    expect(out.analysis.config).toEqual({ drawDirection: "z" });
  });

  it("changing it records the axis it replaced", async () => {
    const { service, audit } = setup({ direction: set });
    await service.setDrawDirection(input, "x", "second thoughts");
    expect(audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.set", meta: { axis: "x", reason: "second thoughts", previousAxis: "y" } }));
  });

  it("clearing it removes the override, audits what was removed, and asks for the automatic analysis", async () => {
    const { service, calls, audit } = setup({ direction: set });
    const out = await service.clearDrawDirection(input);
    expect(calls.deletes).toBe(1);
    expect(audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.cleared", meta: { previousAxis: "y", previousReason: set.reason } }));
    expect(out.drawDirection).toEqual({ axis: null, declaredAxis: null, reason: null, setBy: null, setAt: null, status: null, notice: null });
    expect(calls.inserts[0]).toMatchObject({ config: { drawDirection: "auto" } });
  });

  it("clearing when there is none changes and audits nothing but the request", async () => {
    const { service, audit } = setup();
    await service.clearDrawDirection(input);
    expect(audit.recordBestEffort).not.toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.cleared" }));
  });

  it("an item the user cannot see (another organization) is not found, and nothing is stored", async () => {
    const { service, calls } = setup({ item: null });
    await expect(service.setDrawDirection(input, "x", "reason")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.clearDrawDirection(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.upserts).toEqual([]);
    expect(calls.deletes).toBe(0);
  });

  it("a stored axis this backend does not know is no override", async () => {
    const { service } = setup({ direction: { ...set, axis: "w" } });
    expect(await service.drawDirection("item-1", "t")).toEqual({ axis: null, declaredAxis: null, reason: null, setBy: null, setAt: null, status: null, notice: null });
  });

  function latest(rows: unknown[], _error: null, direction: typeof set | null) {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => ((filters[c] = v), chain),
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null }),
    };
    const directions = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: direction, error: null }) }) }) };
    const service = new SandCastingService({ getUserClient: () => ({ from: (t: string) => (t === "casting_draw_directions" ? directions : chain) }) } as never, {} as never, {} as never, {} as never);
    return { service, filters };
  }

  it("the result used for the item is the one along its draw direction: the automatic analysis does not answer an override", async () => {
    const auto = latest([{ result: { r: 1 }, worker_version: CASTING_WORKER_VERSION }], null, null);
    await auto.service.latestResult("item-1", "p", "t");
    expect(auto.filters).toMatchObject({ config_hash: configHash({ drawDirection: "auto" }) });
    const fixed = latest([{ result: { r: 1 }, worker_version: CASTING_WORKER_VERSION }], null, { ...set, source_path: "p" });
    await fixed.service.latestResult("item-1", "p", "t");
    expect(fixed.filters).toMatchObject({ config_hash: configHash({ drawDirection: "y" }) });
  });
});

describe("SandCastingService: a draw direction is bound to the geometry it was chosen on", () => {
  const partResult = (over: Record<string, unknown> = {}) => ({
    parts: [{ solids: 1, faces: 12, edges: 24, volume_mm3: 216000, area_mm2: 30400, box_mm: { size: [100, 60, 40] }, ...over }],
  });
  const GEOMETRY = { solids: 1, faces: 12, edges: 24, volumeMm3: 216000, areaMm2: 30400, boxMm: [100, 60, 40] };
  const base = { axis: "y", reason: "split on the long side", set_by: "u", set_at: "2026-11-04T10:00:00.000Z" };
  /** The item's file is path/part.step now; the override was set on `was`. */
  const overrideOn = (was: string | null, geometry: unknown = GEOMETRY) => ({ ...base, source_path: was, geometry });

  it("while the item's file is the one it was set on, it applies, and the analysis runs along it", async () => {
    const t = setup({ direction: overrideOn("path/part.step") });
    expect(await t.service.drawDirection("item-1", "t", "path/part.step")).toMatchObject({ axis: "y", declaredAxis: "y", status: "in_force", notice: null });
    await t.service.request(input);
    expect(t.calls.inserts[0]).toMatchObject({ config: { drawDirection: "y" } });
  });

  it("a replaced file that is the same geometry keeps it: the analysis still runs along the axis", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: partResult({ volume_mm3: 216000.3, box_mm: { size: [100.002, 60, 40] } }) });
    expect(await t.service.drawDirection("item-1", "t", "path/part.step")).toMatchObject({ axis: "y", status: "in_force" });
    await t.service.request(input);
    expect(t.calls.inserts[0]).toMatchObject({ config: { drawDirection: "y" } });
  });

  it("a replaced file that is a different geometry holds it back: automatic analysis, the choice still shown with why", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: partResult({ faces: 17, volume_mm3: 250000 }) });
    const view = await t.service.drawDirection("item-1", "t", "path/part.step");
    expect(view).toMatchObject({ axis: null, declaredAxis: "y", reason: "split on the long side", status: "needs_confirmation" });
    expect(view.notice).toMatch(/different geometry \(faces 12 to 17; volume 216000 to 250000 mm3\).*Confirm it for the new file or remove it/);
    await t.service.request(input);
    expect(t.calls.inserts[0]).toMatchObject({ config: { drawDirection: "auto" } });
  });

  it("a replaced file not analysed yet is pending, and runs automatically so it can be compared", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: null });
    expect(await t.service.drawDirection("item-1", "t", "path/part.step")).toMatchObject({ axis: null, declaredAxis: "y", status: "pending" });
    await t.service.request(input);
    expect(t.calls.inserts[0]).toMatchObject({ config: { drawDirection: "auto" } });
  });

  it("an override whose geometry was never recorded is not carried over to a replaced file, even once it is analysed", async () => {
    const t = setup({ direction: overrideOn("old/part.step", null), autoResult: partResult() });
    expect(await t.service.drawDirection("item-1", "t", "path/part.step")).toMatchObject({ axis: null, declaredAxis: "y", status: "needs_confirmation" });
  });

  it("the result used for the item is the automatic one while the override is held back", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: partResult({ faces: 17 }) });
    // latestResult reads the user's analyses through the same chain: what matters is the key it asks for
    const asked: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "in", "order"]) chain[m] = () => chain;
    chain.eq = (c: string, v: unknown) => ((asked[c] = v), chain);
    chain.limit = async () => ({ data: [], error: null });
    const service = new SandCastingService({ getUserClient: () => ({ from: (tbl: string) => (tbl === "casting_analyses" ? chain : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: overrideOn("old/part.step"), error: null }) }) }) }) }) } as never, {} as never, {} as never, {} as never);
    await service.latestResult("item-1", "path/part.step", "t");
    expect(asked).toMatchObject({ config_hash: configHash({ drawDirection: "auto" }) });
    void t;
  });

  it("setting it records the file and the geometry as measured so far; with no analysis yet the geometry is not recorded", async () => {
    const withAnalysis = setup({ autoResult: partResult() });
    await withAnalysis.service.setDrawDirection(input, "z", "foundry splits it flat");
    expect(withAnalysis.calls.upserts[0]).toMatchObject({ source_path: "path/part.step", geometry: GEOMETRY });
    const none = setup();
    await none.service.setDrawDirection(input, "z", "foundry splits it flat");
    expect(none.calls.upserts[0]).toMatchObject({ source_path: "path/part.step", geometry: null });
  });

  it("confirming a held-back override for the new file (setting it again) binds it to the new file, and audits the axis it replaced", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: partResult({ faces: 17, volume_mm3: 250000 }) });
    const out = await t.service.setDrawDirection(input, "y", "confirmed for the new file");
    expect(t.calls.upserts[0]).toMatchObject({ axis: "y", source_path: "path/part.step", geometry: expect.objectContaining({ faces: 17, volumeMm3: 250000 }) });
    expect(t.audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.set", meta: { axis: "y", reason: "confirmed for the new file", previousAxis: "y" } }));
    expect(out.drawDirection).toMatchObject({ axis: "y", status: "in_force" });
  });

  it("removing a held-back override is audited like any other (it was the engineer's choice, applied or not)", async () => {
    const t = setup({ direction: overrideOn("old/part.step"), autoResult: partResult({ faces: 17 }) });
    await t.service.clearDrawDirection(input);
    expect(t.calls.deletes).toBe(1);
    expect(t.audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: "casting_draw_direction.cleared", meta: { previousAxis: "y", previousReason: "split on the long side" } }));
  });
});

describe("SandCastingService.currentStatuses", () => {
  function statuses(rows: { status: string }[] | null, error: { message: string } | null = null, direction: { axis: string } | null = null) {
    const filters: Record<string, unknown> = {};
    // The status query ends on the last filter, so the chain itself is awaitable.
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => ((filters[c] = v), chain),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error }),
    };
    const directions = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: direction, error: null }) }) }) };
    const service = new SandCastingService({ getUserClient: () => ({ from: (t: string) => (t === "casting_draw_directions" ? directions : chain) }) } as never, {} as never, {} as never, {} as never);
    return { service, filters };
  }

  it("lists the statuses of the item's analyses of its current file, worker version and draw direction", async () => {
    const { service, filters } = statuses([{ status: "queued" }, { status: "succeeded" }]);
    expect(await service.currentStatuses("item-1", "path/part.step", "t")).toEqual(["queued", "succeeded"]);
    expect(filters).toMatchObject({
      bom_item_id: "item-1", source_path: "path/part.step", worker_version: CASTING_WORKER_VERSION,
      schema_version: CASTING_SCHEMA_VERSION, config_hash: configHash({ drawDirection: "auto" }),
    });
  });

  it("is empty without a file path or without rows, and a read error is thrown, never read as 'not requested'", async () => {
    expect(await statuses([]).service.currentStatuses("item-1", null, "t")).toEqual([]);
    expect(await statuses(null).service.currentStatuses("item-1", "p", "t")).toEqual([]);
    await expect(statuses(null, { message: "down" }).service.currentStatuses("item-1", "p", "t")).rejects.toThrow("Could not read the casting analysis status: down");
  });
});
