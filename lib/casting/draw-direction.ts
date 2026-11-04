/**
 * The engineer's draw direction in words and the checks before it is sent. Pure, so it is tested. The backend checks again (axis x, y or z;
 * a reason of 3 to 500 characters) and the database constraints below that; this only saves a round trip and says what is wrong.
 */
import type {
  CastingAnalysisSummary,
  CastingDrawDirection,
  DrawAxis,
  DrawDirection,
} from "@/lib/api/casting-analyses";

export const DRAW_AXES: readonly DrawAxis[] = ["x", "y", "z"];
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** The analyses made along `direction`: an automatic analysis never answers an override, nor the other way round. */
export function analysesForDirection<
  T extends Pick<CastingAnalysisSummary, "drawDirection">,
>(list: readonly T[], direction: DrawDirection): T[] {
  return list.filter((a) => a.drawDirection === direction);
}

/** The direction the item asks for: the engineer's axis, else automatic. */
export const directionOf = (d: CastingDrawDirection | undefined): DrawDirection =>
  d?.axis ?? "auto";

/** What is wrong with the input, or null when it can be sent. */
export function drawDirectionError(
  input: { axis: string; reason: string },
  current: DrawAxis | null,
): string | null {
  if (!DRAW_AXES.includes(input.axis as DrawAxis))
    return "Choose the axis the mould opens along: X, Y or Z.";
  if (input.axis === current)
    return `The draw direction is already ${input.axis.toUpperCase()}.`;
  const reason = input.reason.trim();
  if (reason.length < REASON_MIN)
    return `Say why the automatic choice is overridden (at least ${REASON_MIN} characters).`;
  if (reason.length > REASON_MAX)
    return `The reason is too long (at most ${REASON_MAX} characters).`;
  return null;
}

/** One line for the current state; `autoAxis` is the axis the worker chose, when an automatic analysis is shown. */
/**
 * An engineer's choice that does not apply to the item's file now (it was replaced by a file that is a different geometry, or one not yet compared): the axis
 * they chose, why it is held back, and whether it can be confirmed for the new file. Null when there is none or it applies.
 */
export function heldBack(
  d: CastingDrawDirection | undefined,
): { axis: DrawAxis; notice: string; pending: boolean } | null {
  if (!d?.declaredAxis || !d.status || d.status === "in_force") return null;
  return {
    axis: d.declaredAxis,
    notice: d.notice ?? "The draw direction is not applied.",
    pending: d.status === "pending",
  };
}

export function describeDrawDirection(
  d: CastingDrawDirection | undefined,
  autoAxis: DrawAxis | null,
): string {
  if (d?.axis) return `Fixed to ${d.axis.toUpperCase()} by an engineer`;
  const held = heldBack(d);
  if (held)
    return `Automatic for now: the draw direction ${held.axis.toUpperCase()} is held back`;
  return autoAxis
    ? `Automatic: the worker chose ${autoAxis.toUpperCase()} (fewest hidden regions, then shallowest)`
    : "Automatic: the worker chooses (fewest hidden regions, then shallowest)";
}
