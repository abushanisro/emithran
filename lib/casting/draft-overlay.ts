/**
 * The colours of the draft overlay: each face of the worker's mesh by what the design check found about its draft angle. Pure, so it is tested. The thresholds are
 * the published rule's (the severity table, applied by the backend); this only maps a finding's severity to a colour, and a measured face with no finding to "ok".
 */
import type { DfmFinding, DfmSeverity } from "@/lib/api/casting-analyses";

export const DRAFT_RULE = "InsufficientDraftAngle";

export const DRAFT_COLORS: Record<DfmSeverity | "ok", string> = {
  Critical: "#ef4444",
  Major: "#f59e0b",
  Minor: "#38bdf8",
  ok: "#22c55e",
};

const RANK: Record<DfmSeverity, number> = { Critical: 0, Major: 1, Minor: 2 };

/**
 * Face number to colour. Every face whose draft was measured is "ok" unless a finding names it; a face with several findings takes the most severe.
 * Without the design checks (not yet read, or no analysis) there is nothing to colour, so the map is empty rather than painting faces green unchecked.
 */
export function draftFaceColors(
  findings: readonly DfmFinding[] | null | undefined,
  measuredFaces: readonly number[],
): Map<number, string> {
  const colors = new Map<number, string>();
  if (!findings) return colors;
  for (const face of measuredFaces) colors.set(face, DRAFT_COLORS.ok);
  const worst = new Map<number, DfmSeverity>();
  for (const f of findings) {
    if (f.rule !== DRAFT_RULE) continue;
    for (const face of f.faces) {
      const seen = worst.get(face);
      if (!seen || RANK[f.severity] < RANK[seen]) worst.set(face, f.severity);
    }
  }
  for (const [face, severity] of worst) colors.set(face, DRAFT_COLORS[severity]);
  return colors;
}
