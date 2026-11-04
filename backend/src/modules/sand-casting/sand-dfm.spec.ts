import { type DfmReference, analysedPartOf, evaluateSandDfm } from "./sand-dfm";

// Rows exactly as the published rule data has them (Lookup/lookupTables_Component_manufacturabilitySeverity.csv, adviceRules.csv).
const row = (o: Record<string, string>) => ({ "Rule Name": "", "Threshold Name": "", "Process Name": "", "Material Type": "", "Rule Type": "", Critical: "", Major: "", Minor: "", Units: "", Notes: "", ...o });
const SEVERITY = [
  row({ "Rule Name": "InsufficientHoleDiameter", "Threshold Name": "Insufficient Hole Diameter", "Rule Type": "<", Critical: "4.8", Units: "mm", Notes: "hole too small" }),
  row({ "Rule Name": "HighThroughHoleLengthToDiameterRatio", "Threshold Name": "High Through Hole L/D", "Rule Type": ">", Critical: "2", Notes: "through hole too deep" }),
  row({ "Rule Name": "HighBlindHoleLengthToDiameterRatio", "Threshold Name": "High Blind Hole L/D", "Rule Type": ">", Critical: "1.5", Notes: "blind hole too deep" }),
  row({ "Rule Name": "ThinSection", "Threshold Name": "Min Wall Thickness", "Material Type": "Aluminum", "Rule Type": "<", Major: "3", Units: "mm", Notes: "wall too thin" }),
  row({ "Rule Name": "ThinSection", "Threshold Name": "Min Wall Thickness", "Material Type": "Brass", "Rule Type": "<", Major: "2.3", Units: "mm" }),
  row({ "Rule Name": "ThickSection", "Threshold Name": "Max Wall Thickness", "Rule Type": ">", Major: "1016", Minor: "127", Units: "mm" }),
  row({ "Rule Name": "InsufficientInternalRadius", "Threshold Name": "Insufficient Internal Radius", "Material Type": "Aluminum", "Rule Type": "<", Major: "3", Units: "mm" }),
  row({ "Rule Name": "InsufficientExternalRadius", "Threshold Name": "Insufficient External Radius", "Material Type": "Aluminum", "Rule Type": "<", Major: "0.3", Units: "mm" }),
  row({ "Rule Name": "ClosedVoid", "Threshold Name": "Closed Void", "Rule Type": "Boolean", Critical: "TRUE" }),
  row({ "Rule Name": "InsufficientDraftAngle", "Threshold Name": "Min Draft Angle", "Rule Type": "<", Critical: "0.01", Major: "0.5", Units: "degrees" }),
  row({ "Rule Name": "TightToleranceFlatness", "Threshold Name": "Tolerance - flatness", "Rule Type": "Boolean", Major: "TRUE" }),
];
const ADVICE = [...new Set(SEVERITY.map((r) => r["Rule Name"]))].map((n) => ({ "Advice Rule Name": n, Enabled: "true" }));
const REF: DfmReference = { severity: SEVERITY, adviceRules: ADVICE, version: "2026-SandCasting" };

const feature = (id: string, type: string, parameters: Record<string, number>, faces = [1]) => ({ id, type, parent: null, faces, edges: [], parameters });
const result = (over: { wall?: unknown; features?: unknown[]; draft?: unknown } = {}) => ({
  parts: [{ casting: { wall_mm: over.wall === undefined ? { min: 5, nominal: 10, max: 50, samples: 9 } : over.wall, draft: over.draft ?? null }, features: over.features ?? [] }],
});
/** A wall measurement with the thinnest wall seen from each face (worker 0.15.0). */
const wallWith = (...faces: Array<[number, number]>) => ({ min: 5, nominal: 10, max: 50, samples: 9, faces: faces.map(([face, min]) => ({ face, min, samples: 4 })) });
const evaluate = (r: unknown, material: string | null = "Aluminum") => {
  const out = evaluateSandDfm(r, material, REF);
  if ("reason" in out) throw new Error(out.reason);
  return out;
};

describe("evaluateSandDfm: a part that passes", () => {
  it("raises nothing for a thick enough wall, a big enough hole and a part with no sharp edges, and says what it passed", () => {
    const out = evaluate(result({ features: [feature("SimpleHole:1", "SimpleHole", { diameter_mm: 10, depth_mm: 15, through: 1, l_over_d: 1.5 })] }));
    expect(out.findings).toEqual([]);
    expect(out.passed).toEqual(expect.arrayContaining(["ThinSection", "ThickSection", "InsufficientHoleDiameter", "HighThroughHoleLengthToDiameterRatio"]));
    expect(out.rulesetVersion).toBe("2026-SandCasting");
  });
});

describe("evaluateSandDfm: one failing case per rule", () => {
  it("ThinSection: a 2.5 mm wall in aluminium (limit 3 mm) is Major, a 2.5 mm wall in brass (limit 2.3 mm) is fine", () => {
    const thin = result({ wall: { min: 2.5, nominal: 6, max: 8, samples: 4 } });
    expect(evaluate(thin, "Aluminum").findings).toEqual([expect.objectContaining({ rule: "ThinSection", severity: "Major", measured: 2.5, threshold: 3, comparison: "<", unit: "mm", note: "wall too thin", featureIds: [] })]);
    expect(evaluate(thin, "Brass").findings).toEqual([]);
  });

  it("ThickSection: 150 mm is over the Minor limit 127 only; 1100 mm is over the Major limit 1016", () => {
    expect(evaluate(result({ wall: { min: 5, nominal: 20, max: 150, samples: 4 } })).findings).toEqual([expect.objectContaining({ rule: "ThickSection", severity: "Minor", measured: 150, threshold: 127 })]);
    expect(evaluate(result({ wall: { min: 5, nominal: 20, max: 1100, samples: 4 } })).findings).toEqual([expect.objectContaining({ rule: "ThickSection", severity: "Major", threshold: 1016 })]);
  });

  it("InsufficientHoleDiameter: a 3 mm hole (limit 4.8 mm) is Critical and carries its faces", () => {
    const out = evaluate(result({ features: [feature("SimpleHole:2", "SimpleHole", { diameter_mm: 3, depth_mm: 4, through: 0, l_over_d: 1.33 }, [7, 8])] }));
    expect(out.findings).toEqual([expect.objectContaining({ rule: "InsufficientHoleDiameter", severity: "Critical", measured: 3, threshold: 4.8, featureIds: ["SimpleHole:2"], faces: [7, 8] })]);
  });

  it("HighThroughHoleLengthToDiameterRatio: L/D 2.5 on a through hole is Critical; a blind hole of L/D 2.5 is judged by the blind rule (1.5), not the through rule", () => {
    const through = feature("SimpleHole:1", "SimpleHole", { diameter_mm: 10, depth_mm: 25, through: 1, l_over_d: 2.5 });
    const blind = feature("SimpleHole:2", "SimpleHole", { diameter_mm: 10, depth_mm: 25, through: 0, l_over_d: 2.5 });
    expect(evaluate(result({ features: [through] })).findings.map((f) => [f.rule, f.threshold])).toEqual([["HighThroughHoleLengthToDiameterRatio", 2]]);
    expect(evaluate(result({ features: [blind] })).findings.map((f) => [f.rule, f.threshold])).toEqual([["HighBlindHoleLengthToDiameterRatio", 1.5]]);
  });

  it("InsufficientInternalRadius and InsufficientExternalRadius: a sharp concave edge has radius 0 (limit 3 mm); a sharp convex edge has radius 0 (limit 0.3 mm)", () => {
    const out = evaluate(result({ features: [feature("SharpEdge:1", "SharpEdge", { length_mm: 40, convex: 0, edges: 1 }), feature("SharpEdge:2", "SharpEdge", { length_mm: 40, convex: 1, edges: 1 })] }));
    expect(out.findings.map((f) => [f.rule, f.featureIds[0], f.measured, f.threshold])).toEqual([
      ["InsufficientExternalRadius", "SharpEdge:2", 0, 0.3],
      ["InsufficientInternalRadius", "SharpEdge:1", 0, 3],
    ]);
  });
});

describe("evaluateSandDfm: thin walls found where they are (per face)", () => {
  it("aluminium (limit 3 mm): a face whose thinnest wall is 2.5 or 2.9 is Major and carries its face; 3.0 (not below) and 3.2 pass", () => {
    const out = evaluate(result({ wall: wallWith([4, 2.5], [5, 2.9], [6, 3.2], [7, 3]) }), "Aluminum");
    expect(out.findings.filter((f) => f.rule === "ThinSection").map((f) => [f.faces, f.severity, f.measured, f.threshold])).toEqual([
      [[4], "Major", 2.5, 3],
      [[5], "Major", 2.9, 3],
    ]);
  });

  it("the limit is the material's: brass (2.3 mm) accepts the 2.5 mm face", () => {
    expect(evaluate(result({ wall: wallWith([4, 2.5]) }), "Brass").findings.filter((f) => f.rule === "ThinSection")).toEqual([]);
  });

  it("the faces judge the part where they are present, whatever the part's overall figure says; without them the part's figure judges", () => {
    // overall 5th percentile 1 mm (thin) but every face measured over 3: the faces rule
    const thinOverall = { min: 1, nominal: 10, max: 50, samples: 9 };
    expect(evaluate(result({ wall: { ...thinOverall, faces: [{ face: 0, min: 4, samples: 2 }] } }), "Aluminum").findings.some((f) => f.rule === "ThinSection")).toBe(false);
    const whole = evaluate(result({ wall: thinOverall }), "Aluminum").findings.filter((f) => f.rule === "ThinSection");
    expect(whole).toEqual([expect.objectContaining({ measured: 1, faces: [], featureIds: [] })]);
  });

  it("a face entry that is not a whole face number with a finite thickness is ignored", () => {
    const out = evaluate(result({ wall: { min: 5, nominal: 10, max: 50, samples: 9, faces: [{ face: "a", min: 1 }, { face: 1.5, min: 1 }, { face: 2, min: "x" }, null, { face: 3, min: 1 }] } }), "Aluminum");
    expect(out.findings.filter((f) => f.rule === "ThinSection").map((f) => f.faces[0])).toEqual([3]);
  });

  it("a part whose every face is thick enough passes the rule", () => {
    expect(evaluate(result({ wall: wallWith([0, 10], [1, 20]) }), "Aluminum").passed).toContain("ThinSection");
  });
});

describe("evaluateSandDfm: draft angle (the rule's thresholds: below 0.01 degrees Critical, below 0.5 Major)", () => {
  const face = (face: number, min_deg: number) => ({ face, side: "c", min_deg, max_deg: min_deg });
  const withDraft = (...faces: Array<ReturnType<typeof face>>) => evaluate(result({ draft: { parting_planar: true, at_parting_plane: 0, unmeasured: 0, faces } }));

  it("a wall with no taper is Critical, 0.4 degrees is Major, 0.5 and 3 degrees pass, a floor at 90 passes, an undercut is Critical; each finding carries its face", () => {
    const out = withDraft(face(0, 0), face(1, 0.4), face(2, 0.5), face(3, 3), face(4, 90), face(5, -90));
    expect(out.findings.map((f) => [f.faces[0], f.severity, f.measured, f.threshold])).toEqual([
      [0, "Critical", 0, 0.01],
      [5, "Critical", -90, 0.01],
      [1, "Major", 0.4, 0.5],
    ]);
    expect(out.findings.every((f) => f.rule === "InsufficientDraftAngle" && f.featureIds.length === 0 && f.comparison === "<" && f.unit === "degrees")).toBe(true);
    expect(out.notEvaluated.map((n) => n.rule)).not.toContain("InsufficientDraftAngle");
  });

  it("every face drafted: the rule passes", () => {
    const out = withDraft(face(0, 2), face(1, 5), face(2, 90));
    expect(out.findings.filter((f) => f.rule === "InsufficientDraftAngle")).toEqual([]);
    expect(out.passed).toContain("InsufficientDraftAngle");
  });

  it("without draft angles in the analysis (no parting line, or an older worker) it is not evaluated, with the reason, not passed", () => {
    const out = evaluate(result());
    expect(out.passed).not.toContain("InsufficientDraftAngle");
    expect(out.notEvaluated).toContainEqual({ rule: "InsufficientDraftAngle", reason: expect.stringMatching(/no draft angles.*worker is older than 0\.14\.0/) });
  });

  it("a face entry that is not a whole face number with a finite angle is ignored, not read as zero", () => {
    const out = evaluate(result({ draft: { faces: [{ face: "a", min_deg: 0 }, { face: 1.5, min_deg: 0 }, { face: 2, min_deg: "x" }, null, face(3, 0)] } }));
    expect(out.findings.filter((f) => f.rule === "InsufficientDraftAngle").map((f) => f.faces[0])).toEqual([3]);
  });
});

describe("evaluateSandDfm: what it does not claim", () => {
  it("lists the rules the analysis cannot measure, with the reason, and never as passed", () => {
    const out = evaluate(result());
    const not = Object.fromEntries(out.notEvaluated.map((n) => [n.rule, n.reason]));
    expect(not["InsufficientDraftAngle"]).toMatch(/draft angles/);
    expect(not["ClosedVoid"]).toMatch(/open to the outside/);
    expect(not["TightToleranceFlatness"]).toMatch(/drawing tolerances/);
    expect(out.passed).not.toContain("InsufficientDraftAngle");
    expect(out.passed).not.toContain("ClosedVoid");
  });

  it("does not judge a material the rule has no row for", () => {
    const out = evaluate(result(), "Unobtainium");
    expect(out.notEvaluated).toContainEqual({ rule: "ThinSection", reason: "the rule has no row for Unobtainium" });
    expect(out.findings.some((f) => f.rule === "ThinSection")).toBe(false);
  });

  it("does not judge a part with no material type", () => {
    expect(evaluate(result(), null).notEvaluated).toContainEqual({ rule: "ThinSection", reason: "the rule has no row for a part with no material type" });
  });

  it("a wall that was not measured is not evaluated, not passed", () => {
    const out = evaluate(result({ wall: null }));
    expect(out.notEvaluated).toContainEqual({ rule: "ThinSection", reason: "the wall thickness was not measured" });
    expect(out.passed).not.toContain("ThinSection");
  });

  it("a rule the advice rules do not enable is not evaluated", () => {
    const out = evaluateSandDfm(result({ wall: { min: 1, nominal: 5, max: 9, samples: 3 } }), "Aluminum", { ...REF, adviceRules: ADVICE.filter((a) => a["Advice Rule Name"] !== "ThinSection") });
    if ("reason" in out) throw new Error(out.reason);
    expect(out.findings.some((f) => f.rule === "ThinSection")).toBe(false);
    expect(out.notEvaluated).toContainEqual({ rule: "ThinSection", reason: "not enabled in the advice rules" });
  });

  it("an analysis of several parts, or none, is not judged", () => {
    expect(evaluateSandDfm({ parts: [{}, {}] }, "Aluminum", REF)).toEqual({ reason: "the analysis has 2 distinct parts: the checks are for one part" });
    expect(evaluateSandDfm({ parts: [] }, "Aluminum", REF)).toEqual({ reason: "the analysis has no part" });
    expect(analysedPartOf(null)).toEqual({ reason: "the analysis has no part" });
  });
});

describe("evaluateSandDfm: order", () => {
  it("lists Critical before Major before Minor", () => {
    const out = evaluate(result({ wall: { min: 2, nominal: 5, max: 150, samples: 4 }, features: [feature("SimpleHole:1", "SimpleHole", { diameter_mm: 3, depth_mm: 3, through: 1, l_over_d: 1 })] }));
    expect(out.findings.map((f) => f.severity)).toEqual(["Critical", "Major", "Minor"]);
  });
});
