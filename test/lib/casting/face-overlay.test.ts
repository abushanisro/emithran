import { describe, expect, it } from "vitest";
import type { DfmFinding } from "@/lib/api/casting-analyses";
import { OVERLAYS, OVERLAY_COLORS, overlayFaceColors } from "@/lib/casting/face-overlay";

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
  unit: null,
  note: null,
  featureIds: [],
  faces,
});
const DRAFT = OVERLAYS.draft.rule;
const WALL = OVERLAYS.wall.rule;

describe("overlayFaceColors", () => {
  it("colours a face by its finding and a measured face with none as ok", () => {
    const colors = overlayFaceColors(
      "draft",
      [finding(DRAFT, "Critical", [1]), finding(DRAFT, "Major", [2])],
      [0, 1, 2, 3],
    );
    expect([...colors]).toEqual([
      [0, OVERLAY_COLORS.ok],
      [1, OVERLAY_COLORS.Critical],
      [2, OVERLAY_COLORS.Major],
      [3, OVERLAY_COLORS.ok],
    ]);
  });

  it("a face with several findings takes the most severe", () => {
    const colors = overlayFaceColors(
      "draft",
      [
        finding(DRAFT, "Major", [4]),
        finding(DRAFT, "Critical", [4]),
        finding(DRAFT, "Minor", [4]),
      ],
      [4],
    );
    expect(colors.get(4)).toBe(OVERLAY_COLORS.Critical);
  });

  it("each overlay is coloured only by its own rule: a draft finding does not colour the wall overlay, nor the other way round", () => {
    const findings = [finding(DRAFT, "Critical", [7]), finding(WALL, "Major", [8])];
    const draft = overlayFaceColors("draft", findings, [7, 8]);
    const wall = overlayFaceColors("wall", findings, [7, 8]);
    expect([draft.get(7), draft.get(8)]).toEqual([
      OVERLAY_COLORS.Critical,
      OVERLAY_COLORS.ok,
    ]);
    expect([wall.get(7), wall.get(8)]).toEqual([OVERLAY_COLORS.ok, OVERLAY_COLORS.Major]);
  });

  it("without the design checks nothing is coloured, so no face is shown as fine unchecked", () => {
    expect(overlayFaceColors("wall", null, [0, 1]).size).toBe(0);
    expect(overlayFaceColors("draft", undefined, [0, 1]).size).toBe(0);
  });

  it("a finding on a face not listed as measured still colours it", () => {
    expect(overlayFaceColors("wall", [finding(WALL, "Major", [9])], []).get(9)).toBe(
      OVERLAY_COLORS.Major,
    );
  });

  it("the four classes are four different colours, and the two overlays use two different rules", () => {
    expect(new Set(Object.values(OVERLAY_COLORS)).size).toBe(4);
    expect(DRAFT).not.toBe(WALL);
  });
});
