import { meshKey, meshNames } from "./casting-meshes";

// The part of a worker result that names its files (casting-worker/result.schema.json): a part's mesh and its cores' mesh.
const fixture = {
  parts: [{ glb: "parts/0-1-1-1.glb", casting: { cores_glb: "parts/0-1-1-1-cores.glb" } }],
};

describe("meshNames", () => {
  it("lists the part's mesh and its cores' mesh, as the result names them", () => {
    expect(meshNames(fixture)).toEqual(["parts/0-1-1-1.glb", "parts/0-1-1-1-cores.glb"]);
  });

  it("lists a part with no cores once, and nothing for a result without meshes", () => {
    const noCores = { parts: [{ glb: "parts/a.glb", casting: { cores_glb: null } }] };
    expect(meshNames(noCores)).toEqual(["parts/a.glb"]);
    expect(meshNames({ parts: [{ glb: null }] })).toEqual([]);
    expect(meshNames(null)).toEqual([]);
    expect(meshNames({})).toEqual([]);
  });

  it("never lists a name that could leave the analysis's folder", () => {
    const hostile = { parts: [{ glb: "parts/../../other/secret.glb", casting: { cores_glb: "/etc/passwd.glb" } }, { glb: "parts/a/b.glb" }, { glb: "parts/ok.glb" }] };
    expect(meshNames(hostile)).toEqual(["parts/ok.glb"]);
  });
});

describe("meshKey", () => {
  it("is the analysis's folder and the file name without its parts/ (where the runner stores it)", () => {
    expect(meshKey("casting-analyses/org-1/ca-1", "parts/0-1-1-1.glb")).toBe("casting-analyses/org-1/ca-1/0-1-1-1.glb");
  });
});
