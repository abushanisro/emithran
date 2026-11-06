/**
 * The engineer's pull (mold-opening) direction in words and the checks before it is sent. Pure, so it is tested. The backend checks again (axis x, y or z;
 * a reason of 3 to 500 characters) and the database constraints below that; this only saves a round trip and says what is wrong.
 */
import type { PlasticPullDirection, PullAxis } from "@/lib/api/plastic-pull-direction";

export const PULL_AXES: readonly PullAxis[] = ["x", "y", "z"];
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** What is wrong with the input, or null when it can be sent. */
export function pullDirectionError(input: { axis: string; reason: string }, current: PullAxis | null): string | null {
  if (!PULL_AXES.includes(input.axis as PullAxis)) return "Choose the axis the mold opens along: X, Y or Z.";
  if (input.axis === current) return `The pull direction is already ${input.axis.toUpperCase()}.`;
  const reason = input.reason.trim();
  if (reason.length < REASON_MIN) return `Say why the automatic choice is overridden (at least ${REASON_MIN} characters).`;
  if (reason.length > REASON_MAX) return `The reason is too long (at most ${REASON_MAX} characters).`;
  return null;
}

/** An engineer's choice that does not apply to the item's file now: the axis they chose and why it is held back. Null when there is none or it applies. */
export function heldBack(d: PlasticPullDirection | undefined): { axis: PullAxis; notice: string } | null {
  if (!d?.declaredAxis || d.status !== "needs_confirmation") return null;
  return { axis: d.declaredAxis, notice: d.notice ?? "The pull direction is not applied." };
}

export function describePullDirection(d: PlasticPullDirection | undefined): string {
  if (d?.axis) return `Fixed to ${d.axis.toUpperCase()} by an engineer`;
  const held = heldBack(d);
  if (held) return `Automatic for now: the pull direction ${held.axis.toUpperCase()} is held back`;
  return "Automatic: the CAD engine chooses (fewest undercut faces, then the largest projected area)";
}
