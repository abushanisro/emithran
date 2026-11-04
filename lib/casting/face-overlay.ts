/**
 * The overlays that colour the worker's mesh face by face: each measured face by what a design check found about it (its draft angle, its wall thickness). Pure,
 * so it is tested. The thresholds are the published rules' (the severity table, applied by the backend); this only maps a finding's severity to a colour, and a
 * measured face with no finding to "ok".
 */
import type { DfmFinding, DfmSeverity } from "@/lib/api/casting-analyses";

export type OverlayKind = "draft" | "wall";

/** What each overlay shows: the design check whose findings colour the faces, and the words for the control. */
export const OVERLAYS: Record<
  OverlayKind,
  { rule: string; label: string; title: string }
> = {
  draft: {
    rule: "InsufficientDraftAngle",
    label: "Draft",
    title:
      "Each face coloured by the design check of its draft angle along the draw axis: red Critical (no taper or an undercut), amber Major, green fine.",
  },
  wall: {
    rule: "ThinSection",
    label: "Thin walls",
    title:
      "Each face coloured by the design check of the thinnest wall measured from it, against the material's minimum wall: amber too thin, green fine.",
  },
};

export const OVERLAY_COLORS: Record<DfmSeverity | "ok", string> = {
  Critical: "#ef4444",
  Major: "#f59e0b",
  Minor: "#38bdf8",
  ok: "#22c55e",
};

const RANK: Record<DfmSeverity, number> = { Critical: 0, Major: 1, Minor: 2 };

/**
 * Face number to colour for one overlay. Every face that was measured is "ok" unless a finding of the overlay's rule names it; a face with several findings takes
 * the most severe. Without the design checks (not yet read, or no analysis) there is nothing to colour, so the map is empty rather than painting faces green unchecked.
 */
export function overlayFaceColors(
  kind: OverlayKind,
  findings: readonly DfmFinding[] | null | undefined,
  measuredFaces: readonly number[],
): Map<number, string> {
  const colors = new Map<number, string>();
  if (!findings) return colors;
  for (const face of measuredFaces) colors.set(face, OVERLAY_COLORS.ok);
  const worst = new Map<number, DfmSeverity>();
  for (const f of findings) {
    if (f.rule !== OVERLAYS[kind].rule) continue;
    for (const face of f.faces) {
      const seen = worst.get(face);
      if (!seen || RANK[f.severity] < RANK[seen]) worst.set(face, f.severity);
    }
  }
  for (const [face, severity] of worst) colors.set(face, OVERLAY_COLORS[severity]);
  return colors;
}
