import { analysisListView, analysisView } from "./casting-view";
import { type CastingAnalysisRow } from "./casting-analysis.types";

const row = (over: Partial<CastingAnalysisRow> = {}): CastingAnalysisRow => ({
  id: "ca-1",
  organization_id: "o",
  bom_item_id: "i",
  requested_by: "u",
  input_sha256: "s",
  source_path: "p",
  worker_version: "0.13.0",
  schema_version: 1,
  config_hash: "h",
  config: { drawDirection: "y" },
  status: "succeeded",
  attempts: 1,
  error_code: null,
  error_detail: null,
  result: { parts: [{ big: "x".repeat(10) }] },
  output_prefix: "casting-analyses/o/ca-1",
  created_at: "t0",
  started_at: "t1",
  finished_at: "t2",
  ...over,
});

describe("analysis views", () => {
  it("the list carries no result and no storage path (a page polls it)", () => {
    const v = analysisListView(row());
    expect(v).not.toHaveProperty("result");
    expect(v).not.toHaveProperty("output_prefix");
    expect(v).not.toHaveProperty("outputPrefix");
    expect(v).toMatchObject({
      id: "ca-1",
      bomItemId: "i",
      status: "succeeded",
      drawDirection: "y",
      workerVersion: "0.13.0",
    });
  });

  it("one analysis carries its result", () => {
    expect(analysisView(row()).result).toEqual({ parts: [{ big: "xxxxxxxxxx" }] });
  });

  it("a row from before the configuration existed is the automatic one", () => {
    expect(analysisListView(row({ config: undefined as never })).drawDirection).toBe(
      "auto",
    );
  });
});
