import { SandCastingController } from "./sand-casting.controller";
import type { CastingAnalysisRow } from "./casting-analysis.types";

const row = (over: Partial<CastingAnalysisRow> = {}): CastingAnalysisRow => ({
  id: "ca-1", organization_id: "org-1", bom_item_id: "item-1", requested_by: "u", input_sha256: "s", source_path: "p", worker_version: "0.12.0", schema_version: 1,
  config_hash: "h", config: { drawDirection: "auto" }, status: "succeeded", attempts: 1, error_code: null, error_detail: null, result: { big: "x".repeat(1000) }, output_prefix: null,
  created_at: "2026-11-04T00:00:00Z", started_at: null, finished_at: "2026-11-04T00:01:00Z", ...over,
});

describe("SandCastingController", () => {
  const service = { listForItem: jest.fn(async () => [row(), row({ id: "ca-0", status: "failed", error_code: "host_unreachable" })]), get: jest.fn(async () => row()) };
  const controller = new SandCastingController(service as never);

  it("the list is a light summary: status, versions and errors, never the (large) result, which a page polling the list must not fetch", async () => {
    const list = (await controller.list({ bomItemId: "item-1" }, "t")) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list.every((a) => !("result" in a))).toBe(true);
    expect(list[1]).toMatchObject({ id: "ca-0", status: "failed", errorCode: "host_unreachable", bomItemId: "item-1", drawDirection: "auto" });
  });

  it("one analysis carries its result", async () => {
    const one = (await controller.get("00000000-0000-4000-8000-000000000001", "t")) as { result: unknown };
    expect(one.result).toEqual({ big: "x".repeat(1000) });
  });
});
