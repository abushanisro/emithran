import { CASTING_WORKER_VERSION } from "./casting-analysis.types";
import { CastingRetention, prunable, retentionDays, type RetentionRow } from "./casting-retention";

const NOW = new Date("2026-11-05T00:00:00Z");
const DAYS = 90;
const cutoff = new Date(NOW.getTime() - DAYS * 86_400_000); // 2026-08-07
const old = "2026-06-01T00:00:00Z";
const recent = "2026-10-20T00:00:00Z";

const row = (over: Partial<RetentionRow> = {}): RetentionRow => ({
  id: "a1", status: "succeeded", finished_at: old, worker_version: CASTING_WORKER_VERSION, source_path: "files/v1.step", output_prefix: "casting-analyses/org/a1", bom_item_id: "item-1", organization_id: "org", ...over,
});
const files = new Map<string, string | null>([["item-1", "files/v1.step"], ["item-2", "files/new.step"]]);

describe("which analyses retention removes", () => {
  it("keeps one that is recent, current in worker and file, queued or running", () => {
    const keep = [row(), row({ finished_at: recent }), row({ status: "queued", finished_at: null }), row({ status: "running", finished_at: old }), row({ finished_at: null })];
    expect(prunable(keep, files, cutoff, CASTING_WORKER_VERSION)).toEqual([]);
  });

  it("removes a failed one past the cutoff, and not a recent failure", () => {
    expect(prunable([row({ id: "f1", status: "failed" }), row({ id: "f2", status: "failed", finished_at: recent })], files, cutoff, CASTING_WORKER_VERSION)).toEqual(["f1"]);
  });

  it("removes one for a file the item no longer has, and not one for a file it has", () => {
    const rows = [row({ id: "replaced", bom_item_id: "item-2" }), row({ id: "current", bom_item_id: "item-1" })];
    expect(prunable(rows, files, cutoff, CASTING_WORKER_VERSION)).toEqual(["replaced"]);
  });

  it("removes one made by an earlier worker, and not one made by this one", () => {
    expect(prunable([row({ id: "old-worker", worker_version: "0.1.0" }), row({ id: "this" })], files, cutoff, CASTING_WORKER_VERSION)).toEqual(["old-worker"]);
  });

  it("an item that cannot be read is not treated as having replaced its file", () => {
    expect(prunable([row({ id: "unknown", bom_item_id: "item-9" })], files, cutoff, CASTING_WORKER_VERSION)).toEqual([]);
  });
});

describe("the retention setting", () => {
  it("is on only for a positive whole number of days", () => {
    expect(retentionDays("90")).toBe(90);
    for (const v of [undefined, "", " ", "0", "-3", "1.5", "abc"]) expect(retentionDays(v)).toBeNull();
  });
});

/** A fake of the two clients and the store: rows by id, the BOM items' files, the files by key. */
function setup(rows: RetentionRow[], keys: string[], sharedPrefix?: string) {
  const store = new Map<string, string[]>(); // folder -> names
  for (const k of keys) {
    const parts = k.split("/");
    const name = parts.pop() as string;
    const folder = parts.join("/");
    store.set(folder, [...(store.get(folder) ?? []), name]);
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts[i] as string;
      if (!(store.get(parent) ?? []).includes(child)) store.set(parent, [...(store.get(parent) ?? []), child]);
    }
  }
  const state = { rows: [...rows], removed: [] as string[] };
  const builder = (table: string) => {
    let verb = "select";
    let ids: string[] | null = null;
    let eq: [string, unknown] | null = null;
    let head = false;
    const b: Record<string, unknown> = {};
    const result = () => {
      if (table === "bom_items") return { data: [...files].map(([id, f]) => ({ id, file_3d_path: f })), error: null };
      if (verb === "delete") { state.rows = state.rows.filter((r) => !(ids ?? []).includes(r.id)); return { error: null }; }
      if (head && eq) return { count: state.rows.filter((r) => (r as unknown as Record<string, unknown>)[eq![0]] === eq![1]).length + (sharedPrefix && eq[1] === sharedPrefix ? 1 : 0), error: null };
      return { data: state.rows, error: null };
    };
    b.select = (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; };
    b.in = (_k: string, v: string[]) => { ids = v; return b; };
    b.lt = () => b; b.order = () => b; b.limit = () => b;
    b.eq = (k: string, v: unknown) => { eq = [k, v]; return b; };
    b.delete = () => { verb = "delete"; return b; };
    b.then = (resolve: (v: unknown) => void) => resolve(result());
    return b;
  };
  const client = { from: builder };
  const objects = {
    list: async (_bucket: string, prefix: string) => store.get(prefix) ?? [],
    remove: async (_bucket: string, k: string[]) => { state.removed.push(...k); },
  };
  const audits: Array<Record<string, unknown>> = [];
  const retention = new CastingRetention({ getPrivilegedClient: () => client } as never, { recordBestEffort: async (e: Record<string, unknown>) => { audits.push(e); } } as never, objects as never);
  return { retention, state, audits };
}

describe("a retention pass", () => {
  it("removes a failed analysis and a superseded one with their files, and audits each organization", async () => {
    const rows = [
      row({ id: "failed", status: "failed", output_prefix: null }),
      row({ id: "replaced", bom_item_id: "item-2", output_prefix: "casting-analyses/org/replaced" }),
      row({ id: "keep", output_prefix: "casting-analyses/org/keep" }),
    ];
    const { retention, state, audits } = setup(rows, ["casting-analyses/org/replaced/model.glb", "casting-analyses/org/replaced/parts/0-1.glb", "casting-analyses/org/keep/model.glb"]);
    const out = await retention.run(DAYS, NOW);
    expect(out).toEqual({ rows: 2, files: 2 });
    expect(state.rows.map((r) => r.id)).toEqual(["keep"]);
    expect(state.removed.sort()).toEqual(["casting-analyses/org/replaced/model.glb", "casting-analyses/org/replaced/parts/0-1.glb"]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "casting_retention.pruned", organizationId: "org", meta: { rows: 2, files: 2, days: DAYS } });
  });

  it("keeps the files while another analysis still points at the same prefix (a reused row)", async () => {
    const rows = [row({ id: "replaced", bom_item_id: "item-2", output_prefix: "casting-analyses/org/shared" })];
    const { retention, state } = setup(rows, ["casting-analyses/org/shared/model.glb"], "casting-analyses/org/shared");
    expect(await retention.run(DAYS, NOW)).toEqual({ rows: 1, files: 0 });
    expect(state.removed).toEqual([]);
  });

  it("does nothing, and audits nothing, when nothing is old enough or superseded", async () => {
    const { retention, state, audits } = setup([row()], ["casting-analyses/org/a1/model.glb"]);
    expect(await retention.run(DAYS, NOW)).toEqual({ rows: 0, files: 0 });
    expect(state.rows).toHaveLength(1);
    expect(audits).toEqual([]);
  });
});
