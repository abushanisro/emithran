import { describe, expect, it } from "vitest";
import type { DfmFinding } from "@/lib/api/casting-analyses";
import { DRAFT_COLORS, DRAFT_RULE, draftFaceColors } from "@/lib/casting/draft-overlay";

const finding = (
  rule: string,
  severity: DfmFinding["severity"],
  faces: number[],
): DfmFinding => ({
  rule,
  title: rule,
  severity,
  measured: 0,
  threshold: 0.01,
  comparison: "<",
  unit: "degrees",
  note: null,
  featureIds: [],
  faces,
});

describe("draftFaceColors", () => {
  it("colours a face by its finding and a measured face with none as ok", () => {
    const colors = draftFaceColors(
      [finding(DRAFT_RULE, "Critical", [1]), finding(DRAFT_RULE, "Major", [2])],
      [0, 1, 2, 3],
    );
    expect([...colors]).toEqual([
      [0, DRAFT_COLORS.ok],
      [1, DRAFT_COLORS.Critical],
      [2, DRAFT_COLORS.Major],
      [3, DRAFT_COLORS.ok],
    ]);
  });

  it("a face with several findings takes the most severe", () => {
    const colors = draftFaceColors(
      [
        finding(DRAFT_RULE, "Major", [4]),
        finding(DRAFT_RULE, "Critical", [4]),
        finding(DRAFT_RULE, "Minor", [4]),
      ],
      [4],
    );
    expect(colors.get(4)).toBe(DRAFT_COLORS.Critical);
  });

  it("only the draft rule colours: another rule's finding on the same face does not", () => {
    const colors = draftFaceColors([finding("ThinSection", "Critical", [7])], [7]);
    expect(colors.get(7)).toBe(DRAFT_COLORS.ok);
  });

  it("without the design checks nothing is coloured, so no face is shown as fine unchecked", () => {
    expect(draftFaceColors(null, [0, 1]).size).toBe(0);
    expect(draftFaceColors(undefined, [0, 1]).size).toBe(0);
  });

  it("a finding on a face the worker did not list as measured still colours it", () => {
    expect(draftFaceColors([finding(DRAFT_RULE, "Critical", [9])], []).get(9)).toBe(
      DRAFT_COLORS.Critical,
    );
  });

  it("the four classes are four different colours", () => {
    expect(new Set(Object.values(DRAFT_COLORS)).size).toBe(4);
  });
});
